use super::ports::{UsageHistory, UsageReader};
use super::pricing::PriceList;
use super::spending::by_project;
use super::value_objects::{Consumption, DecompressedBytes, Split, TenantId};
use crate::clock::UnixSeconds;
use crate::explore::{ExploreError, Window};
use crate::identity::SessionStore;
use crate::organisation::{Memberships, OrgRole, Whoami};
use crate::secret::SessionToken;

#[derive(Debug)]
pub struct Metering<S, G, R, H> {
    whoami: Whoami<S, G>,
    live: R,
    history: H,
    prices: Option<PriceList>,
}

impl<S, G, R, H> Metering<S, G, R, H>
where
    S: SessionStore,
    G: Memberships,
    R: UsageReader,
    H: UsageHistory,
{
    pub fn new(whoami: Whoami<S, G>, live: R, history: H) -> Self {
        Self {
            whoami,
            live,
            history,
            prices: None,
        }
    }

    #[must_use]
    pub fn priced(mut self, prices: Option<PriceList>) -> Self {
        self.prices = prices;
        self
    }

    pub async fn consumption(
        &self,
        token: &SessionToken,
        org: TenantId,
        window: Window,
        now: UnixSeconds,
    ) -> Result<Consumption, ExploreError> {
        let who = self.whoami.of(token).await?;
        if !who.may_act_in(org, OrgRole::Member) {
            return Err(ExploreError::NotYours);
        }
        let hours = self.history.hours(org, window).await?;
        let projects = by_project(&hours, self.history.project_hours(org, window).await?);
        let used: Split = hours.iter().filter_map(|hour| hour.split).sum();
        let included = self.history.included(org).await?;
        let prices = self
            .prices
            .map(|prices| prices.including(included.per_signal(prices.included)));
        Ok(Consumption {
            ingested_bytes: self.live.used(org).await.get(),
            included_bytes: included.ingest.map(DecompressedBytes::get),
            hours,
            pricing: prices,
            bill: prices.map(|prices| prices.bill(used, window, now)),
            projects,
        })
    }
}
