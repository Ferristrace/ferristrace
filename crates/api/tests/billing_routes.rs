use std::sync::{Arc, Mutex};

use axum::body::Body;
use axum::http::header::{AUTHORIZATION, CONTENT_TYPE};
use axum::http::{Method, Request, StatusCode};
use ferristrace_api::{AppState, billing_router};
use ferristrace_application::registry::{RepoFor, domain};
use ferristrace_application::testing::{Bearers, Inert, Untransacted};
use ferristrace_application::{Adapters, Ferristrace, Stack};
use ferristrace_domain::{
    AccountId, Applied, BillingAccounts, BillingGateway, BillingHour, CheckoutUrl, CurrentPlan,
    CustomerRef, DecompressedBytes, GatewayError, Membership, Memberships, NoPhotos, OrgRole,
    PlanOffer, PlanSlug, PortalUrl, PriceRef, Session, SessionError, SessionStore, SessionToken,
    Subscription, SubscriptionsError, TenantId, UnixSeconds, WebhookError, WebhookEvent,
    WhoamiError,
};
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;

const TOKEN: &str = "ft.person.0123456789";
const MINE: u128 = 1;

fn mine() -> TenantId {
    TenantId::new(Uuid::from_u128(MINE))
}

struct OneSession;

impl SessionStore for OneSession {
    async fn resolve(&self, token: &SessionToken) -> Result<Session, SessionError> {
        if token.identity().subject.as_str() == TOKEN {
            Ok(Session {
                account: AccountId::new(Uuid::from_u128(9)),
                email: "person@example.com".try_into().expect("an address"),
                name: None,
                photo: None,
                org: None,
                expires_at: UnixSeconds::new(0),
            })
        } else {
            Err(SessionError::Unknown)
        }
    }
}

struct Role(OrgRole);

impl Memberships for Role {
    async fn of(&self, _account: AccountId) -> Result<Vec<Membership>, WhoamiError> {
        Ok(vec![Membership {
            org: mine(),
            name: "Acme".into(),
            role: self.0,
        }])
    }
}

#[derive(Debug, Default)]
struct Ledger {
    plan: Option<CurrentPlan>,
    customer: Option<CustomerRef>,
    checkouts: Vec<(Option<CustomerRef>, PriceRef)>,
}

#[derive(Clone)]
struct Accounts(Arc<Mutex<Ledger>>);

impl BillingAccounts for Accounts {
    async fn of(&self, org: TenantId) -> Result<Option<Subscription>, SubscriptionsError> {
        let ledger = self.0.lock().expect("the ledger");
        Ok(ledger.customer.clone().map(|customer| Subscription {
            org,
            customer,
            subscription: None,
            status: None,
            period_end: None,
        }))
    }

    async fn plan_of(&self, _org: TenantId) -> Result<Option<CurrentPlan>, SubscriptionsError> {
        Ok(self.0.lock().expect("the ledger").plan.clone())
    }

    async fn offers(&self) -> Result<Vec<PlanOffer>, SubscriptionsError> {
        Ok(vec![PlanOffer {
            slug: PlanSlug::new("pro"),
            name: "Pro".into(),
            price: PriceRef::new("price_pro"),
            overage_price: None,
        }])
    }

    async fn link_customer(
        &self,
        _org: TenantId,
        customer: &CustomerRef,
    ) -> Result<(), SubscriptionsError> {
        self.0.lock().expect("the ledger").customer = Some(customer.clone());
        Ok(())
    }

    async fn apply(&self, _event: &WebhookEvent) -> Result<Applied, SubscriptionsError> {
        Ok(Applied::New)
    }
}

#[derive(Clone)]
struct Gateway(Arc<Mutex<Ledger>>);

impl BillingGateway for Gateway {
    async fn checkout_url(
        &self,
        _org: TenantId,
        customer: Option<&CustomerRef>,
        price: &PriceRef,
        _overage_price: Option<&PriceRef>,
        _success_url: &str,
        _cancel_url: &str,
    ) -> Result<(CheckoutUrl, CustomerRef), GatewayError> {
        self.0
            .lock()
            .expect("the ledger")
            .checkouts
            .push((customer.cloned(), price.clone()));
        Ok((
            CheckoutUrl::new("https://pay.test/session"),
            customer
                .cloned()
                .unwrap_or_else(|| CustomerRef::new("cus_new")),
        ))
    }

    async fn portal_url(
        &self,
        _customer: &CustomerRef,
        _return_url: &str,
    ) -> Result<PortalUrl, GatewayError> {
        Ok(PortalUrl::new("https://pay.test/portal"))
    }

    async fn report_usage(
        &self,
        _customer: &CustomerRef,
        _hour: BillingHour,
        _over_by: DecompressedBytes,
    ) -> Result<(), GatewayError> {
        Ok(())
    }

    fn verify(&self, _signature: &str, _body: &[u8]) -> Result<WebhookEvent, WebhookError> {
        Err(WebhookError::BadSignature)
    }
}

struct Fakes {
    role: OrgRole,
    ledger: Arc<Mutex<Ledger>>,
}

impl Untransacted for Fakes {}

impl RepoFor<domain::Sessions> for Fakes {
    type Repo = OneSession;

    fn build(&self, (): &()) -> Self::Repo {
        OneSession
    }
}

impl RepoFor<domain::Memberships> for Fakes {
    type Repo = Role;

    fn build(&self, (): &()) -> Self::Repo {
        Role(self.role)
    }
}

impl RepoFor<domain::BillingAccounts> for Fakes {
    type Repo = Accounts;

    fn build(&self, (): &()) -> Self::Repo {
        Accounts(Arc::clone(&self.ledger))
    }
}

struct TestStack;

impl Stack for TestStack {
    type Repos = Fakes;
    type Clock = Inert;
    type Mailer = Inert;
    type Photos = NoPhotos;
    type SpanStore = Inert;
    type IssueStore = Inert;
    type LogStore = Inert;
    type MetricStore = Inert;
    type Meter = Inert;
    type Users = Bearers;
    type Agents = Inert;
    type Sink = Inert;
    type Quota = Inert;
    type Directory = Inert;
    type Webhooks = Inert;
    type Billing = Gateway;
}

fn plan(slug: &str, name: &str, priced: bool) -> CurrentPlan {
    CurrentPlan {
        slug: PlanSlug::new(slug),
        name: name.into(),
        priced,
        ingest_gb: priced.then_some(100),
        retention_days: priced.then_some(30),
        overage: priced,
    }
}

struct World {
    ledger: Arc<Mutex<Ledger>>,
    state: AppState<TestStack>,
}

fn world(role: OrgRole, current: CurrentPlan, payments: bool) -> World {
    let ledger = Arc::new(Mutex::new(Ledger {
        plan: Some(current),
        ..Ledger::default()
    }));
    let adapters = Adapters {
        clock: Inert::default(),
        mailer: Inert::default(),
        webhooks: Inert::default(),
        billing: payments.then(|| Gateway(Arc::clone(&ledger))),
        photos: NoPhotos,
        meter: Inert::default(),
        span_store: None,
        issue_store: None,
        log_store: None,
        metric_store: None,
        users: Some(Bearers),
    };
    let fakes = Fakes {
        role,
        ledger: Arc::clone(&ledger),
    };
    World {
        ledger,
        state: AppState::new(Arc::new(Ferristrace::new(fakes, adapters))),
    }
}

fn request(method: Method, path: &str, body: Option<Value>) -> Request<Body> {
    let builder = Request::builder()
        .method(method)
        .uri(path)
        .header(AUTHORIZATION, format!("Bearer {TOKEN}"));
    match body {
        Some(body) => builder
            .header(CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string())),
        None => builder.body(Body::empty()),
    }
    .expect("a request")
}

fn org_path(tail: &str) -> String {
    format!("/api/orgs/{}/billing{tail}", Uuid::from_u128(MINE))
}

fn checkout(plan: &str) -> Request<Body> {
    request(
        Method::POST,
        &org_path("/checkout"),
        Some(json!({
            "plan": plan,
            "success_url": "https://app.test/settings/billing",
            "cancel_url": "https://app.test/settings/billing",
        })),
    )
}

fn portal() -> Request<Body> {
    request(
        Method::POST,
        &org_path("/portal"),
        Some(json!({"return_url": "https://app.test/settings/billing"})),
    )
}

async fn answered(state: &AppState<TestStack>, request: Request<Body>) -> (StatusCode, Value) {
    let response = billing_router(state.clone())
        .oneshot(request)
        .await
        .expect("a response");
    let status = response.status();
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("a body");
    (status, serde_json::from_slice(&body).unwrap_or(Value::Null))
}

#[tokio::test]
async fn a_self_hosted_organisation_reads_its_own_plan_and_no_offer() {
    let world = world(
        OrgRole::Owner,
        plan("self-hosted", "Self-hosted", false),
        false,
    );

    let (status, body) = answered(&world.state, request(Method::GET, &org_path(""), None)).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["plan"],
        json!({
            "slug": "self-hosted",
            "name": "Self-hosted",
            "ingest_gb": null,
            "retention_days": null,
            "overage": false,
        })
    );
    assert_eq!(body["payments"], json!(false));
    assert_eq!(body["upgrade"], Value::Null);
    assert_eq!(body["portal"], json!(false));
    assert_eq!(body["owner"], json!(true));
}

#[tokio::test]
async fn without_payments_checkout_portal_and_webhook_are_not_found() {
    let world = world(
        OrgRole::Owner,
        plan("self-hosted", "Self-hosted", false),
        false,
    );
    let webhook = Request::builder()
        .method(Method::POST)
        .uri("/api/billing/webhook")
        .header("stripe-signature", "t=1,v1=00")
        .body(Body::from("{}"))
        .expect("a request");

    assert_eq!(
        answered(&world.state, checkout("pro")).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        answered(&world.state, portal()).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        answered(&world.state, webhook).await.0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn a_free_organisation_is_offered_the_priced_plan() {
    let world = world(OrgRole::Member, plan("free", "Free", false), true);

    let (status, body) = answered(&world.state, request(Method::GET, &org_path(""), None)).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["plan"]["slug"], json!("free"));
    assert_eq!(body["payments"], json!(true));
    assert_eq!(body["upgrade"], json!({"slug": "pro", "name": "Pro"}));
    assert_eq!(body["owner"], json!(false));
}

#[tokio::test]
async fn a_paid_organisation_is_offered_nothing_more() {
    let world = world(OrgRole::Owner, plan("pro", "Pro", true), true);

    let (_, body) = answered(&world.state, request(Method::GET, &org_path(""), None)).await;

    assert_eq!(body["upgrade"], Value::Null);
}

#[tokio::test]
async fn a_member_who_is_not_an_owner_cannot_open_checkout_or_the_portal() {
    let world = world(OrgRole::Admin, plan("free", "Free", false), true);
    world.ledger.lock().expect("the ledger").customer = Some(CustomerRef::new("cus_1"));

    assert_eq!(
        answered(&world.state, checkout("pro")).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        answered(&world.state, portal()).await.0,
        StatusCode::FORBIDDEN
    );
    assert!(
        world
            .ledger
            .lock()
            .expect("the ledger")
            .checkouts
            .is_empty()
    );
}

#[tokio::test]
async fn an_owner_checks_out_with_the_price_of_the_plan_and_reuses_the_customer() {
    let world = world(OrgRole::Owner, plan("free", "Free", false), true);

    let (status, body) = answered(&world.state, checkout("pro")).await;
    let (again, _) = answered(&world.state, checkout("pro")).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(again, StatusCode::OK);
    assert_eq!(body["url"], json!("https://pay.test/session"));
    let ledger = world.ledger.lock().expect("the ledger");
    assert_eq!(ledger.customer, Some(CustomerRef::new("cus_new")));
    assert_eq!(
        ledger.checkouts,
        vec![
            (None, PriceRef::new("price_pro")),
            (
                Some(CustomerRef::new("cus_new")),
                PriceRef::new("price_pro")
            ),
        ]
    );
}

#[tokio::test]
async fn a_plan_without_a_price_cannot_be_checked_out() {
    let world = world(OrgRole::Owner, plan("free", "Free", false), true);

    let (status, _) = answered(&world.state, checkout("enterprise")).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn an_owner_with_a_customer_opens_the_portal() {
    let world = world(OrgRole::Owner, plan("pro", "Pro", true), true);
    world.ledger.lock().expect("the ledger").customer = Some(CustomerRef::new("cus_1"));

    let (status, body) = answered(&world.state, portal()).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["url"], json!("https://pay.test/portal"));
}
