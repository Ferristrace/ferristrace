# Scheduled maintenances on status pages

Goal
  An administrator announces a maintenance ahead of time; during its window the
  components it targets read "maintenance" on every public status page of the
  organisation, and the days it covered do not count against uptime.

Decisions
  D1  A maintenance belongs to the organisation, like an incident. It is listed
      on every public status page of the organisation. It targets components
      taken from any page of the organisation (zero or more).
  D2  While a maintenance is in progress, each targeted component shows the
      status `maintenance`, replacing whatever its link derives (alert, service,
      manual).
  D3  The lifecycle follows the clock: scheduled before `starts_ms`, in progress
      from `starts_ms`, completed at `ends_ms`. An administrator may end it early
      (only while in progress) or cancel it (only while scheduled).
  D4  Uptime: a day bucket overlapped by the elapsed part of a maintenance that
      targets the component shows `maintenance`. The web counts it as up. An
      outage on the same day outside the window is hidden by it (accepted).
  D5  Public order of statuses: operational < maintenance < degraded < down. The
      overall banner is the worst shown status; an open public incident still
      raises it to at least degraded.
  D6  Public listing: scheduled and in-progress maintenances, plus completed
      ones whose real end is within the last 7 days. Cancelled ones never show.
      Each lists the names of the targeted components that are public on the
      page being rendered, in page order.
  D7  Storage goes through the existing `StatusPages` port, not a new repo.

Invariants
  - A window ends after it starts and lasts at most 7 days.              [type: MaintenanceWindow::new]
  - A closure is either ended or cancelled, with its instant.            [type: Closure]
  - Title 1..=200 bytes, details 1..=2000 bytes after trim.              [type: text! newtypes]
  - Only an administrator session schedules, changes, ends or cancels.   [test]
  - A maintenance targets only components of its own organisation.       [test]
  - A new or changed maintenance ends in the future.                     [test]
  - A completed or cancelled maintenance never changes again.            [test]
  - No private component name reaches a public view.                     [test]
  - Every change leaves an audit entry.                                  [test]

Out of scope
  - Email to subscribers about maintenances (next PR).
  - Recurring maintenances, timezones other than the visitor's browser.
  - MCP tools, the ferristrace.fr documentation site.
  - French wording on the public page (separate item).

Frozen contracts (domain, crates/domain/src/status)
  value_objects.rs
    identifier!(MaintenanceId)
    text!(MaintenanceTitle, MAX_MAINTENANCE_TITLE_BYTES = 200, BadStatusPage::MaintenanceTitle { max })
    text!(MaintenanceDetails, MAX_MAINTENANCE_DETAILS_BYTES = 2_000, BadStatusPage::MaintenanceDetails { max })
    MAX_MAINTENANCE_DAYS = 7, MAX_MAINTENANCE_COMPONENTS = 100
    MaintenanceWindow::new(starts_ms, ends_ms) -> Result<_, BadStatusPage::Window { max_days }>
      .starts_ms() .ends_ms()
    enum ShownStatus { Operational, Maintenance, Degraded, Down }  spelled, Ord, From<ComponentStatus>
    enum MaintenancePhase { Scheduled, InProgress, Completed, Cancelled }
      spelled "scheduled" "in_progress" "completed" "cancelled"
  entities.rs
    enum Closure { Ended { at_ms }, Cancelled { at_ms } }
    struct Maintenance { id, org, title, details: Option<_>, window, components: Vec<ComponentId>,
                         closure: Option<Closure>, created_ms, updated_ms }
      fn phase(&self, now_ms) -> MaintenancePhase
      fn real_end_ms(&self) -> u64            (ended early: closure instant; else window end)
      fn targets(&self, ComponentId) -> bool
    struct MaintenanceDraft { title, details, window, components }
    struct MaintenancePatch { title: Option, details: Option<Option>, window: Option, components: Option<Vec> }
    struct Placed { component: ComponentId, name: ComponentName, page: StatusPageId, page_name: PageName }
    struct Agenda { maintenances: Vec<Maintenance>, components: Vec<Placed> }
    struct PublicMaintenance { id, title, details, starts_ms, ends_ms, ended_ms: Option<u64>,
                               phase, components: Vec<ComponentName> }
    PublicComponent.status: ShownStatus, PublicComponent.days: Vec<Option<ShownStatus>>
    PublicView.overall: ShownStatus, PublicView.maintenances: Vec<PublicMaintenance>
  ports.rs  (StatusPages, required methods)
    org_components(org) -> Vec<Placed>                       every component of every page, page then position order
    maintenances(org, ending_after_ms) -> Vec<Maintenance>   ends_ms >= ending_after_ms, ordered by starts_ms
    maintenance(org, id) -> Option<Maintenance>
    add_maintenance(&Maintenance) -> ()
    keep_maintenance(&Maintenance) -> bool                   replaces fields and the component set
  planner.rs
    Planner::new(readers, pages, trail)
      .list(who, org, now) -> Agenda              reader; maintenances ending in the last 30 days or later
      .schedule(who, org, &draft, now) -> Maintenance
      .change(who, org, id, patch, now) -> Maintenance
      .end(who, org, id, now) -> Maintenance
      .cancel(who, org, id, now) -> Maintenance
  errors.rs
    StatusError::NoSuchMaintenance, MaintenanceClosed, MaintenanceNotRunning,
    MaintenanceStarted, WindowPassed, TooManyTargets { max }
  audit
    Action::StatusMaintenanceScheduled|Updated|Ended|Cancelled  "status_maintenance.scheduled" ...
    TargetKind::StatusMaintenance

HTTP
  GET    /api/orgs/{org}/status-maintenances            -> { maintenances: [Body], components: [{id, name, page_id, page_name}] }
  POST   /api/orgs/{org}/status-maintenances            {title, details?, starts_ms, ends_ms, components: [uuid]} -> Body
  PATCH  /api/orgs/{org}/status-maintenances/{id}       any of the above; details: null clears -> Body
  POST   /api/orgs/{org}/status-maintenances/{id}/end   -> Body
  POST   /api/orgs/{org}/status-maintenances/{id}/cancel -> Body
  Body = {id, title, details, starts_ms, ends_ms, phase, closed_ms, components: [uuid], created_ms, updated_ms}
  Public JSON adds maintenances: [{id, title, details, starts_ms, ends_ms, ended_ms, phase, components: [name]}];
  component status and days may read "maintenance".

Acceptance
  1. Phase: before start scheduled, from start in progress, from end completed, ended early completed,
     cancelled cancelled.                                                         [domain unit]
  2. Window refuses end <= start and a length over 7 days.                         [domain unit]
  3. An in-progress maintenance shows its targeted public component as maintenance even when its
     link derives down; an untargeted component and a scheduled maintenance change nothing.  [showcase]
  4. Day buckets touched by the elapsed part of a non-cancelled maintenance read maintenance;
     cancelled ones and the future part do not.                                   [domain unit]
  5. Overall: maintenance alone gives maintenance; degraded beats maintenance; an open incident
     raises maintenance to degraded.                                              [domain unit]
  6. The public view lists scheduled, in-progress and recently completed maintenances, never cancelled
     or older ones, with only names of components public on this page.            [showcase]
  7. Schedule refuses a member (NotAdmin), a read key (ReadOnly), a component of another org
     (NoSuchComponent), a window already over (WindowPassed).                     [planner]
  8. End works only in progress, cancel only scheduled; a closed maintenance refuses change, end
     and cancel (MaintenanceClosed).                                              [planner]
  9. Schedule, change, end and cancel each write one audit entry.                 [planner]
  10. Postgres keeps and returns a maintenance with its components, filters by end, replaces the
      component set on keep, and drops a deleted component from it.               [postgres integration]
  11. The HTTP routes schedule, list, change, end and cancel; the public JSON carries maintenances
      and the maintenance status.                                                 [api]
  12. The public page shows an in-progress banner and upcoming maintenances; uptime counts a
      maintenance day as up.                                                      [web node:test]

Files
  crates/domain/src/status/{value_objects,entities,errors,ports,derivation,showcase,planner,mod}.rs + tests
  crates/domain/src/audit/value_objects.rs, crates/domain/src/testing.rs
  crates/postgres/migrations/postgres/20261130000001_status_maintenances.{up,down}.sql
  crates/postgres/src/status.rs, crates/postgres/tests/status.rs
  crates/application/src/status.rs
  crates/api/src/status_routes.rs, crates/api/tests/status_routes.rs
  web/src/data/status-page.ts, web/src/components/ft/StatusPageView.tsx,
  web/src/pages/StatusPageEditor.tsx, web/tests/status-page.test.ts

Verify (loop)
  cargo test -p ferristrace-domain status::

Verify (exit)
  cargo fmt --all --check
  cargo clippy --workspace --all-targets -- -D warnings
  cargo test --workspace
  cd web && pnpm typecheck && pnpm test
  Postgres integration needs DATABASE_URL + REQUIRE_DATABASE_URL=1 (Docker not running locally: CI runs it).
