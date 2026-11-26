use super::entities::{
    Closure, Component, ComponentEvent, Link, Maintenance, Observed, PublicComponent,
    PublicMaintenance, PublicUpdate,
};
use super::value_objects::{
    ComponentId, ComponentStatus, DEGRADED_ERROR_PERCENT, DOWN_ERROR_PERCENT, MaintenancePhase,
    PUBLIC_WINDOW_DAYS, ShownStatus, UPTIME_DAYS, UpdateKind,
};
use crate::alerts::{AlertEvent, AlertSeverity, AlertStatus};
use crate::explore::ServicePoint;
use crate::incidents::{Change, Incident, IncidentStatus, TimelineEntry};

const DAY_MS: u64 = 86_400_000;
const DAY_NANOS: u64 = 86_400_000_000_000;
const PERCENT: u128 = 100;
const REDACTED: &str = "[redacted]";

pub fn derive(
    link: &Link,
    manual: Option<ComponentStatus>,
    observed: &Observed,
) -> ComponentStatus {
    match link {
        Link::Manual => manual.unwrap_or_default(),
        Link::Alert(rule) => match observed.firing(*rule) {
            Some(AlertSeverity::Critical) => ComponentStatus::Down,
            Some(AlertSeverity::Warning | AlertSeverity::Info) => ComponentStatus::Degraded,
            None => ComponentStatus::Operational,
        },
        Link::Service { name, project } => match observed.load(name, *project) {
            Some(load) if load.requests > 0 => by_error_rate(load.requests, load.errors),
            _ if observed.is_silent(name, *project) => ComponentStatus::Degraded,
            _ => ComponentStatus::Operational,
        },
    }
}

pub fn derive_days(
    id: ComponentId,
    link: &Link,
    current: ComponentStatus,
    observed: &Observed,
    since_ms: u64,
    now_ms: u64,
) -> Vec<Option<ComponentStatus>> {
    let from_ms = now_ms.saturating_sub((UPTIME_DAYS as u64) * DAY_MS);
    let mut days = match link {
        Link::Manual => observed.manual_days(id).map_or_else(
            || {
                (0..UPTIME_DAYS)
                    .map(|idx| {
                        let day_end = from_ms.saturating_add(((idx + 1) as u64) * DAY_MS);
                        (day_end > since_ms).then_some(ComponentStatus::Operational)
                    })
                    .collect()
            },
            <[Option<ComponentStatus>]>::to_vec,
        ),
        Link::Alert(rule) => observed.alert_days(*rule).map_or_else(
            || vec![None; UPTIME_DAYS],
            <[Option<ComponentStatus>]>::to_vec,
        ),
        Link::Service { name, project } => observed.service_days(name, *project).map_or_else(
            || vec![None; UPTIME_DAYS],
            <[Option<ComponentStatus>]>::to_vec,
        ),
    };
    if days.len() < UPTIME_DAYS {
        days.resize(UPTIME_DAYS, None);
    } else if days.len() > UPTIME_DAYS {
        days.truncate(UPTIME_DAYS);
    }
    if let Some(today) = days.last_mut() {
        match link {
            Link::Service { name, project } => {
                if observed
                    .load(name, *project)
                    .is_some_and(|load| load.requests > 0)
                    || current != ComponentStatus::Operational
                {
                    *today = Some(today.map_or(current, |prev| prev.max(current)));
                }
            }
            Link::Alert(_) | Link::Manual => {
                *today = Some(today.map_or(current, |prev| prev.max(current)));
            }
        }
    }
    days
}

pub fn manual_days_from_events(
    current: ComponentStatus,
    since_ms: u64,
    events: &[ComponentEvent],
    now_ms: u64,
) -> Vec<Option<ComponentStatus>> {
    let from_ms = now_ms.saturating_sub((UPTIME_DAYS as u64) * DAY_MS);
    if events.is_empty() {
        let mut days: Vec<Option<ComponentStatus>> = (0..UPTIME_DAYS)
            .map(|idx| {
                let day_end = from_ms.saturating_add(((idx + 1) as u64) * DAY_MS);
                (day_end > since_ms).then_some(ComponentStatus::Operational)
            })
            .collect();
        if let Some(today) = days.last_mut() {
            *today = Some(today.map_or(current, |prev| prev.max(current)));
        }
        return days;
    }
    let active_since = events[0].at_ms.max(since_ms);
    let mut days = Vec::with_capacity(UPTIME_DAYS);
    for idx in 0..UPTIME_DAYS {
        let day_start = from_ms.saturating_add((idx as u64) * DAY_MS);
        let day_end = day_start.saturating_add(DAY_MS);
        if day_end <= active_since {
            days.push(None);
            continue;
        }
        let effective_start = day_start.max(active_since);
        let mut worst = events
            .iter()
            .rfind(|event| event.at_ms <= effective_start)
            .map_or(ComponentStatus::Operational, |event| event.status);
        for event in events {
            if event.at_ms > effective_start && event.at_ms < day_end {
                worst = worst.max(event.status);
            }
        }
        if idx == UPTIME_DAYS - 1 {
            for event in events {
                if event.at_ms >= day_end {
                    worst = worst.max(event.status);
                }
            }
            worst = worst.max(current);
        }
        days.push(Some(worst));
    }
    days
}

pub fn alert_days_from_state(
    severity: AlertSeverity,
    firing: bool,
    since_ms: u64,
    created_ms: u64,
    events: &[AlertEvent],
    now_ms: u64,
) -> Vec<Option<ComponentStatus>> {
    let from_ms = now_ms.saturating_sub((UPTIME_DAYS as u64) * DAY_MS);
    let mut days: Vec<Option<ComponentStatus>> = (0..UPTIME_DAYS)
        .map(|idx| {
            let day_end = from_ms.saturating_add(((idx + 1) as u64) * DAY_MS);
            (day_end > created_ms).then_some(ComponentStatus::Operational)
        })
        .collect();
    let impact = match severity {
        AlertSeverity::Critical => ComponentStatus::Down,
        AlertSeverity::Warning | AlertSeverity::Info => ComponentStatus::Degraded,
    };
    let bucket = |at_ms: u64| -> usize {
        ((at_ms.saturating_sub(from_ms)) / DAY_MS).min((UPTIME_DAYS - 1) as u64) as usize
    };
    if firing {
        let start = if since_ms >= from_ms {
            bucket(since_ms)
        } else {
            UPTIME_DAYS - 1
        };
        for day in &mut days[start..UPTIME_DAYS] {
            *day = Some(day.map_or(impact, |prev| prev.max(impact)));
        }
    }
    for event in events {
        if event.at_ms >= from_ms
            && (event.from == AlertStatus::Firing || event.to == AlertStatus::Firing)
        {
            let index = bucket(event.at_ms);
            days[index] = Some(days[index].map_or(impact, |prev| prev.max(impact)));
        }
    }
    days
}

pub fn service_days_from_points(
    points: &[ServicePoint],
    from_nanos: u64,
) -> Vec<Option<ComponentStatus>> {
    let mut buckets = [(0_u64, 0_u64); UPTIME_DAYS];
    for point in points {
        let index = ((point.start_unix_nanos.saturating_sub(from_nanos)) / DAY_NANOS)
            .min((UPTIME_DAYS - 1) as u64) as usize;
        buckets[index].0 = buckets[index].0.saturating_add(point.requests);
        buckets[index].1 = buckets[index].1.saturating_add(point.errors);
    }
    buckets
        .into_iter()
        .map(|(requests, errors)| (requests > 0).then(|| by_error_rate(requests, errors)))
        .collect()
}

pub fn by_error_rate(requests: u64, errors: u64) -> ComponentStatus {
    if requests == 0 {
        return ComponentStatus::Operational;
    }
    let failed = u128::from(errors) * PERCENT;
    let seen = u128::from(requests);
    if failed >= seen * u128::from(DOWN_ERROR_PERCENT) {
        ComponentStatus::Down
    } else if failed >= seen * u128::from(DEGRADED_ERROR_PERCENT) {
        ComponentStatus::Degraded
    } else {
        ComponentStatus::Operational
    }
}

pub fn overall(components: &[PublicComponent], incident_open: bool) -> ShownStatus {
    let worst = components
        .iter()
        .map(|component| component.status)
        .max()
        .unwrap_or_default();
    if incident_open {
        worst.max(ShownStatus::Degraded)
    } else {
        worst
    }
}

pub fn under_maintenance(
    component: ComponentId,
    maintenances: &[Maintenance],
    now_ms: u64,
) -> bool {
    maintenances.iter().any(|maintenance| {
        maintenance.targets(component) && maintenance.phase(now_ms) == MaintenancePhase::InProgress
    })
}

pub fn shown_days(
    component: ComponentId,
    days: &[Option<ComponentStatus>],
    maintenances: &[Maintenance],
    now_ms: u64,
) -> Vec<Option<ShownStatus>> {
    let from_ms = now_ms.saturating_sub((UPTIME_DAYS as u64) * DAY_MS);
    let spans: Vec<(u64, u64)> = maintenances
        .iter()
        .filter(|maintenance| {
            maintenance.targets(component)
                && !matches!(maintenance.closure, Some(Closure::Cancelled { .. }))
        })
        .map(|maintenance| {
            (
                maintenance.window.starts_ms(),
                maintenance.real_end_ms().min(now_ms),
            )
        })
        .filter(|(starts_ms, ends_ms)| starts_ms <= ends_ms)
        .collect();
    let last = days.len().saturating_sub(1);
    days.iter()
        .enumerate()
        .map(|(idx, day)| {
            let day_start = from_ms.saturating_add((idx as u64) * DAY_MS);
            let day_end = if idx == last {
                u64::MAX
            } else {
                day_start.saturating_add(DAY_MS)
            };
            let touched = spans
                .iter()
                .any(|(starts_ms, ends_ms)| *starts_ms < day_end && *ends_ms > day_start);
            if touched {
                Some(ShownStatus::Maintenance)
            } else {
                day.map(ShownStatus::from)
            }
        })
        .collect()
}

pub fn public_maintenances(
    maintenances: &[Maintenance],
    components: &[Component],
    now_ms: u64,
) -> Vec<PublicMaintenance> {
    maintenances
        .iter()
        .filter_map(|maintenance| {
            let phase = maintenance.phase(now_ms);
            let recent = maintenance
                .real_end_ms()
                .saturating_add(PUBLIC_WINDOW_DAYS * DAY_MS)
                >= now_ms;
            let listed = match phase {
                MaintenancePhase::Scheduled | MaintenancePhase::InProgress => true,
                MaintenancePhase::Completed => recent,
                MaintenancePhase::Cancelled => false,
            };
            listed.then(|| PublicMaintenance {
                id: maintenance.id,
                title: maintenance.title.clone(),
                details: maintenance.details.clone(),
                starts_ms: maintenance.window.starts_ms(),
                ends_ms: maintenance.window.ends_ms(),
                ended_ms: (phase == MaintenancePhase::Completed).then(|| maintenance.real_end_ms()),
                phase,
                components: components
                    .iter()
                    .filter(|component| component.public && maintenance.targets(component.id))
                    .map(|component| component.name.clone())
                    .collect(),
            })
        })
        .collect()
}

pub fn shown(incident: &Incident, now_ms: u64) -> bool {
    incident.public
        && (incident.status.is_open()
            || incident.resolved_ms.is_some_and(|resolved| {
                resolved.saturating_add(PUBLIC_WINDOW_DAYS * DAY_MS) >= now_ms
            }))
}

pub fn public_updates(entries: &[TimelineEntry]) -> Vec<PublicUpdate> {
    let mut updates: Vec<PublicUpdate> = entries
        .iter()
        .filter_map(|entry| {
            let (kind, text): (UpdateKind, Box<str>) = match &entry.change {
                Change::Opened { .. } => (
                    UpdateKind::Opened,
                    IncidentStatus::Investigating.as_str().into(),
                ),
                Change::Status { to, .. } => (UpdateKind::Status, to.as_str().into()),
                Change::Comment { body, public: true } => {
                    (UpdateKind::Comment, body.as_str().into())
                }
                _ => return None,
            };
            Some(PublicUpdate {
                at_ms: entry.at_ms,
                kind,
                text,
            })
        })
        .collect();
    updates.reverse();
    updates
}

fn local(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'%' | b'+' | b'-')
}

fn host(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-')
}

pub fn redacted(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut copied = 0;
    let mut at = 0;
    while let Some(found) = text[at..].find('@') {
        let sign = at + found;
        let start = (copied..sign)
            .rev()
            .take_while(|&index| local(bytes[index]))
            .last()
            .unwrap_or(sign);
        let mut end = sign
            + 1
            + bytes[sign + 1..]
                .iter()
                .take_while(|&&byte| host(byte))
                .count();
        while end > sign + 1 && matches!(bytes[end - 1], b'.' | b'-') {
            end -= 1;
        }
        let domain = &text[sign + 1..end];
        if start < sign && domain.contains('.') && !domain.starts_with('.') {
            out.push_str(&text[copied..start]);
            out.push_str(REDACTED);
            copied = end;
            at = end;
        } else {
            at = sign + 1;
        }
    }
    out.push_str(&text[copied..]);
    out
}
