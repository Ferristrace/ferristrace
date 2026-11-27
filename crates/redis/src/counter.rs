use core::fmt;
use std::collections::{BTreeMap, HashMap};

use ferristrace_domain::telemetry::{
    BillingHour, BillingMonth, CounterUnreachable, HourTotal, HourlyCounters, ProjectSplit,
    SignalKind, Split,
};
use ferristrace_domain::{
    Carried, Clock, DecompressedBytes, ProjectId, TenantId, UsageMeter, UsageReader,
};
use redis::AsyncCommands;
use redis::aio::ConnectionManager;

const KEY_PREFIX: &str = "usage";
const KEY_TTL_SECONDS: i64 = 70 * 24 * 60 * 60;
const HOUR_TTL_SECONDS: i64 = 7 * 24 * 60 * 60;
const SCAN_BATCH: usize = 500;
const SPANS_BYTES: &str = "spans_bytes";
const LOGS_BYTES: &str = "logs_bytes";
const METRICS_POINTS: &str = "metrics_points";

const PROJECT_MARK: char = '@';

fn field_of(signal: SignalKind) -> &'static str {
    match signal {
        SignalKind::Spans => SPANS_BYTES,
        SignalKind::Logs => LOGS_BYTES,
        SignalKind::Metrics => METRICS_POINTS,
    }
}

fn signal_of(field: &str) -> Option<SignalKind> {
    SignalKind::ALL
        .into_iter()
        .find(|signal| field_of(*signal) == field)
}

fn project_field(signal: SignalKind, project: ProjectId) -> String {
    format!("{}{PROJECT_MARK}{project}", field_of(signal))
}

#[derive(Debug, Default, PartialEq, Eq)]
struct HourFields {
    split: Option<Split>,
    projects: Vec<ProjectSplit>,
}

fn read_fields(fields: HashMap<String, u64>) -> HourFields {
    let mut split: Option<Split> = None;
    let mut projects: BTreeMap<ProjectId, Split> = BTreeMap::new();
    for (field, volume) in fields {
        let (name, project) = match field.split_once(PROJECT_MARK) {
            Some((name, project)) => (name, Some(project)),
            None => (field.as_str(), None),
        };
        let Some(signal) = signal_of(name) else {
            continue;
        };
        let slot = match project {
            None => split.get_or_insert_default(),
            Some(project) => match project.parse::<uuid::Uuid>() {
                Ok(id) => projects.entry(ProjectId::new(id)).or_default(),
                Err(_) => continue,
            },
        };
        *slot = slot.adding(signal, volume);
    }
    HourFields {
        split,
        projects: projects
            .into_iter()
            .map(|(project, split)| ProjectSplit { project, split })
            .collect(),
    }
}

#[derive(Debug, thiserror::Error)]
pub enum CounterError {
    #[error("the usage counter store refused the command")]
    Redis(#[from] redis::RedisError),
}

pub struct RedisMeter<C> {
    prefix: String,
    connection: ConnectionManager,
    clock: C,
}

impl<C> fmt::Debug for RedisMeter<C> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.debug_struct("RedisMeter").finish_non_exhaustive()
    }
}

impl<C: Clock> RedisMeter<C> {
    pub async fn connect(url: &str, clock: C) -> Result<Self, CounterError> {
        let client = redis::Client::open(url)?;
        let connection = ConnectionManager::new(client).await?;
        Ok(Self {
            prefix: KEY_PREFIX.to_owned(),
            connection,
            clock,
        })
    }

    #[must_use]
    pub fn with_prefix(mut self, prefix: impl Into<String>) -> Self {
        self.prefix = prefix.into();
        self
    }

    fn key(&self, tenant: TenantId) -> String {
        let month = BillingMonth::containing(self.clock.now()).key();
        format!("{}:{tenant}:{month}", self.prefix)
    }

    fn hour_key(&self, tenant: TenantId) -> String {
        let hour = BillingHour::containing(self.clock.now()).key();
        format!("{}:{tenant}:{hour}", self.prefix)
    }

    fn split_key(&self, tenant: TenantId, hour: BillingHour) -> String {
        format!("{}-split:{tenant}:{}", self.prefix, hour.key())
    }

    fn current_split_key(&self, tenant: TenantId) -> String {
        self.split_key(tenant, BillingHour::containing(self.clock.now()))
    }
}

impl<C: Clock + Send + Sync> RedisMeter<C> {
    async fn fields_of(
        &self,
        connection: &mut ConnectionManager,
        tenant: TenantId,
        hour: BillingHour,
    ) -> Result<HourFields, CounterUnreachable> {
        let fields: HashMap<String, u64> = connection
            .hgetall(self.split_key(tenant, hour))
            .await
            .map_err(|error| refused(&error))?;
        Ok(read_fields(fields))
    }
}

impl<C: Clock + Send + Sync> HourlyCounters for RedisMeter<C> {
    async fn closed_before(&self, hour: BillingHour) -> Result<Vec<HourTotal>, CounterUnreachable> {
        let pattern = format!("{}:*", self.prefix);
        let mut connection = self.connection.clone();
        let mut cursor: u64 = 0;
        let mut totals = Vec::new();

        loop {
            let (next, keys): (u64, Vec<String>) = redis::cmd("SCAN")
                .arg(cursor)
                .arg("MATCH")
                .arg(&pattern)
                .arg("COUNT")
                .arg(SCAN_BATCH)
                .query_async(&mut connection)
                .await
                .map_err(|error| refused(&error))?;

            for key in keys {
                let Some((tenant, closed)) = closed_hour_of(&key, hour) else {
                    continue;
                };
                let Some(total) = connection
                    .get::<_, Option<u64>>(&key)
                    .await
                    .map_err(|error| refused(&error))?
                else {
                    continue;
                };
                let fields = self.fields_of(&mut connection, tenant, closed).await?;
                totals.push(HourTotal {
                    tenant,
                    hour: closed,
                    ingested: DecompressedBytes::new(total),
                    split: fields.split,
                    projects: fields.projects,
                });
            }

            cursor = next;
            if cursor == 0 {
                break;
            }
        }
        Ok(totals)
    }

    async fn discard(&self, total: HourTotal) -> Result<(), CounterUnreachable> {
        let mut connection = self.connection.clone();
        let key = format!("{}:{}:{}", self.prefix, total.tenant, total.hour.key());
        let split = self.split_key(total.tenant, total.hour);
        let _: u64 = connection
            .del(&[key, split])
            .await
            .map_err(|error| refused(&error))?;
        Ok(())
    }

    async fn seed(
        &self,
        tenant: TenantId,
        total: DecompressedBytes,
    ) -> Result<bool, CounterUnreachable> {
        let mut connection = self.connection.clone();
        let key = self.key(tenant);
        let claimed: bool = connection
            .set_nx(&key, total.get())
            .await
            .map_err(|error| refused(&error))?;
        if claimed {
            let _: bool = connection
                .expire(&key, KEY_TTL_SECONDS)
                .await
                .map_err(|error| refused(&error))?;
        }
        Ok(claimed)
    }
}

fn refused(error: &redis::RedisError) -> CounterUnreachable {
    tracing::error!(%error, "the usage counter store refused the command");
    CounterUnreachable
}

impl<C: Clock + Send + Sync> UsageMeter for RedisMeter<C> {
    async fn record_ingest(
        &self,
        tenant: TenantId,
        project: Option<ProjectId>,
        decompressed: DecompressedBytes,
        carried: Carried,
    ) {
        let mut connection = self.connection.clone();
        let bytes = decompressed.get();
        let month = self.key(tenant);
        let hour = self.hour_key(tenant);
        let split = self.current_split_key(tenant);

        let mut pipe = redis::pipe();
        pipe.atomic()
            .incr(&month, bytes)
            .incr(&hour, bytes)
            .hincr(&split, field_of(carried.signal()), carried.volume())
            .ignore();
        if let Some(project) = project {
            pipe.hincr(
                &split,
                project_field(carried.signal(), project),
                carried.volume(),
            )
            .ignore();
        }
        pipe.expire(&split, HOUR_TTL_SECONDS).ignore();
        let replies: Result<(u64, u64), _> = pipe.query_async(&mut connection).await;

        match replies {
            Ok((month_total, hour_total)) => {
                expire_if_new(&mut connection, &month, month_total, bytes, KEY_TTL_SECONDS).await;
                expire_if_new(&mut connection, &hour, hour_total, bytes, HOUR_TTL_SECONDS).await;
            }
            Err(error) => {
                tracing::error!(%error, %tenant, "the usage counters were not incremented");
            }
        }
    }
}

async fn expire_if_new(
    connection: &mut ConnectionManager,
    key: &str,
    total: u64,
    increment: u64,
    ttl: i64,
) {
    if total != increment {
        return;
    }
    if let Err(error) = connection.expire::<_, bool>(key, ttl).await {
        tracing::error!(%error, key, "the usage counter was left without an expiry");
    }
}

fn closed_hour_of(key: &str, before: BillingHour) -> Option<(TenantId, BillingHour)> {
    let mut segments = key.rsplit(':');
    let hour = BillingHour::from_key(segments.next()?).filter(|hour| *hour < before)?;
    let tenant = segments
        .next()?
        .parse::<uuid::Uuid>()
        .ok()
        .map(TenantId::new)?;
    Some((tenant, hour))
}

impl<C: Clock + Send + Sync> UsageReader for RedisMeter<C> {
    async fn used(&self, tenant: TenantId) -> DecompressedBytes {
        let mut connection = self.connection.clone();
        match connection.get::<_, Option<u64>>(self.key(tenant)).await {
            Ok(total) => DecompressedBytes::new(total.unwrap_or_default()),
            Err(error) => {
                tracing::error!(
                    %error,
                    %tenant,
                    "the usage counter could not be read, so the payload is admitted"
                );
                DecompressedBytes::default()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use ferristrace_domain::telemetry::{ProjectSplit, Split};
    use ferristrace_domain::{ProjectId, SignalKind};
    use uuid::Uuid;

    use ferristrace_domain::UnixSeconds;
    use ferristrace_domain::telemetry::BillingHour;

    use super::{HourFields, closed_hour_of, project_field, read_fields};

    #[test]
    fn the_project_fields_of_an_hour_add_up_per_project_beside_the_split() {
        let web = ProjectId::new(Uuid::from_u128(1));
        let api = ProjectId::new(Uuid::from_u128(2));
        let fields = HashMap::from([
            ("spans_bytes".to_owned(), 30),
            ("logs_bytes".to_owned(), 5),
            (project_field(SignalKind::Spans, web), 20),
            (project_field(SignalKind::Logs, web), 5),
            (project_field(SignalKind::Spans, api), 10),
            ("total".to_owned(), 99),
            ("spans_bytes@not-a-uuid".to_owned(), 7),
        ]);

        assert_eq!(
            read_fields(fields),
            HourFields {
                split: Some(Split {
                    spans_bytes: 30,
                    logs_bytes: 5,
                    metrics_points: 0,
                }),
                projects: vec![
                    ProjectSplit {
                        project: web,
                        split: Split {
                            spans_bytes: 20,
                            logs_bytes: 5,
                            metrics_points: 0,
                        },
                    },
                    ProjectSplit {
                        project: api,
                        split: Split {
                            spans_bytes: 10,
                            logs_bytes: 0,
                            metrics_points: 0,
                        },
                    },
                ],
            }
        );
    }

    #[test]
    fn an_empty_hash_is_an_hour_without_a_split() {
        assert_eq!(read_fields(HashMap::new()), HourFields::default());
    }

    #[test]
    fn a_closed_hour_key_names_its_tenant_and_hour_whatever_the_prefix() {
        let now = BillingHour::containing(UnixSeconds::new(1_700_003_600));
        let plain = "usage:2f1e8a4c-0000-4000-8000-000000000001:2023111422";
        let nested = "test:rollup:2f1e8a4c-0000-4000-8000-000000000001:2023111422";

        assert_eq!(closed_hour_of(plain, now), closed_hour_of(nested, now));
        let (_, hour) = closed_hour_of(plain, now).expect("a closed hour");
        assert_eq!(hour.key(), "2023111422");
    }

    #[test]
    fn the_current_hour_a_month_key_and_a_key_without_a_tenant_are_skipped() {
        let now = BillingHour::containing(UnixSeconds::new(1_700_000_000));

        assert_eq!(
            closed_hour_of("usage:2f1e8a4c-0000-4000-8000-000000000001:2023111422", now),
            None
        );
        assert_eq!(
            closed_hour_of("usage:2f1e8a4c-0000-4000-8000-000000000001:202311", now),
            None
        );
        assert_eq!(closed_hour_of("usage:2023111421", now), None);
        assert_eq!(closed_hour_of("usage", now), None);
    }
}
