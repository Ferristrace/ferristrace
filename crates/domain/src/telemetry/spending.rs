use std::collections::BTreeMap;

use super::billing::BillingHour;
use super::value_objects::{
    Consumed, DayVolume, HourSplit, HourVolume, ProjectHourShare, ProjectHourSplit, ProjectHours,
    ProjectUsage, Split, TenantId,
};
use crate::catalogue::ProjectId;

const A_DAY_NANOS: u64 = 24 * 3600 * 1_000_000_000;

pub fn by_project(hours: &[Consumed], projects: Vec<ProjectHours>) -> Vec<ProjectUsage> {
    let mut attributed: BTreeMap<u64, Split> = BTreeMap::new();
    for hour in projects.iter().flat_map(|project| &project.hours) {
        let slot = attributed.entry(hour.started_at_unix_nanos).or_default();
        *slot = slot.plus(hour.split);
    }
    let unattributed: Vec<HourVolume> = hours
        .iter()
        .filter_map(|hour| {
            let split = hour.split?;
            let claimed = attributed
                .get(&hour.started_at_unix_nanos)
                .copied()
                .unwrap_or_default();
            Some(HourVolume {
                started_at_unix_nanos: hour.started_at_unix_nanos,
                split: split.less(claimed),
            })
        })
        .collect();

    let mut named: Vec<ProjectUsage> = projects
        .into_iter()
        .map(|project| usage(Some(project.project), project.name, &project.hours))
        .filter(|usage| !usage.total.is_empty())
        .collect();
    named.sort_by(|left, right| {
        (left.name.is_none(), &left.name, left.project).cmp(&(
            right.name.is_none(),
            &right.name,
            right.project,
        ))
    });
    let rest = usage(None, None, &unattributed);
    if !rest.total.is_empty() {
        named.push(rest);
    }
    named
}

pub fn project_shares(
    totals: &[HourSplit],
    projects: &[ProjectHourSplit],
) -> Vec<ProjectHourShare> {
    let mut stored_totals: BTreeMap<(TenantId, BillingHour), Split> = totals
        .iter()
        .map(|total| ((total.tenant, total.hour), total.split))
        .collect();
    let mut claimed: BTreeMap<(TenantId, BillingHour), Split> = BTreeMap::new();
    for project in projects {
        let slot = claimed.entry((project.tenant, project.hour)).or_default();
        *slot = slot.plus(project.split);
    }
    for (key, sum) in claimed {
        let slot = stored_totals.entry(key).or_default();
        *slot = slot.at_least(sum);
    }
    projects
        .iter()
        .map(|project| ProjectHourShare {
            tenant: project.tenant,
            project: project.project,
            hour: project.hour,
            stored: project.split,
            stored_total: stored_totals
                .get(&(project.tenant, project.hour))
                .copied()
                .unwrap_or(project.split),
        })
        .collect()
}

fn usage(project: Option<ProjectId>, name: Option<Box<str>>, hours: &[HourVolume]) -> ProjectUsage {
    let mut days: BTreeMap<u64, Split> = BTreeMap::new();
    for hour in hours {
        let day = hour.started_at_unix_nanos - hour.started_at_unix_nanos % A_DAY_NANOS;
        let slot = days.entry(day).or_default();
        *slot = slot.plus(hour.split);
    }
    let days: Vec<DayVolume> = days
        .into_iter()
        .filter(|(_, split)| !split.is_empty())
        .map(|(day_start_unix_nanos, split)| DayVolume {
            day_start_unix_nanos,
            split,
        })
        .collect();
    ProjectUsage {
        project,
        name,
        total: days.iter().map(|day| day.split).sum(),
        days,
    }
}
