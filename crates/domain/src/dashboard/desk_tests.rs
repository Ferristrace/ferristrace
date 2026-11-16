use std::sync::Mutex;

use serde_json::json;
use uuid::Uuid;

use super::desk::{DashboardDesk, MAX_DASHBOARDS};
use super::doc::DashboardDoc;
use super::doc_tests::{document, panel, series_query};
use super::entities::{Dashboard, DashboardFile, DashboardSummary};
use super::errors::{Cap, DashboardError};
use super::ports::{DashboardCreation, DashboardSaving, DashboardStore, Scope};
use super::value_objects::{DashboardId, DashboardName};
use crate::access::key_ring_tests::{
    MINE, MemberOfMine, OTHER, OURS, OneSession, Ring, THEIRS, a_project, an_org, scopes, token,
};
use crate::access::{KeyScope, Reader, Readers};
use crate::audit::{Action, Actor, TargetKind};
use crate::catalogue::ProjectId;
use crate::identity::AccountId;
use crate::organisation::{OrgRole, Whoami};
use crate::store::StoreError;
use crate::testing::Notebook;

const OTHERS_PROJECT: u128 = 50;
const ME: u128 = 9;

fn scope_of(org: u128, project: u128) -> Scope {
    Scope {
        org: an_org(org),
        project: a_project(project),
    }
}

#[derive(Default)]
struct Shelf {
    kept: Mutex<Vec<(Scope, Dashboard)>>,
}

impl Shelf {
    fn holding(&self, scope: Scope, count: usize) {
        for at in 0..count {
            let file = a_file(&format!("filler {at}"));
            let mut kept = self.kept.lock().expect("the lock");
            let id = DashboardId::new(Uuid::from_u128(5000 + kept.len() as u128));
            kept.push((scope, dashboard(id, scope, file)));
        }
    }

    fn names(&self, project: u128) -> Vec<String> {
        self.kept
            .lock()
            .expect("the lock")
            .iter()
            .filter(|(scope, _)| scope.project == a_project(project))
            .map(|(_, held)| held.name.to_string())
            .collect()
    }
}

fn dashboard(id: DashboardId, scope: Scope, file: DashboardFile) -> Dashboard {
    Dashboard {
        id,
        project: scope.project,
        name: file.name,
        tags: file.tags,
        doc: file.doc,
        updated_by: Some(AccountId::new(Uuid::from_u128(ME))),
        created_at_unix_nanos: 1,
        updated_at_unix_nanos: 1,
    }
}

impl DashboardStore for Shelf {
    async fn project_scope(&self, project: ProjectId) -> Result<Option<Scope>, StoreError> {
        Ok([
            scope_of(MINE, OURS),
            scope_of(MINE, OTHER),
            scope_of(THEIRS, OTHERS_PROJECT),
        ]
        .into_iter()
        .find(|scope| scope.project == project))
    }

    async fn locate(&self, id: DashboardId) -> Result<Option<Scope>, StoreError> {
        Ok(self
            .kept
            .lock()
            .expect("the lock")
            .iter()
            .find(|(_, held)| held.id == id)
            .map(|(scope, _)| *scope))
    }

    async fn list(&self, scope: Scope) -> Result<Vec<DashboardSummary>, StoreError> {
        Ok(self
            .kept
            .lock()
            .expect("the lock")
            .iter()
            .filter(|(held, _)| *held == scope)
            .map(|(_, held)| DashboardSummary {
                id: held.id,
                name: held.name.clone(),
                tags: held.tags.clone(),
                updated_by: held.updated_by,
                updated_at_unix_nanos: held.updated_at_unix_nanos,
            })
            .collect())
    }

    async fn get(&self, scope: Scope, id: DashboardId) -> Result<Option<Dashboard>, StoreError> {
        Ok(self
            .kept
            .lock()
            .expect("the lock")
            .iter()
            .find(|(held, found)| *held == scope && found.id == id)
            .map(|(_, found)| found.clone()))
    }

    async fn count(&self, scope: Scope) -> Result<usize, StoreError> {
        Ok(self
            .kept
            .lock()
            .expect("the lock")
            .iter()
            .filter(|(held, _)| *held == scope)
            .count())
    }

    async fn create(
        &self,
        scope: Scope,
        by: AccountId,
        file: &DashboardFile,
    ) -> Result<DashboardCreation, StoreError> {
        let mut kept = self.kept.lock().expect("the lock");
        if kept
            .iter()
            .any(|(held, found)| *held == scope && found.name == file.name)
        {
            return Ok(DashboardCreation::NameTaken);
        }
        let id = DashboardId::new(Uuid::from_u128(5000 + kept.len() as u128));
        let made = Dashboard {
            updated_by: Some(by),
            ..dashboard(id, scope, file.clone())
        };
        kept.push((scope, made.clone()));
        Ok(DashboardCreation::Made(made))
    }

    async fn update(
        &self,
        scope: Scope,
        id: DashboardId,
        by: AccountId,
        file: &DashboardFile,
    ) -> Result<DashboardSaving, StoreError> {
        let mut kept = self.kept.lock().expect("the lock");
        if kept
            .iter()
            .any(|(held, found)| *held == scope && found.id != id && found.name == file.name)
        {
            return Ok(DashboardSaving::NameTaken);
        }
        let Some((_, found)) = kept
            .iter_mut()
            .find(|(held, found)| *held == scope && found.id == id)
        else {
            return Ok(DashboardSaving::Missing);
        };
        found.name = file.name.clone();
        found.tags = file.tags.clone();
        found.doc = file.doc.clone();
        found.updated_by = Some(by);
        found.updated_at_unix_nanos += 1;
        Ok(DashboardSaving::Saved(found.clone()))
    }

    async fn delete(&self, scope: Scope, id: DashboardId) -> Result<bool, StoreError> {
        let mut kept = self.kept.lock().expect("the lock");
        let before = kept.len();
        kept.retain(|(held, found)| !(*held == scope && found.id == id));
        Ok(kept.len() < before)
    }
}

fn a_doc() -> DashboardDoc {
    DashboardDoc::from_value(document(
        vec![panel("latency", "time_series", vec![series_query()])],
        vec![json!({"panel": "latency", "x": 0, "y": 0, "w": 12, "h": 6})],
    ))
    .expect("a document")
}

fn a_file(name: &str) -> DashboardFile {
    DashboardFile {
        name: DashboardName::try_from(name).expect("a name"),
        tags: super::value_objects::Tags::parse(&["prod"]).expect("tags"),
        doc: a_doc(),
    }
}

type Desk<'a> = DashboardDesk<OneSession, MemberOfMine, &'a Ring, &'a Shelf, Notebook>;

fn desk<'a>(shelf: &'a Shelf, keys: &'a Ring, notebook: &Notebook) -> Desk<'a> {
    DashboardDesk::new(
        Readers::new(Whoami::new(OneSession, MemberOfMine(OrgRole::Member)), keys),
        shelf,
        notebook.clone(),
    )
}

fn me() -> Reader {
    Reader::Session(token())
}

fn project(seed: u128) -> ProjectId {
    a_project(seed)
}

#[tokio::test]
async fn spec_l16_1_a_member_creates_a_dashboard_and_reads_it_back_unchanged() {
    let (shelf, keys, notebook) = (Shelf::default(), Ring::default(), Notebook::default());
    let desk = desk(&shelf, &keys, &notebook);
    let file = a_file("Checkout health");

    let made = desk
        .create(&token(), project(OURS), &file)
        .await
        .expect("created");
    let read = desk.get(&me(), made.id).await.expect("read");
    let listed = desk.list(&me(), project(OURS)).await.expect("listed");

    assert_eq!(read.clone().into_file(), file);
    assert_eq!(read.project, project(OURS));
    assert_eq!(read.updated_by, Some(AccountId::new(Uuid::from_u128(ME))));
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].name, file.name);
}

#[tokio::test]
async fn spec_l16_2_a_member_of_another_project_cannot_read_edit_or_delete() {
    let (shelf, keys, notebook) = (Shelf::default(), Ring::default(), Notebook::default());
    let desk = desk(&shelf, &keys, &notebook);
    let theirs = scope_of(THEIRS, OTHERS_PROJECT);
    shelf.holding(theirs, 1);
    let id = DashboardId::new(Uuid::from_u128(5000));
    let file = a_file("mine");

    assert_eq!(
        desk.list(&me(), project(OTHERS_PROJECT)).await,
        Err(DashboardError::NotFound)
    );
    assert_eq!(desk.get(&me(), id).await, Err(DashboardError::NotFound));
    assert_eq!(desk.export(&me(), id).await, Err(DashboardError::NotFound));
    assert_eq!(
        desk.create(&token(), project(OTHERS_PROJECT), &file).await,
        Err(DashboardError::NotFound)
    );
    assert_eq!(
        desk.import(&token(), project(OTHERS_PROJECT), &file).await,
        Err(DashboardError::NotFound)
    );
    assert_eq!(
        desk.replace(&token(), id, &file).await,
        Err(DashboardError::NotFound)
    );
    assert_eq!(
        desk.duplicate(&token(), id).await,
        Err(DashboardError::NotFound)
    );
    assert_eq!(
        desk.delete(&token(), id).await,
        Err(DashboardError::NotFound)
    );
    assert_eq!(shelf.names(OTHERS_PROJECT), vec!["filler 0"]);
    assert!(notebook.entries().is_empty());
}

#[tokio::test]
async fn spec_l16_2_a_key_bound_to_another_project_cannot_read() {
    let (shelf, keys, notebook) = (Shelf::default(), Ring::default(), Notebook::default());
    let desk = desk(&shelf, &keys, &notebook);
    desk.create(&token(), project(OURS), &a_file("ours"))
        .await
        .expect("created");
    let id = DashboardId::new(Uuid::from_u128(5000));
    let read = scopes(&[KeyScope::Read]);
    let bound_here = Reader::Key(keys.holding(an_org(MINE), Some(project(OURS)), read.clone()));
    let bound_elsewhere =
        Reader::Key(keys.holding(an_org(MINE), Some(project(OTHER)), read.clone()));
    let whole_org = Reader::Key(keys.holding(an_org(MINE), None, read.clone()));
    let other_org = Reader::Key(keys.holding(an_org(THEIRS), None, read));

    assert!(desk.get(&bound_here, id).await.is_ok());
    assert!(desk.get(&whole_org, id).await.is_ok());
    assert_eq!(
        desk.get(&bound_elsewhere, id).await,
        Err(DashboardError::NotFound)
    );
    assert_eq!(
        desk.list(&bound_elsewhere, project(OURS)).await,
        Err(DashboardError::NotFound)
    );
    assert_eq!(
        desk.get(&other_org, id).await,
        Err(DashboardError::NotFound)
    );
}

#[tokio::test]
async fn spec_l16_3_a_key_with_only_the_ingest_scope_is_refused() {
    let (shelf, keys, notebook) = (Shelf::default(), Ring::default(), Notebook::default());
    let desk = desk(&shelf, &keys, &notebook);
    desk.create(&token(), project(OURS), &a_file("ours"))
        .await
        .expect("created");
    let id = DashboardId::new(Uuid::from_u128(5000));
    let ingest_only = Reader::Key(keys.holding(an_org(MINE), None, scopes(&[KeyScope::Ingest])));
    let reads = Reader::Key(keys.holding(an_org(MINE), None, scopes(&[KeyScope::Read])));

    assert_eq!(
        desk.get(&ingest_only, id).await,
        Err(DashboardError::NoSession)
    );
    assert_eq!(
        desk.list(&ingest_only, project(OURS)).await,
        Err(DashboardError::NoSession)
    );
    assert_eq!(
        desk.export(&ingest_only, id).await,
        Err(DashboardError::NoSession)
    );
    assert!(desk.get(&reads, id).await.is_ok());
    assert_eq!(
        desk.list(&reads, project(OURS)).await.map(|all| all.len()),
        Ok(1)
    );
}

#[tokio::test]
async fn spec_l16_4_an_unknown_schema_version_is_refused_on_import() {
    let mut exported = serde_json::to_value(a_file("ours")).expect("a file");
    exported["doc"]["schema_version"] = json!(2);

    assert_eq!(
        DashboardFile::from_value(exported),
        Err(DashboardError::UnknownSchema)
    );
}

#[tokio::test]
async fn spec_l16_5_a_hundred_and_first_dashboard_is_refused() {
    let (shelf, keys, notebook) = (Shelf::default(), Ring::default(), Notebook::default());
    let desk = desk(&shelf, &keys, &notebook);
    shelf.holding(scope_of(MINE, OURS), MAX_DASHBOARDS - 1);

    let hundredth = desk.create(&token(), project(OURS), &a_file("last")).await;
    let created = desk
        .create(&token(), project(OURS), &a_file("one too many"))
        .await;
    let imported = desk
        .import(&token(), project(OURS), &a_file("one too many"))
        .await;
    let cloned = desk
        .duplicate(&token(), DashboardId::new(Uuid::from_u128(5000)))
        .await;
    let elsewhere = desk.create(&token(), project(OTHER), &a_file("fine")).await;

    assert!(hundredth.is_ok());
    for refused in [created, imported, cloned] {
        assert_eq!(refused, Err(DashboardError::TooMany(Cap::Dashboards)));
    }
    assert!(elsewhere.is_ok());
    assert_eq!(shelf.names(OURS).len(), 100);
}

#[tokio::test]
async fn spec_l16_15_an_export_imported_into_another_project_is_an_equal_document() {
    let (shelf, keys, notebook) = (Shelf::default(), Ring::default(), Notebook::default());
    let desk = desk(&shelf, &keys, &notebook);
    let made = desk
        .create(&token(), project(OURS), &a_file("Checkout health"))
        .await
        .expect("created");

    let exported = desk.export(&me(), made.id).await.expect("exported");
    let text = serde_json::to_value(&exported).expect("a file");
    let parsed = DashboardFile::from_value(text).expect("a file again");
    let imported = desk
        .import(&token(), project(OTHER), &parsed)
        .await
        .expect("imported");

    assert_eq!(imported.project, project(OTHER));
    assert_eq!(imported.doc, made.doc);
    assert_eq!(imported.name, made.name);
    assert_eq!(imported.tags, made.tags);
    assert_ne!(imported.id, made.id);
}

#[tokio::test]
async fn spec_l16_17_create_update_and_delete_each_write_an_audit_entry() {
    let (shelf, keys, notebook) = (Shelf::default(), Ring::default(), Notebook::default());
    let desk = desk(&shelf, &keys, &notebook);

    let made = desk
        .create(&token(), project(OURS), &a_file("Checkout"))
        .await
        .expect("created");
    desk.replace(&token(), made.id, &a_file("Checkout v2"))
        .await
        .expect("replaced");
    desk.get(&me(), made.id).await.expect("read");
    desk.delete(&token(), made.id).await.expect("deleted");

    let entries = notebook.entries();
    let actions: Vec<_> = entries.iter().map(|entry| entry.action).collect();
    assert_eq!(
        actions,
        vec![
            Action::DashboardCreated,
            Action::DashboardUpdated,
            Action::DashboardDeleted
        ]
    );
    for entry in &entries {
        assert_eq!(entry.org, an_org(MINE));
        assert_eq!(
            entry.actor,
            Actor::Account(AccountId::new(Uuid::from_u128(ME)))
        );
        assert_eq!(entry.target.kind, TargetKind::Dashboard);
        assert_eq!(
            entry.target.id.as_deref(),
            Some(made.id.to_string().as_str())
        );
        assert_eq!(
            entry.detail.get("project"),
            Some(Some(project(OURS).to_string().as_str()))
        );
    }
    assert_eq!(entries[0].detail.get("name"), Some(Some("Checkout")));
    assert_eq!(entries[1].detail.get("name"), Some(Some("Checkout v2")));
    assert_eq!(entries[1].detail.get("from"), Some(Some("Checkout")));
    assert_eq!(entries[2].detail.get("name"), Some(Some("Checkout v2")));
}

#[tokio::test]
async fn a_refused_change_writes_no_audit_entry() {
    let (shelf, keys, notebook) = (Shelf::default(), Ring::default(), Notebook::default());
    let desk = desk(&shelf, &keys, &notebook);
    let made = desk
        .create(&token(), project(OURS), &a_file("a"))
        .await
        .expect("created");
    desk.create(&token(), project(OURS), &a_file("b"))
        .await
        .expect("created");
    let before = notebook.entries().len();

    let clash = desk.replace(&token(), made.id, &a_file("b")).await;
    let again = desk.create(&token(), project(OURS), &a_file("b")).await;
    let ghost = desk
        .delete(&token(), DashboardId::new(Uuid::from_u128(1)))
        .await;

    assert_eq!(clash, Err(DashboardError::NameTaken));
    assert_eq!(again, Err(DashboardError::NameTaken));
    assert_eq!(ghost, Err(DashboardError::NotFound));
    assert_eq!(notebook.entries().len(), before);
}

#[tokio::test]
async fn a_replace_may_rename_a_dashboard_and_keeps_its_id() {
    let (shelf, keys, notebook) = (Shelf::default(), Ring::default(), Notebook::default());
    let desk = desk(&shelf, &keys, &notebook);
    let made = desk
        .create(&token(), project(OURS), &a_file("old"))
        .await
        .expect("created");
    let mut changed = a_file("new");
    changed.doc = DashboardDoc::from_value(document(vec![], vec![])).expect("an empty document");

    let saved = desk
        .replace(&token(), made.id, &changed)
        .await
        .expect("replaced");

    assert_eq!(saved.id, made.id);
    assert_eq!(saved.into_file(), changed);
    assert_eq!(shelf.names(OURS), vec!["new"]);
}

#[tokio::test]
async fn a_clone_is_named_after_its_source_and_numbered_on_a_clash() {
    let (shelf, keys, notebook) = (Shelf::default(), Ring::default(), Notebook::default());
    let desk = desk(&shelf, &keys, &notebook);
    let made = desk
        .create(&token(), project(OURS), &a_file("Checkout"))
        .await
        .expect("created");

    let first = desk.duplicate(&token(), made.id).await.expect("cloned");
    let second = desk.duplicate(&token(), made.id).await.expect("cloned");
    let of_a_copy = desk.duplicate(&token(), first.id).await.expect("cloned");

    assert_eq!(first.name.as_str(), "Checkout copy");
    assert_eq!(second.name.as_str(), "Checkout copy 2");
    assert_eq!(of_a_copy.name.as_str(), "Checkout copy copy");
    assert_eq!(first.doc, made.doc);
    assert_eq!(first.tags, made.tags);
    let entries = notebook.entries();
    assert_eq!(entries.len(), 4);
    assert_eq!(entries[1].action, Action::DashboardCreated);
    assert_eq!(entries[1].detail.get("via"), Some(Some("clone")));
    assert_eq!(
        entries[1].detail.get("from"),
        Some(Some(made.id.to_string().as_str()))
    );
}

#[tokio::test]
async fn an_import_is_a_creation_that_says_it_came_from_a_file() {
    let (shelf, keys, notebook) = (Shelf::default(), Ring::default(), Notebook::default());
    let desk = desk(&shelf, &keys, &notebook);

    desk.import(&token(), project(OURS), &a_file("from a file"))
        .await
        .expect("imported");

    let entries = notebook.entries();
    assert_eq!(entries[0].action, Action::DashboardCreated);
    assert_eq!(entries[0].detail.get("via"), Some(Some("import")));
}

#[tokio::test]
async fn an_unknown_session_is_not_a_member() {
    let (shelf, keys, notebook) = (Shelf::default(), Ring::default(), Notebook::default());
    let desk = desk(&shelf, &keys, &notebook);
    let stranger = crate::secret::SessionToken::for_subject("nobody");

    assert_eq!(
        desk.create(&stranger, project(OURS), &a_file("x")).await,
        Err(DashboardError::NoSession)
    );
    assert_eq!(
        desk.list(&Reader::Session(stranger), project(OURS)).await,
        Err(DashboardError::NoSession)
    );
}
