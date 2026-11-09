use axum::extract::{Extension, Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::Utc;
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
use crate::handlers::telegram::{validate_bot_token, validate_chat_id};
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

#[derive(Debug, Deserialize)]
pub struct MetricsQuery {
    #[serde(default)]
    pub hours: Option<i64>,
}

pub async fn metrics(
    State(state): State<AppState>,
    user: AuthUser,
    Query(query): Query<MetricsQuery>,
) -> AppResult<Json<Value>> {
    user.require_admin()?;
    let hours = query.hours.unwrap_or(24).clamp(1, 720);
    let since = Utc::now() - chrono::Duration::hours(hours);

    let (total, completed, failed, cancelled, running, queued, avg_duration): (
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        Option<f64>,
    ) = sqlx::query_as(
        "SELECT
            count(*)::bigint,
            count(*) FILTER (WHERE status = 'completed')::bigint,
            count(*) FILTER (WHERE status = 'failed')::bigint,
            count(*) FILTER (WHERE status = 'cancelled')::bigint,
            count(*) FILTER (WHERE status = 'running')::bigint,
            count(*) FILTER (WHERE status = 'queued')::bigint,
            (avg(extract(epoch FROM (finished_at - created_at)))
                FILTER (WHERE status = 'completed' AND finished_at IS NOT NULL))::double precision
         FROM runs WHERE created_at >= $1",
    )
    .bind(since)
    .fetch_one(&state.pool)
    .await?;

    let (calls, input_tokens, output_tokens, cost): (i64, i64, i64, f64) = sqlx::query_as(
        "SELECT
            count(*)::bigint,
            coalesce(sum(input_tokens), 0)::bigint,
            coalesce(sum(output_tokens), 0)::bigint,
            coalesce(sum(cost), 0)::double precision
         FROM llm_calls WHERE created_at >= $1",
    )
    .bind(since)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(json!({
        "window_hours": hours,
        "runs": {
            "total": total,
            "completed": completed,
            "failed": failed,
            "cancelled": cancelled,
            "running": running,
            "queued": queued,
            "avg_duration_secs": avg_duration.map(|value| value.round() as i64),
        },
        "llm": {
            "calls": calls,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost": cost,
        }
    })))
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
    let role = payload.role.unwrap_or_else(|| "user".to_string());
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
    let keys = [
        "weights",
        "model",
        "prompt_version",
        "selection",
        "llm_base_url",
        "telegram_chat_id",
    ];
    let mut out = serde_json::Map::new();
    for key in keys {
        if let Some(value) = db::get_setting(&state.pool, key).await? {
            out.insert(key.to_string(), value);
        }
    }
    let model = out
        .get("model")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| state.config.llm.model.clone());
    let prompt_version = out
        .get("prompt_version")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| state.config.prompt_version.clone());
    let base_url = out
        .get("llm_base_url")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| state.config.llm.base_url.clone());
    let telegram_token_configured = db::get_setting(&state.pool, "telegram_bot_token")
        .await?
        .and_then(|value| value.as_str().map(str::trim).map(ToOwned::to_owned))
        .filter(|value| !value.is_empty())
        .is_some();
    let telegram_chat_id = out
        .get("telegram_chat_id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    out.insert(
        "telegram_bot_token_set".to_string(),
        json!(telegram_token_configured),
    );
    let weights = out
        .get("weights")
        .and_then(|value| {
            serde_json::from_value::<news_shared::config::ScoringWeights>(value.clone()).ok()
        })
        .unwrap_or_else(|| state.config.weights.clone());
    Ok(Json(json!({
        "settings": out,
        "effective": {
            "model": model,
            "prompt_version": prompt_version,
            "base_url": base_url,
            "weights": {
                "impact": weights.impact,
                "scale": weights.scale,
                "urgency": weights.urgency,
                "relevance": weights.relevance,
                "confidence": weights.confidence,
                "uncertainty_penalty": weights.uncertainty_penalty,
            },
            "telegram": {
                "bot_configured": telegram_token_configured,
                "chat_id": telegram_chat_id,
            },
            "env": state.config.env_name,
        }
    })))
}

#[derive(Debug, Deserialize)]
pub struct LlmModelsQuery {
    #[serde(default)]
    pub base_url: Option<String>,
}

pub async fn llm_models(
    State(state): State<AppState>,
    user: AuthUser,
    Query(query): Query<LlmModelsQuery>,
) -> AppResult<Json<Value>> {
    user.require_admin()?;
    let base_url = match query.base_url.map(|value| value.trim().to_owned()) {
        Some(value) if !value.is_empty() => value,
        _ => db::get_setting(&state.pool, "llm_base_url")
            .await?
            .and_then(|value| value.as_str().map(ToOwned::to_owned))
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| state.config.llm.base_url.clone()),
    };
    let models = state.llm.list_models_at(&base_url).await?;
    Ok(Json(json!({"base_url": base_url, "models": models})))
}

pub async fn put_setting(
    State(state): State<AppState>,
    user: AuthUser,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    Json(payload): Json<SettingRequest>,
) -> AppResult<Json<Value>> {
    user.require_admin()?;
    let allowed = [
        "weights",
        "model",
        "prompt_version",
        "selection",
        "llm_base_url",
        "telegram_bot_token",
        "telegram_chat_id",
    ];
    if !allowed.contains(&payload.key.as_str()) {
        return Err(AppError::BadRequest("unknown setting".into()));
    }
    if payload.key == "telegram_bot_token" {
        let token = payload
            .value
            .as_str()
            .ok_or_else(|| AppError::Validation("telegram bot token must be a string".into()))?;
        validate_bot_token(token)?;
    }
    if payload.key == "telegram_chat_id" {
        let chat_id = payload
            .value
            .as_str()
            .ok_or_else(|| AppError::Validation("telegram chat id must be a string".into()))?;
        validate_chat_id(chat_id)?;
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
    let llm_base_url = db::get_setting(&state.pool, "llm_base_url")
        .await?
        .and_then(|value| value.as_str().map(ToOwned::to_owned))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| state.config.llm.base_url.clone());
    let llm_ok = state.llm.health_at(&llm_base_url).await;

    Ok(Json(json!({
        "registry": news_shared::registry::read_services(&state.config.data_dir),
        "database": {"ok": db_ok},
        "redis": {"ok": redis_latency.is_some(), "latency_ms": redis_latency.map(|d| d.as_millis())},
        "kafka": {"ok": kafka_ok, "brokers": state.bus.brokers()},
        "llm": {"ok": llm_ok, "model": state.config.llm.model, "base_url": llm_base_url},
        "env": state.config.env_name,
        "version": env!("CARGO_PKG_VERSION"),
    })))
}

#[derive(Debug, Deserialize)]
pub struct HistoryQuery {
    #[serde(default)]
    pub limit: Option<i64>,
}

pub async fn health_history(
    State(state): State<AppState>,
    user: AuthUser,
    Query(query): Query<HistoryQuery>,
) -> AppResult<Json<Value>> {
    user.require_admin()?;
    let limit = query.limit.unwrap_or(30).clamp(1, 200);
    let rows = sqlx::query_as::<
        _,
        (
            Uuid,
            chrono::DateTime<Utc>,
            bool,
            bool,
            Option<i64>,
            bool,
            bool,
            i32,
            i32,
        ),
    >(
        "SELECT id, checked_at, database_ok, redis_ok, redis_latency_ms, kafka_ok, llm_ok,
                registry_alive, registry_total
         FROM health_snapshots ORDER BY checked_at DESC LIMIT $1",
    )
    .bind(limit)
    .fetch_all(&state.pool)
    .await?;

    let items = rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.0,
                "checked_at": row.1,
                "database_ok": row.2,
                "redis_ok": row.3,
                "redis_latency_ms": row.4,
                "kafka_ok": row.5,
                "llm_ok": row.6,
                "registry_alive": row.7,
                "registry_total": row.8,
            })
        })
        .collect::<Vec<_>>();

    Ok(Json(json!(items)))
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
