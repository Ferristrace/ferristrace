use axum::Json;
use axum::Router;
use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::routing::get;
use ferristrace_application::Stack;
use ferristrace_application::registry::UsageRepos;
use ferristrace_domain::telemetry::{Bill, DayVolume, PriceList, ProjectUsage, SignalBill, Split};
use ferristrace_domain::{Consumed, Consumption, ProjectId, TenantId, Window};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::carried::carried;
use crate::explore_routes::LookRefused;
use crate::state::AppState;

const NANOS_PER_MILLI: u64 = 1_000_000;

#[derive(Debug, Deserialize)]
pub struct Asked {
    from: u64,
    to: u64,
}

#[derive(Debug, Serialize)]
pub struct Metered {
    ingested_bytes: u64,
    included_bytes: Option<u64>,
    by_signal: BySignal,
    hours: Vec<Hour>,
    pricing: Option<Pricing>,
    bill: Option<Billed>,
    projects: Vec<Spender>,
}

#[derive(Debug, Serialize)]
struct Volumes {
    spans_bytes: u64,
    logs_bytes: u64,
    metrics_points: u64,
}

impl From<Split> for Volumes {
    fn from(split: Split) -> Self {
        Self {
            spans_bytes: split.spans_bytes,
            logs_bytes: split.logs_bytes,
            metrics_points: split.metrics_points,
        }
    }
}

#[derive(Debug, Serialize)]
struct Pricing {
    currency: String,
    spans_gb_micros: u64,
    logs_gb_micros: u64,
    metrics_million_micros: u64,
    included: Volumes,
}

impl From<PriceList> for Pricing {
    fn from(prices: PriceList) -> Self {
        Self {
            currency: prices.currency.code().to_owned(),
            spans_gb_micros: prices.spans_gb_micros,
            logs_gb_micros: prices.logs_gb_micros,
            metrics_million_micros: prices.metrics_million_micros,
            included: prices.included.into(),
        }
    }
}

#[derive(Debug, Serialize)]
struct Billed {
    value_micros: u64,
    billable_micros: u64,
    projected_value_micros: u64,
    projected_billable_micros: u64,
    by_signal: BilledSignals,
}

#[derive(Debug, Serialize)]
struct BilledSignals {
    spans: BilledSignal,
    logs: BilledSignal,
    metrics: BilledSignal,
}

#[derive(Debug, Serialize)]
struct BilledSignal {
    used: u64,
    included: u64,
    projected: u64,
    value_micros: u64,
    billable_micros: u64,
    projected_billable_micros: u64,
    passes_at_ms: Option<u64>,
}

impl From<SignalBill> for BilledSignal {
    fn from(line: SignalBill) -> Self {
        Self {
            used: line.used,
            included: line.included,
            projected: line.projected,
            value_micros: line.value_micros,
            billable_micros: line.billable_micros,
            projected_billable_micros: line.projected_billable_micros,
            passes_at_ms: line.passes_at_unix_nanos.map(|at| at / NANOS_PER_MILLI),
        }
    }
}

impl From<Bill> for Billed {
    fn from(bill: Bill) -> Self {
        Self {
            value_micros: bill.value_micros(),
            billable_micros: bill.billable_micros(),
            projected_value_micros: bill.projected_value_micros(),
            projected_billable_micros: bill.projected_billable_micros(),
            by_signal: BilledSignals {
                spans: bill.spans.into(),
                logs: bill.logs.into(),
                metrics: bill.metrics.into(),
            },
        }
    }
}

#[derive(Debug, Serialize)]
struct Spender {
    project: Option<Uuid>,
    name: Option<Box<str>>,
    #[serde(flatten)]
    total: Volumes,
    days: Vec<Day>,
}

#[derive(Debug, Serialize)]
struct Day {
    day_ms: u64,
    #[serde(flatten)]
    volumes: Volumes,
}

impl From<DayVolume> for Day {
    fn from(day: DayVolume) -> Self {
        Self {
            day_ms: day.day_start_unix_nanos / NANOS_PER_MILLI,
            volumes: day.split.into(),
        }
    }
}

impl From<ProjectUsage> for Spender {
    fn from(usage: ProjectUsage) -> Self {
        Self {
            project: usage.project.map(ProjectId::as_uuid),
            name: usage.name,
            total: usage.total.into(),
            days: usage.days.into_iter().map(Day::from).collect(),
        }
    }
}

#[derive(Debug, Serialize)]
struct BySignal {
    spans_bytes: u64,
    logs_bytes: u64,
    metrics_points: u64,
    unsplit_hours: usize,
}

#[derive(Debug, Serialize)]
struct Hour {
    started_at_ms: u64,
    ingested_bytes: u64,
    spans_bytes: Option<u64>,
    logs_bytes: Option<u64>,
    metrics_points: Option<u64>,
}

impl BySignal {
    fn over(hours: &[Consumed]) -> Self {
        let mut totals = Self {
            spans_bytes: 0,
            logs_bytes: 0,
            metrics_points: 0,
            unsplit_hours: 0,
        };
        for hour in hours {
            match hour.split {
                Some(split) => {
                    totals.spans_bytes = totals.spans_bytes.saturating_add(split.spans_bytes);
                    totals.logs_bytes = totals.logs_bytes.saturating_add(split.logs_bytes);
                    totals.metrics_points =
                        totals.metrics_points.saturating_add(split.metrics_points);
                }
                None => totals.unsplit_hours += 1,
            }
        }
        totals
    }
}

impl From<Consumption> for Metered {
    fn from(consumption: Consumption) -> Self {
        let by_signal = BySignal::over(&consumption.hours);
        Self {
            ingested_bytes: consumption.ingested_bytes,
            included_bytes: consumption.included_bytes,
            by_signal,
            hours: consumption
                .hours
                .into_iter()
                .map(|hour| Hour {
                    started_at_ms: hour.started_at_unix_nanos / NANOS_PER_MILLI,
                    ingested_bytes: hour.ingested_bytes,
                    spans_bytes: hour.split.map(|split| split.spans_bytes),
                    logs_bytes: hour.split.map(|split| split.logs_bytes),
                    metrics_points: hour.split.map(|split| split.metrics_points),
                })
                .collect(),
            pricing: consumption.pricing.map(Pricing::from),
            bill: consumption.bill.map(Billed::from),
            projects: consumption
                .projects
                .into_iter()
                .map(Spender::from)
                .collect(),
        }
    }
}

pub fn usage_router<S: Stack>(state: AppState<S>) -> Router
where
    S::Repos: UsageRepos,
{
    Router::new()
        .route("/api/orgs/{org}/usage", get(usage::<S>))
        .with_state(state)
}

async fn usage<S: Stack>(
    State(state): State<AppState<S>>,
    Path(org): Path<Uuid>,
    Query(asked): Query<Asked>,
    headers: HeaderMap,
) -> Result<Json<Metered>, LookRefused>
where
    S::Repos: UsageRepos,
{
    let token = carried(&state, &headers).await?;
    let window = Window::new(
        asked.from.saturating_mul(NANOS_PER_MILLI),
        asked.to.saturating_mul(NANOS_PER_MILLI),
    )
    .map_err(|_| LookRefused::Window)?;
    let consumption = state
        .app
        .consumption(&token, TenantId::new(org), window)
        .await?;
    Ok(Json(consumption.into()))
}
