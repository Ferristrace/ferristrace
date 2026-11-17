use ferristrace_application::repository;
use ferristrace_domain::{
    Applied, BillingAccounts, BillingEventId, CurrentPlan, CustomerRef, PlanOffer, PlanSlug,
    PriceRef, Subscription, SubscriptionChange, SubscriptionRef, SubscriptionStatus,
    SubscriptionsError, TenantId, WebhookEvent,
};
use sqlx::postgres::PgRow;
use sqlx::{PgConnection, Row};
use uuid::Uuid;

use crate::postgres::{FALLBACK_PLAN, OVERAGE_FEATURE};
use crate::unit_of_work::{Postgres, SharedTx};

const OF: &str = "SELECT customer_ref, subscription_ref, status, period_end \
     FROM billing_subscriptions WHERE org_id = $1";

const PLAN_OF: &str = "SELECT p.slug AS slug, p.name AS name, p.price_ref IS NOT NULL AS priced, \
       p.ingest_gb AS ingest_gb, p.retention_days AS retention_days, \
       $2 = ANY (p.features) AS overage \
     FROM orgs o JOIN plans p ON p.id = o.plan_id WHERE o.id = $1";

const OFFERS: &str = "SELECT slug, name, price_ref FROM plans \
     WHERE price_ref IS NOT NULL ORDER BY ingest_gb NULLS LAST, slug";

const LINK_CUSTOMER: &str = "INSERT INTO billing_subscriptions (org_id, customer_ref) \
     VALUES ($1, $2) \
     ON CONFLICT (org_id) DO UPDATE SET customer_ref = excluded.customer_ref";

const RECORD_EVENT: &str =
    "INSERT INTO billing_events (event_id) VALUES ($1) ON CONFLICT (event_id) DO NOTHING";

const ORG_OF_CUSTOMER: &str = "SELECT org_id FROM billing_subscriptions WHERE customer_ref = $1";

const ORG_EXISTS: &str = "SELECT id AS org_id FROM orgs WHERE id = $1";

const MIRROR: &str = "INSERT INTO billing_subscriptions \
       (org_id, customer_ref, subscription_ref, status, period_end, event_at) \
     VALUES ($1, $2, $3, $4, $5, $6) \
     ON CONFLICT (org_id) DO UPDATE SET \
       customer_ref = excluded.customer_ref, \
       subscription_ref = excluded.subscription_ref, \
       status = excluded.status, \
       period_end = excluded.period_end, \
       event_at = excluded.event_at \
     WHERE billing_subscriptions.event_at <= excluded.event_at \
       AND (excluded.status <> 'canceled' \
         OR billing_subscriptions.subscription_ref IS NULL \
         OR billing_subscriptions.subscription_ref = excluded.subscription_ref)";

const SWITCH_TO_PRICED_PLAN: &str = "UPDATE orgs SET plan_id = p.id FROM plans p \
     WHERE p.price_ref = $1 AND orgs.id = $2";

const SWITCH_TO_FALLBACK_PLAN: &str = "UPDATE orgs SET plan_id = p.id FROM plans p \
     WHERE p.slug = $1 AND orgs.id = $2";

#[repository(domain = BillingAccounts, backend = Postgres<C>, generics = <C: Send + Sync + 'static>)]
#[derive(Debug)]
pub struct PostgresBillingAccounts {
    tx: SharedTx,
}

impl PostgresBillingAccounts {
    pub fn new<C>(_backend: &Postgres<C>, tx: &SharedTx) -> Self {
        Self { tx: tx.clone() }
    }
}

fn refused(what: &'static str) -> impl FnOnce(sqlx::Error) -> SubscriptionsError {
    move |error| {
        tracing::error!(%error, "the control plane refused to {what}");
        SubscriptionsError::ControlPlane
    }
}

impl BillingAccounts for PostgresBillingAccounts {
    async fn of(&self, org: TenantId) -> Result<Option<Subscription>, SubscriptionsError> {
        let mut tx = self.tx.lock().await;
        let found = sqlx::query(OF)
            .bind(org.as_uuid())
            .fetch_optional(&mut **tx)
            .await
            .map_err(refused("read a subscription"))?;
        Ok(found.as_ref().map(|row| read_subscription(org, row)))
    }

    async fn plan_of(&self, org: TenantId) -> Result<Option<CurrentPlan>, SubscriptionsError> {
        let mut tx = self.tx.lock().await;
        let found = sqlx::query(PLAN_OF)
            .bind(org.as_uuid())
            .bind(OVERAGE_FEATURE)
            .fetch_optional(&mut **tx)
            .await
            .map_err(refused("read a plan"))?;
        Ok(found.map(|row| CurrentPlan {
            slug: PlanSlug::new(row.get::<String, _>("slug")),
            name: row.get::<String, _>("name").into(),
            priced: row.get("priced"),
            ingest_gb: whole(&row, "ingest_gb"),
            retention_days: whole(&row, "retention_days"),
            overage: row.get("overage"),
        }))
    }

    async fn offers(&self) -> Result<Vec<PlanOffer>, SubscriptionsError> {
        let mut tx = self.tx.lock().await;
        let rows = sqlx::query(OFFERS)
            .fetch_all(&mut **tx)
            .await
            .map_err(refused("list the priced plans"))?;
        Ok(rows
            .iter()
            .map(|row| PlanOffer {
                slug: PlanSlug::new(row.get::<String, _>("slug")),
                name: row.get::<String, _>("name").into(),
                price: PriceRef::new(row.get::<String, _>("price_ref")),
            })
            .collect())
    }

    async fn link_customer(
        &self,
        org: TenantId,
        customer: &CustomerRef,
    ) -> Result<(), SubscriptionsError> {
        let mut tx = self.tx.lock().await;
        sqlx::query(LINK_CUSTOMER)
            .bind(org.as_uuid())
            .bind(customer.as_str())
            .execute(&mut **tx)
            .await
            .map_err(refused("link a billing customer"))?;
        Ok(())
    }

    async fn apply(&self, event: &WebhookEvent) -> Result<Applied, SubscriptionsError> {
        let mut tx = self.tx.lock().await;
        if !record_event(&mut **tx, event.id()).await? {
            return Ok(Applied::AlreadyApplied);
        }
        if let WebhookEvent::Changed { change, .. } = event {
            mirror(&mut **tx, change).await?;
        }
        Ok(Applied::New)
    }
}

async fn record_event(
    connection: &mut PgConnection,
    event: &BillingEventId,
) -> Result<bool, SubscriptionsError> {
    let recorded = sqlx::query(RECORD_EVENT)
        .bind(event.as_str())
        .execute(connection)
        .await
        .map_err(refused("record a billing event"))?;
    Ok(recorded.rows_affected() == 1)
}

async fn mirror(
    connection: &mut PgConnection,
    change: &SubscriptionChange,
) -> Result<(), SubscriptionsError> {
    let Some(org) = org_of(connection, change).await? else {
        tracing::warn!(
            customer = change.customer.as_str(),
            "a billing event names a customer no organisation is linked to"
        );
        return Ok(());
    };

    let mirrored = sqlx::query(MIRROR)
        .bind(org)
        .bind(change.customer.as_str())
        .bind(change.subscription.as_str())
        .bind(change.status.as_str())
        .bind(change.period_end)
        .bind(change.at)
        .execute(&mut *connection)
        .await
        .map_err(refused("mirror a subscription"))?;
    if mirrored.rows_affected() == 0 {
        tracing::info!(
            subscription = change.subscription.as_str(),
            "a billing event older than the mirrored state was skipped"
        );
        return Ok(());
    }

    switch_plan(connection, org, change).await
}

async fn org_of(
    connection: &mut PgConnection,
    change: &SubscriptionChange,
) -> Result<Option<Uuid>, SubscriptionsError> {
    let found = match change.org {
        Some(org) => sqlx::query(ORG_EXISTS).bind(org.as_uuid()),
        None => sqlx::query(ORG_OF_CUSTOMER).bind(change.customer.as_str()),
    }
    .fetch_optional(connection)
    .await
    .map_err(refused("find the organisation of a billing event"))?;
    Ok(found.map(|row| row.get("org_id")))
}

async fn switch_plan(
    connection: &mut PgConnection,
    org: Uuid,
    change: &SubscriptionChange,
) -> Result<(), SubscriptionsError> {
    if !change.status.keeps_the_paid_plan() {
        let switched = sqlx::query(SWITCH_TO_FALLBACK_PLAN)
            .bind(FALLBACK_PLAN)
            .bind(org)
            .execute(connection)
            .await
            .map_err(refused("move an organisation to the fallback plan"))?;
        if switched.rows_affected() == 0 {
            tracing::error!(
                plan = FALLBACK_PLAN,
                "a subscription ended but the fallback plan does not exist"
            );
        }
        return Ok(());
    }

    let Some(price) = &change.price else {
        tracing::warn!(
            subscription = change.subscription.as_str(),
            "a subscription carries no price, the plan is left as it is"
        );
        return Ok(());
    };
    let switched = sqlx::query(SWITCH_TO_PRICED_PLAN)
        .bind(price.as_str())
        .bind(org)
        .execute(connection)
        .await
        .map_err(refused("move an organisation to a priced plan"))?;
    if switched.rows_affected() == 0 {
        tracing::warn!(
            price = price.as_str(),
            "no plan carries this price, the plan is left as it is"
        );
    }
    Ok(())
}

fn whole(row: &PgRow, column: &str) -> Option<u32> {
    row.get::<Option<i32>, _>(column)
        .and_then(|value| u32::try_from(value).ok())
}

fn read_subscription(org: TenantId, row: &PgRow) -> Subscription {
    Subscription {
        org,
        customer: CustomerRef::new(row.get::<String, _>("customer_ref")),
        subscription: row
            .get::<Option<String>, _>("subscription_ref")
            .map(SubscriptionRef::new),
        status: row
            .get::<Option<String>, _>("status")
            .as_deref()
            .and_then(SubscriptionStatus::parse),
        period_end: row.get("period_end"),
    }
}
