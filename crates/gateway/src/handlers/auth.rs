use std::sync::OnceLock;

use axum::extract::{Extension, Path, State};
use axum::http::HeaderMap;
use axum::Json;
use chrono::{Duration, Utc};
use news_shared::audit::{write_audit, AuditRecord};
use news_shared::auth::{
    create_access_token, hash_password, hash_token, new_refresh_token, refresh_expiry,
    verify_password, AuthUser,
};
use news_shared::db;
use news_shared::error::{AppError, AppResult};
use news_shared::models::{LoginRequest, LoginResponse, RefreshRequest, User, UserResponse};
use news_shared::security::{validate_password, validate_username};
use serde::Deserialize;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::handlers::email;
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

    let session = issue_session(&state, &user, ip, "auth.login.success").await?;
    Ok(Json(session))
}

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub username: String,
    pub password: String,
    pub email: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct EmailRequest {
    pub email: String,
}

#[derive(Debug, Deserialize)]
pub struct ResetPasswordRequest {
    pub token: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct TokenRequest {
    pub token: String,
}

fn normalize_email(raw: Option<String>) -> AppResult<Option<String>> {
    match raw {
        None => Ok(None),
        Some(value) => {
            let value = value.trim().to_lowercase();
            if value.is_empty() {
                return Ok(None);
            }
            if value.len() > 254
                || !value.contains('@')
                || value.starts_with('@')
                || value.ends_with('@')
            {
                return Err(AppError::Validation("invalid email".into()));
            }
            Ok(Some(value))
        }
    }
}

fn public_base(state: &AppState) -> String {
    let base = state.config.public_url.trim_end_matches('/');
    if base.is_empty() {
        "http://localhost:8080".to_string()
    } else {
        base.to_string()
    }
}

async fn send_email_link(
    state: &AppState,
    recipient: &str,
    subject: &str,
    link: &str,
    intro: &str,
) -> AppResult<()> {
    let html = format!(
        "<p>{intro}</p><p><a href=\"{link}\">{link}</a></p><p>Ссылка действует 30 минут.</p>"
    );
    email::send_html(state, recipient, subject, &html).await
}

pub async fn register(
    State(state): State<AppState>,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    Json(payload): Json<RegisterRequest>,
) -> AppResult<Json<LoginResponse>> {
    let key = format!("ratelimit:register:{ip}");
    let allowed = state.redis.rate_limit(&key, 5, 600).await.unwrap_or(true);
    if !allowed {
        return Err(AppError::RateLimited(
            "too many registration attempts, try again later".into(),
        ));
    }

    let username = payload.username.trim().to_lowercase();
    validate_username(&username)?;
    validate_password(&payload.password)?;
    let email = normalize_email(payload.email)?;
    if let Some(email) = email.as_deref() {
        if db::find_user_by_email(&state.pool, email).await?.is_some() {
            return Err(AppError::Conflict("email is already in use".into()));
        }
    }

    let hash = hash_password(&payload.password)?;
    let user = db::create_user(&state.pool, &username, &hash, "viewer").await?;
    if let Some(email) = email.as_deref() {
        db::set_user_email(&state.pool, user.id, Some(email)).await?;
        let (token, token_hash) = new_refresh_token();
        db::create_email_token(
            &state.pool,
            user.id,
            "verify",
            &token_hash,
            Utc::now() + Duration::minutes(30),
        )
        .await?;
        let link = format!("{}/verify-email?token={token}", public_base(&state));
        if let Err(error) = send_email_link(
            &state,
            email,
            "Подтверждение почты в CyberBug",
            &link,
            "Подтвердите адрес электронной почты в CyberBug.",
        )
        .await
        {
            tracing::warn!(error = %error, "verification email send failed");
        }
    }
    let session = issue_session(&state, &user, ip, "auth.register.success").await?;
    Ok(Json(session))
}

pub async fn forgot_password(
    State(state): State<AppState>,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    Json(payload): Json<EmailRequest>,
) -> AppResult<Json<serde_json::Value>> {
    let key = format!("ratelimit:password-reset:{ip}");
    let allowed = state.redis.rate_limit(&key, 5, 600).await.unwrap_or(true);
    if !allowed {
        return Err(AppError::RateLimited(
            "too many password reset attempts, try again later".into(),
        ));
    }
    let email = match normalize_email(Some(payload.email))? {
        Some(email) => email,
        None => return Ok(Json(json!({"ok": true}))),
    };
    if let Some(user) = db::find_user_by_email(&state.pool, &email).await? {
        let (token, token_hash) = new_refresh_token();
        db::create_email_token(
            &state.pool,
            user.id,
            "reset",
            &token_hash,
            Utc::now() + Duration::minutes(30),
        )
        .await?;
        let link = format!("{}/reset-password?token={token}", public_base(&state));
        if let Err(error) = send_email_link(
            &state,
            &email,
            "Восстановление пароля в CyberBug",
            &link,
            "Вы запросили восстановление пароля в CyberBug.",
        )
        .await
        {
            tracing::warn!(error = %error, "password reset email send failed");
        }
    }
    Ok(Json(json!({"ok": true})))
}

pub async fn reset_password(
    State(state): State<AppState>,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    Json(payload): Json<ResetPasswordRequest>,
) -> AppResult<Json<serde_json::Value>> {
    validate_password(&payload.password)?;
    let token_hash = hash_token(payload.token.trim());
    let user_id = db::consume_email_token(&state.pool, "reset", &token_hash)
        .await?
        .ok_or_else(|| AppError::BadRequest("reset link is invalid or expired".into()))?;
    let hash = hash_password(&payload.password)?;
    db::set_user_password(&state.pool, user_id, &hash).await?;
    db::revoke_all_user_sessions(&state.pool, user_id).await?;
    let user = fetch_user(&state.pool, user_id).await?;
    let _ = write_audit(
        &state.pool,
        &AuditRecord::new(
            Some(user_id),
            user.username,
            "auth.password.reset",
            "auth",
            json!({}),
            ip,
        ),
    )
    .await;
    Ok(Json(json!({"ok": true})))
}

pub async fn request_email_verification(
    State(state): State<AppState>,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    user: AuthUser,
) -> AppResult<Json<serde_json::Value>> {
    let key = format!("ratelimit:email-verify:{ip}");
    let allowed = state.redis.rate_limit(&key, 5, 600).await.unwrap_or(true);
    if !allowed {
        return Err(AppError::RateLimited(
            "too many verification attempts, try again later".into(),
        ));
    }
    let current = fetch_user(&state.pool, user.id).await?;
    let email = current
        .email
        .as_deref()
        .ok_or_else(|| AppError::BadRequest("email is not set".into()))?;
    let (token, token_hash) = new_refresh_token();
    db::create_email_token(
        &state.pool,
        user.id,
        "verify",
        &token_hash,
        Utc::now() + Duration::minutes(30),
    )
    .await?;
    let link = format!("{}/verify-email?token={token}", public_base(&state));
    send_email_link(
        &state,
        email,
        "Подтверждение почты в CyberBug",
        &link,
        "Подтвердите адрес электронной почты в CyberBug.",
    )
    .await?;
    Ok(Json(json!({"ok": true})))
}

pub async fn confirm_email(
    State(state): State<AppState>,
    Json(payload): Json<TokenRequest>,
) -> AppResult<Json<serde_json::Value>> {
    let token_hash = hash_token(payload.token.trim());
    let user_id = db::consume_email_token(&state.pool, "verify", &token_hash)
        .await?
        .ok_or_else(|| AppError::BadRequest("verification link is invalid or expired".into()))?;
    db::mark_email_verified(&state.pool, user_id).await?;
    Ok(Json(json!({"ok": true})))
}

pub async fn issue_session(
    state: &AppState,
    user: &User,
    ip: String,
    action: &str,
) -> AppResult<LoginResponse> {
    let access = create_access_token(&state.config, user)?;
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
            action,
            "auth",
            json!({"role": user.role}),
            ip,
        ),
    )
    .await;

    Ok(LoginResponse {
        access_token: access,
        refresh_token: refresh,
        token_type: "Bearer".to_string(),
        role: user.role.clone(),
        username: user.username.clone(),
    })
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
                        return Err(AppError::Validation("current email is incorrect".into()));
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
        return Err(AppError::Unauthorized(
            "current password is incorrect".into(),
        ));
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
