use ferristrace_domain::{
    Allowance, Applied, BillingAccounts, BillingEventId, CustomerRef, DecompressedBytes, PriceRef,
    SubscriptionChange, SubscriptionRef, SubscriptionStatus, TenantId, WebhookEvent,
};
use ferristrace_infra::FixedClock;
use ferristrace_postgres::{
    CONTROL_PLANE, MembershipError, PlanSpec, Postgres, SELF_HOSTED_PLAN, billing_plans,
    load_allowances, sync_plans,
};
use sqlx::postgres::PgPoolOptions;
use sqlx::{AssertSqlSafe, PgPool, Row};
use uuid::Uuid;

#[macro_use]
mod backend;

const NOW: u64 = 1_700_000_000;
const GIB: u64 = 1024 * 1024 * 1024;

async fn control_plane(schema: &str) -> Option<PgPool> {
    let url = backend::url()?;
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&url)
        .await
        .expect("connecting to postgres");
    sqlx::query(AssertSqlSafe(format!(
        "DROP SCHEMA IF EXISTS {schema} CASCADE"
    )))
    .execute(&pool)
    .await
    .expect("dropping a leftover schema");
    sqlx::query(AssertSqlSafe(format!("CREATE SCHEMA {schema}")))
        .execute(&pool)
        .await
        .expect("creating the test schema");
    pool.close().await;

    let owned = schema.to_owned();
    let scoped = PgPoolOptions::new()
        .max_connections(2)
        .after_connect(move |connection, _| {
            let schema = owned.clone();
            Box::pin(async move {
                sqlx::query(AssertSqlSafe(format!("SET search_path TO {schema}")))
                    .execute(connection)
                    .await
                    .map(|_| ())
            })
        })
        .connect(&url)
        .await
        .expect("connecting to the test schema");
    CONTROL_PLANE
        .run(&scoped)
        .await
        .expect("the migrations apply");
    Some(scoped)
}

fn backend_of(pool: &PgPool) -> Postgres<FixedClock> {
    Postgres::new(pool.clone(), FixedClock::at(NOW))
}

fn hosted_plans() -> Vec<PlanSpec> {
    vec![
        PlanSpec {
            slug: "free".into(),
            name: "Free".into(),
            ingest_gb: Some(30),
            retention_days: Some(7),
            overage: false,
            price_ref: None,
        },
        PlanSpec {
            slug: "pro".into(),
            name: "Pro".into(),
            ingest_gb: Some(100),
            retention_days: Some(30),
            overage: true,
            price_ref: Some("price_pro".into()),
        },
    ]
}

async fn hosted(schema: &str) -> Option<PgPool> {
    let pool = control_plane(schema).await?;
    sync_plans(&pool, &hosted_plans())
        .await
        .expect("the plans are written");
    Some(pool)
}

async fn an_org(pool: &PgPool) -> TenantId {
    founded_on(&backend_of(pool))
        .await
        .expect("the organisation is founded")
}

async fn founded_on(backend: &Postgres<FixedClock>) -> Result<TenantId, MembershipError> {
    let email = format!("{}@example.com", Uuid::new_v4());
    sqlx::query("INSERT INTO accounts (id, email) VALUES ($1, $2)")
        .bind(Uuid::new_v4())
        .bind(&email)
        .execute(backend.pool())
        .await
        .expect("inserting an account");
    backend::memberships(backend).found("Acme", &email).await
}

async fn plan_slug(pool: &PgPool, org: TenantId) -> String {
    sqlx::query(
        "SELECT p.slug AS slug FROM orgs o JOIN plans p ON p.id = o.plan_id WHERE o.id = $1",
    )
    .bind(org.as_uuid())
    .fetch_one(pool)
    .await
    .expect("the organisation has a plan")
    .get("slug")
}

fn changed(
    event: &str,
    at: i64,
    org: Option<TenantId>,
    subscription: &str,
    status: SubscriptionStatus,
) -> WebhookEvent {
    WebhookEvent::Changed {
        event: BillingEventId::new(event),
        change: SubscriptionChange {
            at,
            org,
            customer: CustomerRef::new("cus_1"),
            subscription: SubscriptionRef::new(subscription),
            price: Some(PriceRef::new("price_pro")),
            status,
            period_end: Some(1_702_592_000),
        },
    }
}

#[tokio::test]
async fn the_migrations_add_no_plan_beside_the_self_hosted_one() {
    let Some(pool) = control_plane("billing_no_seed").await else {
        return;
    };

    let slugs: Vec<String> = sqlx::query("SELECT slug FROM plans ORDER BY slug")
        .fetch_all(&pool)
        .await
        .expect("the plans")
        .iter()
        .map(|row| row.get("slug"))
        .collect();

    assert_eq!(slugs, vec![SELF_HOSTED_PLAN.to_owned()]);
    let found = billing_plans(&pool).await.expect("the billing plans");
    assert!(!found.fallback);
    assert_eq!(found.priced, 0);
}

#[tokio::test]
async fn configured_plans_are_written_once_and_updated_in_place() {
    let Some(pool) = hosted("billing_sync").await else {
        return;
    };
    let mut plans = hosted_plans();
    plans[1].ingest_gb = Some(200);

    sync_plans(&pool, &plans).await.expect("a second sync");

    let rows = sqlx::query("SELECT slug, ingest_gb, features, price_ref FROM plans ORDER BY slug")
        .fetch_all(&pool)
        .await
        .expect("the plans");
    assert_eq!(rows.len(), 3);
    let pro = &rows[1];
    assert_eq!(pro.get::<String, _>("slug"), "pro");
    assert_eq!(pro.get::<Option<i32>, _>("ingest_gb"), Some(200));
    assert_eq!(pro.get::<Vec<String>, _>("features"), vec!["overage"]);
    assert_eq!(
        pro.get::<Option<String>, _>("price_ref").as_deref(),
        Some("price_pro")
    );
    let found = billing_plans(&pool).await.expect("the billing plans");
    assert!(found.fallback);
    assert_eq!(found.priced, 1);
}

#[tokio::test]
async fn a_new_organisation_keeps_the_self_hosted_plan_and_reads_it_back() {
    let Some(pool) = hosted("billing_plan_of").await else {
        return;
    };
    let org = an_org(&pool).await;

    let plan = backend::billing_accounts(&backend_of(&pool))
        .plan_of(org)
        .await
        .expect("the read")
        .expect("the organisation exists");

    assert_eq!(plan.slug.as_str(), SELF_HOSTED_PLAN);
    assert!(!plan.priced);
    assert_eq!(plan.ingest_gb, None);
    assert!(!plan.overage);
    let offers = backend::billing_accounts(&backend_of(&pool))
        .offers()
        .await
        .expect("the offers");
    assert_eq!(offers.len(), 1);
    assert_eq!(offers[0].slug.as_str(), "pro");
    assert_eq!(offers[0].price, PriceRef::new("price_pro"));
}

#[tokio::test]
async fn a_new_organisation_starts_on_the_configured_default_plan_and_is_capped_by_it() {
    let Some(pool) = hosted("billing_default_plan").await else {
        return;
    };

    let org = founded_on(&backend_of(&pool).with_new_org_plan("free"))
        .await
        .expect("the organisation is founded");

    assert_eq!(plan_slug(&pool, org).await, "free");
    let allowances = load_allowances(&pool).await.expect("the allowances");
    assert_eq!(
        allowances.get(&org),
        Some(&Allowance::Capped(DecompressedBytes::new(30 * GIB)))
    );
}

#[tokio::test]
async fn founding_on_a_default_plan_the_control_plane_lacks_creates_nothing() {
    let Some(pool) = control_plane("billing_default_missing").await else {
        return;
    };

    let refused = founded_on(&backend_of(&pool).with_new_org_plan("free")).await;

    assert!(matches!(refused, Err(MembershipError::NoSuchPlan(slug)) if &*slug == "free"));
    let orgs: i64 = sqlx::query("SELECT count(*) AS n FROM orgs")
        .fetch_one(&pool)
        .await
        .expect("the count")
        .get("n");
    assert_eq!(orgs, 0);
}

#[tokio::test]
async fn an_active_subscription_moves_the_organisation_to_the_plan_of_its_price_once() {
    let Some(pool) = hosted("billing_activate").await else {
        return;
    };
    let org = an_org(&pool).await;
    let backend = backend_of(&pool);
    let accounts = backend::billing_accounts(&backend);
    let event = changed("evt_1", 10, Some(org), "sub_1", SubscriptionStatus::Active);

    let first = accounts.apply(&event).await.expect("the first delivery");
    let second = accounts.apply(&event).await.expect("the second delivery");

    assert_eq!(first, Applied::New);
    assert_eq!(second, Applied::AlreadyApplied);
    assert_eq!(plan_slug(&pool, org).await, "pro");
    let plan = accounts
        .plan_of(org)
        .await
        .expect("the read")
        .expect("the organisation exists");
    assert_eq!(plan.ingest_gb, Some(100));
    assert_eq!(plan.retention_days, Some(30));
    assert!(plan.overage && plan.priced);
    let mirrored = accounts
        .of(org)
        .await
        .expect("the read")
        .expect("a subscription");
    assert_eq!(mirrored.customer, CustomerRef::new("cus_1"));
    assert_eq!(mirrored.status, Some(SubscriptionStatus::Active));
    assert_eq!(mirrored.period_end, Some(1_702_592_000));
    let allowances = load_allowances(&pool).await.expect("the allowances");
    assert_eq!(
        allowances.get(&org),
        Some(&Allowance::Overage(DecompressedBytes::new(100 * GIB)))
    );
}

#[tokio::test]
async fn an_ended_subscription_moves_the_organisation_back_to_free() {
    let Some(pool) = hosted("billing_end").await else {
        return;
    };
    let org = an_org(&pool).await;
    let backend = backend_of(&pool);
    let accounts = backend::billing_accounts(&backend);
    accounts
        .apply(&changed(
            "evt_1",
            10,
            Some(org),
            "sub_1",
            SubscriptionStatus::Active,
        ))
        .await
        .expect("activated");

    accounts
        .apply(&changed(
            "evt_2",
            20,
            None,
            "sub_1",
            SubscriptionStatus::Canceled,
        ))
        .await
        .expect("ended");

    assert_eq!(plan_slug(&pool, org).await, "free");
    let allowances = load_allowances(&pool).await.expect("the allowances");
    assert_eq!(
        allowances.get(&org),
        Some(&Allowance::Capped(DecompressedBytes::new(30 * GIB)))
    );
}

#[tokio::test]
async fn a_past_due_subscription_keeps_the_paid_plan() {
    let Some(pool) = hosted("billing_past_due").await else {
        return;
    };
    let org = an_org(&pool).await;
    let backend = backend_of(&pool);
    let accounts = backend::billing_accounts(&backend);
    accounts
        .apply(&changed(
            "evt_1",
            10,
            Some(org),
            "sub_1",
            SubscriptionStatus::Active,
        ))
        .await
        .expect("activated");

    accounts
        .apply(&changed(
            "evt_2",
            20,
            None,
            "sub_1",
            SubscriptionStatus::PastDue,
        ))
        .await
        .expect("past due");

    assert_eq!(plan_slug(&pool, org).await, "pro");
}

#[tokio::test]
async fn an_event_older_than_the_mirror_changes_nothing() {
    let Some(pool) = hosted("billing_order").await else {
        return;
    };
    let org = an_org(&pool).await;
    let backend = backend_of(&pool);
    let accounts = backend::billing_accounts(&backend);
    accounts
        .apply(&changed(
            "evt_new",
            20,
            Some(org),
            "sub_1",
            SubscriptionStatus::Active,
        ))
        .await
        .expect("the newer event");

    accounts
        .apply(&changed(
            "evt_old",
            10,
            Some(org),
            "sub_1",
            SubscriptionStatus::Canceled,
        ))
        .await
        .expect("the older event");

    assert_eq!(plan_slug(&pool, org).await, "pro");
}

#[tokio::test]
async fn the_end_of_another_subscription_leaves_the_current_one_alone() {
    let Some(pool) = hosted("billing_other_sub").await else {
        return;
    };
    let org = an_org(&pool).await;
    let backend = backend_of(&pool);
    let accounts = backend::billing_accounts(&backend);
    accounts
        .apply(&changed(
            "evt_1",
            10,
            Some(org),
            "sub_new",
            SubscriptionStatus::Active,
        ))
        .await
        .expect("the current subscription");

    accounts
        .apply(&changed(
            "evt_2",
            20,
            Some(org),
            "sub_old",
            SubscriptionStatus::Canceled,
        ))
        .await
        .expect("an old subscription ends");

    assert_eq!(plan_slug(&pool, org).await, "pro");
}

#[tokio::test]
async fn an_event_for_an_unknown_customer_is_recorded_and_changes_nothing() {
    let Some(pool) = hosted("billing_unknown").await else {
        return;
    };
    let org = an_org(&pool).await;
    let backend = backend_of(&pool);
    let accounts = backend::billing_accounts(&backend);
    let event = changed("evt_1", 10, None, "sub_1", SubscriptionStatus::Active);

    let first = accounts.apply(&event).await.expect("applied");
    let second = accounts.apply(&event).await.expect("replayed");

    assert_eq!(first, Applied::New);
    assert_eq!(second, Applied::AlreadyApplied);
    assert_eq!(plan_slug(&pool, org).await, SELF_HOSTED_PLAN);
}

#[tokio::test]
async fn a_linked_customer_finds_its_organisation_without_metadata() {
    let Some(pool) = hosted("billing_linked").await else {
        return;
    };
    let org = an_org(&pool).await;
    let backend = backend_of(&pool);
    let accounts = backend::billing_accounts(&backend);
    accounts
        .link_customer(org, &CustomerRef::new("cus_1"))
        .await
        .expect("linked");

    accounts
        .apply(&changed(
            "evt_1",
            10,
            None,
            "sub_1",
            SubscriptionStatus::Active,
        ))
        .await
        .expect("activated");

    assert_eq!(plan_slug(&pool, org).await, "pro");
}

#[tokio::test]
async fn a_price_no_plan_carries_leaves_the_plan_as_it_is() {
    let Some(pool) = hosted("billing_unknown_price").await else {
        return;
    };
    let org = an_org(&pool).await;
    let backend = backend_of(&pool);
    let accounts = backend::billing_accounts(&backend);
    let WebhookEvent::Changed { event, mut change } =
        changed("evt_1", 10, Some(org), "sub_1", SubscriptionStatus::Active)
    else {
        unreachable!();
    };
    change.price = Some(PriceRef::new("price_unknown"));

    accounts
        .apply(&WebhookEvent::Changed { event, change })
        .await
        .expect("applied without failing");

    assert_eq!(plan_slug(&pool, org).await, SELF_HOSTED_PLAN);
}
