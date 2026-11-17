use core::future::Future;

use super::entities::{CurrentPlan, PlanOffer, Subscription};
use super::errors::{GatewayError, SubscriptionsError, WebhookError};
use super::value_objects::{
    BillingEventId, CheckoutUrl, CustomerRef, PortalUrl, PriceRef, SubscriptionRef,
    SubscriptionStatus,
};
use crate::telemetry::{BillingHour, DecompressedBytes, TenantId};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubscriptionChange {
    pub at: i64,
    pub org: Option<TenantId>,
    pub customer: CustomerRef,
    pub subscription: SubscriptionRef,
    pub price: Option<PriceRef>,
    pub status: SubscriptionStatus,
    pub period_end: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WebhookEvent {
    Changed {
        event: BillingEventId,
        change: SubscriptionChange,
    },
    Ignored {
        event: BillingEventId,
    },
}

impl WebhookEvent {
    pub fn id(&self) -> &BillingEventId {
        match self {
            Self::Changed { event, .. } | Self::Ignored { event } => event,
        }
    }
}

pub trait BillingGateway {
    fn checkout_url(
        &self,
        org: TenantId,
        customer: Option<&CustomerRef>,
        price: &PriceRef,
        success_url: &str,
        cancel_url: &str,
    ) -> impl Future<Output = Result<(CheckoutUrl, CustomerRef), GatewayError>> + Send;

    fn portal_url(
        &self,
        customer: &CustomerRef,
        return_url: &str,
    ) -> impl Future<Output = Result<PortalUrl, GatewayError>> + Send;

    fn report_usage(
        &self,
        customer: &CustomerRef,
        hour: BillingHour,
        over_by: DecompressedBytes,
    ) -> impl Future<Output = Result<(), GatewayError>> + Send;

    fn verify(&self, signature: &str, body: &[u8]) -> Result<WebhookEvent, WebhookError>;
}

impl<T: BillingGateway + Sync> BillingGateway for &T {
    fn checkout_url(
        &self,
        org: TenantId,
        customer: Option<&CustomerRef>,
        price: &PriceRef,
        success_url: &str,
        cancel_url: &str,
    ) -> impl Future<Output = Result<(CheckoutUrl, CustomerRef), GatewayError>> + Send {
        (*self).checkout_url(org, customer, price, success_url, cancel_url)
    }

    fn portal_url(
        &self,
        customer: &CustomerRef,
        return_url: &str,
    ) -> impl Future<Output = Result<PortalUrl, GatewayError>> + Send {
        (*self).portal_url(customer, return_url)
    }

    fn report_usage(
        &self,
        customer: &CustomerRef,
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
        customer: Option<&CustomerRef>,
        price: &PriceRef,
        success_url: &str,
        cancel_url: &str,
    ) -> impl Future<Output = Result<(CheckoutUrl, CustomerRef), GatewayError>> + Send {
        self.as_ref()
            .checkout_url(org, customer, price, success_url, cancel_url)
    }

    fn portal_url(
        &self,
        customer: &CustomerRef,
        return_url: &str,
    ) -> impl Future<Output = Result<PortalUrl, GatewayError>> + Send {
        self.as_ref().portal_url(customer, return_url)
    }

    fn report_usage(
        &self,
        customer: &CustomerRef,
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

pub trait BillingAccounts {
    fn of(
        &self,
        org: TenantId,
    ) -> impl Future<Output = Result<Option<Subscription>, SubscriptionsError>> + Send;

    fn plan_of(
        &self,
        org: TenantId,
    ) -> impl Future<Output = Result<Option<CurrentPlan>, SubscriptionsError>> + Send;

    fn offers(&self) -> impl Future<Output = Result<Vec<PlanOffer>, SubscriptionsError>> + Send;

    fn link_customer(
        &self,
        org: TenantId,
        customer: &CustomerRef,
    ) -> impl Future<Output = Result<(), SubscriptionsError>> + Send;

    fn apply(
        &self,
        event: &WebhookEvent,
    ) -> impl Future<Output = Result<Applied, SubscriptionsError>> + Send;
}

impl<T: BillingAccounts + Sync> BillingAccounts for &T {
    fn of(
        &self,
        org: TenantId,
    ) -> impl Future<Output = Result<Option<Subscription>, SubscriptionsError>> + Send {
        (*self).of(org)
    }

    fn plan_of(
        &self,
        org: TenantId,
    ) -> impl Future<Output = Result<Option<CurrentPlan>, SubscriptionsError>> + Send {
        (*self).plan_of(org)
    }

    fn offers(&self) -> impl Future<Output = Result<Vec<PlanOffer>, SubscriptionsError>> + Send {
        (*self).offers()
    }

    fn link_customer(
        &self,
        org: TenantId,
        customer: &CustomerRef,
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
