use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Instant;

use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, Request};
use axum::middleware::Next;
use axum::response::Response;
use news_shared::auth::{decode_access_token, AuthUser};
use news_shared::error::{AppError, AppResult};
use news_shared::models::User;
use news_shared::security::client_ip;
use news_shared::telemetry::metrics;

use crate::state::AppState;

#[derive(Clone, Debug)]
pub struct ClientIp(pub String);

pub async fn client_ip_middleware(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    mut request: Request<axum::body::Body>,
    next: Next,
) -> Response {
    let headers = request.headers().clone();
    let ip = client_ip(&headers, Some(peer), state.config.trust_proxy_headers);
    request.extensions_mut().insert(ClientIp(ip));
    next.run(request).await
}

pub async fn auth_middleware(
    State(state): State<AppState>,
    mut request: Request<axum::body::Body>,
    next: Next,
) -> AppResult<Response> {
    let token = bearer_token(request.headers())
        .ok_or_else(|| AppError::Unauthorized("missing bearer token".into()))?;
    let claims = decode_access_token(&state.config, token)?;
    let auth_user = AuthUser::from_claims(&claims)?;

    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1 AND is_active = TRUE")
        .bind(auth_user.id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::Unauthorized("user is disabled or missing".into()))?;

    let auth_user = AuthUser {
        id: user.id,
        username: user.username,
        role: news_shared::models::Role::parse(&user.role)
            .ok_or_else(|| AppError::Unauthorized("invalid role".into()))?,
    };
    request.extensions_mut().insert(auth_user);
    Ok(next.run(request).await)
}

pub async fn rate_limit_middleware(
    State(state): State<AppState>,
    request: Request<axum::body::Body>,
    next: Next,
) -> AppResult<Response> {
    let ip = request
        .extensions()
        .get::<ClientIp>()
        .map(|ip| ip.0.clone())
        .unwrap_or_else(|| "unknown".to_string());
    let path = normalize_path(request.uri().path());
    let key = format!("ratelimit:api:{}:{}", ip, path);
    let allowed = state
        .redis
        .rate_limit(&key, 600, 60)
        .await
        .unwrap_or_else(|e| {
            tracing::warn!(error = %e, "redis rate limit unavailable, allowing request");
            true
        });
    if !allowed {
        return Err(AppError::RateLimited("too many requests".into()));
    }
    Ok(next.run(request).await)
}

pub async fn metrics_middleware(request: Request<axum::body::Body>, next: Next) -> Response {
    let method = request.method().to_string();
    let path = normalize_path(request.uri().path());
    let start = Instant::now();
    let response = next.run(request).await;
    let status = response.status().as_u16().to_string();
    let elapsed = start.elapsed().as_secs_f64();
    let m = metrics();
    m.http_requests
        .with_label_values(&[&method, &path, &status])
        .inc();
    m.http_latency
        .with_label_values(&[&method, &path])
        .observe(elapsed);
    response
}

pub fn normalize_path(path: &str) -> String {
    let segments: Vec<&str> = path
        .split('/')
        .map(|segment| {
            if uuid::Uuid::parse_str(segment).is_ok() {
                ":id"
            } else {
                segment
            }
        })
        .collect();
    segments.join("/")
}

pub fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    let value = headers
        .get(axum::http::header::AUTHORIZATION)?
        .to_str()
        .ok()?;
    value.strip_prefix("Bearer ").map(str::trim)
}

pub fn request_ip(extensions: &axum::http::Extensions) -> String {
    extensions
        .get::<ClientIp>()
        .map(|ip| ip.0.clone())
        .unwrap_or_default()
}

#[allow(dead_code)]
pub fn state_arc(state: &AppState) -> Arc<AppState> {
    Arc::new(state.clone())
}
