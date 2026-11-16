use core::future::Future;

use super::errors::{DashboardError, invalid};
use super::labels::clashing_label;
use super::ports::{DashboardStore, Scope};
use super::query::PanelQuery;
use super::result::{PanelError, PanelResult, QueryError};
use super::value_objects::{PanelKind, ResultShape};
use super::variables::Variables;
use crate::access::{ApiKeys, Reader, Readers};
use crate::catalogue::ProjectId;
use crate::explore::Window;
use crate::identity::SessionStore;
use crate::organisation::Memberships;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PanelRequest {
    pub project: ProjectId,
    pub kind: PanelKind,
    pub query: PanelQuery,
    pub window: Window,
    pub variables: Variables,
}

impl PanelRequest {
    pub fn accepts(&self, result: PanelResult) -> Result<PanelResult, PanelError> {
        if result.shape() == self.kind.result_shape() {
            Ok(result)
        } else {
            Err(QueryError::Refused("the reader returned a shape the panel does not take").into())
        }
    }
}

pub trait PanelReader {
    fn run(
        &self,
        scope: Scope,
        query: &PanelQuery,
        kind: PanelKind,
        window: Window,
        variables: &Variables,
    ) -> impl Future<Output = Result<PanelResult, QueryError>> + Send;
}

impl<T: PanelReader + Sync> PanelReader for &T {
    fn run(
        &self,
        scope: Scope,
        query: &PanelQuery,
        kind: PanelKind,
        window: Window,
        variables: &Variables,
    ) -> impl Future<Output = Result<PanelResult, QueryError>> + Send {
        (*self).run(scope, query, kind, window, variables)
    }
}

#[derive(Debug)]
pub struct PanelDesk<S, G, K, D> {
    readers: Readers<S, G, K>,
    store: D,
}

impl<S, G, K, D> PanelDesk<S, G, K, D>
where
    S: SessionStore,
    G: Memberships,
    K: ApiKeys,
    D: DashboardStore,
{
    pub fn new(readers: Readers<S, G, K>, store: D) -> Self {
        Self { readers, store }
    }

    pub async fn admit(&self, who: &Reader, request: &PanelRequest) -> Result<Scope, PanelError> {
        let scope = self
            .store
            .project_scope(request.project)
            .await
            .map_err(DashboardError::from)?
            .ok_or(DashboardError::NotFound)?;
        let grant = self
            .readers
            .grant(who, scope.org)
            .await
            .map_err(DashboardError::from)?;
        grant
            .narrow(Some(scope.project))
            .map_err(DashboardError::from)?;
        let shape = request.kind.result_shape();
        if shape == ResultShape::None {
            return Err(invalid(format!("a {} panel runs no query", request.kind)).into());
        }
        if !request.query.can_yield(shape) {
            return Err(invalid(format!(
                "this query cannot feed a {} panel: it does not return {shape:?}",
                request.kind
            ))
            .into());
        }
        if let Some(label) = clashing_label(&request.query) {
            return Err(invalid(format!(
                "the label `{label}` names two columns of this query: group by a field \
                 or an attribute once, and not under the name of an aggregation"
            ))
            .into());
        }
        if let Some(filter) = request.query.filter() {
            request.variables.resolve(filter)?;
        }
        Ok(scope)
    }
}
