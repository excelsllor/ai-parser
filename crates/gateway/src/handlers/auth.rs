use std::sync::OnceLock;

use axum::extract::{Extension, Path, State};
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
use news_shared::security::validate_password;
use serde::Deserialize;
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
    let _ = db::prune_user_sessions(&state.pool, user.id, 10).await;

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
    let _ = db::prune_user_sessions(&state.pool, user.id, 10).await;

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

#[derive(Debug, Deserialize)]
pub struct UpdateProfileRequest {
    pub display_name: Option<String>,
    pub department: Option<String>,
    pub email: Option<String>,
    pub current_email: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

#[derive(Debug, Deserialize)]
pub struct RevokeOthersRequest {
    pub refresh_token: String,
}

#[derive(Debug, serde::Serialize)]
pub struct SessionResponse {
    pub id: Uuid,
    pub created_at: chrono::DateTime<Utc>,
    pub expires_at: chrono::DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct VerifyEmailRequest {
    pub email: String,
}

pub async fn verify_email(
    State(state): State<AppState>,
    user: AuthUser,
    Json(payload): Json<VerifyEmailRequest>,
) -> AppResult<Json<serde_json::Value>> {
    let current = fetch_user(&state.pool, user.id).await?;
    if let Some(stored) = current.email {
        if !stored.eq_ignore_ascii_case(payload.email.trim()) {
            return Err(AppError::Validation("current email is incorrect".into()));
        }
    }
    Ok(Json(json!({"ok": true})))
}

pub async fn update_profile(
    State(state): State<AppState>,
    user: AuthUser,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    Json(payload): Json<UpdateProfileRequest>,
) -> AppResult<Json<UserResponse>> {
    let current = fetch_user(&state.pool, user.id).await?;
    let display_name = payload
        .display_name
        .unwrap_or(current.display_name)
        .trim()
        .to_string();
    let department = payload
        .department
        .unwrap_or(current.department)
        .trim()
        .to_string();
    if display_name.chars().count() > 120 || department.chars().count() > 120 {
        return Err(AppError::Validation(
            "display_name and department must be at most 120 characters".into(),
        ));
    }

    let email = match payload.email {
        Some(raw) => {
            let value = raw.trim().to_lowercase();
            if value.is_empty() {
                None
            } else {
                if value.len() > 254
                    || !value.contains('@')
                    || value.starts_with('@')
                    || value.ends_with('@')
                {
                    return Err(AppError::Validation("invalid email".into()));
                }
                let stored = current.email.as_deref().map(str::to_lowercase);
                if stored.as_deref() != Some(value.as_str()) {
                    let provided = payload
                        .current_email
                        .as_deref()
                        .unwrap_or("")
                        .trim()
                        .to_lowercase();
                    if stored.as_deref() != Some(provided.as_str()) {
                        return Err(AppError::Validation(
                            "current email is incorrect".into(),
                        ));
                    }
                }
                let taken: Option<Uuid> = sqlx::query_scalar(
                    "SELECT id FROM users WHERE lower(email) = $1 AND id <> $2 LIMIT 1",
                )
                .bind(&value)
                .bind(user.id)
                .fetch_optional(&state.pool)
                .await?;
                if taken.is_some() {
                    return Err(AppError::Validation("email is already in use".into()));
                }
                Some(value)
            }
        }
        None => current.email,
    };

    let updated = db::update_user_profile(
        &state.pool,
        user.id,
        &display_name,
        &department,
        email.as_deref(),
    )
    .await?;

    let _ = write_audit(
        &state.pool,
        &AuditRecord::new(
            Some(user.id),
            user.username.clone(),
            "auth.profile.update",
            "auth",
            json!({"email": updated.email, "display_name": updated.display_name, "department": updated.department}),
            ip,
        ),
    )
    .await;

    Ok(Json(UserResponse::from(updated)))
}

pub async fn change_password(
    State(state): State<AppState>,
    user: AuthUser,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    Json(payload): Json<ChangePasswordRequest>,
) -> AppResult<Json<serde_json::Value>> {
    let current = fetch_user(&state.pool, user.id).await?;
    if !verify_password(&payload.current_password, &current.password_hash) {
        return Err(AppError::Unauthorized("current password is incorrect".into()));
    }
    validate_password(&payload.new_password)?;
    let hash = hash_password(&payload.new_password)?;
    db::set_user_password(&state.pool, user.id, &hash).await?;

    let _ = write_audit(
        &state.pool,
        &AuditRecord::new(
            Some(user.id),
            user.username.clone(),
            "auth.password.change",
            "auth",
            json!({}),
            ip,
        ),
    )
    .await;

    Ok(Json(json!({"ok": true})))
}

pub async fn list_sessions(
    State(state): State<AppState>,
    user: AuthUser,
) -> AppResult<Json<Vec<SessionResponse>>> {
    let rows = db::list_user_sessions(&state.pool, user.id).await?;
    Ok(Json(
        rows.into_iter()
            .map(|row| SessionResponse {
                id: row.id,
                created_at: row.created_at,
                expires_at: row.expires_at,
            })
            .collect(),
    ))
}

pub async fn revoke_session(
    State(state): State<AppState>,
    user: AuthUser,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    Path(session_id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    db::revoke_user_session(&state.pool, user.id, session_id).await?;
    let _ = write_audit(
        &state.pool,
        &AuditRecord::new(
            Some(user.id),
            user.username.clone(),
            "auth.session.revoke",
            format!("session:{session_id}"),
            json!({}),
            ip,
        ),
    )
    .await;
    Ok(Json(json!({"ok": true})))
}

pub async fn revoke_other_sessions(
    State(state): State<AppState>,
    user: AuthUser,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    Json(payload): Json<RevokeOthersRequest>,
) -> AppResult<Json<serde_json::Value>> {
    let current_hash = hash_token(payload.refresh_token.trim());
    db::revoke_other_sessions(&state.pool, user.id, &current_hash).await?;
    let _ = write_audit(
        &state.pool,
        &AuditRecord::new(
            Some(user.id),
            user.username.clone(),
            "auth.session.revoke_others",
            "auth",
            json!({}),
            ip,
        ),
    )
    .await;
    Ok(Json(json!({"ok": true})))
}

pub async fn fetch_user(pool: &PgPool, user_id: Uuid) -> AppResult<User> {
    sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("user not found".into()))
}
