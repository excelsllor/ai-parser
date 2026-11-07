use std::sync::OnceLock;

use axum::extract::{Extension, State};
use axum::http::HeaderMap;
use axum::Json;
use chrono::Utc;
use news_shared::audit::{write_audit, AuditRecord};
use news_shared::auth::{
    create_access_token, hash_password, hash_token, new_refresh_token, refresh_expiry,
    verify_password, AuthUser,
};
use news_shared::db;
use news_shared::error::{AppError, AppResult};
use news_shared::models::{LoginRequest, LoginResponse, RefreshRequest, User, UserResponse};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::middleware::ClientIp;
use crate::state::AppState;

fn dummy_hash() -> &'static str {
    static HASH: OnceLock<String> = OnceLock::new();
    HASH.get_or_init(|| hash_password("dummy-password-1").unwrap_or_default())
}

pub async fn status(State(state): State<AppState>) -> AppResult<Json<serde_json::Value>> {
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM users")
        .fetch_one(&state.pool)
        .await?;
    Ok(Json(json!({ "initialized": count > 0 })))
}

pub async fn login(
    State(state): State<AppState>,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    headers: HeaderMap,
    Json(payload): Json<LoginRequest>,
) -> AppResult<Json<LoginResponse>> {
    let _ = &headers;
    let key = format!("ratelimit:login:{ip}");
    let allowed = state.redis.rate_limit(&key, 10, 60).await.unwrap_or(true);
    if !allowed {
        return Err(AppError::RateLimited(
            "too many login attempts, try again later".into(),
        ));
    }

    let username = payload.username.trim().to_lowercase();
    let user = db::find_user_by_username(&state.pool, &username).await?;

    let Some(user) = user else {
        let _ = verify_password(&payload.password, dummy_hash());
        let _ = write_audit(
            &state.pool,
            &AuditRecord::new(
                None,
                "",
                "auth.login.failed",
                "auth",
                json!({"username": username}),
                ip.clone(),
            ),
        )
        .await;
        return Err(AppError::Unauthorized("invalid credentials".into()));
    };

    if !user.is_active || !verify_password(&payload.password, &user.password_hash) {
        let _ = write_audit(
            &state.pool,
            &AuditRecord::new(
                Some(user.id),
                user.username.clone(),
                "auth.login.failed",
                "auth",
                json!({"reason": "invalid_credentials"}),
                ip.clone(),
            ),
        )
        .await;
        return Err(AppError::Unauthorized("invalid credentials".into()));
    }

    let access = create_access_token(&state.config, &user)?;
    let (refresh, refresh_hash) = new_refresh_token();
    let expires = refresh_expiry(&state.config);

    sqlx::query("INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)")
        .bind(user.id)
        .bind(&refresh_hash)
        .bind(expires)
        .execute(&state.pool)
        .await?;

    let _ = write_audit(
        &state.pool,
        &AuditRecord::new(
            Some(user.id),
            user.username.clone(),
            "auth.login.success",
            "auth",
            json!({"role": user.role}),
            ip,
        ),
    )
    .await;

    Ok(Json(LoginResponse {
        access_token: access,
        refresh_token: refresh,
        token_type: "Bearer".to_string(),
        role: user.role,
        username: user.username,
    }))
}

pub async fn refresh(
    State(state): State<AppState>,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    Json(payload): Json<RefreshRequest>,
) -> AppResult<Json<LoginResponse>> {
    let token_hash = hash_token(payload.refresh_token.trim());
    let row: Option<(Uuid, Uuid, chrono::DateTime<Utc>, bool)> = sqlx::query_as(
        "SELECT id, user_id, expires_at, revoked FROM refresh_tokens WHERE token_hash = $1",
    )
    .bind(&token_hash)
    .fetch_optional(&state.pool)
    .await?;

    let Some((token_id, user_id, expires_at, revoked)) = row else {
        return Err(AppError::Unauthorized("invalid refresh token".into()));
    };
    if revoked || expires_at <= Utc::now() {
        return Err(AppError::Unauthorized("refresh token expired".into()));
    }

    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1 AND is_active = TRUE")
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::Unauthorized("user is disabled".into()))?;

    sqlx::query("UPDATE refresh_tokens SET revoked = TRUE WHERE id = $1")
        .bind(token_id)
        .execute(&state.pool)
        .await?;

    let (new_refresh, new_hash) = new_refresh_token();
    sqlx::query("INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)")
        .bind(user.id)
        .bind(&new_hash)
        .bind(refresh_expiry(&state.config))
        .execute(&state.pool)
        .await?;

    let access = create_access_token(&state.config, &user)?;

    let _ = write_audit(
        &state.pool,
        &AuditRecord::new(
            Some(user.id),
            user.username.clone(),
            "auth.refresh",
            "auth",
            json!({}),
            ip,
        ),
    )
    .await;

    Ok(Json(LoginResponse {
        access_token: access,
        refresh_token: new_refresh,
        token_type: "Bearer".to_string(),
        role: user.role,
        username: user.username,
    }))
}

pub async fn logout(
    State(state): State<AppState>,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    Json(payload): Json<RefreshRequest>,
) -> AppResult<Json<serde_json::Value>> {
    let token_hash = hash_token(payload.refresh_token.trim());
    sqlx::query("UPDATE refresh_tokens SET revoked = TRUE WHERE token_hash = $1")
        .bind(&token_hash)
        .execute(&state.pool)
        .await?;
    let _ = write_audit(
        &state.pool,
        &AuditRecord::new(None, "", "auth.logout", "auth", json!({}), ip),
    )
    .await;
    Ok(Json(json!({"ok": true})))
}

pub async fn me(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<UserResponse>> {
    let row = fetch_user(&state.pool, user.id).await?;
    Ok(Json(UserResponse::from(row)))
}

pub async fn fetch_user(pool: &PgPool, user_id: Uuid) -> AppResult<User> {
    sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("user not found".into()))
}
