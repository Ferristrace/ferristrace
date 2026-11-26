use uuid::Uuid;

use super::derivation::{overall, public_maintenances, shown_days, under_maintenance};
use super::entities::{Closure, Component, Link, Maintenance, PublicComponent};
use super::errors::BadStatusPage;
use super::value_objects::{
    ComponentId, ComponentName, ComponentStatus, MAX_MAINTENANCE_DAYS, MaintenanceId,
    MaintenancePhase, MaintenanceTitle, MaintenanceWindow, ShownStatus, StatusPageId, UPTIME_DAYS,
};
use crate::telemetry::TenantId;

const NOW_MS: u64 = 1_700_000_000_000;
const HOUR_MS: u64 = 3_600_000;
const DAY_MS: u64 = 86_400_000;

fn maintenance(starts_ms: u64, ends_ms: u64, components: Vec<ComponentId>) -> Maintenance {
    Maintenance {
        id: MaintenanceId::fresh(),
        org: TenantId::new(Uuid::from_u128(1)),
        title: MaintenanceTitle::try_from("Database upgrade").expect("a title"),
        details: None,
        window: MaintenanceWindow::new(starts_ms, ends_ms).expect("a window"),
        components,
        closure: None,
        created_ms: 1,
        updated_ms: 1,
    }
}

fn closed(mut held: Maintenance, closure: Closure) -> Maintenance {
    held.closure = Some(closure);
    held
}

fn shown(status: ShownStatus) -> PublicComponent {
    PublicComponent {
        name: ComponentName::try_from("Checkout").expect("a name"),
        status,
        days: vec![Some(status); UPTIME_DAYS],
    }
}

fn component(id: ComponentId, name: &str, public: bool) -> Component {
    Component {
        id,
        page: StatusPageId::fresh(),
        name: ComponentName::try_from(name).expect("a name"),
        link: Link::Manual,
        manual_status: None,
        position: 0,
        public,
    }
}

#[test]
fn spec_maintenance_1_the_phase_follows_the_clock_and_the_closure() {
    let held = maintenance(NOW_MS, NOW_MS + HOUR_MS, Vec::new());

    assert_eq!(held.phase(NOW_MS - 1), MaintenancePhase::Scheduled);
    assert_eq!(held.phase(NOW_MS), MaintenancePhase::InProgress);
    assert_eq!(
        held.phase(NOW_MS + HOUR_MS - 1),
        MaintenancePhase::InProgress
    );
    assert_eq!(held.phase(NOW_MS + HOUR_MS), MaintenancePhase::Completed);
    let ended = closed(
        held.clone(),
        Closure::Ended {
            at_ms: NOW_MS + 60_000,
        },
    );
    assert_eq!(ended.phase(NOW_MS + 60_000), MaintenancePhase::Completed);
    assert_eq!(ended.real_end_ms(), NOW_MS + 60_000);
    let cancelled = closed(held, Closure::Cancelled { at_ms: NOW_MS - 1 });
    assert_eq!(cancelled.phase(NOW_MS), MaintenancePhase::Cancelled);
    assert_eq!(cancelled.real_end_ms(), NOW_MS + HOUR_MS);
}

#[test]
fn spec_maintenance_2_a_window_ends_after_it_starts_and_lasts_at_most_seven_days() {
    let refused = Err(BadStatusPage::Window {
        max_days: MAX_MAINTENANCE_DAYS,
    });

    assert_eq!(MaintenanceWindow::new(NOW_MS, NOW_MS), refused);
    assert_eq!(MaintenanceWindow::new(NOW_MS, NOW_MS - 1), refused);
    assert_eq!(
        MaintenanceWindow::new(NOW_MS, NOW_MS + 7 * DAY_MS + 1),
        refused
    );
    let longest = MaintenanceWindow::new(NOW_MS, NOW_MS + 7 * DAY_MS).expect("seven days");
    assert_eq!(longest.starts_ms(), NOW_MS);
    assert_eq!(longest.ends_ms(), NOW_MS + 7 * DAY_MS);
}

#[test]
fn spec_maintenance_3_only_a_running_maintenance_puts_its_targets_under_maintenance() {
    let api = ComponentId::fresh();
    let web = ComponentId::fresh();
    let running = maintenance(NOW_MS - HOUR_MS, NOW_MS + HOUR_MS, vec![api]);
    let upcoming = maintenance(NOW_MS + HOUR_MS, NOW_MS + 2 * HOUR_MS, vec![web]);
    let both = [running.clone(), upcoming];

    assert!(under_maintenance(api, &both, NOW_MS));
    assert!(!under_maintenance(web, &both, NOW_MS));
    let ended = closed(running, Closure::Ended { at_ms: NOW_MS - 1 });
    assert!(!under_maintenance(api, &[ended], NOW_MS));
}

#[test]
fn spec_maintenance_4_days_touched_by_the_elapsed_part_of_a_maintenance_read_maintenance() {
    let api = ComponentId::fresh();
    let days = vec![Some(ComponentStatus::Down); UPTIME_DAYS];
    let from_ms = NOW_MS - (UPTIME_DAYS as u64) * DAY_MS;
    let past = maintenance(
        from_ms + 2 * DAY_MS + HOUR_MS,
        from_ms + 2 * DAY_MS + 2 * HOUR_MS,
        vec![api],
    );
    let cancelled = closed(
        maintenance(
            from_ms + 5 * DAY_MS,
            from_ms + 5 * DAY_MS + HOUR_MS,
            vec![api],
        ),
        Closure::Cancelled { at_ms: 1 },
    );
    let starting_now = maintenance(NOW_MS, NOW_MS + 3 * DAY_MS, vec![api]);
    let elsewhere = maintenance(
        from_ms + 8 * DAY_MS,
        from_ms + 8 * DAY_MS + HOUR_MS,
        vec![ComponentId::fresh()],
    );

    let shown_days = shown_days(
        api,
        &days,
        &[past, cancelled, starting_now, elsewhere],
        NOW_MS,
    );

    assert_eq!(shown_days.len(), UPTIME_DAYS);
    assert_eq!(shown_days[2], Some(ShownStatus::Maintenance));
    assert_eq!(shown_days[5], Some(ShownStatus::Down), "cancelled");
    assert_eq!(shown_days[8], Some(ShownStatus::Down), "another component");
    assert_eq!(shown_days[UPTIME_DAYS - 1], Some(ShownStatus::Maintenance));
    assert_eq!(shown_days[UPTIME_DAYS - 2], Some(ShownStatus::Down));
}

#[test]
fn spec_maintenance_5_maintenance_ranks_between_operational_and_degraded() {
    assert_eq!(
        overall(
            &[
                shown(ShownStatus::Maintenance),
                shown(ShownStatus::Operational)
            ],
            false
        ),
        ShownStatus::Maintenance
    );
    assert_eq!(
        overall(
            &[
                shown(ShownStatus::Maintenance),
                shown(ShownStatus::Degraded)
            ],
            false
        ),
        ShownStatus::Degraded
    );
    assert_eq!(
        overall(&[shown(ShownStatus::Maintenance)], true),
        ShownStatus::Degraded
    );
}

#[test]
fn spec_maintenance_6_the_public_list_keeps_live_and_recent_maintenances_with_public_names_only() {
    let api = ComponentId::fresh();
    let admin = ComponentId::fresh();
    let components = [
        component(api, "API", true),
        component(admin, "Admin", false),
    ];
    let upcoming = maintenance(NOW_MS + HOUR_MS, NOW_MS + 2 * HOUR_MS, vec![api, admin]);
    let running = maintenance(NOW_MS - HOUR_MS, NOW_MS + HOUR_MS, vec![admin]);
    let recent = maintenance(
        NOW_MS - 3 * DAY_MS,
        NOW_MS - 3 * DAY_MS + HOUR_MS,
        vec![api],
    );
    let ended_early = closed(
        maintenance(NOW_MS - 2 * HOUR_MS, NOW_MS + HOUR_MS, vec![api]),
        Closure::Ended {
            at_ms: NOW_MS - HOUR_MS,
        },
    );
    let old = maintenance(
        NOW_MS - 8 * DAY_MS - HOUR_MS,
        NOW_MS - 8 * DAY_MS,
        vec![api],
    );
    let cancelled = closed(
        maintenance(NOW_MS + HOUR_MS, NOW_MS + 2 * HOUR_MS, vec![api]),
        Closure::Cancelled { at_ms: NOW_MS - 1 },
    );

    let listed = public_maintenances(
        &[
            upcoming.clone(),
            running.clone(),
            recent.clone(),
            ended_early.clone(),
            old,
            cancelled,
        ],
        &components,
        NOW_MS,
    );

    let summary: Vec<_> = listed
        .iter()
        .map(|shown| {
            (
                shown.id,
                shown.phase,
                shown.ended_ms,
                shown
                    .components
                    .iter()
                    .map(ComponentName::as_str)
                    .collect::<Vec<_>>(),
            )
        })
        .collect();
    assert_eq!(
        summary,
        vec![
            (upcoming.id, MaintenancePhase::Scheduled, None, vec!["API"]),
            (running.id, MaintenancePhase::InProgress, None, Vec::new()),
            (
                recent.id,
                MaintenancePhase::Completed,
                Some(NOW_MS - 3 * DAY_MS + HOUR_MS),
                vec!["API"]
            ),
            (
                ended_early.id,
                MaintenancePhase::Completed,
                Some(NOW_MS - HOUR_MS),
                vec!["API"]
            ),
        ]
    );
}
