use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use news_shared::db;
use news_shared::error::AppResult;
use news_shared::telemetry::render_metrics;

use crate::state::AppState;

pub async fn health(State(state): State<AppState>) -> (StatusCode, Json<serde_json::Value>) {
    let database = db::db_ping(&state.pool).await;
    let redis = state.redis.ping().await;
    let kafka = state.bus.health().await;
    let healthy = database && redis && kafka;
    let status = if healthy { "ok" } else { "degraded" };
    let code = if healthy {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (code, Json(serde_json::json!({ "status": status })))
}

pub async fn metrics(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !state.config.metrics_public {
        let provided = headers
            .get("x-metrics-token")
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default();
        let expected = state.config.metrics_token.as_deref().unwrap_or_default();
        if expected.is_empty() || provided != expected {
            return (StatusCode::NOT_FOUND, "not found").into_response();
        }
    }
    (
        StatusCode::OK,
        [("content-type", "text/plain; version=0.0.4; charset=utf-8")],
        render_metrics(),
    )
        .into_response()
}

pub async fn ready(State(state): State<AppState>) -> AppResult<StatusCode> {
    if db::db_ping(&state.pool).await {
        Ok(StatusCode::OK)
    } else {
        Ok(StatusCode::SERVICE_UNAVAILABLE)
    }
}
