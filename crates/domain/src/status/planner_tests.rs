use super::desk::StatusDesk;
use super::entities::{
    Closure, Component, ComponentDraft, Link, MaintenanceDraft, MaintenancePatch, PageDraft,
    StatusPage,
};
use super::errors::StatusError;
use super::planner::Planner;
use super::value_objects::{
    ComponentId, ComponentName, MaintenanceId, MaintenancePhase, MaintenanceTitle,
    MaintenanceWindow, PageName, Slug, StatusPageId, Theme,
};
use crate::access::key_ring_tests::{
    MINE, MemberOfMine, OTHER, OneProject, OneSession, Ring, THEIRS, an_org, scopes, token,
};
use crate::access::{KeyScope, Reader, Readers};
use crate::audit::{Action, TargetKind};
use crate::clock::UnixSeconds;
use crate::organisation::{OrgRole, Whoami};
use crate::testing::{AlertLedger, Notebook, StatusLedger};

const NOW: u64 = 1_700_000_000;
const NOW_MS: u64 = NOW * 1_000;
const HOUR_MS: u64 = 3_600_000;

struct World {
    status: StatusLedger,
    notebook: Notebook,
    keys: Ring,
}

impl World {
    fn new() -> Self {
        Self {
            status: StatusLedger::default(),
            notebook: Notebook::default(),
            keys: Ring::default(),
        }
    }

    fn planner(
        &self,
        role: OrgRole,
    ) -> Planner<OneSession, MemberOfMine, &Ring, StatusLedger, Notebook> {
        Planner::new(
            Readers::new(Whoami::new(OneSession, MemberOfMine(role)), &self.keys),
            self.status.clone(),
            self.notebook.clone(),
        )
    }

    async fn a_component(&self, name: &str) -> ComponentId {
        let desk = StatusDesk::new(
            Readers::new(
                Whoami::new(OneSession, MemberOfMine(OrgRole::Admin)),
                &self.keys,
            ),
            OneProject,
            AlertLedger::default(),
            self.status.clone(),
            self.status.clone(),
            Notebook::default(),
        );
        let page = desk
            .create(
                &session(),
                an_org(MINE),
                &PageDraft {
                    name: PageName::try_from("Acme").expect("a name"),
                    slug: Slug::try_from(format!("page-{name}").to_lowercase().as_str())
                        .expect("a slug"),
                    public: true,
                    hide_from_search: false,
                    theme: Theme::default(),
                    intro: None,
                },
                at(0),
            )
            .await
            .expect("created")
            .page
            .id;
        desk.add_component(
            &session(),
            an_org(MINE),
            page,
            &ComponentDraft {
                name: ComponentName::try_from(name).expect("a name"),
                link: Link::Manual,
                manual_status: None,
                public: true,
            },
            at(0),
        )
        .await
        .expect("added")
        .id
    }

    fn a_foreign_component(&self) -> ComponentId {
        let page = StatusPageId::fresh();
        self.status.put_page(StatusPage {
            id: page,
            org: an_org(THEIRS),
            name: PageName::try_from("Theirs").expect("a name"),
            slug: Slug::try_from("theirs").expect("a slug"),
            public: true,
            hide_from_search: false,
            theme: Theme::default(),
            intro: None,
            created_ms: 1,
            updated_ms: 1,
        });
        let id = ComponentId::fresh();
        self.status.put_component(
            an_org(THEIRS),
            Component {
                id,
                page,
                name: ComponentName::try_from("Their API").expect("a name"),
                link: Link::Manual,
                manual_status: None,
                position: 0,
                public: true,
            },
        );
        id
    }

    async fn scheduled(
        &self,
        starts_ms: u64,
        ends_ms: u64,
        components: Vec<ComponentId>,
    ) -> MaintenanceId {
        self.planner(OrgRole::Admin)
            .schedule(
                &session(),
                an_org(MINE),
                &draft(starts_ms, ends_ms, components),
                at(0),
            )
            .await
            .expect("scheduled")
            .id
    }

    fn maintenance_actions(&self) -> Vec<Action> {
        self.notebook
            .entries()
            .into_iter()
            .filter(|entry| entry.target.kind == TargetKind::StatusMaintenance)
            .map(|entry| entry.action)
            .collect()
    }
}

fn session() -> Reader {
    Reader::Session(token())
}

fn at(seconds: u64) -> UnixSeconds {
    UnixSeconds::new(NOW + seconds)
}

fn window(starts_ms: u64, ends_ms: u64) -> MaintenanceWindow {
    MaintenanceWindow::new(starts_ms, ends_ms).expect("a window")
}

fn draft(starts_ms: u64, ends_ms: u64, components: Vec<ComponentId>) -> MaintenanceDraft {
    MaintenanceDraft {
        title: MaintenanceTitle::try_from("Database upgrade").expect("a title"),
        details: None,
        window: window(starts_ms, ends_ms),
        components,
    }
}

#[tokio::test]
async fn spec_maintenance_7_an_administrator_schedules_and_members_read_the_agenda() {
    let world = World::new();
    let api = world.a_component("API").await;

    let scheduled = world
        .planner(OrgRole::Admin)
        .schedule(
            &session(),
            an_org(MINE),
            &draft(NOW_MS + HOUR_MS, NOW_MS + 2 * HOUR_MS, vec![api, api]),
            at(0),
        )
        .await
        .expect("scheduled");
    let agenda = world
        .planner(OrgRole::Member)
        .list(&session(), an_org(MINE), at(0))
        .await
        .expect("listed");

    assert_eq!(scheduled.components, vec![api], "duplicates collapse");
    assert_eq!(scheduled.phase(NOW_MS), MaintenancePhase::Scheduled);
    assert_eq!(agenda.maintenances, vec![scheduled]);
    assert_eq!(agenda.components.len(), 1);
    assert_eq!(agenda.components[0].component, api);
    assert_eq!(agenda.components[0].page_name.as_str(), "Acme");
}

#[tokio::test]
async fn spec_maintenance_7_scheduling_refuses_members_keys_foreign_components_and_past_windows() {
    let world = World::new();
    let api = world.a_component("API").await;
    let foreign = world.a_foreign_component();
    let key = Reader::Key(
        world
            .keys
            .holding(an_org(MINE), None, scopes(&[KeyScope::Read])),
    );
    let ahead = draft(NOW_MS + HOUR_MS, NOW_MS + 2 * HOUR_MS, vec![api]);

    let member = world
        .planner(OrgRole::Member)
        .schedule(&session(), an_org(MINE), &ahead, at(0))
        .await;
    let keyed = world
        .planner(OrgRole::Admin)
        .schedule(&key, an_org(MINE), &ahead, at(0))
        .await;
    let stranger = world
        .planner(OrgRole::Admin)
        .schedule(&session(), an_org(OTHER), &ahead, at(0))
        .await;
    let theirs = world
        .planner(OrgRole::Admin)
        .schedule(
            &session(),
            an_org(MINE),
            &draft(NOW_MS + HOUR_MS, NOW_MS + 2 * HOUR_MS, vec![api, foreign]),
            at(0),
        )
        .await;
    let over = world
        .planner(OrgRole::Admin)
        .schedule(
            &session(),
            an_org(MINE),
            &draft(NOW_MS - 2 * HOUR_MS, NOW_MS - HOUR_MS, vec![api]),
            at(0),
        )
        .await;

    assert_eq!(member.map(|_| ()), Err(StatusError::NotAdmin));
    assert_eq!(keyed.map(|_| ()), Err(StatusError::ReadOnly));
    assert_eq!(stranger.map(|_| ()), Err(StatusError::NotYours));
    assert_eq!(theirs.map(|_| ()), Err(StatusError::NoSuchComponent));
    assert_eq!(over.map(|_| ()), Err(StatusError::WindowPassed));
    assert!(world.status.all_maintenances().is_empty());
}

#[tokio::test]
async fn spec_maintenance_8_end_needs_a_running_maintenance_and_cancel_a_scheduled_one() {
    let world = World::new();
    let api = world.a_component("API").await;
    let running = world
        .scheduled(NOW_MS - HOUR_MS, NOW_MS + HOUR_MS, vec![api])
        .await;
    let upcoming = world
        .scheduled(NOW_MS + HOUR_MS, NOW_MS + 2 * HOUR_MS, vec![api])
        .await;
    let planner = world.planner(OrgRole::Admin);

    let cancel_running = planner
        .cancel(&session(), an_org(MINE), running, at(10))
        .await;
    let end_upcoming = planner
        .end(&session(), an_org(MINE), upcoming, at(10))
        .await;
    let ended = planner
        .end(&session(), an_org(MINE), running, at(10))
        .await
        .expect("ended");
    let cancelled = planner
        .cancel(&session(), an_org(MINE), upcoming, at(10))
        .await
        .expect("cancelled");

    assert_eq!(
        cancel_running.map(|_| ()),
        Err(StatusError::MaintenanceStarted)
    );
    assert_eq!(
        end_upcoming.map(|_| ()),
        Err(StatusError::MaintenanceNotRunning)
    );
    assert_eq!(
        ended.closure,
        Some(Closure::Ended {
            at_ms: NOW_MS + 10_000
        })
    );
    assert_eq!(ended.phase(NOW_MS + 10_000), MaintenancePhase::Completed);
    assert_eq!(
        cancelled.closure,
        Some(Closure::Cancelled {
            at_ms: NOW_MS + 10_000
        })
    );
    assert_eq!(
        cancelled.phase(NOW_MS + 10_000),
        MaintenancePhase::Cancelled
    );
}

#[tokio::test]
async fn spec_maintenance_8_a_closed_maintenance_never_changes_again() {
    let world = World::new();
    let api = world.a_component("API").await;
    let upcoming = world
        .scheduled(NOW_MS + HOUR_MS, NOW_MS + 2 * HOUR_MS, vec![api])
        .await;
    let planner = world.planner(OrgRole::Admin);
    planner
        .cancel(&session(), an_org(MINE), upcoming, at(0))
        .await
        .expect("cancelled");

    let changed = planner
        .change(
            &session(),
            an_org(MINE),
            upcoming,
            MaintenancePatch {
                title: Some(MaintenanceTitle::try_from("Again").expect("a title")),
                ..MaintenancePatch::default()
            },
            at(1),
        )
        .await;
    let ended = planner.end(&session(), an_org(MINE), upcoming, at(1)).await;
    let cancelled = planner
        .cancel(&session(), an_org(MINE), upcoming, at(1))
        .await;
    let unknown = planner
        .end(&session(), an_org(MINE), MaintenanceId::fresh(), at(1))
        .await;

    assert_eq!(changed.map(|_| ()), Err(StatusError::MaintenanceClosed));
    assert_eq!(ended.map(|_| ()), Err(StatusError::MaintenanceClosed));
    assert_eq!(cancelled.map(|_| ()), Err(StatusError::MaintenanceClosed));
    assert_eq!(unknown.map(|_| ()), Err(StatusError::NoSuchMaintenance));
}

#[tokio::test]
async fn a_change_replaces_the_named_fields_and_refuses_a_window_already_over() {
    let world = World::new();
    let api = world.a_component("API").await;
    let web = world.a_component("Web").await;
    let id = world
        .scheduled(NOW_MS + HOUR_MS, NOW_MS + 2 * HOUR_MS, vec![api])
        .await;
    let planner = world.planner(OrgRole::Admin);

    let changed = planner
        .change(
            &session(),
            an_org(MINE),
            id,
            MaintenancePatch {
                window: Some(window(NOW_MS + HOUR_MS, NOW_MS + 3 * HOUR_MS)),
                components: Some(vec![web]),
                ..MaintenancePatch::default()
            },
            at(5),
        )
        .await
        .expect("changed");
    let backwards = planner
        .change(
            &session(),
            an_org(MINE),
            id,
            MaintenancePatch {
                window: Some(window(NOW_MS - 3 * HOUR_MS, NOW_MS - HOUR_MS)),
                ..MaintenancePatch::default()
            },
            at(5),
        )
        .await;

    assert_eq!(changed.title.as_str(), "Database upgrade");
    assert_eq!(changed.components, vec![web]);
    assert_eq!(changed.window.ends_ms(), NOW_MS + 3 * HOUR_MS);
    assert_eq!(changed.updated_ms, NOW_MS + 5_000);
    assert_eq!(backwards.map(|_| ()), Err(StatusError::WindowPassed));
}

#[tokio::test]
async fn spec_maintenance_9_every_change_leaves_one_audit_entry() {
    let world = World::new();
    let api = world.a_component("API").await;
    let running = world
        .scheduled(NOW_MS - HOUR_MS, NOW_MS + HOUR_MS, vec![api])
        .await;
    let upcoming = world
        .scheduled(NOW_MS + HOUR_MS, NOW_MS + 2 * HOUR_MS, vec![api])
        .await;
    let planner = world.planner(OrgRole::Admin);
    planner
        .change(
            &session(),
            an_org(MINE),
            upcoming,
            MaintenancePatch {
                title: Some(MaintenanceTitle::try_from("Network work").expect("a title")),
                ..MaintenancePatch::default()
            },
            at(1),
        )
        .await
        .expect("changed");
    planner
        .change(
            &session(),
            an_org(MINE),
            upcoming,
            MaintenancePatch::default(),
            at(1),
        )
        .await
        .expect("an empty change is no change");
    planner
        .end(&session(), an_org(MINE), running, at(2))
        .await
        .expect("ended");
    planner
        .cancel(&session(), an_org(MINE), upcoming, at(3))
        .await
        .expect("cancelled");

    assert_eq!(
        world.maintenance_actions(),
        vec![
            Action::StatusMaintenanceScheduled,
            Action::StatusMaintenanceScheduled,
            Action::StatusMaintenanceUpdated,
            Action::StatusMaintenanceEnded,
            Action::StatusMaintenanceCancelled,
        ]
    );
}

#[tokio::test]
async fn a_removed_component_leaves_the_maintenances_that_targeted_it() {
    use super::ports::StatusPages;

    let world = World::new();
    let api = world.a_component("API").await;
    let id = world
        .scheduled(NOW_MS + HOUR_MS, NOW_MS + 2 * HOUR_MS, vec![api])
        .await;
    let page = world.status.pages()[0].id;

    assert!(
        world
            .status
            .remove_component(an_org(MINE), page, api)
            .await
            .expect("removed")
    );

    let held = world
        .status
        .maintenance(an_org(MINE), id)
        .await
        .expect("read")
        .expect("kept");
    assert!(held.components.is_empty());
}
