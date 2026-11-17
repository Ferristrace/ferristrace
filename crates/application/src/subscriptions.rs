use ferristrace_domain::{
    BillingGateway, CheckoutUrl, GatewayError, Orgs, PortalUrl, SessionToken, StoreError,
    StripeSubscriptions, SubscriptionStatus, SubscriptionsError, TenantId, WebhookError, Whoami,
    WhoamiError,
};

use crate::registry::{OrgRepos, SubscriptionsRepos};
use crate::{Ferristrace, Stack, transactional};

#[derive(Debug, thiserror::Error)]
pub enum BillingError {
    #[error("no billing adapter is configured")]
    NotConfigured,
    #[error("this organisation has never started checkout")]
    NoSubscription,
    #[error("the billing gateway could not be reached")]
    Gateway(#[from] GatewayError),
    #[error("the control plane refused the subscription store")]
    StoreUnreachable,
    #[error("no such organisation")]
    NoSuchOrg,
    #[error("no live session carries this token")]
    NoSession,
    #[error("this organisation is not yours")]
    NotYours,
}

impl From<SubscriptionsError> for BillingError {
    fn from(_: SubscriptionsError) -> Self {
        Self::StoreUnreachable
    }
}

impl From<StoreError> for BillingError {
    fn from(_: StoreError) -> Self {
        Self::StoreUnreachable
    }
}

impl From<WhoamiError> for BillingError {
    fn from(error: WhoamiError) -> Self {
        match error {
            WhoamiError::NoSession => Self::NoSession,
            WhoamiError::StoreUnreachable => Self::StoreUnreachable,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum WebhookApplyError {
    #[error("no billing adapter is configured")]
    NotConfigured,
    #[error("the webhook could not be verified")]
    Verify(#[from] WebhookError),
    #[error("the control plane refused the subscription store")]
    StoreUnreachable,
}

impl From<SubscriptionsError> for WebhookApplyError {
    fn from(_: SubscriptionsError) -> Self {
        Self::StoreUnreachable
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BillingRead {
    pub plan: &'static str,
    pub status: Option<SubscriptionStatus>,
    pub period_end: Option<i64>,
}

impl<S: Stack> Ferristrace<S> {
    pub fn billing_enabled(&self) -> bool {
        self.billing.is_some()
    }
}

impl<S: Stack> Ferristrace<S>
where
    S::Repos: SubscriptionsRepos + OrgRepos,
{
    #[transactional(sessions, memberships, orgs, stripe_subscriptions, unavailable = BillingError::StoreUnreachable)]
    pub async fn billing_status(
        &self,
        token: &SessionToken,
        org: TenantId,
    ) -> Result<BillingRead, BillingError> {
        let who = Whoami::new(sessions, memberships).of(token).await?;
        if who.role_in(org).is_none() {
            return Err(BillingError::NotYours);
        }
        let organisation = orgs.only(org).await?.ok_or(BillingError::NoSuchOrg)?;
        let plan = if organisation.plan.eq_ignore_ascii_case("pro") {
            "pro"
        } else {
            "free"
        };
        let subscription = stripe_subscriptions.of(org).await?;
        Ok(BillingRead {
            plan,
            status: subscription.as_ref().and_then(|found| found.status),
            period_end: subscription.and_then(|found| found.period_end),
        })
    }
}

impl<S: Stack> Ferristrace<S>
where
    S::Repos: SubscriptionsRepos,
{
    #[transactional(sessions, memberships, stripe_subscriptions, unavailable = BillingError::StoreUnreachable)]
    pub async fn start_checkout(
        &self,
        token: &SessionToken,
        org: TenantId,
        success_url: &str,
        cancel_url: &str,
    ) -> Result<CheckoutUrl, BillingError> {
        let who = Whoami::new(sessions, memberships).of(token).await?;
        if who.role_in(org).is_none() {
            return Err(BillingError::NotYours);
        }
        let Some(billing) = &self.billing else {
            return Err(BillingError::NotConfigured);
        };
        let existing = stripe_subscriptions
            .of(org)
            .await?
            .map(|found| found.customer);
        let (url, customer) = billing
            .checkout_url(org, existing.as_ref(), success_url, cancel_url)
            .await?;
        if existing.is_none() {
            stripe_subscriptions.link_customer(org, &customer).await?;
        }
        Ok(url)
    }

    #[transactional(sessions, memberships, stripe_subscriptions, unavailable = BillingError::StoreUnreachable)]
    pub async fn open_portal(
        &self,
        token: &SessionToken,
        org: TenantId,
        return_url: &str,
    ) -> Result<PortalUrl, BillingError> {
        let who = Whoami::new(sessions, memberships).of(token).await?;
        if who.role_in(org).is_none() {
            return Err(BillingError::NotYours);
        }
        let Some(billing) = &self.billing else {
            return Err(BillingError::NotConfigured);
        };
        let Some(subscription) = stripe_subscriptions.of(org).await? else {
            return Err(BillingError::NoSubscription);
        };
        Ok(billing
            .portal_url(&subscription.customer, return_url)
            .await?)
    }

    #[transactional(stripe_subscriptions, unavailable = WebhookApplyError::StoreUnreachable)]
    pub async fn apply_webhook(
        &self,
        signature: &str,
        body: &[u8],
    ) -> Result<(), WebhookApplyError> {
        let Some(billing) = &self.billing else {
            return Err(WebhookApplyError::NotConfigured);
        };
        let event = billing.verify(signature, body)?;
        stripe_subscriptions.apply(&event).await?;
        Ok(())
    }
}
