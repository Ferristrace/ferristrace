use std::collections::BTreeMap;

use ferristrace_domain::telemetry::Allowance;
use ferristrace_domain::{DecompressedBytes, TenantId};
use sqlx::migrate::Migrator;
use sqlx::{PgPool, Row};

pub static CONTROL_PLANE: Migrator = sqlx::migrate!("migrations/postgres");

pub const SELF_HOSTED_PLAN: &str = "self-hosted";
pub const OVERAGE_FEATURE: &str = "overage";
pub const FALLBACK_PLAN: &str = "free";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanSpec {
    pub slug: String,
    pub name: String,
    pub ingest_gb: Option<i32>,
    pub retention_days: Option<i32>,
    pub overage: bool,
    pub price_ref: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BillingPlans {
    pub fallback: bool,
    pub priced: i64,
}

pub async fn sync_plans(pool: &PgPool, plans: &[PlanSpec]) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    for plan in plans {
        let features: Vec<&str> = if plan.overage {
            vec![OVERAGE_FEATURE]
        } else {
            Vec::new()
        };
        sqlx::query(
            "INSERT INTO plans (id, slug, name, ingest_gb, retention_days, features, price_ref) \
             VALUES ($1, $2, $3, $4, $5, $6, $7) \
             ON CONFLICT (slug) DO UPDATE SET name = excluded.name, \
               ingest_gb = excluded.ingest_gb, retention_days = excluded.retention_days, \
               features = excluded.features, price_ref = excluded.price_ref",
        )
        .bind(uuid::Uuid::new_v4())
        .bind(&plan.slug)
        .bind(&plan.name)
        .bind(plan.ingest_gb)
        .bind(plan.retention_days)
        .bind(&features)
        .bind(plan.price_ref.as_deref())
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await
}

pub async fn billing_plans(pool: &PgPool) -> Result<BillingPlans, sqlx::Error> {
    let row = sqlx::query(
        "SELECT EXISTS (SELECT 1 FROM plans WHERE slug = $1) AS fallback, \
         (SELECT count(*) FROM plans WHERE price_ref IS NOT NULL) AS priced",
    )
    .bind(FALLBACK_PLAN)
    .fetch_one(pool)
    .await?;
    Ok(BillingPlans {
        fallback: row.get("fallback"),
        priced: row.get("priced"),
    })
}

const BYTES_PER_GIGABYTE: u64 = 1024 * 1024 * 1024;

pub async fn load_allowances(pool: &PgPool) -> Result<BTreeMap<TenantId, Allowance>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT o.id AS org_id, p.ingest_gb AS ingest_gb, p.features AS features \
         FROM orgs o JOIN plans p ON p.id = o.plan_id",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let tenant = TenantId::new(row.get("org_id"));
            let features: Vec<String> = row.get("features");
            let allowance = row
                .get::<Option<i32>, _>("ingest_gb")
                .and_then(gigabytes_to_bytes)
                .map_or(Allowance::Unlimited, |bytes| {
                    if features.iter().any(|feature| feature == OVERAGE_FEATURE) {
                        Allowance::Overage(bytes)
                    } else {
                        Allowance::Capped(bytes)
                    }
                });
            (tenant, allowance)
        })
        .collect())
}

pub(crate) fn gigabytes_to_bytes(gigabytes: i32) -> Option<DecompressedBytes> {
    u64::try_from(gigabytes)
        .ok()?
        .checked_mul(BYTES_PER_GIGABYTE)
        .map(DecompressedBytes::new)
}

#[cfg(test)]
mod tests {
    use ferristrace_domain::DecompressedBytes;

    use super::{BYTES_PER_GIGABYTE, gigabytes_to_bytes};

    #[test]
    fn a_gigabyte_is_binary_not_decimal() {
        assert_eq!(
            gigabytes_to_bytes(1).map(DecompressedBytes::get),
            Some(1_073_741_824)
        );
    }

    #[test]
    fn a_negative_allowance_reads_as_absent() {
        assert_eq!(gigabytes_to_bytes(-1), None);
    }

    #[test]
    fn the_largest_plan_still_fits_in_bytes() {
        let largest = gigabytes_to_bytes(i32::MAX).map(DecompressedBytes::get);

        assert_eq!(
            largest,
            Some(u64::from(i32::MAX.unsigned_abs()) * BYTES_PER_GIGABYTE)
        );
    }
}
