use backend::Each;
use ferristrace_application::registry::domain;
use ferristrace_domain::{
    AccountId, Created, DashboardCreation, DashboardFile, DashboardId, DashboardSaving,
    DashboardScope, DashboardStore, ProjectId, ProjectName, Projects, TenantId,
};
use ferristrace_infra::FixedClock;
use ferristrace_postgres::{CONTROL_PLANE, Postgres};
use serde_json::{Value, json};
use sqlx::postgres::PgPoolOptions;
use sqlx::{AssertSqlSafe, PgPool, Row};
use uuid::Uuid;

#[macro_use]
mod backend;

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

async fn an_account(pool: &PgPool, email: &str) -> AccountId {
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO accounts (id, email) VALUES ($1, $2)")
        .bind(id)
        .bind(email)
        .execute(pool)
        .await
        .expect("inserting an account");
    AccountId::new(id)
}

async fn an_org(pool: &PgPool, owner: &str) -> TenantId {
    an_account(pool, owner).await;
    backend::memberships(&Postgres::new(pool.clone(), FixedClock::at(1_700_000_000)))
        .found("Acme", owner)
        .await
        .expect("the organisation is founded")
}

async fn a_project(
    projects: &Each<'_, domain::Projects, FixedClock>,
    org: TenantId,
    name: &str,
) -> ProjectId {
    let slug = ProjectName::try_from(name).expect("an admitted name");
    assert_eq!(
        projects.create(org, &slug).await.expect("a create"),
        Created::Done
    );
    projects
        .of(org)
        .await
        .expect("the projects are read")
        .into_iter()
        .find(|project| &*project.name == name)
        .expect("the project is in the catalogue")
        .id
}

fn scope(org: TenantId, project: ProjectId) -> DashboardScope {
    DashboardScope { org, project }
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
                "filter": {"all": [
                    {"field": "service", "op": "in", "value": [{"var": "service"}]},
                    {"field": "http_status_code", "op": "gte", "value": 500}
                ]},
                "group_by": [{"field": "service"}],
                "order": {"by": {"aggregation": 0}, "direction": "desc"},
                "limit": 20,
                "step": {"fixed": 60}
            }],
            "options": {"unit": null, "decimals": 2, "legend": "right", "stacked": true, "content": null}
        }],
        "layout": [{"panel": "latency", "x": 0, "y": 0, "w": 12, "h": 6}],
        "duration": 3600
    })
}

fn a_file(name: &str) -> DashboardFile {
    DashboardFile::from_value(json!({"name": name, "tags": ["prod", "checkout"], "doc": the_doc()}))
        .expect("a dashboard file")
}

async fn made(
    store: &Each<'_, domain::Dashboards, FixedClock>,
    scope: DashboardScope,
    by: AccountId,
    name: &str,
) -> ferristrace_domain::Dashboard {
    match store
        .create(scope, by, &a_file(name))
        .await
        .expect("created")
    {
        DashboardCreation::Made(made) => made,
        DashboardCreation::NameTaken => panic!("{name} is free"),
    }
}

#[tokio::test]
async fn spec_l16_1_a_dashboard_is_kept_and_read_back_unchanged() {
    let Some(pool) = control_plane("dashboards_roundtrip").await else {
        return;
    };
    let org = an_org(&pool, "owner@example.com").await;
    let alice = an_account(&pool, "alice@example.com").await;
    let pg = Postgres::new(pool.clone(), FixedClock::at(1_700_000_000));
    let project = a_project(&backend::projects(&pg), org, "storefront").await;
    let store = backend::dashboards(&pg);
    let file = a_file("Checkout health");

    let created = made(&store, scope(org, project), alice, "Checkout health").await;
    let found = store
        .get(scope(org, project), created.id)
        .await
        .expect("read")
        .expect("held");

    assert_eq!(found, created);
    assert_eq!(found.clone().into_file(), file);
    assert_eq!(
        serde_json::to_value(&found.doc).expect("serialises"),
        the_doc()
    );
    assert_eq!(found.updated_by, Some(alice));
    assert_eq!(found.project, project);
    assert!(found.created_at_unix_nanos > 0);
    let version: i32 = sqlx::query("SELECT schema_version FROM dashboards WHERE id = $1")
        .bind(found.id.as_uuid())
        .fetch_one(&pool)
        .await
        .expect("the row")
        .get("schema_version");
    assert_eq!(version, 1);
}

#[tokio::test]
async fn a_name_is_unique_in_a_project_and_free_in_another() {
    let Some(pool) = control_plane("dashboards_names").await else {
        return;
    };
    let org = an_org(&pool, "owner@example.com").await;
    let alice = an_account(&pool, "alice@example.com").await;
    let pg = Postgres::new(pool.clone(), FixedClock::at(1_700_000_000));
    let projects = backend::projects(&pg);
    let storefront = a_project(&projects, org, "storefront").await;
    let backoffice = a_project(&projects, org, "backoffice").await;
    let store = backend::dashboards(&pg);
    made(&store, scope(org, storefront), alice, "Checkout").await;

    let twice = store
        .create(scope(org, storefront), alice, &a_file("Checkout"))
        .await
        .expect("created");
    let elsewhere = store
        .create(scope(org, backoffice), alice, &a_file("Checkout"))
        .await
        .expect("created");

    assert_eq!(twice, DashboardCreation::NameTaken);
    assert!(matches!(elsewhere, DashboardCreation::Made(_)));
}

#[tokio::test]
async fn an_update_rewrites_renames_and_never_takes_a_taken_name() {
    let Some(pool) = control_plane("dashboards_update").await else {
        return;
    };
    let org = an_org(&pool, "owner@example.com").await;
    let alice = an_account(&pool, "alice@example.com").await;
    let bob = an_account(&pool, "bob@example.com").await;
    let pg = Postgres::new(pool.clone(), FixedClock::at(1_700_000_000));
    let project = a_project(&backend::projects(&pg), org, "storefront").await;
    let here = scope(org, project);
    let store = backend::dashboards(&pg);
    made(&store, here, alice, "taken").await;
    let mine = made(&store, here, alice, "draft").await;
    let mut next = json!({"name": "final", "tags": [], "doc": the_doc()});
    next["doc"]["panels"] = json!([]);
    next["doc"]["layout"] = json!([]);
    let next = DashboardFile::from_value(next).expect("a file");

    let clash = store
        .update(here, mine.id, bob, &a_file("taken"))
        .await
        .expect("updated");
    let same_name = store
        .update(here, mine.id, bob, &a_file("draft"))
        .await
        .expect("updated");
    let saved = store
        .update(here, mine.id, bob, &next)
        .await
        .expect("updated");
    let missing = store
        .update(
            here,
            DashboardId::new(Uuid::new_v4()),
            bob,
            &a_file("ghost"),
        )
        .await
        .expect("updated");
    let elsewhere = store
        .update(
            scope(org, ProjectId::new(Uuid::new_v4())),
            mine.id,
            bob,
            &a_file("ghost"),
        )
        .await
        .expect("updated");

    assert_eq!(clash, DashboardSaving::NameTaken);
    assert!(matches!(same_name, DashboardSaving::Saved(_)));
    let DashboardSaving::Saved(saved) = saved else {
        panic!("the update is saved");
    };
    assert_eq!(saved.id, mine.id);
    assert_eq!(saved.updated_by, Some(bob));
    assert_eq!(saved.created_at_unix_nanos, mine.created_at_unix_nanos);
    assert!(saved.updated_at_unix_nanos >= mine.updated_at_unix_nanos);
    assert_eq!(saved.into_file(), next);
    assert_eq!(missing, DashboardSaving::Missing);
    assert_eq!(elsewhere, DashboardSaving::Missing);
}

#[tokio::test]
async fn a_dashboard_is_only_there_for_its_own_project() {
    let Some(pool) = control_plane("dashboards_scope").await else {
        return;
    };
    let org = an_org(&pool, "owner@example.com").await;
    let other_org = an_org(&pool, "other@example.com").await;
    let alice = an_account(&pool, "alice@example.com").await;
    let pg = Postgres::new(pool.clone(), FixedClock::at(1_700_000_000));
    let projects = backend::projects(&pg);
    let storefront = a_project(&projects, org, "storefront").await;
    let backoffice = a_project(&projects, org, "backoffice").await;
    let foreign = a_project(&projects, other_org, "storefront").await;
    let store = backend::dashboards(&pg);
    let created = made(&store, scope(org, storefront), alice, "Checkout").await;

    assert_eq!(
        store.locate(created.id).await.expect("located"),
        Some(scope(org, storefront))
    );
    assert_eq!(
        store.project_scope(foreign).await.expect("located"),
        Some(scope(other_org, foreign))
    );
    assert_eq!(
        store
            .project_scope(ProjectId::new(Uuid::new_v4()))
            .await
            .expect("located"),
        None
    );
    assert_eq!(
        store
            .locate(DashboardId::new(Uuid::new_v4()))
            .await
            .expect("located"),
        None
    );
    for wrong in [
        scope(org, backoffice),
        scope(other_org, foreign),
        scope(other_org, storefront),
    ] {
        assert_eq!(store.get(wrong, created.id).await.expect("read"), None);
        assert!(store.list(wrong).await.expect("listed").is_empty());
        assert!(!store.delete(wrong, created.id).await.expect("deleted"));
    }
    assert_eq!(
        store.count(scope(org, storefront)).await.expect("counted"),
        1
    );
    assert_eq!(
        store.count(scope(org, backoffice)).await.expect("counted"),
        0
    );
    assert!(
        store
            .delete(scope(org, storefront), created.id)
            .await
            .expect("deleted")
    );
    assert!(
        !store
            .delete(scope(org, storefront), created.id)
            .await
            .expect("deleted")
    );
}

#[tokio::test]
async fn a_list_gives_summaries_in_the_order_a_person_reads_names() {
    let Some(pool) = control_plane("dashboards_list").await else {
        return;
    };
    let org = an_org(&pool, "owner@example.com").await;
    let alice = an_account(&pool, "alice@example.com").await;
    let pg = Postgres::new(pool.clone(), FixedClock::at(1_700_000_000));
    let project = a_project(&backend::projects(&pg), org, "storefront").await;
    let store = backend::dashboards(&pg);
    for name in ["beta", "Alpha", "gamma"] {
        made(&store, scope(org, project), alice, name).await;
    }

    let listed = store.list(scope(org, project)).await.expect("listed");

    let names: Vec<_> = listed.iter().map(|one| one.name.to_string()).collect();
    assert_eq!(names, vec!["Alpha", "beta", "gamma"]);
    assert_eq!(listed[0].tags.as_slice().len(), 2);
    assert_eq!(listed[0].updated_by, Some(alice));
}

#[tokio::test]
async fn spec_l16_16_deleting_a_project_deletes_its_dashboards() {
    let Some(pool) = control_plane("dashboards_cascade").await else {
        return;
    };
    let org = an_org(&pool, "owner@example.com").await;
    let alice = an_account(&pool, "alice@example.com").await;
    let pg = Postgres::new(pool.clone(), FixedClock::at(1_700_000_000));
    let projects = backend::projects(&pg);
    let doomed = a_project(&projects, org, "doomed").await;
    let kept = a_project(&projects, org, "kept").await;
    let store = backend::dashboards(&pg);
    made(&store, scope(org, doomed), alice, "one").await;
    made(&store, scope(org, doomed), alice, "two").await;
    made(&store, scope(org, kept), alice, "three").await;

    assert!(projects.forget(org, doomed).await.expect("the forget"));

    let remaining: i64 = sqlx::query("SELECT count(*) AS value FROM dashboards")
        .fetch_one(&pool)
        .await
        .expect("counting")
        .get("value");
    assert_eq!(remaining, 1);
    assert_eq!(store.count(scope(org, kept)).await.expect("counted"), 1);
    assert_eq!(store.count(scope(org, doomed)).await.expect("counted"), 0);
}

#[tokio::test]
async fn disbanding_an_organisation_deletes_its_dashboards_and_a_leaver_leaves_them_orphaned() {
    let Some(pool) = control_plane("dashboards_orphan").await else {
        return;
    };
    let org = an_org(&pool, "owner@example.com").await;
    let doomed = an_org(&pool, "doomed@example.com").await;
    let alice = an_account(&pool, "alice@example.com").await;
    let pg = Postgres::new(pool.clone(), FixedClock::at(1_700_000_000));
    let projects = backend::projects(&pg);
    let storefront = a_project(&projects, org, "storefront").await;
    let gone = a_project(&projects, doomed, "storefront").await;
    let store = backend::dashboards(&pg);
    let created = made(&store, scope(org, storefront), alice, "Checkout").await;
    made(&store, scope(doomed, gone), alice, "Checkout").await;

    sqlx::query("DELETE FROM orgs WHERE id = $1")
        .bind(doomed.as_uuid())
        .execute(&pool)
        .await
        .expect("disbanded");
    sqlx::query("DELETE FROM accounts WHERE id = $1")
        .bind(alice.as_uuid())
        .execute(&pool)
        .await
        .expect("deleted");

    let kept = store
        .get(scope(org, storefront), created.id)
        .await
        .expect("read")
        .expect("still there");
    let total: i64 = sqlx::query("SELECT count(*) AS value FROM dashboards")
        .fetch_one(&pool)
        .await
        .expect("counting")
        .get("value");
    assert_eq!(kept.updated_by, None);
    assert_eq!(total, 1);
}
