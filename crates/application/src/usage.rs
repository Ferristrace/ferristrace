use core::future::Future;

use ferristrace_domain::telemetry::{
    BillingHour, BillingMonth, HourSplit, HourTotal, HourlyCounters, MonthTotal,
    PendingOverageHour, ProjectHourShare, StoredVolumes, UsageLedger, UsageSyncError,
    project_shares,
};
use ferristrace_domain::{
    BillingGateway, Clock, Consumption, DecompressedBytes, ExploreError, Metering, SessionToken,
    StoreError, TenantId, Whoami, Window,
};

use crate::registry::{RepoFor, UsageRepos, domain};
use crate::{Ferristrace, Stack, transactional};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UsageBackfill {
    pub hours: usize,
    pub projects: usize,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct OverageReport {
    pub reported: usize,
    pub failed: usize,
}

impl<S: Stack> Ferristrace<S>
where
    S::Repos: UsageRepos,
{
    #[transactional(sessions, memberships, usage_history, unavailable = ExploreError::StoreUnreachable)]
    pub async fn consumption(
        &self,
        token: &SessionToken,
        org: TenantId,
        window: Window,
    ) -> Result<Consumption, ExploreError> {
        Metering::new(
            Whoami::new(sessions, memberships),
            &self.meter,
            usage_history,
        )
        .priced(self.prices)
        .consumption(token, org, window, self.clock.now())
        .await
    }
}

impl<S: Stack> Ferristrace<S>
where
    S::Repos: RepoFor<domain::UsageHistory, Repo: UsageLedger>,
{
    pub async fn backfill_usage<V: StoredVolumes + Sync>(
        &self,
        volumes: &V,
    ) -> Result<UsageBackfill, UsageSyncError> {
        let stored = volumes.hourly().await?;
        let hours = self.fill_splits(&stored).await?;
        let shares = project_shares(&stored, &volumes.hourly_by_project().await?);
        let projects = self.fill_project_shares(&shares).await?;
        Ok(UsageBackfill { hours, projects })
    }

    #[transactional(usage_history, unavailable = UsageSyncError::Store(StoreError::Unreachable))]
    async fn fill_splits(&self, splits: &[HourSplit]) -> Result<usize, UsageSyncError> {
        Ok(usage_history.fill_splits(splits).await?)
    }

    #[transactional(usage_history, unavailable = UsageSyncError::Store(StoreError::Unreachable))]
    async fn fill_project_shares(
        &self,
        shares: &[ProjectHourShare],
    ) -> Result<usize, UsageSyncError> {
        Ok(usage_history.fill_project_shares(shares).await?)
    }
}

impl<S: Stack> Ferristrace<S>
where
    S::Repos: RepoFor<domain::UsageHistory, Repo: UsageLedger>,
    S::Meter: HourlyCounters,
{
    #[allow(clippy::manual_async_fn)]
    pub fn roll_up_usage(&self) -> impl Future<Output = Result<usize, UsageSyncError>> + Send {
        async move {
            let current = BillingHour::containing(self.clock.now());
            let finished = self.meter.closed_before(current).await?;
            let rolled = self.record_hours(&finished).await?;
            for total in finished {
                self.meter.discard(total).await?;
            }
            Ok(rolled)
        }
    }

    #[allow(clippy::manual_async_fn)]
    pub fn rehydrate_usage(&self) -> impl Future<Output = Result<usize, UsageSyncError>> + Send {
        async move {
            let month = BillingMonth::containing(self.clock.now());
            let billed = self.billed_since(month).await?;
            let mut seeded = 0;
            for total in billed {
                if self.meter.seed(total.tenant, total.ingested).await? {
                    seeded += 1;
                }
            }
            Ok(seeded)
        }
    }

    #[transactional(usage_history, unavailable = UsageSyncError::Store(StoreError::Unreachable))]
    async fn record_hours(&self, hours: &[HourTotal]) -> Result<usize, UsageSyncError> {
        Ok(usage_history.record_hours(hours).await?)
    }

    #[transactional(usage_history, unavailable = UsageSyncError::Store(StoreError::Unreachable))]
    async fn billed_since(&self, month: BillingMonth) -> Result<Vec<MonthTotal>, UsageSyncError> {
        Ok(usage_history.billed_since(month).await?)
    }
}

impl<S: Stack> Ferristrace<S>
where
    S::Repos: RepoFor<domain::UsageHistory, Repo: UsageLedger>,
{
    #[transactional(usage_history, unavailable = UsageSyncError::Store(StoreError::Unreachable))]
    async fn pending_overages(
        &self,
        month: BillingMonth,
    ) -> Result<Vec<PendingOverageHour>, UsageSyncError> {
        Ok(usage_history.pending_overages(month).await?)
    }

    #[transactional(usage_history, unavailable = UsageSyncError::Store(StoreError::Unreachable))]
    async fn mark_overage_reported(
        &self,
        org: TenantId,
        hour: BillingHour,
        reported: DecompressedBytes,
    ) -> Result<(), UsageSyncError> {
        Ok(usage_history
            .mark_overage_reported(org, hour, reported)
            .await?)
    }
}

impl<S: Stack> Ferristrace<S>
where
    S::Repos: RepoFor<domain::UsageHistory, Repo: UsageLedger>,
    S::Billing: BillingGateway,
{
    #[allow(clippy::manual_async_fn)]
    pub fn report_overages(
        &self,
    ) -> impl Future<Output = Result<OverageReport, UsageSyncError>> + Send {
        async move {
            let Some(billing) = &self.billing else {
                return Ok(OverageReport::default());
            };
            let month = BillingMonth::containing(self.clock.now());
            let pending = self.pending_overages(month).await?;
            let mut outcome = OverageReport::default();
            for entry in pending {
                let billable = entry.billable();
                if billable.get() > 0 {
                    if billing
                        .report_usage(&entry.customer, entry.hour, billable)
                        .await
                        .is_ok()
                    {
                        self.mark_overage_reported(entry.org, entry.hour, billable)
                            .await?;
                        outcome.reported += 1;
                    } else {
                        outcome.failed += 1;
                    }
                } else {
                    self.mark_overage_reported(entry.org, entry.hour, DecompressedBytes::new(0))
                        .await?;
                }
            }
            Ok(outcome)
        }
    }
}
