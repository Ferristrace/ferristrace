use core::future::Future;

use super::entities::{Dashboard, DashboardFile, DashboardSummary};
use super::value_objects::DashboardId;
use crate::catalogue::ProjectId;
use crate::identity::AccountId;
use crate::store::StoreError;
use crate::telemetry::TenantId;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Scope {
    pub org: TenantId,
    pub project: ProjectId,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DashboardCreation {
    Made(Dashboard),
    NameTaken,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DashboardSaving {
    Saved(Dashboard),
    Missing,
    NameTaken,
}

pub trait DashboardStore {
    fn project_scope(
        &self,
        project: ProjectId,
    ) -> impl Future<Output = Result<Option<Scope>, StoreError>> + Send;

    fn locate(
        &self,
        id: DashboardId,
    ) -> impl Future<Output = Result<Option<Scope>, StoreError>> + Send;

    fn list(
        &self,
        scope: Scope,
    ) -> impl Future<Output = Result<Vec<DashboardSummary>, StoreError>> + Send;

    fn get(
        &self,
        scope: Scope,
        id: DashboardId,
    ) -> impl Future<Output = Result<Option<Dashboard>, StoreError>> + Send;

    fn count(&self, scope: Scope) -> impl Future<Output = Result<usize, StoreError>> + Send;

    fn create(
        &self,
        scope: Scope,
        by: AccountId,
        file: &DashboardFile,
    ) -> impl Future<Output = Result<DashboardCreation, StoreError>> + Send;

    fn update(
        &self,
        scope: Scope,
        id: DashboardId,
        by: AccountId,
        file: &DashboardFile,
    ) -> impl Future<Output = Result<DashboardSaving, StoreError>> + Send;

    fn delete(
        &self,
        scope: Scope,
        id: DashboardId,
    ) -> impl Future<Output = Result<bool, StoreError>> + Send;
}

impl<T: DashboardStore + Sync> DashboardStore for &T {
    fn project_scope(
        &self,
        project: ProjectId,
    ) -> impl Future<Output = Result<Option<Scope>, StoreError>> + Send {
        (*self).project_scope(project)
    }

    fn locate(
        &self,
        id: DashboardId,
    ) -> impl Future<Output = Result<Option<Scope>, StoreError>> + Send {
        (*self).locate(id)
    }

    fn list(
        &self,
        scope: Scope,
    ) -> impl Future<Output = Result<Vec<DashboardSummary>, StoreError>> + Send {
        (*self).list(scope)
    }

    fn get(
        &self,
        scope: Scope,
        id: DashboardId,
    ) -> impl Future<Output = Result<Option<Dashboard>, StoreError>> + Send {
        (*self).get(scope, id)
    }

    fn count(&self, scope: Scope) -> impl Future<Output = Result<usize, StoreError>> + Send {
        (*self).count(scope)
    }

    fn create(
        &self,
        scope: Scope,
        by: AccountId,
        file: &DashboardFile,
    ) -> impl Future<Output = Result<DashboardCreation, StoreError>> + Send {
        (*self).create(scope, by, file)
    }

    fn update(
        &self,
        scope: Scope,
        id: DashboardId,
        by: AccountId,
        file: &DashboardFile,
    ) -> impl Future<Output = Result<DashboardSaving, StoreError>> + Send {
        (*self).update(scope, id, by, file)
    }

    fn delete(
        &self,
        scope: Scope,
        id: DashboardId,
    ) -> impl Future<Output = Result<bool, StoreError>> + Send {
        (*self).delete(scope, id)
    }
}
