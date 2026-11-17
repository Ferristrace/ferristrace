use std::collections::BTreeMap;
use std::sync::{Arc, RwLock};

use super::ports::{QuotaPolicy, UsageReader};
use super::value_objects::{Admission, DecompressedBytes, TenantId};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Allowance {
    Unlimited,
    Capped(DecompressedBytes),
    Overage(DecompressedBytes),
}

#[derive(Debug, Clone, Default)]
pub struct Allowances(Arc<RwLock<BTreeMap<TenantId, Allowance>>>);

impl Allowances {
    pub fn new(allowances: impl IntoIterator<Item = (TenantId, Allowance)>) -> Self {
        Self(Arc::new(RwLock::new(allowances.into_iter().collect())))
    }

    pub fn replace(&self, allowances: impl IntoIterator<Item = (TenantId, Allowance)>) {
        *self
            .0
            .write()
            .expect("the allowance map lock is never poisoned") = allowances.into_iter().collect();
    }

    fn get(&self, tenant: TenantId) -> Option<Allowance> {
        self.0
            .read()
            .expect("the allowance map lock is never poisoned")
            .get(&tenant)
            .copied()
    }
}

#[derive(Debug, Default)]
pub struct StaticQuota<R> {
    allowances: Allowances,
    usage: R,
}

impl<R> StaticQuota<R> {
    pub fn new(usage: R, allowances: impl IntoIterator<Item = (TenantId, Allowance)>) -> Self {
        Self {
            allowances: Allowances::new(allowances),
            usage,
        }
    }

    pub fn unlimited(usage: R) -> Self {
        Self {
            allowances: Allowances::default(),
            usage,
        }
    }

    pub fn allowances(&self) -> Allowances {
        self.allowances.clone()
    }
}

impl<R: UsageReader + Send + Sync> QuotaPolicy for StaticQuota<R> {
    async fn admit(&self, tenant: TenantId, incoming: DecompressedBytes) -> Admission {
        let Some(allowance) = self.allowances.get(tenant) else {
            return Admission::Within;
        };
        if allowance == Allowance::Unlimited {
            return Admission::Within;
        }

        let total = self
            .usage
            .used(tenant)
            .await
            .get()
            .saturating_add(incoming.get());

        match allowance {
            Allowance::Unlimited => Admission::Within,
            Allowance::Capped(limit) | Allowance::Overage(limit) if total <= limit.get() => {
                Admission::Within
            }
            Allowance::Capped(limit) => Admission::Capped { allowance: limit },
            Allowance::Overage(limit) => Admission::Overage {
                over_by: DecompressedBytes::new(total - limit.get()),
            },
        }
    }
}
