use ferristrace_domain::{
    DashboardError, DashboardScope, PanelDesk, PanelError, PanelReader, PanelRequest, PanelResult,
    Reader, Readers, Whoami,
};

use crate::registry::DashboardRepos;
use crate::{Ferristrace, Stack, transactional};

impl<S: Stack> Ferristrace<S>
where
    S::Repos: DashboardRepos,
{
    #[transactional(sessions, memberships, api_keys, dashboards, unavailable = PanelError::Dashboard(DashboardError::StoreUnreachable))]
    async fn admit_panel(
        &self,
        who: &Reader,
        request: &PanelRequest,
    ) -> Result<DashboardScope, PanelError> {
        PanelDesk::new(
            Readers::new(Whoami::new(sessions, memberships), api_keys),
            dashboards,
        )
        .admit(who, request)
        .await
    }

    pub async fn run_panel<R: PanelReader + Sync>(
        &self,
        who: &Reader,
        request: &PanelRequest,
        reader: &R,
    ) -> Result<PanelResult, PanelError> {
        let scope = self.admit_panel(who, request).await?;
        let result = reader
            .run(
                scope,
                &request.query,
                request.kind,
                request.window,
                &request.variables,
            )
            .await?;
        request.accepts(result)
    }
}
