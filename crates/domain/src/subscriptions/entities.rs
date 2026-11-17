use super::value_objects::{CustomerRef, PlanSlug, PriceRef, SubscriptionRef, SubscriptionStatus};
use crate::telemetry::TenantId;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Subscription {
    pub org: TenantId,
    pub customer: CustomerRef,
    pub subscription: Option<SubscriptionRef>,
    pub status: Option<SubscriptionStatus>,
    pub period_end: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CurrentPlan {
    pub slug: PlanSlug,
    pub name: Box<str>,
    pub priced: bool,
    pub ingest_gb: Option<u32>,
    pub retention_days: Option<u32>,
    pub overage: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanOffer {
    pub slug: PlanSlug,
    pub name: Box<str>,
    pub price: PriceRef,
}
