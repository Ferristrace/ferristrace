use ferristrace_application::repository;
use ferristrace_domain::{
    Applied, StripeCustomerId, StripeEventId, StripeSubscriptionId, StripeSubscriptions,
    Subscription, SubscriptionStatus, SubscriptionsError, TenantId, WebhookEvent,
};
use sqlx::Row;
use sqlx::postgres::PgRow;

use crate::unit_of_work::{Postgres, SharedTx};

const OF: &str = "SELECT stripe_customer_id, stripe_subscription_id, status, period_end \
     FROM billing_subscriptions WHERE org_id = $1";

const LINK_CUSTOMER: &str = "INSERT INTO billing_subscriptions (org_id, stripe_customer_id) \
     VALUES ($1, $2) \
     ON CONFLICT (org_id) DO UPDATE SET stripe_customer_id = excluded.stripe_customer_id";

const RECORD_EVENT: &str = "INSERT INTO stripe_events (event_id) VALUES ($1)";

const ACTIVATE: &str = "INSERT INTO billing_subscriptions \
       (org_id, stripe_customer_id, stripe_subscription_id, status, period_end) \
     VALUES ($1, $2, $3, $4, $5) \
     ON CONFLICT (org_id) DO UPDATE SET \
       stripe_customer_id = excluded.stripe_customer_id, \
       stripe_subscription_id = excluded.stripe_subscription_id, \
       status = excluded.status, \
       period_end = excluded.period_end";

const SWITCH_PLAN: &str =
    "UPDATE orgs SET plan_id = (SELECT id FROM plans WHERE stripe_price_id = $1) WHERE id = $2";

const CANCEL_SUBSCRIPTION: &str =
    "UPDATE billing_subscriptions SET status = 'canceled' WHERE stripe_customer_id = $1";

const DOWNGRADE_TO_FREE: &str = "UPDATE orgs SET plan_id = (SELECT id FROM plans WHERE slug = 'free') \
     WHERE id = (SELECT org_id FROM billing_subscriptions WHERE stripe_customer_id = $1)";

#[repository(domain = StripeSubscriptions, backend = Postgres<C>, generics = <C: Send + Sync + 'static>)]
#[derive(Debug)]
pub struct PostgresSubscriptions {
    tx: SharedTx,
}

impl PostgresSubscriptions {
    pub fn new<C>(_backend: &Postgres<C>, tx: &SharedTx) -> Self {
        Self { tx: tx.clone() }
    }
}

impl StripeSubscriptions for PostgresSubscriptions {
    async fn of(&self, org: TenantId) -> Result<Option<Subscription>, SubscriptionsError> {
        let mut tx = self.tx.lock().await;
        let found = sqlx::query(OF)
            .bind(org.as_uuid())
            .fetch_optional(&mut **tx)
            .await
            .map_err(|error| {
                tracing::error!(%error, "the control plane refused the subscription query");
                SubscriptionsError::ControlPlane
            })?;
        Ok(found.as_ref().map(|row| read_subscription(org, row)))
    }

    async fn link_customer(
        &self,
        org: TenantId,
        customer: &StripeCustomerId,
    ) -> Result<(), SubscriptionsError> {
        let mut tx = self.tx.lock().await;
        sqlx::query(LINK_CUSTOMER)
            .bind(org.as_uuid())
            .bind(customer.as_str())
            .execute(&mut **tx)
            .await
            .map_err(|error| {
                tracing::error!(%error, "the control plane refused to link a stripe customer");
                SubscriptionsError::ControlPlane
            })?;
        Ok(())
    }

    async fn apply(&self, event: &WebhookEvent) -> Result<Applied, SubscriptionsError> {
        let mut tx = self.tx.lock().await;
        if record_event(&mut **tx, event.id()).await? {
            return Ok(Applied::AlreadyApplied);
        }

        match event {
            WebhookEvent::Activated {
                org,
                customer,
                subscription,
                price,
                status,
                period_end,
                ..
            } => {
                sqlx::query(ACTIVATE)
                    .bind(org.as_uuid())
                    .bind(customer.as_str())
                    .bind(subscription.as_str())
                    .bind(status.as_str())
                    .bind(period_end)
                    .execute(&mut **tx)
                    .await
                    .map_err(|error| {
                        tracing::error!(%error, "the control plane refused to activate a subscription");
                        SubscriptionsError::ControlPlane
                    })?;

                let switched = sqlx::query(SWITCH_PLAN)
                    .bind(price.as_str())
                    .bind(org.as_uuid())
                    .execute(&mut **tx)
                    .await
                    .map_err(|error| {
                        tracing::error!(%error, "the control plane refused to switch a plan");
                        SubscriptionsError::ControlPlane
                    })?;
                if switched.rows_affected() == 0 {
                    tracing::warn!(
                        price = price.as_str(),
                        "no plan carries this stripe price id yet"
                    );
                }
            }
            WebhookEvent::RetriesExhausted { customer, .. } => {
                sqlx::query(CANCEL_SUBSCRIPTION)
                    .bind(customer.as_str())
                    .execute(&mut **tx)
                    .await
                    .map_err(|error| {
                        tracing::error!(%error, "the control plane refused to cancel a subscription");
                        SubscriptionsError::ControlPlane
                    })?;

                sqlx::query(DOWNGRADE_TO_FREE)
                    .bind(customer.as_str())
                    .execute(&mut **tx)
                    .await
                    .map_err(|error| {
                        tracing::error!(%error, "the control plane refused to downgrade an org");
                        SubscriptionsError::ControlPlane
                    })?;
            }
            WebhookEvent::Ignored { .. } => {}
        }

        Ok(Applied::New)
    }
}

async fn record_event<'c, E>(executor: E, event: &StripeEventId) -> Result<bool, SubscriptionsError>
where
    E: sqlx::Executor<'c, Database = sqlx::Postgres>,
{
    match sqlx::query(RECORD_EVENT)
        .bind(event.as_str())
        .execute(executor)
        .await
    {
        Ok(_) => Ok(false),
        Err(sqlx::Error::Database(refusal)) if refusal.is_unique_violation() => Ok(true),
        Err(error) => {
            tracing::error!(%error, "the control plane refused to record a stripe event");
            Err(SubscriptionsError::ControlPlane)
        }
    }
}

fn read_subscription(org: TenantId, row: &PgRow) -> Subscription {
    Subscription {
        org,
        customer: StripeCustomerId::new(row.get::<String, _>("stripe_customer_id")),
        subscription: row
            .get::<Option<String>, _>("stripe_subscription_id")
            .map(StripeSubscriptionId::new),
        status: row
            .get::<Option<String>, _>("status")
            .as_deref()
            .and_then(SubscriptionStatus::parse),
        price: None,
        period_end: row.get("period_end"),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ACTIVATE, CANCEL_SUBSCRIPTION, DOWNGRADE_TO_FREE, LINK_CUSTOMER, OF, RECORD_EVENT,
        SWITCH_PLAN,
    };

    #[test]
    fn linking_a_customer_is_idempotent_per_org() {
        assert!(LINK_CUSTOMER.contains("ON CONFLICT (org_id)"));
        assert!(LINK_CUSTOMER.contains("stripe_customer_id = excluded.stripe_customer_id"));
    }

    #[test]
    fn activating_a_subscription_upserts_every_mutable_column() {
        assert!(ACTIVATE.contains("ON CONFLICT (org_id)"));
        for column in [
            "stripe_customer_id",
            "stripe_subscription_id",
            "status",
            "period_end",
        ] {
            assert!(
                ACTIVATE.contains(&format!("{column} = excluded.{column}")),
                "activating must keep {column} in step with stripe"
            );
        }
    }

    #[test]
    fn recording_an_event_never_rewrites_an_already_applied_one() {
        assert!(!RECORD_EVENT.contains("ON CONFLICT"));
        assert!(RECORD_EVENT.contains("stripe_events"));
    }

    #[test]
    fn exhausting_retries_touches_the_subscription_and_the_plan_in_two_statements() {
        assert!(CANCEL_SUBSCRIPTION.contains("status = 'canceled'"));
        assert!(DOWNGRADE_TO_FREE.contains("slug = 'free'"));
        assert!(DOWNGRADE_TO_FREE.contains("billing_subscriptions"));
    }

    #[test]
    fn switching_a_plan_resolves_the_price_through_the_plans_table() {
        assert!(SWITCH_PLAN.contains("FROM plans WHERE stripe_price_id = $1"));
    }

    #[test]
    fn reading_a_subscription_is_keyed_by_org() {
        assert!(OF.contains("WHERE org_id = $1"));
    }
}
