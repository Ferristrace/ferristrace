use ferristrace_application::repository;
use std::collections::BTreeMap;

use ferristrace_domain::telemetry::{
    BillingMonth, HourSplit, HourTotal, HourVolume, MonthTotal, ProjectHourShare, ProjectHours,
    ProjectSplit, Split, UsageLedger,
};
use ferristrace_domain::{
    Consumed, DecompressedBytes, ProjectId, StoreError, TenantId, UsageHistory, Window,
};
use sqlx::Row;
use uuid::Uuid;

use crate::postgres::gigabytes_to_bytes;
use crate::unit_of_work::{Postgres, SharedTx};

#[repository(domain = UsageHistory, backend = Postgres<C>, generics = <C: Send + Sync + 'static>)]
#[derive(Debug)]
pub struct PostgresUsage {
    tx: SharedTx,
}

impl PostgresUsage {
    pub fn new<C>(_backend: &Postgres<C>, tx: &SharedTx) -> Self {
        Self { tx: tx.clone() }
    }
}

impl UsageHistory for PostgresUsage {
    async fn hours(&self, org: TenantId, window: Window) -> Result<Vec<Consumed>, StoreError> {
        let mut tx = self.tx.lock().await;
        let rows = sqlx::query(
            "SELECT hour_start AS hour_start, ingested_bytes AS ingested_bytes, \
             spans_bytes AS spans_bytes, logs_bytes AS logs_bytes, \
             metrics_points AS metrics_points \
             FROM usage_hourly WHERE org_id = $1 AND hour_start >= $2 AND hour_start < $3 \
             ORDER BY hour_start",
        )
        .bind(org.as_uuid())
        .bind(as_nanos(window.from_unix_nanos()))
        .bind(as_nanos(window.to_unix_nanos()))
        .fetch_all(&mut **tx)
        .await
        .map_err(|error| unreachable(&error, "read the usage history"))?;

        Ok(rows
            .into_iter()
            .map(|row| Consumed {
                started_at_unix_nanos: u64::try_from(row.get::<i64, _>("hour_start"))
                    .unwrap_or_default(),
                ingested_bytes: u64::try_from(row.get::<i64, _>("ingested_bytes"))
                    .unwrap_or_default(),
                split: split_of(&row),
            })
            .collect())
    }

    async fn included(&self, org: TenantId) -> Result<Option<DecompressedBytes>, StoreError> {
        let mut tx = self.tx.lock().await;
        let found = sqlx::query(
            "SELECT p.ingest_gb AS ingest_gb FROM orgs o JOIN plans p ON p.id = o.plan_id \
             WHERE o.id = $1",
        )
        .bind(org.as_uuid())
        .fetch_optional(&mut **tx)
        .await
        .map_err(|error| unreachable(&error, "read what a plan allows"))?;

        Ok(found
            .and_then(|row| row.get::<Option<i32>, _>("ingest_gb"))
            .and_then(gigabytes_to_bytes))
    }

    async fn project_hours(
        &self,
        org: TenantId,
        window: Window,
    ) -> Result<Vec<ProjectHours>, StoreError> {
        let mut tx = self.tx.lock().await;
        let rows = sqlx::query(
            "SELECT u.project_id AS project_id, p.name AS name, u.hour_start AS hour_start, \
             u.spans_bytes AS spans_bytes, u.logs_bytes AS logs_bytes, \
             u.metrics_points AS metrics_points \
             FROM usage_hourly_project u \
             LEFT JOIN projects p ON p.id = u.project_id AND p.org_id = u.org_id \
             WHERE u.org_id = $1 AND u.hour_start >= $2 AND u.hour_start < $3 \
             ORDER BY u.project_id, u.hour_start",
        )
        .bind(org.as_uuid())
        .bind(as_nanos(window.from_unix_nanos()))
        .bind(as_nanos(window.to_unix_nanos()))
        .fetch_all(&mut **tx)
        .await
        .map_err(|error| unreachable(&error, "read the usage of each project"))?;

        let mut projects: BTreeMap<Uuid, ProjectHours> = BTreeMap::new();
        for row in rows {
            let id: Uuid = row.get("project_id");
            let project = projects.entry(id).or_insert_with(|| ProjectHours {
                project: ProjectId::new(id),
                name: row.get::<Option<String>, _>("name").map(Into::into),
                hours: Vec::new(),
            });
            project.hours.push(HourVolume {
                started_at_unix_nanos: unsigned(row.get("hour_start")),
                split: Split {
                    spans_bytes: unsigned(row.get("spans_bytes")),
                    logs_bytes: unsigned(row.get("logs_bytes")),
                    metrics_points: unsigned(row.get("metrics_points")),
                },
            });
        }
        Ok(projects.into_values().collect())
    }
}

impl UsageLedger for PostgresUsage {
    async fn record_hours(&self, hours: &[HourTotal]) -> Result<usize, StoreError> {
        let mut tx = self.tx.lock().await;
        let mut written = 0;
        for total in hours {
            let org = total.tenant.as_uuid();
            let hour_start = total.hour.start_nanos();
            let split = total.split;
            let inserted = sqlx::query(
                "INSERT INTO usage_hourly \
                 (org_id, hour_start, ingested_bytes, spans_bytes, logs_bytes, metrics_points) \
                 SELECT $1, $2, $3, $4, $5, $6 WHERE EXISTS (SELECT 1 FROM orgs WHERE id = $1) \
                 ON CONFLICT (org_id, hour_start) DO NOTHING",
            )
            .bind(org)
            .bind(hour_start)
            .bind(as_nanos(total.ingested.get()))
            .bind(split.map(|found| as_nanos(found.spans_bytes)))
            .bind(split.map(|found| as_nanos(found.logs_bytes)))
            .bind(split.map(|found| as_nanos(found.metrics_points)))
            .execute(&mut **tx)
            .await
            .map_err(|error| unreachable(&error, "roll an hour up"))?;
            if inserted.rows_affected() == 0 {
                continue;
            }
            written += 1;
            for project in &total.projects {
                record_project(&mut tx, org, hour_start, project).await?;
            }
        }
        Ok(written)
    }

    async fn fill_splits(&self, splits: &[HourSplit]) -> Result<usize, StoreError> {
        let mut tx = self.tx.lock().await;
        let mut filled = 0;
        for found in splits {
            let updated = sqlx::query(
                "UPDATE usage_hourly SET spans_bytes = $3, logs_bytes = $4, metrics_points = $5 \
                 WHERE org_id = $1 AND hour_start = $2 AND spans_bytes IS NULL",
            )
            .bind(found.tenant.as_uuid())
            .bind(found.hour.start_nanos())
            .bind(as_nanos(found.split.spans_bytes))
            .bind(as_nanos(found.split.logs_bytes))
            .bind(as_nanos(found.split.metrics_points))
            .execute(&mut **tx)
            .await
            .map_err(|error| unreachable(&error, "fill an hour's split"))?;
            filled += usize::try_from(updated.rows_affected()).unwrap_or_default();
        }
        Ok(filled)
    }

    async fn fill_project_shares(&self, shares: &[ProjectHourShare]) -> Result<usize, StoreError> {
        let mut columns = ShareColumns::with_capacity(shares.len());
        for share in shares {
            columns.push(share);
        }
        let mut tx = self.tx.lock().await;
        let filled = sqlx::query(
            "INSERT INTO usage_hourly_project \
             (org_id, project_id, hour_start, spans_bytes, logs_bytes, metrics_points) \
             SELECT f.org_id, f.project_id, f.hour_start, \
             CASE WHEN f.spans_total > 0 THEN div(LEAST(f.spans, f.spans_total)::numeric \
             * h.spans_bytes, f.spans_total)::bigint ELSE 0 END, \
             CASE WHEN f.logs_total > 0 THEN div(LEAST(f.logs, f.logs_total)::numeric \
             * h.logs_bytes, f.logs_total)::bigint ELSE 0 END, \
             CASE WHEN f.points_total > 0 THEN div(LEAST(f.points, f.points_total)::numeric \
             * h.metrics_points, f.points_total)::bigint ELSE 0 END \
             FROM UNNEST($1::uuid[], $2::uuid[], $3::bigint[], $4::bigint[], $5::bigint[], \
             $6::bigint[], $7::bigint[], $8::bigint[], $9::bigint[]) AS f(org_id, project_id, \
             hour_start, spans, logs, points, spans_total, logs_total, points_total) \
             JOIN usage_hourly h ON h.org_id = f.org_id AND h.hour_start = f.hour_start \
             WHERE h.spans_bytes IS NOT NULL AND h.logs_bytes IS NOT NULL \
             AND h.metrics_points IS NOT NULL \
             AND NOT EXISTS (SELECT 1 FROM usage_hourly_project p \
             WHERE p.org_id = f.org_id AND p.hour_start = f.hour_start) \
             ON CONFLICT DO NOTHING",
        )
        .bind(columns.orgs)
        .bind(columns.projects)
        .bind(columns.hours)
        .bind(columns.stored.spans)
        .bind(columns.stored.logs)
        .bind(columns.stored.points)
        .bind(columns.totals.spans)
        .bind(columns.totals.logs)
        .bind(columns.totals.points)
        .execute(&mut **tx)
        .await
        .map_err(|error| unreachable(&error, "fill the usage of each project"))?;
        Ok(usize::try_from(filled.rows_affected()).unwrap_or_default())
    }

    async fn billed_since(&self, month: BillingMonth) -> Result<Vec<MonthTotal>, StoreError> {
        let mut tx = self.tx.lock().await;
        let rows = sqlx::query(
            "SELECT org_id AS org_id, sum(ingested_bytes)::bigint AS total \
             FROM usage_hourly WHERE hour_start >= $1 GROUP BY org_id",
        )
        .bind(month.start_nanos())
        .fetch_all(&mut **tx)
        .await
        .map_err(|error| unreachable(&error, "read the billed hours"))?;

        Ok(rows
            .into_iter()
            .map(|row| MonthTotal {
                tenant: TenantId::new(row.get("org_id")),
                ingested: DecompressedBytes::new(
                    u64::try_from(row.get::<i64, _>("total")).unwrap_or_default(),
                ),
            })
            .collect())
    }
}

fn split_of(row: &sqlx::postgres::PgRow) -> Option<Split> {
    let count = |column: &str| {
        row.get::<Option<i64>, _>(column)
            .map(|value| u64::try_from(value).unwrap_or_default())
    };
    Some(Split {
        spans_bytes: count("spans_bytes")?,
        logs_bytes: count("logs_bytes")?,
        metrics_points: count("metrics_points")?,
    })
}

async fn record_project(
    tx: &mut sqlx::Transaction<'static, sqlx::Postgres>,
    org: Uuid,
    hour_start: i64,
    project: &ProjectSplit,
) -> Result<(), StoreError> {
    sqlx::query(
        "INSERT INTO usage_hourly_project \
         (org_id, project_id, hour_start, spans_bytes, logs_bytes, metrics_points) \
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING",
    )
    .bind(org)
    .bind(project.project.as_uuid())
    .bind(hour_start)
    .bind(as_nanos(project.split.spans_bytes))
    .bind(as_nanos(project.split.logs_bytes))
    .bind(as_nanos(project.split.metrics_points))
    .execute(&mut **tx)
    .await
    .map_err(|error| unreachable(&error, "roll a project's hour up"))?;
    Ok(())
}

#[derive(Debug, Default)]
struct SplitColumns {
    spans: Vec<i64>,
    logs: Vec<i64>,
    points: Vec<i64>,
}

impl SplitColumns {
    fn with_capacity(rows: usize) -> Self {
        Self {
            spans: Vec::with_capacity(rows),
            logs: Vec::with_capacity(rows),
            points: Vec::with_capacity(rows),
        }
    }

    fn push(&mut self, split: Split) {
        self.spans.push(as_nanos(split.spans_bytes));
        self.logs.push(as_nanos(split.logs_bytes));
        self.points.push(as_nanos(split.metrics_points));
    }
}

#[derive(Debug, Default)]
struct ShareColumns {
    orgs: Vec<Uuid>,
    projects: Vec<Uuid>,
    hours: Vec<i64>,
    stored: SplitColumns,
    totals: SplitColumns,
}

impl ShareColumns {
    fn with_capacity(rows: usize) -> Self {
        Self {
            orgs: Vec::with_capacity(rows),
            projects: Vec::with_capacity(rows),
            hours: Vec::with_capacity(rows),
            stored: SplitColumns::with_capacity(rows),
            totals: SplitColumns::with_capacity(rows),
        }
    }

    fn push(&mut self, share: &ProjectHourShare) {
        self.orgs.push(share.tenant.as_uuid());
        self.projects.push(share.project.as_uuid());
        self.hours.push(share.hour.start_nanos());
        self.stored.push(share.stored);
        self.totals.push(share.stored_total);
    }
}

fn unsigned(signed: i64) -> u64 {
    u64::try_from(signed).unwrap_or_default()
}

fn as_nanos(unsigned: u64) -> i64 {
    i64::try_from(unsigned).unwrap_or(i64::MAX)
}

fn unreachable(error: &sqlx::Error, what: &str) -> StoreError {
    tracing::error!(%error, "the control plane refused to {what}");
    StoreError::Unreachable
}
