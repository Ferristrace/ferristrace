use uuid::Uuid;

use super::spending::by_project;
use super::value_objects::{Consumed, HourVolume, ProjectHours, Split};
use crate::catalogue::ProjectId;

const AN_HOUR: u64 = 3_600_000_000_000;
const A_DAY: u64 = 24 * AN_HOUR;

fn split(spans: u64, logs: u64, points: u64) -> Split {
    Split {
        spans_bytes: spans,
        logs_bytes: logs,
        metrics_points: points,
    }
}

fn org_hour(at: u64, split: Option<Split>) -> Consumed {
    Consumed {
        started_at_unix_nanos: at,
        ingested_bytes: 0,
        split,
    }
}

fn project(seed: u128, name: Option<&str>, hours: &[(u64, Split)]) -> ProjectHours {
    ProjectHours {
        project: ProjectId::new(Uuid::from_u128(seed)),
        name: name.map(Into::into),
        hours: hours
            .iter()
            .map(|&(started_at_unix_nanos, split)| HourVolume {
                started_at_unix_nanos,
                split,
            })
            .collect(),
    }
}

#[test]
fn what_no_project_claims_is_the_organisation_split_minus_the_projects() {
    let hours = [
        org_hour(A_DAY, Some(split(100, 50, 9))),
        org_hour(A_DAY + AN_HOUR, Some(split(10, 0, 0))),
    ];
    let projects = vec![
        project(1, Some("web"), &[(A_DAY, split(60, 20, 4))]),
        project(2, Some("api"), &[(A_DAY, split(30, 30, 5))]),
    ];

    let spent = by_project(&hours, projects);

    assert_eq!(spent.len(), 3);
    let rest = spent.last().expect("no project");
    assert_eq!((rest.project, rest.name.as_deref()), (None, None));
    assert_eq!(rest.total, split(20, 0, 0));
    let summed: Split = spent.iter().map(|usage| usage.total).sum();
    assert_eq!(summed, split(110, 50, 9));
}

#[test]
fn projects_come_by_name_then_deleted_ones_then_no_project() {
    let hours = [org_hour(A_DAY, Some(split(100, 0, 0)))];
    let projects = vec![
        project(3, None, &[(A_DAY, split(10, 0, 0))]),
        project(1, Some("web"), &[(A_DAY, split(10, 0, 0))]),
        project(2, Some("api"), &[(A_DAY, split(10, 0, 0))]),
    ];

    let names: Vec<_> = by_project(&hours, projects)
        .into_iter()
        .map(|usage| (usage.project.map(|id| id.as_uuid().as_u128()), usage.name))
        .collect();

    assert_eq!(
        names,
        vec![
            (Some(2), Some("api".into())),
            (Some(1), Some("web".into())),
            (Some(3), None),
            (None, None),
        ]
    );
}

#[test]
fn a_project_is_summed_per_utc_day_and_quiet_days_are_left_out() {
    let projects = vec![project(
        1,
        Some("web"),
        &[
            (A_DAY, split(1, 0, 0)),
            (A_DAY + 23 * AN_HOUR, split(2, 0, 0)),
            (2 * A_DAY, split(0, 0, 0)),
            (3 * A_DAY + AN_HOUR, split(0, 4, 0)),
        ],
    )];

    let spent = by_project(&[], projects);

    assert_eq!(spent.len(), 1);
    let days: Vec<_> = spent[0]
        .days
        .iter()
        .map(|day| (day.day_start_unix_nanos, day.split))
        .collect();
    assert_eq!(
        days,
        vec![(A_DAY, split(3, 0, 0)), (3 * A_DAY, split(0, 4, 0))]
    );
    assert_eq!(spent[0].total, split(3, 4, 0));
}

#[test]
fn unsplit_hours_and_projects_claiming_more_leave_no_project_empty() {
    let hours = [
        org_hour(A_DAY, None),
        org_hour(A_DAY + AN_HOUR, Some(split(5, 0, 0))),
    ];
    let projects = vec![project(
        1,
        Some("web"),
        &[(A_DAY + AN_HOUR, split(7, 0, 0))],
    )];

    let spent = by_project(&hours, projects);

    assert_eq!(spent.len(), 1);
    assert_eq!(spent[0].project, Some(ProjectId::new(Uuid::from_u128(1))));
}

#[test]
fn an_organisation_without_project_rows_spends_everything_as_no_project() {
    let hours = [org_hour(A_DAY, Some(split(5, 6, 7)))];

    let spent = by_project(&hours, Vec::new());

    assert_eq!(spent.len(), 1);
    assert_eq!(spent[0].project, None);
    assert_eq!(spent[0].total, split(5, 6, 7));
}
