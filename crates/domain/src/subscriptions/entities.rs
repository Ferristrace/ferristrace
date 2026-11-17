use super::value_objects::{StripeCustomerId, StripePriceId, StripeSubscriptionId, SubscriptionStatus};
use crate::telemetry::TenantId;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Subscription {
    pub org: TenantId,
    pub customer: StripeCustomerId,
    pub subscription: Option<StripeSubscriptionId>,
    pub status: Option<SubscriptionStatus>,
    pub price: Option<StripePriceId>,
    pub period_end: Option<i64>,
}
