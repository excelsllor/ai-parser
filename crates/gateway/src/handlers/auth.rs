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
use serde::{Deserialize, Serialize};
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

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum LoginResult {
    Session(LoginResponse),
    TwoFactor {
        two_factor_required: bool,
        challenge: String,
    },
}

async fn two_factor_global(state: &AppState) -> AppResult<bool> {
    Ok(db::get_setting(&state.pool, "two_factor_enabled")
        .await?
        .and_then(|value| value.as_bool())
        .unwrap_or(false))
}

fn generate_code() -> String {
    let (token, _) = new_refresh_token();
    let value = u32::from_str_radix(&token[..8], 16).unwrap_or(0);
    format!("{:06}", value % 1_000_000)
}

async fn send_code(
    state: &AppState,
    recipient: &str,
    code: &str,
    purpose: &str,
) -> AppResult<()> {
    let (title, intro, note) = match purpose {
        "enable" => (
            "Подключение двухфакторной защиты",
            "Вы включаете двухфакторную аутентификацию в CyberBug. Введите код ниже, чтобы подтвердить включение.",
            "Код действует 10 минут. Если вы не включали 2FA, просто проигнорируйте письмо.",
        ),
        "disable" => (
            "Отключение двухфакторной защиты",
            "Вы отключаете двухфакторную аутентификацию в CyberBug. Введите код ниже, чтобы подтвердить отключение.",
            "Код действует 10 минут. Если вы не отключали 2FA, просто проигнорируйте письмо.",
        ),
        _ => (
            "Подтверждение входа",
            "Вы входите в CyberBug. Введите код ниже, чтобы завершить вход.",
            "Код действует 10 минут. Если вы не пытались войти, смените пароль.",
        ),
    };
    let html = email::render_code_email(&email::CodeEmail {
        title,
        intro,
        code,
        note,
    })?;
    email::send_html(state, recipient, "Код подтверждения CyberBug", &html).await
}

async fn create_two_factor_code(
    pool: &PgPool,
    user_id: Uuid,
    purpose: &str,
) -> AppResult<String> {
    let code = generate_code();
    sqlx::query("DELETE FROM two_factor_codes WHERE user_id = $1 AND purpose = $2")
        .bind(user_id)
        .bind(purpose)
        .execute(pool)
        .await?;
    sqlx::query(
        "INSERT INTO two_factor_codes (user_id, purpose, code_hash, expires_at)
         VALUES ($1, $2, $3, now() + interval '10 minutes')",
    )
    .bind(user_id)
    .bind(purpose)
    .bind(hash_token(&code))
    .execute(pool)
    .await?;
    Ok(code)
}

async fn consume_two_factor_code(
    pool: &PgPool,
    user_id: Uuid,
    purpose: &str,
    code: &str,
) -> AppResult<bool> {
    let row: Option<(Uuid,)> = sqlx::query_as(
        "UPDATE two_factor_codes SET used_at = now()
         WHERE user_id = $1 AND purpose = $2 AND code_hash = $3
           AND used_at IS NULL AND expires_at > now()
         RETURNING id",
    )
    .bind(user_id)
    .bind(purpose)
    .bind(hash_token(code.trim()))
    .fetch_optional(pool)
    .await?;
    Ok(row.is_some())
}

async fn begin_two_factor_login(
    state: &AppState,
    user: &User,
    email: &str,
) -> AppResult<String> {
    let code = create_two_factor_code(&state.pool, user.id, "login").await?;
    let (ticket, ticket_hash) = new_refresh_token();
    sqlx::query("DELETE FROM two_factor_challenges WHERE user_id = $1")
        .bind(user.id)
        .execute(&state.pool)
        .await?;
    sqlx::query(
        "INSERT INTO two_factor_challenges (user_id, ticket_hash, expires_at)
         VALUES ($1, $2, now() + interval '10 minutes')",
    )
    .bind(user.id)
    .bind(ticket_hash)
    .execute(&state.pool)
    .await?;
    send_code(state, email, &code, "login").await?;
    Ok(ticket)
}

async fn two_factor_recipient(user: &User) -> AppResult<String> {
    user.email
        .as_deref()
        .filter(|_| user.email_verified_at.is_some())
        .map(str::to_string)
        .ok_or_else(|| {
            AppError::Validation("подтвердите адрес электронной почты, чтобы использовать 2FA".into())
        })
}

pub async fn login(
    State(state): State<AppState>,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    headers: HeaderMap,
    Json(payload): Json<LoginRequest>,
) -> AppResult<Json<LoginResult>> {
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

    if user.two_factor_enabled && two_factor_global(&state).await? {
        if let Some(email) = user
            .email
            .as_deref()
            .filter(|_| user.email_verified_at.is_some())
        {
            let challenge = begin_two_factor_login(&state, &user, email).await?;
            return Ok(Json(LoginResult::TwoFactor {
                two_factor_required: true,
                challenge,
            }));
        }
    }

    let session = issue_session(&state, &user, ip, "auth.login.success").await?;
    Ok(Json(LoginResult::Session(session)))
}

#[derive(Debug, Deserialize)]
pub struct TwoFactorLoginRequest {
    pub challenge: String,
    pub code: String,
}

#[derive(Debug, Deserialize)]
pub struct TwoFactorCodeRequest {
    pub code: String,
}

pub async fn login_two_factor(
    State(state): State<AppState>,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    Json(payload): Json<TwoFactorLoginRequest>,
) -> AppResult<Json<LoginResult>> {
    let key = format!("ratelimit:login2fa:{ip}");
    let allowed = state.redis.rate_limit(&key, 20, 60).await.unwrap_or(true);
    if !allowed {
        return Err(AppError::RateLimited(
            "too many login attempts, try again later".into(),
        ));
    }

    let ticket_hash = hash_token(payload.challenge.trim());
    let row: Option<(Uuid,)> = sqlx::query_as(
        "SELECT user_id FROM two_factor_challenges
         WHERE ticket_hash = $1 AND used_at IS NULL AND expires_at > now()",
    )
    .bind(&ticket_hash)
    .fetch_optional(&state.pool)
    .await?;
    let Some((user_id,)) = row else {
        return Err(AppError::Unauthorized(
            "invalid or expired confirmation code".into(),
        ));
    };

    let user: Option<User> =
        sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1 AND is_active = TRUE")
            .bind(user_id)
            .fetch_optional(&state.pool)
            .await?;
    let Some(user) = user else {
        return Err(AppError::Unauthorized(
            "invalid or expired confirmation code".into(),
        ));
    };

    if !consume_two_factor_code(&state.pool, user.id, "login", &payload.code).await? {
        let _ = write_audit(
            &state.pool,
            &AuditRecord::new(
                Some(user.id),
                user.username.clone(),
                "auth.login.failed",
                "auth",
                json!({"reason": "invalid_2fa_code"}),
                ip,
            ),
        )
        .await;
        return Err(AppError::Unauthorized(
            "invalid or expired confirmation code".into(),
        ));
    }

    sqlx::query("UPDATE two_factor_challenges SET used_at = now() WHERE ticket_hash = $1")
        .bind(&ticket_hash)
        .execute(&state.pool)
        .await?;

    let session = issue_session(&state, &user, ip, "auth.login.2fa").await?;
    Ok(Json(LoginResult::Session(session)))
}

pub async fn two_factor_status(
    State(state): State<AppState>,
    user: AuthUser,
) -> AppResult<Json<serde_json::Value>> {
    let current = fetch_user(&state.pool, user.id).await?;
    Ok(Json(json!({
        "available": two_factor_global(&state).await?,
        "enabled": current.two_factor_enabled,
        "email_verified": current.email.is_some() && current.email_verified_at.is_some(),
    })))
}

pub async fn two_factor_setup(
    State(state): State<AppState>,
    user: AuthUser,
) -> AppResult<Json<serde_json::Value>> {
    if !two_factor_global(&state).await? {
        return Err(AppError::BadRequest(
            "two-factor authentication is disabled".into(),
        ));
    }
    let current = fetch_user(&state.pool, user.id).await?;
    let email = two_factor_recipient(&current).await?;
    let code = create_two_factor_code(&state.pool, current.id, "enable").await?;
    send_code(&state, &email, &code, "enable").await?;
    Ok(Json(json!({"ok": true})))
}

pub async fn two_factor_enable(
    State(state): State<AppState>,
    user: AuthUser,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    Json(payload): Json<TwoFactorCodeRequest>,
) -> AppResult<Json<serde_json::Value>> {
    if !two_factor_global(&state).await? {
        return Err(AppError::BadRequest(
            "two-factor authentication is disabled".into(),
        ));
    }
    let current = fetch_user(&state.pool, user.id).await?;
    let _ = two_factor_recipient(&current).await?;
    if !consume_two_factor_code(&state.pool, current.id, "enable", &payload.code).await? {
        return Err(AppError::Validation(
            "invalid or expired confirmation code".into(),
        ));
    }
    sqlx::query("UPDATE users SET two_factor_enabled = TRUE, updated_at = now() WHERE id = $1")
        .bind(current.id)
        .execute(&state.pool)
        .await?;
    let _ = write_audit(
        &state.pool,
        &AuditRecord::new(
            Some(current.id),
            current.username.clone(),
            "auth.2fa.enable",
            "auth",
            json!({}),
            ip,
        ),
    )
    .await;
    Ok(Json(json!({"ok": true})))
}

pub async fn two_factor_disable_setup(
    State(state): State<AppState>,
    user: AuthUser,
) -> AppResult<Json<serde_json::Value>> {
    let current = fetch_user(&state.pool, user.id).await?;
    if !current.two_factor_enabled {
        return Err(AppError::BadRequest(
            "two-factor authentication is not enabled".into(),
        ));
    }
    let email = two_factor_recipient(&current).await?;
    let code = create_two_factor_code(&state.pool, current.id, "disable").await?;
    send_code(&state, &email, &code, "disable").await?;
    Ok(Json(json!({"ok": true})))
}

pub async fn two_factor_disable(
    State(state): State<AppState>,
    user: AuthUser,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    Json(payload): Json<TwoFactorCodeRequest>,
) -> AppResult<Json<serde_json::Value>> {
    let current = fetch_user(&state.pool, user.id).await?;
    if !consume_two_factor_code(&state.pool, current.id, "disable", &payload.code).await? {
        return Err(AppError::Validation(
            "invalid or expired confirmation code".into(),
        ));
    }
    sqlx::query("UPDATE users SET two_factor_enabled = FALSE, updated_at = now() WHERE id = $1")
        .bind(current.id)
        .execute(&state.pool)
        .await?;
    sqlx::query("DELETE FROM two_factor_codes WHERE user_id = $1")
        .bind(current.id)
        .execute(&state.pool)
        .await?;
    sqlx::query("DELETE FROM two_factor_challenges WHERE user_id = $1")
        .bind(current.id)
        .execute(&state.pool)
        .await?;
    let _ = write_audit(
        &state.pool,
        &AuditRecord::new(
            Some(current.id),
            current.username.clone(),
            "auth.2fa.disable",
            "auth",
            json!({}),
            ip,
        ),
    )
    .await;
    Ok(Json(json!({"ok": true})))
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

pub(crate) fn normalize_email(raw: Option<String>) -> AppResult<Option<String>> {
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
    content: email::ActionEmail<'_>,
) -> AppResult<()> {
    let html = email::render_action_email(&content)?;
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
    let user = db::create_user(&state.pool, &username, &hash, "user").await?;
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
        let send_state = state.clone();
        let recipient = email.to_string();
        tokio::spawn(async move {
            if let Err(error) = send_email_link(
                &send_state,
                &recipient,
                "Подтверждение почты в CyberBug",
                email::ActionEmail {
                    title: "Подтвердите почту",
                    intro: "Спасибо за регистрацию в CyberBug. Нажмите кнопку ниже, чтобы подтвердить адрес электронной почты.",
                    button: "Подтвердить почту",
                    link: &link,
                    note: "Ссылка действует 30 минут. Если вы не регистрировались в CyberBug, просто проигнорируйте это письмо.",
                },
            )
            .await
            {
                tracing::warn!(error = %error, "verification email send failed");
            }
        });
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
        let send_state = state.clone();
        tokio::spawn(async move {
            if let Err(error) = send_email_link(
                &send_state,
                &email,
                "Восстановление пароля в CyberBug",
                email::ActionEmail {
                    title: "Сброс пароля",
                    intro: "Вы запросили восстановление пароля в CyberBug. Нажмите кнопку ниже, чтобы создать новый пароль.",
                    button: "Создать новый пароль",
                    link: &link,
                    note: "Ссылка действует 30 минут. Если вы не запрашивали сброс пароля, пароль останется прежним — просто проигнорируйте это письмо.",
                },
            )
            .await
            {
                tracing::warn!(error = %error, "password reset email send failed");
            }
        });
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
    let send_state = state.clone();
    let recipient = email.to_string();
    tokio::spawn(async move {
        if let Err(error) = send_email_link(
            &send_state,
            &recipient,
            "Подтверждение почты в CyberBug",
            email::ActionEmail {
                title: "Подтвердите почту",
                intro: "Нажмите кнопку ниже, чтобы подтвердить адрес электронной почты в CyberBug.",
                button: "Подтвердить почту",
                link: &link,
                note: "Ссылка действует 30 минут. Если вы не запрашивали подтверждение, просто проигнорируйте это письмо.",
            },
        )
        .await
        {
            tracing::warn!(error = %error, "verification email send failed");
        }
    });
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
    if display_name.chars().count() > 120 {
        return Err(AppError::Validation(
            "display_name must be at most 120 characters".into(),
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
                if let Some(stored) = stored.as_deref() {
                    if stored != value {
                        let provided = payload
                            .current_email
                            .as_deref()
                            .unwrap_or("")
                            .trim()
                            .to_lowercase();
                        if stored != provided {
                            return Err(AppError::Validation("current email is incorrect".into()));
                        }
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

    let updated =
        db::update_user_profile(&state.pool, user.id, &display_name, email.as_deref()).await?;

    let _ = write_audit(
        &state.pool,
        &AuditRecord::new(
            Some(user.id),
            user.username.clone(),
            "auth.profile.update",
            "auth",
            json!({"email": updated.email, "display_name": updated.display_name}),
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
