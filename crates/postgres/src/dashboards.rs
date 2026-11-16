use ferristrace_application::repository;
use ferristrace_domain::{
    AccountId, Dashboard, DashboardCreation, DashboardDoc, DashboardFile, DashboardId,
    DashboardName, DashboardSaving, DashboardScope, DashboardStore, DashboardSummary,
    DashboardTags, ProjectId, StoreError, TenantId,
};
use sqlx::Row;
use sqlx::postgres::PgRow;
use uuid::Uuid;

use crate::unit_of_work::{Postgres, SharedTx};

macro_rules! columns {
    () => {
        "id, project_id, name, tags::text AS tags, doc::text AS doc, updated_by, \
         created_at, updated_at"
    };
}

#[repository(domain = Dashboards, backend = Postgres<C>, generics = <C: Send + Sync + 'static>)]
#[derive(Debug)]
pub struct PostgresDashboards {
    tx: SharedTx,
}

impl PostgresDashboards {
    pub fn new<C>(_backend: &Postgres<C>, tx: &SharedTx) -> Self {
        Self { tx: tx.clone() }
    }
}

impl DashboardStore for PostgresDashboards {
    async fn project_scope(
        &self,
        project: ProjectId,
    ) -> Result<Option<DashboardScope>, StoreError> {
        let mut tx = self.tx.lock().await;
        let row = sqlx::query("SELECT org_id FROM projects WHERE id = $1")
            .bind(project.as_uuid())
            .fetch_optional(&mut **tx)
            .await
            .map_err(|error| unreachable(&error, "look a project up"))?;

        Ok(row.map(|row| DashboardScope {
            org: TenantId::new(row.get("org_id")),
            project,
        }))
    }

    async fn locate(&self, id: DashboardId) -> Result<Option<DashboardScope>, StoreError> {
        let mut tx = self.tx.lock().await;
        let row = sqlx::query("SELECT org_id, project_id FROM dashboards WHERE id = $1")
            .bind(id.as_uuid())
            .fetch_optional(&mut **tx)
            .await
            .map_err(|error| unreachable(&error, "look a dashboard up"))?;

        Ok(row.map(|row| DashboardScope {
            org: TenantId::new(row.get("org_id")),
            project: ProjectId::new(row.get("project_id")),
        }))
    }

    async fn list(&self, scope: DashboardScope) -> Result<Vec<DashboardSummary>, StoreError> {
        let mut tx = self.tx.lock().await;
        let rows = sqlx::query(
            "SELECT id, name, tags::text AS tags, updated_by, updated_at FROM dashboards \
             WHERE org_id = $1 AND project_id = $2 ORDER BY lower(name), name, id",
        )
        .bind(scope.org.as_uuid())
        .bind(scope.project.as_uuid())
        .fetch_all(&mut **tx)
        .await
        .map_err(|error| unreachable(&error, "read the dashboards"))?;

        rows.iter().map(read_summary).collect()
    }

    async fn get(
        &self,
        scope: DashboardScope,
        id: DashboardId,
    ) -> Result<Option<Dashboard>, StoreError> {
        let mut tx = self.tx.lock().await;
        let row = sqlx::query(concat!(
            "SELECT ",
            columns!(),
            " FROM dashboards WHERE org_id = $1 AND project_id = $2 AND id = $3"
        ))
        .bind(scope.org.as_uuid())
        .bind(scope.project.as_uuid())
        .bind(id.as_uuid())
        .fetch_optional(&mut **tx)
        .await
        .map_err(|error| unreachable(&error, "read a dashboard"))?;

        row.as_ref().map(read_dashboard).transpose()
    }

    async fn count(&self, scope: DashboardScope) -> Result<usize, StoreError> {
        let mut tx = self.tx.lock().await;
        let held: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM dashboards WHERE org_id = $1 AND project_id = $2",
        )
        .bind(scope.org.as_uuid())
        .bind(scope.project.as_uuid())
        .fetch_one(&mut **tx)
        .await
        .map_err(|error| unreachable(&error, "count the dashboards"))?;

        Ok(usize::try_from(held).unwrap_or(usize::MAX))
    }

    async fn create(
        &self,
        scope: DashboardScope,
        by: AccountId,
        file: &DashboardFile,
    ) -> Result<DashboardCreation, StoreError> {
        let (tags, doc) = written(file)?;
        let mut tx = self.tx.lock().await;
        let row = sqlx::query(concat!(
            "INSERT INTO dashboards \
               (id, org_id, project_id, name, tags, doc, schema_version, updated_by) \
             VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8) \
             ON CONFLICT (project_id, name) DO NOTHING RETURNING ",
            columns!()
        ))
        .bind(Uuid::new_v4())
        .bind(scope.org.as_uuid())
        .bind(scope.project.as_uuid())
        .bind(file.name.as_str())
        .bind(tags)
        .bind(doc)
        .bind(file.doc.schema_version() as i32)
        .bind(by.as_uuid())
        .fetch_optional(&mut **tx)
        .await
        .map_err(|error| unreachable(&error, "create a dashboard"))?;

        Ok(match row {
            Some(row) => DashboardCreation::Made(read_dashboard(&row)?),
            None => DashboardCreation::NameTaken,
        })
    }

    async fn update(
        &self,
        scope: DashboardScope,
        id: DashboardId,
        by: AccountId,
        file: &DashboardFile,
    ) -> Result<DashboardSaving, StoreError> {
        let (tags, doc) = written(file)?;
        let mut tx = self.tx.lock().await;

        let clash = sqlx::query(
            "SELECT 1 AS one FROM dashboards WHERE project_id = $1 AND name = $2 AND id <> $3",
        )
        .bind(scope.project.as_uuid())
        .bind(file.name.as_str())
        .bind(id.as_uuid())
        .fetch_optional(&mut **tx)
        .await
        .map_err(|error| unreachable(&error, "look a dashboard name up"))?;
        if clash.is_some() {
            return Ok(DashboardSaving::NameTaken);
        }

        let row = sqlx::query(concat!(
            "UPDATE dashboards SET name = $4, tags = $5::jsonb, doc = $6::jsonb, \
               schema_version = $7, updated_by = $8, \
               updated_at = (extract(epoch FROM clock_timestamp()) * 1000000000)::bigint \
             WHERE org_id = $1 AND project_id = $2 AND id = $3 RETURNING ",
            columns!()
        ))
        .bind(scope.org.as_uuid())
        .bind(scope.project.as_uuid())
        .bind(id.as_uuid())
        .bind(file.name.as_str())
        .bind(tags)
        .bind(doc)
        .bind(file.doc.schema_version() as i32)
        .bind(by.as_uuid())
        .fetch_optional(&mut **tx)
        .await;
        let row = match row {
            Ok(row) => row,
            Err(sqlx::Error::Database(failure)) if failure.is_unique_violation() => {
                return Ok(DashboardSaving::NameTaken);
            }
            Err(error) => return Err(unreachable(&error, "change a dashboard")),
        };

        Ok(match row {
            Some(row) => DashboardSaving::Saved(read_dashboard(&row)?),
            None => DashboardSaving::Missing,
        })
    }

    async fn delete(&self, scope: DashboardScope, id: DashboardId) -> Result<bool, StoreError> {
        let mut tx = self.tx.lock().await;
        sqlx::query("DELETE FROM dashboards WHERE org_id = $1 AND project_id = $2 AND id = $3")
            .bind(scope.org.as_uuid())
            .bind(scope.project.as_uuid())
            .bind(id.as_uuid())
            .execute(&mut **tx)
            .await
            .map(|done| done.rows_affected() > 0)
            .map_err(|error| unreachable(&error, "delete a dashboard"))
    }
}

fn written(file: &DashboardFile) -> Result<(String, String), StoreError> {
    let tags = serde_json::to_string(&file.tags);
    let doc = serde_json::to_string(&file.doc);
    match (tags, doc) {
        (Ok(tags), Ok(doc)) => Ok((tags, doc)),
        (Err(error), _) | (_, Err(error)) => {
            tracing::error!(%error, "a dashboard could not be written as JSON");
            Err(StoreError::Unreachable)
        }
    }
}

fn read_name(row: &PgRow) -> Result<DashboardName, StoreError> {
    DashboardName::try_from(row.get::<String, _>("name").as_str()).map_err(|error| {
        unreadable("name", &error);
        StoreError::Unreachable
    })
}

fn read_tags(row: &PgRow) -> Result<DashboardTags, StoreError> {
    serde_json::from_str(&row.get::<String, _>("tags")).map_err(|error| {
        unreadable("tags", &error);
        StoreError::Unreachable
    })
}

fn read_summary(row: &PgRow) -> Result<DashboardSummary, StoreError> {
    Ok(DashboardSummary {
        id: DashboardId::new(row.get("id")),
        name: read_name(row)?,
        tags: read_tags(row)?,
        updated_by: row.get::<Option<Uuid>, _>("updated_by").map(AccountId::new),
        updated_at_unix_nanos: u64::try_from(row.get::<i64, _>("updated_at")).unwrap_or_default(),
    })
}

fn read_dashboard(row: &PgRow) -> Result<Dashboard, StoreError> {
    let doc: DashboardDoc =
        serde_json::from_str(&row.get::<String, _>("doc")).map_err(|error| {
            unreadable("doc", &error);
            StoreError::Unreachable
        })?;
    Ok(Dashboard {
        id: DashboardId::new(row.get("id")),
        project: ProjectId::new(row.get("project_id")),
        name: read_name(row)?,
        tags: read_tags(row)?,
        doc,
        updated_by: row.get::<Option<Uuid>, _>("updated_by").map(AccountId::new),
        created_at_unix_nanos: u64::try_from(row.get::<i64, _>("created_at")).unwrap_or_default(),
        updated_at_unix_nanos: u64::try_from(row.get::<i64, _>("updated_at")).unwrap_or_default(),
    })
}

fn unreadable(column: &str, error: &dyn std::fmt::Display) {
    tracing::error!(column, %error, "a stored dashboard holds a value this version does not know");
}

fn unreachable(error: &sqlx::Error, what: &str) -> StoreError {
    tracing::error!(%error, "the control plane refused to {what}");
    StoreError::Unreachable
}
