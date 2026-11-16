use super::entities::{Dashboard, DashboardFile, DashboardSummary};
use super::errors::{Cap, DashboardError};
use super::ports::{DashboardCreation, DashboardSaving, DashboardStore, Scope};
use super::value_objects::DashboardId;
use crate::access::{ApiKeys, Reader, Readers};
use crate::audit::{Action, Actor, AuditEntry, AuditTrail, Detail, Target};
use crate::catalogue::ProjectId;
use crate::identity::{AccountId, SessionStore};
use crate::organisation::{Memberships, OrgRole};
use crate::secret::SessionToken;

pub const MAX_DASHBOARDS: usize = 100;

#[derive(Debug, Clone, Copy)]
enum Origin {
    Created,
    Imported,
    Cloned(DashboardId),
}

#[derive(Debug)]
pub struct DashboardDesk<S, G, K, D, A> {
    readers: Readers<S, G, K>,
    store: D,
    trail: A,
}

impl<S, G, K, D, A> DashboardDesk<S, G, K, D, A>
where
    S: SessionStore,
    G: Memberships,
    K: ApiKeys,
    D: DashboardStore,
    A: AuditTrail,
{
    pub fn new(readers: Readers<S, G, K>, store: D, trail: A) -> Self {
        Self {
            readers,
            store,
            trail,
        }
    }

    pub async fn list(
        &self,
        who: &Reader,
        project: ProjectId,
    ) -> Result<Vec<DashboardSummary>, DashboardError> {
        let scope = self.in_project(project).await?;
        self.may_read(who, scope).await?;
        Ok(self.store.list(scope).await?)
    }

    pub async fn get(&self, who: &Reader, id: DashboardId) -> Result<Dashboard, DashboardError> {
        let scope = self.home_of(id).await?;
        self.may_read(who, scope).await?;
        self.held(scope, id).await
    }

    pub async fn export(
        &self,
        who: &Reader,
        id: DashboardId,
    ) -> Result<DashboardFile, DashboardError> {
        Ok(self.get(who, id).await?.into_file())
    }

    pub async fn create(
        &self,
        token: &SessionToken,
        project: ProjectId,
        file: &DashboardFile,
    ) -> Result<Dashboard, DashboardError> {
        let scope = self.in_project(project).await?;
        let by = self.member(token, scope).await?;
        self.add(scope, by, file, Origin::Created).await
    }

    pub async fn import(
        &self,
        token: &SessionToken,
        project: ProjectId,
        file: &DashboardFile,
    ) -> Result<Dashboard, DashboardError> {
        let scope = self.in_project(project).await?;
        let by = self.member(token, scope).await?;
        self.add(scope, by, file, Origin::Imported).await
    }

    pub async fn replace(
        &self,
        token: &SessionToken,
        id: DashboardId,
        file: &DashboardFile,
    ) -> Result<Dashboard, DashboardError> {
        let scope = self.home_of(id).await?;
        let by = self.member(token, scope).await?;
        let before = self.held(scope, id).await?;
        let saved = match self.store.update(scope, id, by, file).await? {
            DashboardSaving::Saved(saved) => saved,
            DashboardSaving::Missing => return Err(DashboardError::NotFound),
            DashboardSaving::NameTaken => return Err(DashboardError::NameTaken),
        };
        let renamed = (before.name != saved.name).then_some(&before.name);
        self.note(
            scope,
            by,
            Action::DashboardUpdated,
            id,
            Detail::default()
                .with("name", &saved.name)
                .with_maybe("from", renamed)
                .with("project", scope.project),
        )
        .await?;
        Ok(saved)
    }

    pub async fn delete(
        &self,
        token: &SessionToken,
        id: DashboardId,
    ) -> Result<(), DashboardError> {
        let scope = self.home_of(id).await?;
        let by = self.member(token, scope).await?;
        let before = self.held(scope, id).await?;
        if !self.store.delete(scope, id).await? {
            return Err(DashboardError::NotFound);
        }
        self.note(
            scope,
            by,
            Action::DashboardDeleted,
            id,
            Detail::default()
                .with("name", &before.name)
                .with("project", scope.project),
        )
        .await
    }

    pub async fn duplicate(
        &self,
        token: &SessionToken,
        id: DashboardId,
    ) -> Result<Dashboard, DashboardError> {
        let scope = self.home_of(id).await?;
        let by = self.member(token, scope).await?;
        let source = self.held(scope, id).await?;
        let names = self.store.list(scope).await?;
        let name = (1..=u32::try_from(MAX_DASHBOARDS + 1).unwrap_or(u32::MAX))
            .map(|attempt| source.name.copy(attempt))
            .find(|candidate| names.iter().all(|held| &held.name != candidate))
            .ok_or(DashboardError::NameTaken)?;
        let copy = DashboardFile {
            name,
            ..source.into_file()
        };
        self.add(scope, by, &copy, Origin::Cloned(id)).await
    }

    async fn add(
        &self,
        scope: Scope,
        by: AccountId,
        file: &DashboardFile,
        origin: Origin,
    ) -> Result<Dashboard, DashboardError> {
        if self.store.count(scope).await? >= MAX_DASHBOARDS {
            return Err(DashboardError::TooMany(Cap::Dashboards));
        }
        let made = match self.store.create(scope, by, file).await? {
            DashboardCreation::Made(made) => made,
            DashboardCreation::NameTaken => return Err(DashboardError::NameTaken),
        };
        let detail = Detail::default()
            .with("name", &made.name)
            .with("project", scope.project);
        let detail = match origin {
            Origin::Created => detail,
            Origin::Imported => detail.with("via", "import"),
            Origin::Cloned(source) => detail.with("via", "clone").with("from", source),
        };
        self.note(scope, by, Action::DashboardCreated, made.id, detail)
            .await?;
        Ok(made)
    }

    async fn in_project(&self, project: ProjectId) -> Result<Scope, DashboardError> {
        self.store
            .project_scope(project)
            .await?
            .ok_or(DashboardError::NotFound)
    }

    async fn home_of(&self, id: DashboardId) -> Result<Scope, DashboardError> {
        self.store.locate(id).await?.ok_or(DashboardError::NotFound)
    }

    async fn held(&self, scope: Scope, id: DashboardId) -> Result<Dashboard, DashboardError> {
        self.store
            .get(scope, id)
            .await?
            .ok_or(DashboardError::NotFound)
    }

    async fn may_read(&self, who: &Reader, scope: Scope) -> Result<(), DashboardError> {
        let grant = self.readers.grant(who, scope.org).await?;
        grant.narrow(Some(scope.project))?;
        Ok(())
    }

    async fn member(
        &self,
        token: &SessionToken,
        scope: Scope,
    ) -> Result<AccountId, DashboardError> {
        let who = self.readers.whoami().of(token).await?;
        if who.may_act_in(scope.org, OrgRole::Member) {
            Ok(who.account)
        } else {
            Err(DashboardError::NotFound)
        }
    }

    async fn note(
        &self,
        scope: Scope,
        by: AccountId,
        action: Action,
        id: DashboardId,
        detail: Detail,
    ) -> Result<(), DashboardError> {
        Ok(self
            .trail
            .record(&AuditEntry {
                org: scope.org,
                actor: Actor::Account(by),
                action,
                target: Target::dashboard(id),
                detail,
            })
            .await?)
    }
}
