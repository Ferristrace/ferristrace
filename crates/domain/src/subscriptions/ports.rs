use core::future::Future;

use super::entities::Subscription;
use super::errors::{GatewayError, SubscriptionsError, WebhookError};
use super::value_objects::{
    CheckoutUrl, PortalUrl, StripeCustomerId, StripeEventId, StripePriceId, StripeSubscriptionId,
    SubscriptionStatus,
};
use crate::telemetry::{BillingHour, DecompressedBytes, TenantId};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WebhookEvent {
    Activated {
        event: StripeEventId,
        org: TenantId,
        customer: StripeCustomerId,
        subscription: StripeSubscriptionId,
        price: StripePriceId,
        status: SubscriptionStatus,
        period_end: i64,
    },
    RetriesExhausted {
        event: StripeEventId,
        customer: StripeCustomerId,
    },
    Ignored {
        event: StripeEventId,
    },
}

impl WebhookEvent {
    pub fn id(&self) -> &StripeEventId {
        match self {
            Self::Activated { event, .. }
            | Self::RetriesExhausted { event, .. }
            | Self::Ignored { event } => event,
        }
    }
}

pub trait BillingGateway {
    fn checkout_url(
        &self,
        org: TenantId,
        customer: Option<&StripeCustomerId>,
        success_url: &str,
        cancel_url: &str,
    ) -> impl Future<Output = Result<(CheckoutUrl, StripeCustomerId), GatewayError>> + Send;

    fn portal_url(
        &self,
        customer: &StripeCustomerId,
        return_url: &str,
    ) -> impl Future<Output = Result<PortalUrl, GatewayError>> + Send;

    fn report_usage(
        &self,
        customer: &StripeCustomerId,
        hour: BillingHour,
        over_by: DecompressedBytes,
    ) -> impl Future<Output = Result<(), GatewayError>> + Send;

    fn verify(&self, signature: &str, body: &[u8]) -> Result<WebhookEvent, WebhookError>;
}

impl<T: BillingGateway + Sync> BillingGateway for &T {
    fn checkout_url(
        &self,
        org: TenantId,
        customer: Option<&StripeCustomerId>,
        success_url: &str,
        cancel_url: &str,
    ) -> impl Future<Output = Result<(CheckoutUrl, StripeCustomerId), GatewayError>> + Send {
        (*self).checkout_url(org, customer, success_url, cancel_url)
    }

    fn portal_url(
        &self,
        customer: &StripeCustomerId,
        return_url: &str,
    ) -> impl Future<Output = Result<PortalUrl, GatewayError>> + Send {
        (*self).portal_url(customer, return_url)
    }

    fn report_usage(
        &self,
        customer: &StripeCustomerId,
        hour: BillingHour,
        over_by: DecompressedBytes,
    ) -> impl Future<Output = Result<(), GatewayError>> + Send {
        (*self).report_usage(customer, hour, over_by)
    }

    fn verify(&self, signature: &str, body: &[u8]) -> Result<WebhookEvent, WebhookError> {
        (*self).verify(signature, body)
    }
}

impl<T: BillingGateway + Send + Sync> BillingGateway for std::sync::Arc<T> {
    fn checkout_url(
        &self,
        org: TenantId,
        customer: Option<&StripeCustomerId>,
        success_url: &str,
        cancel_url: &str,
    ) -> impl Future<Output = Result<(CheckoutUrl, StripeCustomerId), GatewayError>> + Send {
        self.as_ref()
            .checkout_url(org, customer, success_url, cancel_url)
    }

    fn portal_url(
        &self,
        customer: &StripeCustomerId,
        return_url: &str,
    ) -> impl Future<Output = Result<PortalUrl, GatewayError>> + Send {
        self.as_ref().portal_url(customer, return_url)
    }

    fn report_usage(
        &self,
        customer: &StripeCustomerId,
        hour: BillingHour,
        over_by: DecompressedBytes,
    ) -> impl Future<Output = Result<(), GatewayError>> + Send {
        self.as_ref().report_usage(customer, hour, over_by)
    }

    fn verify(&self, signature: &str, body: &[u8]) -> Result<WebhookEvent, WebhookError> {
        self.as_ref().verify(signature, body)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Applied {
    New,
    AlreadyApplied,
}

pub trait StripeSubscriptions {
    fn of(
        &self,
        org: TenantId,
    ) -> impl Future<Output = Result<Option<Subscription>, SubscriptionsError>> + Send;

    fn link_customer(
        &self,
        org: TenantId,
        customer: &StripeCustomerId,
    ) -> impl Future<Output = Result<(), SubscriptionsError>> + Send;

    fn apply(
        &self,
        event: &WebhookEvent,
    ) -> impl Future<Output = Result<Applied, SubscriptionsError>> + Send;
}

impl<T: StripeSubscriptions + Sync> StripeSubscriptions for &T {
    fn of(
        &self,
        org: TenantId,
    ) -> impl Future<Output = Result<Option<Subscription>, SubscriptionsError>> + Send {
        (*self).of(org)
    }

    fn link_customer(
        &self,
        org: TenantId,
        customer: &StripeCustomerId,
    ) -> impl Future<Output = Result<(), SubscriptionsError>> + Send {
        (*self).link_customer(org, customer)
    }

    fn apply(
        &self,
        event: &WebhookEvent,
    ) -> impl Future<Output = Result<Applied, SubscriptionsError>> + Send {
        (*self).apply(event)
    }
}
