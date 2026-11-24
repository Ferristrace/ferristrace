use ferristrace_domain::{
    BillingAccounts, BillingGateway, CheckoutUrl, CurrentPlan, GatewayError, OrgRole, PlanOffer,
    PortalUrl, SessionToken, StoreError, SubscriptionStatus, SubscriptionsError, TenantId,
    WebhookError, Whoami, WhoamiError,
};

use crate::registry::BillingRepos;
use crate::{Ferristrace, Stack, transactional};

#[derive(Debug, thiserror::Error)]
pub enum BillingError {
    #[error("no billing adapter is configured")]
    NotConfigured,
    #[error("this organisation has never started checkout")]
    NoSubscription,
    #[error("no plan with this slug can be bought")]
    NoSuchOffer,
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
    #[error("only an owner manages billing")]
    NotOwner,
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
    pub plan: CurrentPlan,
    pub payments: bool,
    pub upgrade: Option<PlanOffer>,
    pub portal: bool,
    pub owner: bool,
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
    S::Repos: BillingRepos,
{
    #[transactional(sessions, memberships, billing_accounts, unavailable = BillingError::StoreUnreachable)]
    pub async fn billing_status(
        &self,
        token: &SessionToken,
        org: TenantId,
    ) -> Result<BillingRead, BillingError> {
        let who = Whoami::new(sessions, memberships).of(token).await?;
        if who.role_in(org).is_none() {
            return Err(BillingError::NotYours);
        }
        let plan = billing_accounts
            .plan_of(org)
            .await?
            .ok_or(BillingError::NoSuchOrg)?;
        let payments = self.billing.is_some();
        let upgrade = if payments && !plan.priced {
            billing_accounts.offers().await?.into_iter().next()
        } else {
            None
        };
        let subscription = billing_accounts.of(org).await?;
        Ok(BillingRead {
            plan,
            payments,
            upgrade,
            portal: payments && subscription.is_some(),
            owner: who.role_in(org) == Some(OrgRole::Owner),
            status: subscription.as_ref().and_then(|found| found.status),
            period_end: subscription.and_then(|found| found.period_end),
        })
    }

    #[transactional(sessions, memberships, billing_accounts, unavailable = BillingError::StoreUnreachable)]
    pub async fn start_checkout(
        &self,
        token: &SessionToken,
        org: TenantId,
        plan: &str,
        success_url: &str,
        cancel_url: &str,
    ) -> Result<CheckoutUrl, BillingError> {
        let Some(billing) = &self.billing else {
            return Err(BillingError::NotConfigured);
        };
        let who = Whoami::new(sessions, memberships).of(token).await?;
        owner_of(who.role_in(org))?;
        let offer = billing_accounts
            .offers()
            .await?
            .into_iter()
            .find(|offer| offer.slug.as_str() == plan)
            .ok_or(BillingError::NoSuchOffer)?;
        let existing = billing_accounts.of(org).await?.map(|found| found.customer);
        let (url, customer) = billing
            .checkout_url(
                org,
                existing.as_ref(),
                &offer.price,
                offer.overage_price.as_ref(),
                success_url,
                cancel_url,
            )
            .await?;
        if existing.as_ref() != Some(&customer) {
            billing_accounts.link_customer(org, &customer).await?;
        }
        Ok(url)
    }

    #[transactional(sessions, memberships, billing_accounts, unavailable = BillingError::StoreUnreachable)]
    pub async fn open_portal(
        &self,
        token: &SessionToken,
        org: TenantId,
        return_url: &str,
    ) -> Result<PortalUrl, BillingError> {
        let Some(billing) = &self.billing else {
            return Err(BillingError::NotConfigured);
        };
        let who = Whoami::new(sessions, memberships).of(token).await?;
        owner_of(who.role_in(org))?;
        let Some(subscription) = billing_accounts.of(org).await? else {
            return Err(BillingError::NoSubscription);
        };
        Ok(billing
            .portal_url(&subscription.customer, return_url)
            .await?)
    }

    #[transactional(billing_accounts, unavailable = WebhookApplyError::StoreUnreachable)]
    pub async fn apply_webhook(
        &self,
        signature: &str,
        body: &[u8],
    ) -> Result<(), WebhookApplyError> {
        let Some(billing) = &self.billing else {
            return Err(WebhookApplyError::NotConfigured);
        };
        let event = billing.verify(signature, body)?;
        billing_accounts.apply(&event).await?;
        Ok(())
    }
}

fn owner_of(role: Option<OrgRole>) -> Result<(), BillingError> {
    match role {
        None => Err(BillingError::NotYours),
        Some(OrgRole::Owner) => Ok(()),
        Some(_) => Err(BillingError::NotOwner),
    }
}
