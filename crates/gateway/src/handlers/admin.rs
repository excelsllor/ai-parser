use axum::extract::{Extension, Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use news_shared::audit::{write_audit, AuditRecord};
use news_shared::auth::AuthUser;
use news_shared::db;
use news_shared::error::{AppError, AppResult};
use news_shared::models::UserResponse;
use news_shared::security::{
    validate_password, validate_public_url, validate_role, validate_source_kind, validate_trust,
    validate_username,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::handlers::auth::fetch_user;
use crate::handlers::runs::Pagination;
use crate::middleware::{request_ip, ClientIp};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct CreateUserRequest {
    pub username: String,
    pub password: String,
    pub role: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateUserRequest {
    pub role: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct CreateSourceRequest {
    pub name: String,
    pub kind: String,
    pub url: String,
    pub trust: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ToggleSourceRequest {
    pub enabled: bool,
}

#[derive(Debug, Deserialize)]
pub struct CreateKeywordRequest {
    pub word: String,
}

#[derive(Debug, Deserialize)]
pub struct SettingRequest {
    pub key: String,
    pub value: Value,
}

pub async fn list_users(
    State(state): State<AppState>,
    user: AuthUser,
) -> AppResult<Json<Vec<UserResponse>>> {
    user.require_admin()?;
    let users = db::list_users(&state.pool).await?;
    Ok(Json(users.into_iter().map(UserResponse::from).collect()))
}

pub async fn create_user(
    State(state): State<AppState>,
    user: AuthUser,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    Json(payload): Json<CreateUserRequest>,
) -> AppResult<(StatusCode, Json<UserResponse>)> {
    user.require_admin()?;
    validate_username(&payload.username)?;
    validate_password(&payload.password)?;
    let role = payload.role.unwrap_or_else(|| "viewer".to_string());
    validate_role(&role)?;

    let hash = news_shared::auth::hash_password(&payload.password)?;
    let created =
        db::create_user(&state.pool, &payload.username.to_lowercase(), &hash, &role).await?;

    let _ = write_audit(
        &state.pool,
        &AuditRecord::new(
            Some(user.id),
            user.username.clone(),
            "admin.user.create",
            format!("user:{}", created.id),
            json!({"username": created.username, "role": created.role}),
            ip,
        ),
    )
    .await;

    Ok((StatusCode::CREATED, Json(UserResponse::from(created))))
}

pub async fn update_user(
    State(state): State<AppState>,
    user: AuthUser,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    Path(user_id): Path<Uuid>,
    Json(payload): Json<UpdateUserRequest>,
) -> AppResult<Json<UserResponse>> {
    user.require_admin()?;
    if let Some(role) = &payload.role {
        validate_role(role)?;
        if user_id == user.id && role != "admin" {
            return Err(AppError::BadRequest(
                "cannot demote your own administrator account".into(),
            ));
        }
        db::set_user_role(&state.pool, user_id, role).await?;
    }
    if let Some(active) = payload.is_active {
        if user_id == user.id && !active {
            return Err(AppError::BadRequest(
                "cannot disable your own account".into(),
            ));
        }
        db::set_user_active(&state.pool, user_id, active).await?;
    }
    let updated = fetch_user(&state.pool, user_id).await?;

    let _ = write_audit(
        &state.pool,
        &AuditRecord::new(
            Some(user.id),
            user.username.clone(),
            "admin.user.update",
            format!("user:{user_id}"),
            json!({"role": payload.role, "is_active": payload.is_active}),
            ip,
        ),
    )
    .await;

    Ok(Json(UserResponse::from(updated)))
}

pub async fn delete_user(
    State(state): State<AppState>,
    user: AuthUser,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    Path(user_id): Path<Uuid>,
) -> AppResult<Json<Value>> {
    user.require_admin()?;
    if user_id == user.id {
        return Err(AppError::BadRequest(
            "cannot disable your own account".into(),
        ));
    }
    db::set_user_active(&state.pool, user_id, false).await?;
    let _ = write_audit(
        &state.pool,
        &AuditRecord::new(
            Some(user.id),
            user.username.clone(),
            "admin.user.disable",
            format!("user:{user_id}"),
            json!({}),
            ip,
        ),
    )
    .await;
    Ok(Json(json!({"ok": true})))
}

pub async fn list_sources(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    user.require_admin()?;
    let sources = db::list_sources(&state.pool).await?;
    Ok(Json(json!(sources)))
}

pub async fn create_source(
    State(state): State<AppState>,
    user: AuthUser,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    Json(payload): Json<CreateSourceRequest>,
) -> AppResult<(StatusCode, Json<Value>)> {
    user.require_admin()?;
    validate_source_kind(&payload.kind)?;
    let trust = payload.trust.unwrap_or_else(|| "unknown".to_string());
    validate_trust(&trust)?;
    let _ = validate_public_url(&payload.url, &[]).await?;

    let source = db::create_source(
        &state.pool,
        payload.name.trim(),
        &payload.kind,
        payload.url.trim(),
        &trust,
    )
    .await?;

    let _ = write_audit(
        &state.pool,
        &AuditRecord::new(
            Some(user.id),
            user.username.clone(),
            "admin.source.create",
            format!("source:{}", source.id),
            json!({"name": source.name, "url": source.url}),
            ip,
        ),
    )
    .await;

    Ok((StatusCode::CREATED, Json(json!(source))))
}

pub async fn toggle_source(
    State(state): State<AppState>,
    user: AuthUser,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    Path(source_id): Path<Uuid>,
    Json(payload): Json<ToggleSourceRequest>,
) -> AppResult<Json<Value>> {
    user.require_admin()?;
    db::set_source_enabled(&state.pool, source_id, payload.enabled).await?;
    let _ = write_audit(
        &state.pool,
        &AuditRecord::new(
            Some(user.id),
            user.username.clone(),
            "admin.source.toggle",
            format!("source:{source_id}"),
            json!({"enabled": payload.enabled}),
            ip,
        ),
    )
    .await;
    Ok(Json(json!({"ok": true})))
}

pub async fn delete_source(
    State(state): State<AppState>,
    user: AuthUser,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    Path(source_id): Path<Uuid>,
) -> AppResult<Json<Value>> {
    user.require_admin()?;
    db::delete_source(&state.pool, source_id).await?;
    let _ = write_audit(
        &state.pool,
        &AuditRecord::new(
            Some(user.id),
            user.username.clone(),
            "admin.source.delete",
            format!("source:{source_id}"),
            json!({}),
            ip,
        ),
    )
    .await;
    Ok(Json(json!({"ok": true})))
}

pub async fn list_keywords(
    State(state): State<AppState>,
    user: AuthUser,
) -> AppResult<Json<Value>> {
    user.require_admin()?;
    let keywords = db::list_keywords(&state.pool).await?;
    Ok(Json(json!(keywords)))
}

pub async fn create_keyword(
    State(state): State<AppState>,
    user: AuthUser,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    Json(payload): Json<CreateKeywordRequest>,
) -> AppResult<(StatusCode, Json<Value>)> {
    user.require_admin()?;
    let word = payload.word.trim();
    if word.is_empty() || word.len() > 100 {
        return Err(AppError::BadRequest("invalid keyword".into()));
    }
    let keyword = db::create_keyword(&state.pool, word).await?;
    let _ = write_audit(
        &state.pool,
        &AuditRecord::new(
            Some(user.id),
            user.username.clone(),
            "admin.keyword.create",
            format!("keyword:{}", keyword.id),
            json!({"word": keyword.word}),
            ip,
        ),
    )
    .await;
    Ok((StatusCode::CREATED, Json(json!(keyword))))
}

pub async fn delete_keyword(
    State(state): State<AppState>,
    user: AuthUser,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    Path(keyword_id): Path<Uuid>,
) -> AppResult<Json<Value>> {
    user.require_admin()?;
    db::delete_keyword(&state.pool, keyword_id).await?;
    let _ = write_audit(
        &state.pool,
        &AuditRecord::new(
            Some(user.id),
            user.username.clone(),
            "admin.keyword.delete",
            format!("keyword:{keyword_id}"),
            json!({}),
            ip,
        ),
    )
    .await;
    Ok(Json(json!({"ok": true})))
}

pub async fn get_settings(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    user.require_admin()?;
    let keys = ["weights", "model", "prompt_version", "selection"];
    let mut out = serde_json::Map::new();
    for key in keys {
        if let Some(value) = db::get_setting(&state.pool, key).await? {
            out.insert(key.to_string(), value);
        }
    }
    Ok(Json(json!({
        "settings": out,
        "effective": {
            "model": state.config.llm.model,
            "prompt_version": state.config.prompt_version,
            "weights": {
                "impact": state.config.weights.impact,
                "scale": state.config.weights.scale,
                "urgency": state.config.weights.urgency,
                "relevance": state.config.weights.relevance,
                "confidence": state.config.weights.confidence,
                "uncertainty_penalty": state.config.weights.uncertainty_penalty,
            },
            "env": state.config.env_name,
        }
    })))
}

pub async fn put_setting(
    State(state): State<AppState>,
    user: AuthUser,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    Json(payload): Json<SettingRequest>,
) -> AppResult<Json<Value>> {
    user.require_admin()?;
    let allowed = ["weights", "model", "prompt_version", "selection"];
    if !allowed.contains(&payload.key.as_str()) {
        return Err(AppError::BadRequest("unknown setting".into()));
    }
    db::set_setting(&state.pool, &payload.key, payload.value.clone()).await?;
    let _ = write_audit(
        &state.pool,
        &AuditRecord::new(
            Some(user.id),
            user.username.clone(),
            "admin.setting.update",
            format!("setting:{}", payload.key),
            json!({"key": payload.key}),
            ip,
        ),
    )
    .await;
    Ok(Json(json!({"ok": true})))
}

pub async fn audit(
    State(state): State<AppState>,
    user: AuthUser,
    Query(pagination): Query<Pagination>,
) -> AppResult<Json<Value>> {
    user.require_admin()?;
    let rows = db::list_audit(
        &state.pool,
        pagination.limit.unwrap_or(100),
        pagination.offset.unwrap_or(0),
    )
    .await?;
    Ok(Json(json!(rows)))
}

pub async fn debug_run(
    State(state): State<AppState>,
    user: AuthUser,
    Path(run_id): Path<Uuid>,
) -> AppResult<Json<Value>> {
    user.require_admin()?;
    let run = db::get_run(&state.pool, run_id).await?;
    let items = db::get_items(&state.pool, run_id).await?;
    let stages = db::get_stages(&state.pool, run_id).await?;
    let llm = db::list_llm_calls(&state.pool, Some(run_id), 200).await?;
    let checks = db::get_check_results(&state.pool, run_id).await?;
    let events = db::get_events(&state.pool, run_id).await?;
    Ok(Json(json!({
        "run": run,
        "stages": stages,
        "items": items,
        "llm_calls": llm,
        "checks": checks,
        "events": events,
    })))
}

pub async fn debug_llm_calls(
    State(state): State<AppState>,
    user: AuthUser,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> AppResult<Json<Value>> {
    user.require_admin()?;
    let run_id = params.get("run_id").and_then(|v| Uuid::parse_str(v).ok());
    let calls = db::list_llm_calls(&state.pool, run_id, 200).await?;
    Ok(Json(json!(calls)))
}

pub async fn debug_services(
    State(state): State<AppState>,
    user: AuthUser,
) -> AppResult<Json<Value>> {
    user.require_admin()?;
    let db_ok = db::db_ping(&state.pool).await;
    let redis_latency = state.redis.health_latency().await;
    let kafka_ok = state.bus.health().await;
    let llm_ok = state.llm.health().await;

    Ok(Json(json!({
        "registry": news_shared::registry::read_services(&state.config.data_dir),
        "database": {"ok": db_ok},
        "redis": {"ok": redis_latency.is_some(), "latency_ms": redis_latency.map(|d| d.as_millis())},
        "kafka": {"ok": kafka_ok, "brokers": state.bus.brokers()},
        "llm": {"ok": llm_ok, "model": state.config.llm.model},
        "env": state.config.env_name,
        "version": env!("CARGO_PKG_VERSION"),
    })))
}

pub async fn debug_kafka(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    user.require_admin()?;
    Ok(Json(json!({
        "brokers": state.bus.brokers(),
        "healthy": state.bus.health().await,
    })))
}

pub async fn debug_redis(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    user.require_admin()?;
    let latency = state.redis.health_latency().await;
    Ok(Json(json!({
        "healthy": latency.is_some(),
        "latency_ms": latency.map(|d| d.as_millis()),
    })))
}

#[allow(dead_code)]
fn _ip(extensions: &axum::http::Extensions) -> String {
    request_ip(extensions)
}
