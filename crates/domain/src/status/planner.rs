use super::desk::admin;
use super::entities::{Agenda, Closure, Maintenance, MaintenanceDraft, MaintenancePatch};
use super::errors::StatusError;
use super::ports::StatusPages;
use super::value_objects::{
    ComponentId, MAX_MAINTENANCE_COMPONENTS, MaintenanceId, MaintenancePhase, MaintenanceWindow,
    UPTIME_DAYS,
};
use crate::access::{ApiKeys, Reader, Readers};
use crate::audit::{Action, Actor, AuditEntry, AuditTrail, Detail, Target, TargetKind};
use crate::clock::UnixSeconds;
use crate::identity::{AccountId, SessionStore};
use crate::organisation::Memberships;
use crate::telemetry::TenantId;

const MILLIS_PER_SECOND: u64 = 1_000;
const DAY_MS: u64 = 86_400_000;

#[derive(Debug)]
pub struct Planner<S, G, K, Pg, A> {
    readers: Readers<S, G, K>,
    pages: Pg,
    trail: A,
}

impl<S, G, K, Pg, A> Planner<S, G, K, Pg, A>
where
    S: SessionStore,
    G: Memberships,
    K: ApiKeys,
    Pg: StatusPages,
    A: AuditTrail,
{
    pub fn new(readers: Readers<S, G, K>, pages: Pg, trail: A) -> Self {
        Self {
            readers,
            pages,
            trail,
        }
    }

    pub async fn list(
        &self,
        who: &Reader,
        org: TenantId,
        now: UnixSeconds,
    ) -> Result<Agenda, StatusError> {
        self.readers.grant(who, org).await?;
        let since_ms = millis(now).saturating_sub((UPTIME_DAYS as u64) * DAY_MS);
        Ok(Agenda {
            maintenances: self.pages.maintenances(org, since_ms).await?,
            components: self.pages.org_components(org).await?,
        })
    }

    pub async fn schedule(
        &self,
        who: &Reader,
        org: TenantId,
        draft: &MaintenanceDraft,
        now: UnixSeconds,
    ) -> Result<Maintenance, StatusError> {
        let by = admin(&self.readers, who, org).await?;
        let now_ms = millis(now);
        ahead(draft.window, now_ms)?;
        let maintenance = Maintenance {
            id: MaintenanceId::fresh(),
            org,
            title: draft.title.clone(),
            details: draft.details.clone(),
            window: draft.window,
            components: self.targets(org, &draft.components).await?,
            closure: None,
            created_ms: now_ms,
            updated_ms: now_ms,
        };
        self.pages.add_maintenance(&maintenance).await?;
        self.note(org, by, Action::StatusMaintenanceScheduled, &maintenance)
            .await?;
        Ok(maintenance)
    }

    pub async fn change(
        &self,
        who: &Reader,
        org: TenantId,
        id: MaintenanceId,
        patch: MaintenancePatch,
        now: UnixSeconds,
    ) -> Result<Maintenance, StatusError> {
        let by = admin(&self.readers, who, org).await?;
        let now_ms = millis(now);
        let held = self.held(org, id).await?;
        if !matches!(
            held.phase(now_ms),
            MaintenancePhase::Scheduled | MaintenancePhase::InProgress
        ) {
            return Err(StatusError::MaintenanceClosed);
        }
        let components = match &patch.components {
            Some(asked) => self.targets(org, asked).await?,
            None => held.components.clone(),
        };
        let changed = Maintenance {
            title: patch.title.unwrap_or_else(|| held.title.clone()),
            details: patch.details.unwrap_or_else(|| held.details.clone()),
            window: patch.window.unwrap_or(held.window),
            components,
            ..held.clone()
        };
        if changed == held {
            return Ok(held);
        }
        if changed.window != held.window {
            ahead(changed.window, now_ms)?;
        }
        let changed = Maintenance {
            updated_ms: now_ms,
            ..changed
        };
        self.keep(&changed).await?;
        self.note(org, by, Action::StatusMaintenanceUpdated, &changed)
            .await?;
        Ok(changed)
    }

    pub async fn end(
        &self,
        who: &Reader,
        org: TenantId,
        id: MaintenanceId,
        now: UnixSeconds,
    ) -> Result<Maintenance, StatusError> {
        let by = admin(&self.readers, who, org).await?;
        let now_ms = millis(now);
        let held = self.held(org, id).await?;
        match held.phase(now_ms) {
            MaintenancePhase::InProgress => {}
            MaintenancePhase::Scheduled => return Err(StatusError::MaintenanceNotRunning),
            MaintenancePhase::Completed | MaintenancePhase::Cancelled => {
                return Err(StatusError::MaintenanceClosed);
            }
        }
        let ended = Maintenance {
            closure: Some(Closure::Ended { at_ms: now_ms }),
            updated_ms: now_ms,
            ..held
        };
        self.keep(&ended).await?;
        self.note(org, by, Action::StatusMaintenanceEnded, &ended)
            .await?;
        Ok(ended)
    }

    pub async fn cancel(
        &self,
        who: &Reader,
        org: TenantId,
        id: MaintenanceId,
        now: UnixSeconds,
    ) -> Result<Maintenance, StatusError> {
        let by = admin(&self.readers, who, org).await?;
        let now_ms = millis(now);
        let held = self.held(org, id).await?;
        match held.phase(now_ms) {
            MaintenancePhase::Scheduled => {}
            MaintenancePhase::InProgress => return Err(StatusError::MaintenanceStarted),
            MaintenancePhase::Completed | MaintenancePhase::Cancelled => {
                return Err(StatusError::MaintenanceClosed);
            }
        }
        let cancelled = Maintenance {
            closure: Some(Closure::Cancelled { at_ms: now_ms }),
            updated_ms: now_ms,
            ..held
        };
        self.keep(&cancelled).await?;
        self.note(org, by, Action::StatusMaintenanceCancelled, &cancelled)
            .await?;
        Ok(cancelled)
    }

    async fn held(&self, org: TenantId, id: MaintenanceId) -> Result<Maintenance, StatusError> {
        self.pages
            .maintenance(org, id)
            .await?
            .ok_or(StatusError::NoSuchMaintenance)
    }

    async fn keep(&self, maintenance: &Maintenance) -> Result<(), StatusError> {
        if self.pages.keep_maintenance(maintenance).await? {
            Ok(())
        } else {
            Err(StatusError::NoSuchMaintenance)
        }
    }

    async fn targets(
        &self,
        org: TenantId,
        asked: &[ComponentId],
    ) -> Result<Vec<ComponentId>, StatusError> {
        let mut kept: Vec<ComponentId> = Vec::with_capacity(asked.len());
        for id in asked {
            if !kept.contains(id) {
                kept.push(*id);
            }
        }
        if kept.len() > MAX_MAINTENANCE_COMPONENTS {
            return Err(StatusError::TooManyTargets {
                max: MAX_MAINTENANCE_COMPONENTS,
            });
        }
        if kept.is_empty() {
            return Ok(kept);
        }
        let known = self.pages.org_components(org).await?;
        if kept
            .iter()
            .all(|id| known.iter().any(|placed| placed.component == *id))
        {
            Ok(kept)
        } else {
            Err(StatusError::NoSuchComponent)
        }
    }

    async fn note(
        &self,
        org: TenantId,
        by: AccountId,
        action: Action,
        maintenance: &Maintenance,
    ) -> Result<(), StatusError> {
        Ok(self
            .trail
            .record(&AuditEntry {
                org,
                actor: Actor::Account(by),
                action,
                target: Target::of(
                    TargetKind::StatusMaintenance,
                    Some(maintenance.id.to_string().into()),
                ),
                detail: Detail::default()
                    .with("title", &maintenance.title)
                    .with("starts_ms", maintenance.window.starts_ms())
                    .with("ends_ms", maintenance.window.ends_ms())
                    .with("components", maintenance.components.len()),
            })
            .await?)
    }
}

fn ahead(window: MaintenanceWindow, now_ms: u64) -> Result<(), StatusError> {
    if window.ends_ms() > now_ms {
        Ok(())
    } else {
        Err(StatusError::WindowPassed)
    }
}

fn millis(now: UnixSeconds) -> u64 {
    now.get().saturating_mul(MILLIS_PER_SECOND)
}
