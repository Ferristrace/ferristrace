use std::sync::{Arc, Mutex};

use axum::body::Body;
use axum::http::header::AUTHORIZATION;
use axum::http::{Method, Request, StatusCode};
use ferristrace_api::{AppState, dashboard_query_router};
use ferristrace_application::registry::{RepoFor, domain};
use ferristrace_application::testing::{Bearers, Inert, Untransacted};
use ferristrace_application::{Adapters, Ferristrace, Stack};
use ferristrace_domain::dashboard::{
    Cell, Line, PanelKind, PanelQuery, PanelResult, QueryError, Variables,
};
use ferristrace_domain::testing::Notebook;
use ferristrace_domain::{
    AccountId, ApiKey, ApiKeys, ApiSecret, Dashboard, DashboardCreation, DashboardFile,
    DashboardId, DashboardSaving, DashboardScope, DashboardStore, DashboardSummary, IssuedKey,
    KeyId, KeyName, KeyScopes, Membership, Memberships, NoPhotos, OrgRole, PanelReader, ProjectId,
    ReadGrant, Session, SessionError, SessionStore, SessionToken, StoreError, TenantId,
    UnixSeconds, WhoamiError, Window,
};
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;

const TOKEN: &str = "ft.person.0123456789";
const READ_KEY: &str = "ft_live_000000000001.secret";
const BOUND_KEY: &str = "ft_live_000000000002.secret";
const INGEST_KEY: &str = "ft_live_000000000003.secret";
const MINE: u128 = 1;
const THEIRS: u128 = 2;
const OURS: u128 = 30;
const OTHER: u128 = 40;
const STRANGERS: u128 = 50;
const ME: u128 = 9;
const FROM: u64 = 1_700_000_000_000_000_000;
const HOUR: u64 = 3_600_000_000_000;

fn id(seed: u128) -> String {
    Uuid::from_u128(seed).to_string()
}

fn org(seed: u128) -> TenantId {
    TenantId::new(Uuid::from_u128(seed))
}

fn project(seed: u128) -> ProjectId {
    ProjectId::new(Uuid::from_u128(seed))
}

fn scope(org_seed: u128, project_seed: u128) -> DashboardScope {
    DashboardScope {
        org: org(org_seed),
        project: project(project_seed),
    }
}

struct OneSession;

impl SessionStore for OneSession {
    async fn resolve(&self, token: &SessionToken) -> Result<Session, SessionError> {
        if token.identity().subject.as_str() == TOKEN {
            Ok(Session {
                account: AccountId::new(Uuid::from_u128(ME)),
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

struct MemberOfMine;

impl Memberships for MemberOfMine {
    async fn of(&self, _account: AccountId) -> Result<Vec<Membership>, WhoamiError> {
        Ok(vec![Membership {
            org: org(MINE),
            name: "Acme".into(),
            role: OrgRole::Member,
        }])
    }
}

struct Keys;

impl ApiKeys for Keys {
    async fn list(&self, _org: TenantId) -> Result<Vec<ApiKey>, StoreError> {
        Ok(Vec::new())
    }

    async fn issue(
        &self,
        _org: TenantId,
        _project: Option<ProjectId>,
        _name: &KeyName,
        _scopes: &KeyScopes,
        _by: AccountId,
    ) -> Result<IssuedKey, StoreError> {
        Err(StoreError::Unreachable)
    }

    async fn revoke(&self, _org: TenantId, _id: KeyId) -> Result<bool, StoreError> {
        Ok(false)
    }

    async fn grant_for(&self, secret: &ApiSecret) -> Result<Option<ReadGrant>, StoreError> {
        Ok(match secret.exposed() {
            READ_KEY => Some(ReadGrant::whole(org(MINE))),
            BOUND_KEY => Some(ReadGrant {
                org: org(MINE),
                project: Some(project(OTHER)),
            }),
            _ => None,
        })
    }
}

struct Projects;

impl DashboardStore for Projects {
    async fn project_scope(&self, wanted: ProjectId) -> Result<Option<DashboardScope>, StoreError> {
        Ok([
            scope(MINE, OURS),
            scope(MINE, OTHER),
            scope(THEIRS, STRANGERS),
        ]
        .into_iter()
        .find(|held| held.project == wanted))
    }

    async fn locate(&self, _wanted: DashboardId) -> Result<Option<DashboardScope>, StoreError> {
        Ok(None)
    }

    async fn list(&self, _wanted: DashboardScope) -> Result<Vec<DashboardSummary>, StoreError> {
        Ok(Vec::new())
    }

    async fn get(
        &self,
        _wanted: DashboardScope,
        _which: DashboardId,
    ) -> Result<Option<Dashboard>, StoreError> {
        Ok(None)
    }

    async fn count(&self, _wanted: DashboardScope) -> Result<usize, StoreError> {
        Ok(0)
    }

    async fn create(
        &self,
        _wanted: DashboardScope,
        _by: AccountId,
        _file: &DashboardFile,
    ) -> Result<DashboardCreation, StoreError> {
        Err(StoreError::Unreachable)
    }

    async fn update(
        &self,
        _wanted: DashboardScope,
        _which: DashboardId,
        _by: AccountId,
        _file: &DashboardFile,
    ) -> Result<DashboardSaving, StoreError> {
        Err(StoreError::Unreachable)
    }

    async fn delete(
        &self,
        _wanted: DashboardScope,
        _which: DashboardId,
    ) -> Result<bool, StoreError> {
        Err(StoreError::Unreachable)
    }
}

struct Fakes {
    notebook: Notebook,
}

impl Untransacted for Fakes {}

impl RepoFor<domain::Sessions> for Fakes {
    type Repo = OneSession;

    fn build(&self, (): &()) -> Self::Repo {
        OneSession
    }
}

impl RepoFor<domain::Memberships> for Fakes {
    type Repo = MemberOfMine;

    fn build(&self, (): &()) -> Self::Repo {
        MemberOfMine
    }
}

impl RepoFor<domain::ApiKeys> for Fakes {
    type Repo = Keys;

    fn build(&self, (): &()) -> Self::Repo {
        Keys
    }
}

impl RepoFor<domain::Audit> for Fakes {
    type Repo = Notebook;

    fn build(&self, (): &()) -> Self::Repo {
        self.notebook.clone()
    }
}

impl RepoFor<domain::Dashboards> for Fakes {
    type Repo = Projects;

    fn build(&self, (): &()) -> Self::Repo {
        Projects
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
}

#[derive(Debug, Clone, PartialEq)]
struct Seen {
    scope: DashboardScope,
    kind: PanelKind,
    window: Window,
    variables: Variables,
    query: PanelQuery,
}

#[derive(Default)]
struct Canned {
    answer: Mutex<Option<Result<PanelResult, QueryError>>>,
    seen: Mutex<Vec<Seen>>,
}

impl Canned {
    fn answering(answer: Result<PanelResult, QueryError>) -> Self {
        Self {
            answer: Mutex::new(Some(answer)),
            seen: Mutex::default(),
        }
    }

    fn calls(&self) -> Vec<Seen> {
        self.seen.lock().expect("the lock").clone()
    }
}

impl PanelReader for Canned {
    async fn run(
        &self,
        scope: DashboardScope,
        query: &PanelQuery,
        kind: PanelKind,
        window: Window,
        variables: &Variables,
    ) -> Result<PanelResult, QueryError> {
        self.seen.lock().expect("the lock").push(Seen {
            scope,
            kind,
            window,
            variables: variables.clone(),
            query: query.clone(),
        });
        self.answer
            .lock()
            .expect("the lock")
            .clone()
            .unwrap_or(Ok(PanelResult::Series { series: Vec::new() }))
    }
}

fn state() -> AppState<TestStack> {
    let adapters = Adapters {
        clock: Inert::default(),
        mailer: Inert::default(),
        webhooks: Inert::default(),
        photos: NoPhotos,
        meter: Inert::default(),
        span_store: None,
        issue_store: None,
        log_store: None,
        metric_store: None,
        users: Some(Bearers),
    };
    let fakes = Fakes {
        notebook: Notebook::default(),
    };
    AppState::new(Arc::new(Ferristrace::new(fakes, adapters)))
}

async fn ask(reader: &Arc<Canned>, bearer: Option<&str>, body: &Value) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(Method::POST)
        .uri("/api/v1/dashboards/query")
        .header("content-type", "application/json");
    if let Some(bearer) = bearer {
        request = request.header(AUTHORIZATION, format!("Bearer {bearer}"));
    }
    let response = dashboard_query_router(state(), Arc::clone(reader))
        .oneshot(
            request
                .body(Body::from(body.to_string()))
                .expect("a request"),
        )
        .await
        .expect("a response");
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("a body");
    let text = String::from_utf8(bytes.to_vec()).expect("text");
    (
        status,
        serde_json::from_str(&text).unwrap_or(Value::String(text)),
    )
}

fn per_service() -> Value {
    json!({
        "name": "spans", "signal": "traces",
        "aggregations": [{"function": "count", "field": null}],
        "filter": {"field": "service", "op": "in", "value": [{"var": "service"}]},
        "group_by": [{"field": "service"}],
        "step": "auto"
    })
}

fn errors_per_service() -> Value {
    json!({
        "name": "errors", "signal": "logs",
        "aggregations": [{"function": "count"}],
        "filter": {"field": "severity", "op": "eq", "value": "error"},
        "group_by": [{"field": "service"}],
        "order": {"by": {"aggregation": 0}, "direction": "desc"},
        "step": "total"
    })
}

fn asking(project_seed: u128, kind: &str, query: &Value) -> Value {
    json!({
        "project": id(project_seed), "kind": kind, "query": query,
        "from_ns": FROM, "to_ns": FROM + HOUR,
        "variables": {"service": ["checkout", "cart"]}
    })
}

#[tokio::test]
async fn spec_l16_6_a_traces_count_per_service_returns_one_series_per_service() {
    let reader = Arc::new(Canned::answering(Ok(PanelResult::Series {
        series: vec![
            Line {
                labels: [("service".into(), "checkout".into())].into(),
                points: vec![(FROM, 3.0), (FROM + 30_000_000_000, 4.0)],
            },
            Line {
                labels: [("service".into(), "cart".into())].into(),
                points: vec![(FROM, 1.0)],
            },
        ],
    })));

    let (status, body) = ask(
        &reader,
        Some(TOKEN),
        &asking(OURS, "time_series", &per_service()),
    )
    .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body,
        json!({"kind": "series", "series": [
            {"labels": {"service": "checkout"}, "points": [[FROM, 3.0], [FROM + 30_000_000_000_u64, 4.0]]},
            {"labels": {"service": "cart"}, "points": [[FROM, 1.0]]}
        ]})
    );
    let calls = reader.calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].scope, scope(MINE, OURS));
    assert_eq!(calls[0].kind, PanelKind::TimeSeries);
    assert_eq!(
        (
            calls[0].window.from_unix_nanos(),
            calls[0].window.to_unix_nanos()
        ),
        (FROM, FROM + HOUR)
    );
    assert_ne!(calls[0].variables, Variables::none());
}

#[tokio::test]
async fn spec_l16_7_error_logs_per_service_come_back_as_rows() {
    let reader = Arc::new(Canned::answering(Ok(PanelResult::Rows {
        columns: vec!["service".into(), "count".into()],
        rows: vec![
            vec![Cell::Text("checkout".into()), Cell::Number(9.0)],
            vec![Cell::Text("cart".into()), Cell::Number(2.0)],
        ],
        truncated: false,
    })));

    let (status, body) = ask(
        &reader,
        Some(TOKEN),
        &asking(OURS, "table", &errors_per_service()),
    )
    .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body,
        json!({
            "kind": "rows", "columns": ["service", "count"],
            "rows": [["checkout", 9.0], ["cart", 2.0]], "truncated": false
        })
    );
}

#[tokio::test]
async fn a_read_key_reads_and_a_key_bound_to_another_project_does_not() {
    let reader = Arc::new(Canned::default());
    let query = per_service();

    let (read, _) = ask(
        &reader,
        Some(READ_KEY),
        &asking(OURS, "time_series", &query),
    )
    .await;
    let (bound, _) = ask(
        &reader,
        Some(BOUND_KEY),
        &asking(OURS, "time_series", &query),
    )
    .await;
    let (own, _) = ask(
        &reader,
        Some(BOUND_KEY),
        &asking(OTHER, "time_series", &query),
    )
    .await;

    assert_eq!(read, StatusCode::OK);
    assert_eq!(bound, StatusCode::NOT_FOUND);
    assert_eq!(own, StatusCode::OK);
}

#[tokio::test]
async fn spec_l16_2_another_projects_panel_cannot_be_queried() {
    let reader = Arc::new(Canned::default());
    let query = per_service();

    let (foreign, body) = ask(
        &reader,
        Some(TOKEN),
        &asking(STRANGERS, "time_series", &query),
    )
    .await;
    let (unknown, _) = ask(&reader, Some(TOKEN), &asking(999, "time_series", &query)).await;

    assert_eq!(foreign, StatusCode::NOT_FOUND, "{body}");
    assert_eq!(unknown, StatusCode::NOT_FOUND);
    assert!(reader.calls().is_empty());
}

#[tokio::test]
async fn spec_l16_3_an_ingest_only_key_and_no_token_are_refused() {
    let reader = Arc::new(Canned::default());
    let query = per_service();

    let (ingest, _) = ask(
        &reader,
        Some(INGEST_KEY),
        &asking(OURS, "time_series", &query),
    )
    .await;
    let (none, _) = ask(&reader, None, &asking(OURS, "time_series", &query)).await;

    assert_eq!(ingest, StatusCode::UNAUTHORIZED);
    assert_eq!(none, StatusCode::UNAUTHORIZED);
    assert!(reader.calls().is_empty());
}

#[tokio::test]
async fn spec_l16_9_a_query_with_too_many_series_is_refused_with_the_count() {
    let reader = Arc::new(Canned::answering(Err(QueryError::TooManySeries {
        count: 51,
        max: 50,
    })));

    let (status, body) = ask(
        &reader,
        Some(TOKEN),
        &asking(OURS, "time_series", &per_service()),
    )
    .await;

    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        body,
        json!({"error": "too_many_series", "count": 51, "max": 50})
    );
}

#[tokio::test]
async fn a_query_that_runs_out_of_time_answers_a_gateway_timeout() {
    let reader = Arc::new(Canned::answering(Err(QueryError::Timeout)));

    let (status, body) = ask(
        &reader,
        Some(TOKEN),
        &asking(OURS, "time_series", &per_service()),
    )
    .await;

    assert_eq!(status, StatusCode::GATEWAY_TIMEOUT);
    assert_eq!(body, json!({"error": "timeout"}));
}

#[tokio::test]
async fn an_unreachable_store_answers_service_unavailable() {
    let reader = Arc::new(Canned::answering(Err(QueryError::Store(
        StoreError::Unreachable,
    ))));

    let (status, _) = ask(
        &reader,
        Some(TOKEN),
        &asking(OURS, "time_series", &per_service()),
    )
    .await;

    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test]
async fn spec_l16_11_a_number_panel_given_a_series_query_is_refused_before_any_read() {
    let reader = Arc::new(Canned::default());

    let (status, body) = ask(
        &reader,
        Some(TOKEN),
        &asking(OURS, "number", &per_service()),
    )
    .await;

    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["error"], "invalid");
    assert!(
        body["reason"]
            .as_str()
            .expect("a reason")
            .contains("cannot feed a number panel"),
        "{body}"
    );
    assert!(reader.calls().is_empty());
}

#[tokio::test]
async fn spec_l16_11_a_text_panel_runs_no_query() {
    let reader = Arc::new(Canned::default());

    let (status, body) = ask(&reader, Some(TOKEN), &asking(OURS, "text", &per_service())).await;

    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["error"], "invalid");
    assert!(reader.calls().is_empty());
}

#[tokio::test]
async fn spec_l16_11_a_reader_that_answers_the_wrong_shape_is_refused() {
    let reader = Arc::new(Canned::answering(Ok(PanelResult::Scalar {
        value: Some(1.0),
    })));

    let (status, body) = ask(
        &reader,
        Some(TOKEN),
        &asking(OURS, "time_series", &per_service()),
    )
    .await;

    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["error"], "invalid");
}

#[tokio::test]
async fn a_malformed_query_a_backwards_range_and_a_bad_variable_name_are_invalid() {
    let reader = Arc::new(Canned::default());
    let mut bad_query = asking(OURS, "time_series", &per_service());
    bad_query["query"]["aggregations"] = json!([{"function": "p95"}]);
    let mut backwards = asking(OURS, "time_series", &per_service());
    backwards["to_ns"] = json!(FROM);
    let mut bad_kind = asking(OURS, "time_series", &per_service());
    bad_kind["kind"] = json!("sparkles");
    let mut bad_variable = asking(OURS, "time_series", &per_service());
    bad_variable["variables"] = json!({"Not A Name": ["x"]});

    for body in [bad_query, backwards, bad_kind, bad_variable] {
        let (status, answer) = ask(&reader, Some(TOKEN), &body).await;

        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{answer}");
        assert_eq!(answer["error"], "invalid");
        assert!(answer["reason"].is_string(), "{answer}");
    }
    assert!(reader.calls().is_empty());
}

#[tokio::test]
async fn spec_l16_10_a_hostile_variable_value_reaches_the_reader_as_plain_data() {
    let reader = Arc::new(Canned::default());
    let mut body = asking(OURS, "time_series", &per_service());
    body["variables"] = json!({"service": ["x') OR 1=1 --"]});

    let (status, answer) = ask(&reader, Some(TOKEN), &body).await;

    assert_eq!(status, StatusCode::OK);
    assert!(answer.is_object(), "{answer}");
    let calls = reader.calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(
        calls[0].query,
        serde_json::from_value(per_service()).expect("a query")
    );
}

#[tokio::test]
async fn a_group_by_whose_label_collides_is_refused_before_any_read() {
    let reader = Arc::new(Canned::default());
    let mut clashing = per_service();
    clashing["group_by"] = json!([{"field": "service"}, {"attr": "service"}]);

    let (status, body) = ask(
        &reader,
        Some(TOKEN),
        &asking(OURS, "time_series", &clashing),
    )
    .await;

    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["error"], "invalid");
    assert!(reader.calls().is_empty());
}
