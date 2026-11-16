use axum::Json;
use axum::Router;
use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::http::header::{CONTENT_DISPOSITION, HeaderValue};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use ferristrace_application::Stack;
use ferristrace_application::registry::DashboardRepos;
use ferristrace_domain::{
    AccountId, Dashboard, DashboardDoc, DashboardError, DashboardFile, DashboardId, DashboardName,
    DashboardSummary, DashboardTags, ProjectId,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::carried::{NotCarried, carried, reading};
use crate::state::AppState;

const NANOS_PER_MILLI: u64 = 1_000_000;

#[derive(Debug, Serialize)]
pub struct Listed {
    dashboards: Vec<Summary>,
}

#[derive(Debug, Serialize)]
struct Summary {
    id: Uuid,
    name: DashboardName,
    tags: DashboardTags,
    updated_by: Option<Uuid>,
    updated_at_ms: u64,
}

impl From<DashboardSummary> for Summary {
    fn from(summary: DashboardSummary) -> Self {
        Self {
            id: summary.id.as_uuid(),
            name: summary.name,
            tags: summary.tags,
            updated_by: summary.updated_by.map(AccountId::as_uuid),
            updated_at_ms: summary.updated_at_unix_nanos / NANOS_PER_MILLI,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct Shown {
    id: Uuid,
    project: Uuid,
    name: DashboardName,
    tags: DashboardTags,
    doc: DashboardDoc,
    updated_by: Option<Uuid>,
    created_at_ms: u64,
    updated_at_ms: u64,
}

impl From<Dashboard> for Shown {
    fn from(dashboard: Dashboard) -> Self {
        Self {
            id: dashboard.id.as_uuid(),
            project: dashboard.project.as_uuid(),
            name: dashboard.name,
            tags: dashboard.tags,
            doc: dashboard.doc,
            updated_by: dashboard.updated_by.map(AccountId::as_uuid),
            created_at_ms: dashboard.created_at_unix_nanos / NANOS_PER_MILLI,
            updated_at_ms: dashboard.updated_at_unix_nanos / NANOS_PER_MILLI,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct Listing {
    project: Uuid,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Creating {
    project: Uuid,
    name: String,
    #[serde(default)]
    tags: Vec<String>,
    doc: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Replacing {
    name: String,
    #[serde(default)]
    tags: Vec<String>,
    doc: serde_json::Value,
}

const BODY_LIMIT: usize = 300 * 1024;

pub fn dashboard_router<S: Stack>(state: AppState<S>) -> Router
where
    S::Repos: DashboardRepos,
{
    Router::new()
        .route("/api/v1/dashboards", get(list::<S>).post(create::<S>))
        .route("/api/v1/dashboards/import", post(import::<S>))
        .route(
            "/api/v1/dashboards/{id}",
            get(one::<S>).put(replace::<S>).delete(remove::<S>),
        )
        .route("/api/v1/dashboards/{id}/clone", post(duplicate::<S>))
        .route("/api/v1/dashboards/{id}/export", get(export::<S>))
        .layer(DefaultBodyLimit::max(BODY_LIMIT))
        .with_state(state)
}

async fn list<S: Stack>(
    State(state): State<AppState<S>>,
    Query(listing): Query<Listing>,
    headers: HeaderMap,
) -> Result<Json<Listed>, DashboardRefused>
where
    S::Repos: DashboardRepos,
{
    let who = reading(&state, &headers).await?;
    let found = state
        .app
        .list_dashboards(&who, ProjectId::new(listing.project))
        .await?;
    Ok(Json(Listed {
        dashboards: found.into_iter().map(Summary::from).collect(),
    }))
}

async fn create<S: Stack>(
    State(state): State<AppState<S>>,
    headers: HeaderMap,
    Json(asked): Json<Creating>,
) -> Result<(StatusCode, Json<Shown>), DashboardRefused>
where
    S::Repos: DashboardRepos,
{
    let token = carried(&state, &headers).await?;
    let file = DashboardFile::parse(&asked.name, &asked.tags, asked.doc)?;
    let made = state
        .app
        .create_dashboard(&token, ProjectId::new(asked.project), &file)
        .await?;
    tracing::info!(dashboard = %made.id, project = %made.project, "a dashboard was created");
    Ok((StatusCode::CREATED, Json(made.into())))
}

async fn import<S: Stack>(
    State(state): State<AppState<S>>,
    Query(listing): Query<Listing>,
    headers: HeaderMap,
    Json(exported): Json<serde_json::Value>,
) -> Result<(StatusCode, Json<Shown>), DashboardRefused>
where
    S::Repos: DashboardRepos,
{
    let token = carried(&state, &headers).await?;
    let file = DashboardFile::from_value(exported)?;
    let made = state
        .app
        .import_dashboard(&token, ProjectId::new(listing.project), &file)
        .await?;
    tracing::info!(dashboard = %made.id, project = %made.project, "a dashboard was imported");
    Ok((StatusCode::CREATED, Json(made.into())))
}

async fn one<S: Stack>(
    State(state): State<AppState<S>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<Shown>, DashboardRefused>
where
    S::Repos: DashboardRepos,
{
    let who = reading(&state, &headers).await?;
    let found = state.app.dashboard(&who, DashboardId::new(id)).await?;
    Ok(Json(found.into()))
}

async fn replace<S: Stack>(
    State(state): State<AppState<S>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(asked): Json<Replacing>,
) -> Result<Json<Shown>, DashboardRefused>
where
    S::Repos: DashboardRepos,
{
    let token = carried(&state, &headers).await?;
    let file = DashboardFile::parse(&asked.name, &asked.tags, asked.doc)?;
    let saved = state
        .app
        .replace_dashboard(&token, DashboardId::new(id), &file)
        .await?;
    Ok(Json(saved.into()))
}

async fn remove<S: Stack>(
    State(state): State<AppState<S>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<StatusCode, DashboardRefused>
where
    S::Repos: DashboardRepos,
{
    let token = carried(&state, &headers).await?;
    state
        .app
        .delete_dashboard(&token, DashboardId::new(id))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn duplicate<S: Stack>(
    State(state): State<AppState<S>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<(StatusCode, Json<Shown>), DashboardRefused>
where
    S::Repos: DashboardRepos,
{
    let token = carried(&state, &headers).await?;
    let made = state
        .app
        .clone_dashboard(&token, DashboardId::new(id))
        .await?;
    Ok((StatusCode::CREATED, Json(made.into())))
}

async fn export<S: Stack>(
    State(state): State<AppState<S>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Response, DashboardRefused>
where
    S::Repos: DashboardRepos,
{
    let who = reading(&state, &headers).await?;
    let file = state
        .app
        .export_dashboard(&who, DashboardId::new(id))
        .await?;
    let attachment = format!("attachment; filename=\"{}.json\"", slug(file.name.as_str()));
    let disposition = HeaderValue::from_str(&attachment)
        .unwrap_or_else(|_| HeaderValue::from_static("attachment; filename=\"dashboard.json\""));
    Ok(([(CONTENT_DISPOSITION, disposition)], Json(file)).into_response())
}

fn slug(name: &str) -> String {
    let dashed: String = name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = dashed.trim_matches('-');
    if trimmed.is_empty() {
        "dashboard".to_owned()
    } else {
        trimmed.to_owned()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum DashboardRefused {
    #[error(transparent)]
    Reaching(#[from] NotCarried),
    #[error(transparent)]
    Refused(#[from] DashboardError),
}

impl IntoResponse for DashboardRefused {
    fn into_response(self) -> Response {
        let refused = match self {
            Self::Reaching(refused) => return refused.into_response(),
            Self::Refused(DashboardError::NoSession) => {
                return NotCarried::NoSession.into_response();
            }
            Self::Refused(refused) => refused,
        };
        let status = match refused {
            DashboardError::NotFound => StatusCode::NOT_FOUND,
            DashboardError::NameTaken => StatusCode::CONFLICT,
            DashboardError::TooLarge
            | DashboardError::TooMany(_)
            | DashboardError::UnknownSchema
            | DashboardError::Invalid(_) => StatusCode::UNPROCESSABLE_ENTITY,
            DashboardError::OutOfScope => StatusCode::FORBIDDEN,
            DashboardError::NoSession => StatusCode::UNAUTHORIZED,
            DashboardError::StoreUnreachable => StatusCode::SERVICE_UNAVAILABLE,
        };
        if status.is_server_error() {
            tracing::error!(error = %refused, "the dashboards could not be served");
        }
        (status, refused.to_string()).into_response()
    }
}
