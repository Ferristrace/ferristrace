use std::sync::{Arc, Mutex};

use axum::body::Body;
use axum::http::header::{AUTHORIZATION, CONTENT_DISPOSITION};
use axum::http::{Method, Request, StatusCode};
use ferristrace_api::{AppState, dashboard_router};
use ferristrace_application::registry::{RepoFor, domain};
use ferristrace_application::testing::{Bearers, Inert, Untransacted};
use ferristrace_application::{Adapters, Ferristrace, Stack};
use ferristrace_domain::testing::Notebook;
use ferristrace_domain::{
    AccountId, Action, ApiKey, ApiKeys, ApiSecret, Dashboard, DashboardCreation, DashboardFile,
    DashboardId, DashboardSaving, DashboardScope, DashboardStore, DashboardSummary, IssuedKey,
    KeyId, KeyName, KeyScopes, Membership, Memberships, NoPhotos, OrgRole, ProjectId, ReadGrant,
    Session, SessionError, SessionStore, SessionToken, StoreError, TenantId, UnixSeconds,
    WhoamiError,
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

#[derive(Debug, Clone, Default)]
struct Kept {
    held: Arc<Mutex<Vec<(DashboardScope, Dashboard)>>>,
}

impl Kept {
    fn stamp(&self, scope: DashboardScope, by: AccountId, file: &DashboardFile) -> Dashboard {
        let held = self.held.lock().expect("the lock");
        Dashboard {
            id: DashboardId::new(Uuid::from_u128(5000 + held.len() as u128)),
            project: scope.project,
            name: file.name.clone(),
            tags: file.tags.clone(),
            doc: file.doc.clone(),
            updated_by: Some(by),
            created_at_unix_nanos: 1_700_000_000_123_456_789,
            updated_at_unix_nanos: 1_700_000_000_123_456_789,
        }
    }

    fn seed(&self, scope: DashboardScope, count: usize) {
        for at in 0..count {
            let file = a_file(&format!("filler {at}"), &the_doc());
            let by = AccountId::new(Uuid::from_u128(ME));
            let made = self.stamp(scope, by, &file);
            self.held.lock().expect("the lock").push((scope, made));
        }
    }

    fn count(&self) -> usize {
        self.held.lock().expect("the lock").len()
    }
}

impl DashboardStore for Kept {
    async fn project_scope(&self, wanted: ProjectId) -> Result<Option<DashboardScope>, StoreError> {
        Ok([
            scope(MINE, OURS),
            scope(MINE, OTHER),
            scope(THEIRS, STRANGERS),
        ]
        .into_iter()
        .find(|held| held.project == wanted))
    }

    async fn locate(&self, wanted: DashboardId) -> Result<Option<DashboardScope>, StoreError> {
        Ok(self
            .held
            .lock()
            .expect("the lock")
            .iter()
            .find(|(_, held)| held.id == wanted)
            .map(|(held, _)| *held))
    }

    async fn list(&self, wanted: DashboardScope) -> Result<Vec<DashboardSummary>, StoreError> {
        Ok(self
            .held
            .lock()
            .expect("the lock")
            .iter()
            .filter(|(held, _)| *held == wanted)
            .map(|(_, held)| DashboardSummary {
                id: held.id,
                name: held.name.clone(),
                tags: held.tags.clone(),
                updated_by: held.updated_by,
                updated_at_unix_nanos: held.updated_at_unix_nanos,
            })
            .collect())
    }

    async fn get(
        &self,
        wanted: DashboardScope,
        which: DashboardId,
    ) -> Result<Option<Dashboard>, StoreError> {
        Ok(self
            .held
            .lock()
            .expect("the lock")
            .iter()
            .find(|(held, found)| *held == wanted && found.id == which)
            .map(|(_, found)| found.clone()))
    }

    async fn count(&self, wanted: DashboardScope) -> Result<usize, StoreError> {
        Ok(self
            .held
            .lock()
            .expect("the lock")
            .iter()
            .filter(|(held, _)| *held == wanted)
            .count())
    }

    async fn create(
        &self,
        wanted: DashboardScope,
        by: AccountId,
        file: &DashboardFile,
    ) -> Result<DashboardCreation, StoreError> {
        let taken = self
            .held
            .lock()
            .expect("the lock")
            .iter()
            .any(|(held, found)| *held == wanted && found.name == file.name);
        if taken {
            return Ok(DashboardCreation::NameTaken);
        }
        let made = self.stamp(wanted, by, file);
        self.held
            .lock()
            .expect("the lock")
            .push((wanted, made.clone()));
        Ok(DashboardCreation::Made(made))
    }

    async fn update(
        &self,
        wanted: DashboardScope,
        which: DashboardId,
        by: AccountId,
        file: &DashboardFile,
    ) -> Result<DashboardSaving, StoreError> {
        let mut held = self.held.lock().expect("the lock");
        if held
            .iter()
            .any(|(at, found)| *at == wanted && found.id != which && found.name == file.name)
        {
            return Ok(DashboardSaving::NameTaken);
        }
        let Some((_, found)) = held
            .iter_mut()
            .find(|(at, found)| *at == wanted && found.id == which)
        else {
            return Ok(DashboardSaving::Missing);
        };
        found.name = file.name.clone();
        found.tags = file.tags.clone();
        found.doc = file.doc.clone();
        found.updated_by = Some(by);
        Ok(DashboardSaving::Saved(found.clone()))
    }

    async fn delete(&self, wanted: DashboardScope, which: DashboardId) -> Result<bool, StoreError> {
        let mut held = self.held.lock().expect("the lock");
        let before = held.len();
        held.retain(|(at, found)| !(*at == wanted && found.id == which));
        Ok(held.len() < before)
    }
}

struct Fakes {
    kept: Kept,
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
    type Repo = Kept;

    fn build(&self, (): &()) -> Self::Repo {
        self.kept.clone()
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

struct World {
    kept: Kept,
    notebook: Notebook,
}

impl World {
    fn new() -> Self {
        Self {
            kept: Kept::default(),
            notebook: Notebook::default(),
        }
    }

    fn state(&self) -> AppState<TestStack> {
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
            kept: self.kept.clone(),
            notebook: self.notebook.clone(),
        };
        AppState::new(Arc::new(Ferristrace::new(fakes, adapters)))
    }

    async fn ask(
        &self,
        method: Method,
        uri: &str,
        bearer: Option<&str>,
        body: Option<&Value>,
    ) -> (StatusCode, String, Option<String>) {
        let mut request = Request::builder().method(method).uri(uri);
        if let Some(bearer) = bearer {
            request = request.header(AUTHORIZATION, format!("Bearer {bearer}"));
        }
        if body.is_some() {
            request = request.header("content-type", "application/json");
        }
        let request = request
            .body(body.map_or_else(Body::empty, |json| Body::from(json.to_string())))
            .expect("a request");
        let response = dashboard_router(self.state())
            .oneshot(request)
            .await
            .expect("a response");
        let status = response.status();
        let disposition = response
            .headers()
            .get(CONTENT_DISPOSITION)
            .map(|value| value.to_str().expect("text").to_owned());
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("a body");
        (
            status,
            String::from_utf8(body.to_vec()).expect("text"),
            disposition,
        )
    }

    async fn as_me(&self, method: Method, uri: &str, body: Option<&Value>) -> (StatusCode, Value) {
        let (status, text, _) = self.ask(method, uri, Some(TOKEN), body).await;
        (
            status,
            serde_json::from_str(&text).unwrap_or(Value::String(text)),
        )
    }
}

fn the_doc() -> Value {
    json!({
        "schema_version": 1,
        "variables": [{
            "name": "service",
            "label": "Service",
            "source": {"kind": "attribute", "signal": "traces", "key": "service.name"},
            "multi": true,
            "all": true
        }],
        "panels": [{
            "id": "latency",
            "title": "Spans per service",
            "description": "",
            "kind": "time_series",
            "queries": [{
                "name": "spans",
                "signal": "traces",
                "aggregations": [{"function": "count", "field": null}],
                "filter": {"field": "service", "op": "in", "value": [{"var": "service"}]},
                "group_by": [{"field": "service"}],
                "order": {"by": {"aggregation": 0}, "direction": "desc"},
                "limit": 20,
                "step": "auto"
            }],
            "options": {"unit": "ms", "decimals": 2, "legend": "bottom", "stacked": false, "content": null}
        }],
        "layout": [{"panel": "latency", "x": 0, "y": 0, "w": 12, "h": 6}],
        "duration": 3600
    })
}

fn a_file(name: &str, doc: &Value) -> DashboardFile {
    DashboardFile::from_value(json!({"name": name, "tags": ["prod"], "doc": doc}))
        .expect("a dashboard file")
}

fn creating(project_seed: u128, name: &str, doc: &Value) -> Value {
    json!({"project": id(project_seed), "name": name, "tags": ["prod", "checkout"], "doc": doc})
}

fn list_of(project_seed: u128) -> String {
    format!("/api/v1/dashboards?project={}", id(project_seed))
}

fn one(seed: u128) -> String {
    format!("/api/v1/dashboards/{}", id(seed))
}

async fn created(world: &World, project_seed: u128, name: &str) -> String {
    let (status, body) = world
        .as_me(
            Method::POST,
            "/api/v1/dashboards",
            Some(&creating(project_seed, name, &the_doc())),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body["id"].as_str().expect("an id").to_owned()
}

#[tokio::test]
async fn spec_l16_1_a_member_creates_a_dashboard_with_a_time_series_panel_and_reads_it_back_unchanged()
 {
    let world = World::new();

    let (status, made) = world
        .as_me(
            Method::POST,
            "/api/v1/dashboards",
            Some(&creating(OURS, "Checkout health", &the_doc())),
        )
        .await;
    let (read_status, read) = world
        .as_me(
            Method::GET,
            &format!("/api/v1/dashboards/{}", made["id"].as_str().expect("an id")),
            None,
        )
        .await;
    let (_, listed) = world.as_me(Method::GET, &list_of(OURS), None).await;

    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(read_status, StatusCode::OK);
    assert_eq!(read["doc"], the_doc());
    assert_eq!(read["name"], "Checkout health");
    assert_eq!(read["tags"], json!(["prod", "checkout"]));
    assert_eq!(read["project"], id(OURS));
    assert_eq!(read["updated_by"], id(ME));
    assert_eq!(read["updated_at_ms"], 1_700_000_000_123u64);
    assert_eq!(read, made);
    assert_eq!(listed["dashboards"][0]["name"], "Checkout health");
    assert_eq!(listed["dashboards"][0]["tags"], json!(["prod", "checkout"]));
    assert_eq!(listed["dashboards"][0]["id"], made["id"]);
}

#[tokio::test]
async fn spec_l16_2_a_member_of_another_project_gets_a_404_to_read_edit_or_delete() {
    let world = World::new();
    world.kept.seed(scope(THEIRS, STRANGERS), 1);
    let theirs = one(5000);
    let body = creating(STRANGERS, "mine now", &the_doc());
    let replacing = json!({"name": "mine now", "tags": [], "doc": the_doc()});

    let attempts = [
        world.as_me(Method::GET, &list_of(STRANGERS), None).await,
        world.as_me(Method::GET, &theirs, None).await,
        world
            .as_me(Method::GET, &format!("{theirs}/export"), None)
            .await,
        world
            .as_me(Method::POST, "/api/v1/dashboards", Some(&body))
            .await,
        world.as_me(Method::PUT, &theirs, Some(&replacing)).await,
        world
            .as_me(Method::POST, &format!("{theirs}/clone"), None)
            .await,
        world.as_me(Method::DELETE, &theirs, None).await,
        world
            .as_me(
                Method::POST,
                &format!("/api/v1/dashboards/import?project={}", id(STRANGERS)),
                Some(&json!({"name": "x", "tags": [], "doc": the_doc()})),
            )
            .await,
    ];

    for (status, body) in attempts {
        assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
    }
    assert_eq!(world.kept.count(), 1);
    assert!(world.notebook.entries().is_empty());
}

#[tokio::test]
async fn spec_l16_2_a_key_bound_to_another_project_gets_a_404() {
    let world = World::new();
    let made = created(&world, OURS, "Checkout").await;

    let (bound, _, _) = world
        .ask(
            Method::GET,
            &format!("/api/v1/dashboards/{made}"),
            Some(BOUND_KEY),
            None,
        )
        .await;
    let (bound_list, _, _) = world
        .ask(Method::GET, &list_of(OURS), Some(BOUND_KEY), None)
        .await;
    let (own_list, _, _) = world
        .ask(Method::GET, &list_of(OTHER), Some(BOUND_KEY), None)
        .await;

    assert_eq!(bound, StatusCode::NOT_FOUND);
    assert_eq!(bound_list, StatusCode::NOT_FOUND);
    assert_eq!(own_list, StatusCode::OK);
}

#[tokio::test]
async fn spec_l16_3_a_key_with_only_the_ingest_scope_is_refused_and_a_read_key_reads() {
    let world = World::new();
    let made = created(&world, OURS, "Checkout").await;
    let uri = format!("/api/v1/dashboards/{made}");

    let mut refused = Vec::new();
    for path in [list_of(OURS), uri.clone(), format!("{uri}/export")] {
        refused.push(
            world
                .ask(Method::GET, &path, Some(INGEST_KEY), None)
                .await
                .0,
        );
    }
    let reads = world.ask(Method::GET, &uri, Some(READ_KEY), None).await;
    let writes = world
        .ask(
            Method::POST,
            "/api/v1/dashboards",
            Some(READ_KEY),
            Some(&creating(OURS, "by key", &the_doc())),
        )
        .await;
    let nobody = world.ask(Method::GET, &uri, None, None).await;

    assert_eq!(refused, vec![StatusCode::UNAUTHORIZED; 3]);
    assert_eq!(reads.0, StatusCode::OK);
    assert_eq!(writes.0, StatusCode::UNAUTHORIZED);
    assert_eq!(nobody.0, StatusCode::UNAUTHORIZED);
    assert_eq!(world.kept.count(), 1);
}

#[tokio::test]
async fn spec_l16_4_a_document_with_an_unknown_schema_version_is_refused_with_422() {
    let world = World::new();
    let made = created(&world, OURS, "Checkout").await;
    let mut future = the_doc();
    future["schema_version"] = json!(2);

    let (create, _) = world
        .as_me(
            Method::POST,
            "/api/v1/dashboards",
            Some(&creating(OURS, "v2", &future)),
        )
        .await;
    let (replace, _) = world
        .as_me(
            Method::PUT,
            &format!("/api/v1/dashboards/{made}"),
            Some(&json!({"name": "v2", "tags": [], "doc": future})),
        )
        .await;
    let (import, text) = world
        .as_me(
            Method::POST,
            &format!("/api/v1/dashboards/import?project={}", id(OURS)),
            Some(&json!({"name": "v2", "tags": [], "doc": future})),
        )
        .await;

    assert_eq!(create, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(replace, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(import, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(text.as_str().expect("a reason").contains("schema_version"));
    assert_eq!(world.kept.count(), 1);
}

#[tokio::test]
async fn spec_l16_5_a_31st_panel_a_257_kb_document_and_a_101st_dashboard_are_refused_with_the_reason()
 {
    let world = World::new();
    let mut crowded = the_doc();
    crowded["layout"] = json!([]);
    crowded["panels"] = json!((0..31)
        .map(|at| json!({"id": format!("p{at}"), "title": "", "description": "", "kind": "text", "queries": [], "options": {}}))
        .collect::<Vec<_>>());
    let mut heavy = the_doc();
    heavy["panels"] = json!([]);
    heavy["layout"] = json!([]);
    heavy["variables"] = json!(
        (0..20)
            .map(|at| json!({
                "name": format!("v{at}"), "label": "",
                "source": {"kind": "static", "values": vec!["x".repeat(140); 100]},
                "multi": false, "all": false
            }))
            .collect::<Vec<_>>()
    );
    assert!(heavy.to_string().len() > 257 * 1024);

    let (panels, panels_reason) = world
        .as_me(
            Method::POST,
            "/api/v1/dashboards",
            Some(&creating(OURS, "crowded", &crowded)),
        )
        .await;
    let (size, size_reason) = world
        .as_me(
            Method::POST,
            "/api/v1/dashboards",
            Some(&creating(OURS, "heavy", &heavy)),
        )
        .await;
    world.kept.seed(scope(MINE, OURS), 100);
    let (hundred_and_first, count_reason) = world
        .as_me(
            Method::POST,
            "/api/v1/dashboards",
            Some(&creating(OURS, "one more", &the_doc())),
        )
        .await;
    let (elsewhere, _) = world
        .as_me(
            Method::POST,
            "/api/v1/dashboards",
            Some(&creating(OTHER, "fine", &the_doc())),
        )
        .await;

    assert_eq!(panels, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        panels_reason
            .as_str()
            .expect("a reason")
            .contains("30 panels")
    );
    assert_eq!(size, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(size_reason.as_str().expect("a reason").contains("256 KB"));
    assert_eq!(hundred_and_first, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        count_reason
            .as_str()
            .expect("a reason")
            .contains("100 dashboards")
    );
    assert_eq!(elsewhere, StatusCode::CREATED);
}

#[tokio::test]
async fn a_number_panel_given_a_series_query_is_refused_at_save() {
    let world = World::new();
    let mut doc = the_doc();
    doc["panels"][0]["kind"] = json!("number");

    let (status, reason) = world
        .as_me(
            Method::POST,
            "/api/v1/dashboards",
            Some(&creating(OURS, "n", &doc)),
        )
        .await;

    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(reason.as_str().expect("a reason").contains("number"));
}

#[tokio::test]
async fn spec_l16_15_an_export_imported_into_another_project_gives_an_equal_document() {
    let world = World::new();
    let made = created(&world, OURS, "Checkout health").await;

    let (status, text, disposition) = world
        .ask(
            Method::GET,
            &format!("/api/v1/dashboards/{made}/export"),
            Some(TOKEN),
            None,
        )
        .await;
    let exported: Value = serde_json::from_str(&text).expect("json");
    let (imported_status, imported) = world
        .as_me(
            Method::POST,
            &format!("/api/v1/dashboards/import?project={}", id(OTHER)),
            Some(&exported),
        )
        .await;
    let (_, original) = world
        .as_me(Method::GET, &format!("/api/v1/dashboards/{made}"), None)
        .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        disposition.as_deref(),
        Some("attachment; filename=\"checkout-health.json\"")
    );
    assert_eq!(exported["name"], "Checkout health");
    assert_eq!(exported["tags"], json!(["prod", "checkout"]));
    assert_eq!(imported_status, StatusCode::CREATED);
    assert_eq!(imported["doc"], original["doc"]);
    assert_eq!(imported["doc"], the_doc());
    assert_eq!(imported["name"], original["name"]);
    assert_eq!(imported["project"], id(OTHER));
    assert_ne!(imported["id"], original["id"]);
}

#[tokio::test]
async fn spec_l16_17_create_update_and_delete_each_write_an_audit_entry() {
    let world = World::new();
    let made = created(&world, OURS, "Checkout").await;
    let uri = format!("/api/v1/dashboards/{made}");

    world
        .as_me(
            Method::PUT,
            &uri,
            Some(&json!({"name": "Checkout v2", "tags": [], "doc": the_doc()})),
        )
        .await;
    world.as_me(Method::GET, &uri, None).await;
    let (deleted, _) = world.as_me(Method::DELETE, &uri, None).await;

    let entries = world.notebook.entries();
    let actions: Vec<_> = entries.iter().map(|entry| entry.action).collect();
    assert_eq!(deleted, StatusCode::NO_CONTENT);
    assert_eq!(
        actions,
        vec![
            Action::DashboardCreated,
            Action::DashboardUpdated,
            Action::DashboardDeleted
        ]
    );
    for entry in &entries {
        assert_eq!(entry.org, org(MINE));
        assert_eq!(entry.target.id.as_deref(), Some(made.as_str()));
    }
}

#[tokio::test]
async fn a_name_taken_is_a_409_and_a_clone_is_numbered() {
    let world = World::new();
    let made = created(&world, OURS, "Checkout").await;

    let (again, _) = world
        .as_me(
            Method::POST,
            "/api/v1/dashboards",
            Some(&creating(OURS, "Checkout", &the_doc())),
        )
        .await;
    let (first, copy) = world
        .as_me(
            Method::POST,
            &format!("/api/v1/dashboards/{made}/clone"),
            None,
        )
        .await;
    let (second, second_copy) = world
        .as_me(
            Method::POST,
            &format!("/api/v1/dashboards/{made}/clone"),
            None,
        )
        .await;
    let (clash, _) = world
        .as_me(
            Method::PUT,
            &format!("/api/v1/dashboards/{}", copy["id"].as_str().expect("an id")),
            Some(&json!({"name": "Checkout", "tags": [], "doc": the_doc()})),
        )
        .await;

    assert_eq!(again, StatusCode::CONFLICT);
    assert_eq!((first, second), (StatusCode::CREATED, StatusCode::CREATED));
    assert_eq!(copy["name"], "Checkout copy");
    assert_eq!(second_copy["name"], "Checkout copy 2");
    assert_eq!(copy["doc"], the_doc());
    assert_eq!(clash, StatusCode::CONFLICT);
}

#[tokio::test]
async fn a_request_without_a_bearer_or_without_a_project_is_refused() {
    let world = World::new();

    let (anonymous, _, _) = world.ask(Method::GET, &list_of(OURS), None, None).await;
    let (anonymous_write, _, _) = world
        .ask(
            Method::POST,
            "/api/v1/dashboards",
            None,
            Some(&creating(OURS, "x", &the_doc())),
        )
        .await;
    let (no_project, _) = world.as_me(Method::GET, "/api/v1/dashboards", None).await;
    let (unknown_project, _) = world.as_me(Method::GET, &list_of(9999), None).await;
    let (unknown_id, _) = world.as_me(Method::GET, &one(9999), None).await;

    assert_eq!(anonymous, StatusCode::UNAUTHORIZED);
    assert_eq!(anonymous_write, StatusCode::UNAUTHORIZED);
    assert_eq!(no_project, StatusCode::BAD_REQUEST);
    assert_eq!(unknown_project, StatusCode::NOT_FOUND);
    assert_eq!(unknown_id, StatusCode::NOT_FOUND);
}
