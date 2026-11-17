use std::collections::BTreeMap;

use clickhouse::{Client, Row};
use ferristrace_domain::telemetry::{
    BillingHour, HourSplit, ProjectHourSplit, Split, StoredVolumes,
};
use ferristrace_domain::{ProjectId, SignalKind, StoreError, TenantId, UnixSeconds};
use serde::Deserialize;
use uuid::Uuid;

use super::read::refused;

const SPANS: &str = "SELECT tenant_id AS tenant, \
     toUnixTimestamp(toStartOfHour(start_time)) AS hour, \
     sum(byteSize(*)) AS volume \
   FROM spans GROUP BY tenant, hour";

const LOGS: &str = "SELECT tenant_id AS tenant, \
     toUnixTimestamp(toStartOfHour(time)) AS hour, \
     sum(byteSize(*)) AS volume \
   FROM logs GROUP BY tenant, hour";

const POINTS: &str = "SELECT tenant_id AS tenant, \
     toUnixTimestamp(toStartOfHour(time)) AS hour, \
     count() AS volume \
   FROM metric_points GROUP BY tenant, hour";

const HISTOGRAMS: &str = "SELECT tenant_id AS tenant, \
     toUnixTimestamp(toStartOfHour(time)) AS hour, \
     count() AS volume \
   FROM metric_histograms GROUP BY tenant, hour";

const PROJECT_SPANS: &str = "SELECT tenant_id AS tenant, project_id AS project, \
     toUnixTimestamp(toStartOfHour(start_time)) AS hour, \
     sum(byteSize(*)) AS volume \
   FROM spans WHERE project_id != toUUID('00000000-0000-0000-0000-000000000000') \
   GROUP BY tenant, project, hour";

const PROJECT_LOGS: &str = "SELECT tenant_id AS tenant, project_id AS project, \
     toUnixTimestamp(toStartOfHour(time)) AS hour, \
     sum(byteSize(*)) AS volume \
   FROM logs WHERE project_id != toUUID('00000000-0000-0000-0000-000000000000') \
   GROUP BY tenant, project, hour";

const PROJECT_POINTS: &str = "SELECT tenant_id AS tenant, project_id AS project, \
     toUnixTimestamp(toStartOfHour(time)) AS hour, \
     count() AS volume \
   FROM metric_points WHERE project_id != toUUID('00000000-0000-0000-0000-000000000000') \
   GROUP BY tenant, project, hour";

const PROJECT_HISTOGRAMS: &str = "SELECT tenant_id AS tenant, project_id AS project, \
     toUnixTimestamp(toStartOfHour(time)) AS hour, \
     count() AS volume \
   FROM metric_histograms WHERE project_id != toUUID('00000000-0000-0000-0000-000000000000') \
   GROUP BY tenant, project, hour";

#[derive(Debug, Row, Deserialize)]
struct VolumeRow {
    #[serde(with = "clickhouse::serde::uuid")]
    tenant: Uuid,
    hour: u32,
    volume: u64,
}

#[derive(Debug, Row, Deserialize)]
struct ProjectVolumeRow {
    #[serde(with = "clickhouse::serde::uuid")]
    tenant: Uuid,
    #[serde(with = "clickhouse::serde::uuid")]
    project: Uuid,
    hour: u32,
    volume: u64,
}

#[derive(Debug, Clone)]
pub struct ClickhouseVolumes {
    client: Client,
}

impl ClickhouseVolumes {
    pub fn new(client: Client) -> Self {
        Self { client }
    }

    async fn read(&self, sql: &str) -> Result<Vec<VolumeRow>, StoreError> {
        self.client
            .query(sql)
            .fetch_all::<VolumeRow>()
            .await
            .map_err(|error| refused(&error))
    }

    async fn read_projects(&self, sql: &str) -> Result<Vec<ProjectVolumeRow>, StoreError> {
        self.client
            .query(sql)
            .fetch_all::<ProjectVolumeRow>()
            .await
            .map_err(|error| refused(&error))
    }
}

fn hour_of(hour: u32) -> BillingHour {
    BillingHour::containing(UnixSeconds::new(u64::from(hour)))
}

impl StoredVolumes for ClickhouseVolumes {
    async fn hourly(&self) -> Result<Vec<HourSplit>, StoreError> {
        let mut hours: BTreeMap<(Uuid, u32), Split> = BTreeMap::new();
        for row in self.read(SPANS).await? {
            hours.entry((row.tenant, row.hour)).or_default().spans_bytes += row.volume;
        }
        for row in self.read(LOGS).await? {
            hours.entry((row.tenant, row.hour)).or_default().logs_bytes += row.volume;
        }
        for sql in [POINTS, HISTOGRAMS] {
            for row in self.read(sql).await? {
                hours
                    .entry((row.tenant, row.hour))
                    .or_default()
                    .metrics_points += row.volume;
            }
        }
        Ok(hours
            .into_iter()
            .map(|((tenant, hour), split)| HourSplit {
                tenant: TenantId::new(tenant),
                hour: hour_of(hour),
                split,
            })
            .collect())
    }

    async fn hourly_by_project(&self) -> Result<Vec<ProjectHourSplit>, StoreError> {
        let mut hours: BTreeMap<(Uuid, Uuid, u32), Split> = BTreeMap::new();
        for (signal, sql) in [
            (SignalKind::Spans, PROJECT_SPANS),
            (SignalKind::Logs, PROJECT_LOGS),
            (SignalKind::Metrics, PROJECT_POINTS),
            (SignalKind::Metrics, PROJECT_HISTOGRAMS),
        ] {
            for row in self.read_projects(sql).await? {
                let slot = hours
                    .entry((row.tenant, row.project, row.hour))
                    .or_default();
                *slot = slot.adding(signal, row.volume);
            }
        }
        Ok(hours
            .into_iter()
            .map(|((tenant, project, hour), split)| ProjectHourSplit {
                tenant: TenantId::new(tenant),
                project: ProjectId::new(project),
                hour: hour_of(hour),
                split,
            })
            .collect())
    }
}
