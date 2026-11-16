use ferristrace_domain::{
    Dashboard, DashboardDesk, DashboardError, DashboardFile, DashboardId, DashboardSummary,
    ProjectId, Reader, Readers, SessionToken, Whoami,
};

use crate::registry::DashboardRepos;
use crate::{Ferristrace, Stack, transactional};

impl<S: Stack> Ferristrace<S>
where
    S::Repos: DashboardRepos,
{
    #[transactional(sessions, memberships, api_keys, dashboards, audit, unavailable = DashboardError::StoreUnreachable)]
    pub async fn list_dashboards(
        &self,
        who: &Reader,
        project: ProjectId,
    ) -> Result<Vec<DashboardSummary>, DashboardError> {
        DashboardDesk::new(
            Readers::new(Whoami::new(sessions, memberships), api_keys),
            dashboards,
            audit,
        )
        .list(who, project)
        .await
    }

    #[transactional(sessions, memberships, api_keys, dashboards, audit, unavailable = DashboardError::StoreUnreachable)]
    pub async fn dashboard(
        &self,
        who: &Reader,
        id: DashboardId,
    ) -> Result<Dashboard, DashboardError> {
        DashboardDesk::new(
            Readers::new(Whoami::new(sessions, memberships), api_keys),
            dashboards,
            audit,
        )
        .get(who, id)
        .await
    }

    #[transactional(sessions, memberships, api_keys, dashboards, audit, unavailable = DashboardError::StoreUnreachable)]
    pub async fn export_dashboard(
        &self,
        who: &Reader,
        id: DashboardId,
    ) -> Result<DashboardFile, DashboardError> {
        DashboardDesk::new(
            Readers::new(Whoami::new(sessions, memberships), api_keys),
            dashboards,
            audit,
        )
        .export(who, id)
        .await
    }

    #[transactional(sessions, memberships, api_keys, dashboards, audit, unavailable = DashboardError::StoreUnreachable)]
    pub async fn create_dashboard(
        &self,
        token: &SessionToken,
        project: ProjectId,
        file: &DashboardFile,
    ) -> Result<Dashboard, DashboardError> {
        DashboardDesk::new(
            Readers::new(Whoami::new(sessions, memberships), api_keys),
            dashboards,
            audit,
        )
        .create(token, project, file)
        .await
    }

    #[transactional(sessions, memberships, api_keys, dashboards, audit, unavailable = DashboardError::StoreUnreachable)]
    pub async fn import_dashboard(
        &self,
        token: &SessionToken,
        project: ProjectId,
        file: &DashboardFile,
    ) -> Result<Dashboard, DashboardError> {
        DashboardDesk::new(
            Readers::new(Whoami::new(sessions, memberships), api_keys),
            dashboards,
            audit,
        )
        .import(token, project, file)
        .await
    }

    #[transactional(sessions, memberships, api_keys, dashboards, audit, unavailable = DashboardError::StoreUnreachable)]
    pub async fn replace_dashboard(
        &self,
        token: &SessionToken,
        id: DashboardId,
        file: &DashboardFile,
    ) -> Result<Dashboard, DashboardError> {
        DashboardDesk::new(
            Readers::new(Whoami::new(sessions, memberships), api_keys),
            dashboards,
            audit,
        )
        .replace(token, id, file)
        .await
    }

    #[transactional(sessions, memberships, api_keys, dashboards, audit, unavailable = DashboardError::StoreUnreachable)]
    pub async fn delete_dashboard(
        &self,
        token: &SessionToken,
        id: DashboardId,
    ) -> Result<(), DashboardError> {
        DashboardDesk::new(
            Readers::new(Whoami::new(sessions, memberships), api_keys),
            dashboards,
            audit,
        )
        .delete(token, id)
        .await
    }

    #[transactional(sessions, memberships, api_keys, dashboards, audit, unavailable = DashboardError::StoreUnreachable)]
    pub async fn clone_dashboard(
        &self,
        token: &SessionToken,
        id: DashboardId,
    ) -> Result<Dashboard, DashboardError> {
        DashboardDesk::new(
            Readers::new(Whoami::new(sessions, memberships), api_keys),
            dashboards,
            audit,
        )
        .duplicate(token, id)
        .await
    }
}
