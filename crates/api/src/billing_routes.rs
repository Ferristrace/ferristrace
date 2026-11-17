use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, http::header::HeaderValue};
use ferristrace_application::registry::BillingRepos;
use ferristrace_application::{BillingError, BillingRead, Stack, WebhookApplyError};
use ferristrace_domain::{CurrentPlan, PlanOffer, SubscriptionStatus, TenantId};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::carried::{NotCarried, carried};
use crate::state::AppState;

const STRIPE_SIGNATURE: &str = "stripe-signature";

#[derive(Debug, Serialize)]
pub struct Billing {
    plan: PlanView,
    payments: bool,
    upgrade: Option<OfferView>,
    portal: bool,
    owner: bool,
    status: Option<&'static str>,
    period_end_ms: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct PlanView {
    slug: String,
    name: String,
    ingest_gb: Option<u32>,
    retention_days: Option<u32>,
    overage: bool,
}

impl From<CurrentPlan> for PlanView {
    fn from(plan: CurrentPlan) -> Self {
        Self {
            slug: plan.slug.as_str().to_owned(),
            name: plan.name.into(),
            ingest_gb: plan.ingest_gb,
            retention_days: plan.retention_days,
            overage: plan.overage,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct OfferView {
    slug: String,
    name: String,
}

impl From<PlanOffer> for OfferView {
    fn from(offer: PlanOffer) -> Self {
        Self {
            slug: offer.slug.as_str().to_owned(),
            name: offer.name.into(),
        }
    }
}

impl From<BillingRead> for Billing {
    fn from(read: BillingRead) -> Self {
        Self {
            plan: read.plan.into(),
            payments: read.payments,
            upgrade: read.upgrade.map(OfferView::from),
            portal: read.portal,
            owner: read.owner,
            status: read.status.map(SubscriptionStatus::as_str),
            period_end_ms: read.period_end.map(|seconds| seconds.saturating_mul(1000)),
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct Checkout {
    plan: String,
    success_url: String,
    cancel_url: String,
}

#[derive(Debug, Deserialize)]
pub struct Portal {
    return_url: String,
}

#[derive(Debug, Serialize)]
pub struct Url {
    url: String,
}

pub fn billing_router<S: Stack>(state: AppState<S>) -> Router
where
    S::Repos: BillingRepos,
{
    Router::new()
        .route("/api/orgs/{org}/billing", get(billing::<S>))
        .route("/api/orgs/{org}/billing/checkout", post(checkout::<S>))
        .route("/api/orgs/{org}/billing/portal", post(portal::<S>))
        .route("/api/billing/webhook", post(webhook::<S>))
        .with_state(state)
}

async fn billing<S: Stack>(
    State(state): State<AppState<S>>,
    Path(org): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<Billing>, BillingRefused>
where
    S::Repos: BillingRepos,
{
    let token = carried(&state, &headers).await?;
    let read = state.app.billing_status(&token, TenantId::new(org)).await?;
    Ok(Json(read.into()))
}

async fn checkout<S: Stack>(
    State(state): State<AppState<S>>,
    Path(org): Path<Uuid>,
    headers: HeaderMap,
    Json(asked): Json<Checkout>,
) -> Result<Json<Url>, BillingRefused>
where
    S::Repos: BillingRepos,
{
    let token = carried(&state, &headers).await?;
    let url = state
        .app
        .start_checkout(
            &token,
            TenantId::new(org),
            &asked.plan,
            &asked.success_url,
            &asked.cancel_url,
        )
        .await?;
    Ok(Json(Url {
        url: url.as_str().to_owned(),
    }))
}

async fn portal<S: Stack>(
    State(state): State<AppState<S>>,
    Path(org): Path<Uuid>,
    headers: HeaderMap,
    Json(asked): Json<Portal>,
) -> Result<Json<Url>, BillingRefused>
where
    S::Repos: BillingRepos,
{
    let token = carried(&state, &headers).await?;
    let url = state
        .app
        .open_portal(&token, TenantId::new(org), &asked.return_url)
        .await?;
    Ok(Json(Url {
        url: url.as_str().to_owned(),
    }))
}

async fn webhook<S: Stack>(
    State(state): State<AppState<S>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, WebhookRefused>
where
    S::Repos: BillingRepos,
{
    if !state.app.billing_enabled() {
        return Err(WebhookRefused::NotConfigured);
    }
    let signature = signature_of(&headers).ok_or(WebhookRefused::BadSignature)?;
    state.app.apply_webhook(signature, &body).await?;
    Ok(StatusCode::OK)
}

fn signature_of(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(STRIPE_SIGNATURE)
        .map(HeaderValue::to_str)
        .and_then(Result::ok)
}

#[derive(Debug, thiserror::Error)]
pub enum BillingRefused {
    #[error(transparent)]
    Reaching(#[from] NotCarried),
    #[error("no billing adapter is configured")]
    NotConfigured,
    #[error("this organisation has never started checkout")]
    NoSubscription,
    #[error("no plan with this slug can be bought")]
    NoSuchOffer,
    #[error("no such organisation")]
    NoSuchOrg,
    #[error("only an owner manages billing")]
    NotOwner,
    #[error("the billing gateway could not be reached")]
    Unreachable,
}

impl From<BillingError> for BillingRefused {
    fn from(error: BillingError) -> Self {
        match error {
            BillingError::NoSession => Self::Reaching(NotCarried::NoSession),
            BillingError::NotYours | BillingError::NoSuchOrg => Self::NoSuchOrg,
            BillingError::NotConfigured => Self::NotConfigured,
            BillingError::NoSubscription => Self::NoSubscription,
            BillingError::NoSuchOffer => Self::NoSuchOffer,
            BillingError::NotOwner => Self::NotOwner,
            BillingError::Gateway(_) | BillingError::StoreUnreachable => Self::Unreachable,
        }
    }
}

impl IntoResponse for BillingRefused {
    fn into_response(self) -> Response {
        let status = match self {
            Self::Reaching(refused) => return refused.into_response(),
            Self::NotConfigured | Self::NoSuchOrg | Self::NoSubscription | Self::NoSuchOffer => {
                StatusCode::NOT_FOUND
            }
            Self::NotOwner => StatusCode::FORBIDDEN,
            Self::Unreachable => StatusCode::SERVICE_UNAVAILABLE,
        };
        if status.is_server_error() {
            tracing::error!(error = %self, "billing could not be served");
        }
        (status, self.to_string()).into_response()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum WebhookRefused {
    #[error("no billing adapter is configured")]
    NotConfigured,
    #[error("the webhook could not be verified")]
    BadSignature,
    #[error("the control plane refused the subscription store")]
    Unreachable,
}

impl From<WebhookApplyError> for WebhookRefused {
    fn from(error: WebhookApplyError) -> Self {
        match error {
            WebhookApplyError::NotConfigured => Self::NotConfigured,
            WebhookApplyError::Verify(_) => Self::BadSignature,
            WebhookApplyError::StoreUnreachable => Self::Unreachable,
        }
    }
}

impl IntoResponse for WebhookRefused {
    fn into_response(self) -> Response {
        let status = match self {
            Self::NotConfigured => StatusCode::NOT_FOUND,
            Self::BadSignature => StatusCode::BAD_REQUEST,
            Self::Unreachable => StatusCode::SERVICE_UNAVAILABLE,
        };
        if status.is_server_error() {
            tracing::error!(error = %self, "a stripe webhook could not be applied");
        }
        (status, self.to_string()).into_response()
    }
}
