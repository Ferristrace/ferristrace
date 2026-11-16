use std::collections::BTreeMap;
use std::fmt;
use std::sync::Arc;

use axum::Json;
use axum::Router;
use axum::extract::{DefaultBodyLimit, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use ferristrace_application::Stack;
use ferristrace_application::registry::DashboardRepos;
use ferristrace_domain::dashboard::PanelQuery;
use ferristrace_domain::{
    DashboardError, PanelError, PanelQueryError, PanelReader, PanelRequest, PanelResult,
    PanelVariables, ProjectId, Window,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::carried::{NotCarried, reading};
use crate::state::AppState;

const BODY_LIMIT: usize = 128 * 1024;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Asking {
    project: Uuid,
    kind: Value,
    query: Value,
    from_ns: u64,
    to_ns: u64,
    #[serde(default)]
    variables: BTreeMap<String, Vec<String>>,
}

impl Asking {
    fn request(self) -> Result<PanelRequest, DashboardError> {
        let invalid = |what: &str, error: &dyn fmt::Display| {
            DashboardError::Invalid(format!("{what}: {error}"))
        };
        Ok(PanelRequest {
            project: ProjectId::new(self.project),
            kind: serde_json::from_value(self.kind).map_err(|error| invalid("kind", &error))?,
            query: PanelQuery::deserialize(self.query).map_err(|error| invalid("query", &error))?,
            window: Window::new(self.from_ns, self.to_ns)
                .map_err(|error| DashboardError::Invalid(error.to_string()))?,
            variables: PanelVariables::new(self.variables)?,
        })
    }
}

pub struct Panels<S: Stack, R> {
    state: AppState<S>,
    reader: Arc<R>,
}

impl<S: Stack, R> fmt::Debug for Panels<S, R> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.debug_struct("Panels").finish_non_exhaustive()
    }
}

impl<S: Stack, R> Clone for Panels<S, R> {
    fn clone(&self) -> Self {
        Self {
            state: self.state.clone(),
            reader: Arc::clone(&self.reader),
        }
    }
}

pub fn dashboard_query_router<S: Stack, R>(state: AppState<S>, reader: Arc<R>) -> Router
where
    S::Repos: DashboardRepos,
    R: PanelReader + Send + Sync + 'static,
{
    Router::new()
        .route("/api/v1/dashboards/query", post(run::<S, R>))
        .layer(DefaultBodyLimit::max(BODY_LIMIT))
        .with_state(Panels { state, reader })
}

async fn run<S: Stack, R>(
    State(panels): State<Panels<S, R>>,
    headers: HeaderMap,
    Json(asked): Json<Asking>,
) -> Result<Json<PanelResult>, PanelRefused>
where
    S::Repos: DashboardRepos,
    R: PanelReader + Send + Sync + 'static,
{
    let who = reading(&panels.state, &headers).await?;
    let request = asked.request()?;
    let result = panels
        .state
        .app
        .run_panel(&who, &request, panels.reader.as_ref())
        .await?;
    Ok(Json(result))
}

#[derive(Debug, thiserror::Error)]
pub enum PanelRefused {
    #[error(transparent)]
    Reaching(#[from] NotCarried),
    #[error(transparent)]
    Refused(#[from] PanelError),
    #[error(transparent)]
    Malformed(#[from] DashboardError),
}

#[derive(Serialize)]
struct Reason<'a> {
    error: &'static str,
    reason: &'a str,
}

fn invalid(reason: &str) -> Response {
    (
        StatusCode::UNPROCESSABLE_ENTITY,
        Json(Reason {
            error: "invalid",
            reason,
        }),
    )
        .into_response()
}

fn dashboard(refused: DashboardError) -> Response {
    match refused {
        DashboardError::NoSession => NotCarried::NoSession.into_response(),
        DashboardError::NotFound => {
            (StatusCode::NOT_FOUND, Json(json!({"error": "not_found"}))).into_response()
        }
        DashboardError::OutOfScope => (
            StatusCode::FORBIDDEN,
            Json(json!({"error": "out_of_scope"})),
        )
            .into_response(),
        DashboardError::StoreUnreachable => {
            tracing::error!("the dashboards could not be served");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({"error": "unavailable"})),
            )
                .into_response()
        }
        other => invalid(&other.to_string()),
    }
}

fn query(refused: PanelQueryError) -> Response {
    match refused {
        PanelQueryError::Refused(reason) => invalid(reason),
        PanelQueryError::TooManySeries { count, max } => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({"error": "too_many_series", "count": count, "max": max})),
        )
            .into_response(),
        PanelQueryError::Timeout => (
            StatusCode::GATEWAY_TIMEOUT,
            Json(json!({"error": "timeout"})),
        )
            .into_response(),
        PanelQueryError::Store(_) => {
            tracing::error!("a panel query could not reach its store");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({"error": "unavailable"})),
            )
                .into_response()
        }
    }
}

impl IntoResponse for PanelRefused {
    fn into_response(self) -> Response {
        match self {
            Self::Reaching(refused) => refused.into_response(),
            Self::Malformed(refused) | Self::Refused(PanelError::Dashboard(refused)) => {
                dashboard(refused)
            }
            Self::Refused(PanelError::Query(refused)) => query(refused),
        }
    }
}
