use axum::extract::{Extension, Path, State};
use axum::http::header::{COOKIE, SET_COOKIE};
use axum::http::{HeaderMap, HeaderValue};
use axum::Json;
use news_shared::auth::{hash_password, new_refresh_token};
use news_shared::db;
use news_shared::error::{AppError, AppResult};
use news_shared::models::LoginResponse;
use news_shared::oauth::{self, PendingOAuth, Provider};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::handlers::auth::issue_session;
use crate::middleware::ClientIp;
use crate::state::AppState;

const STATE_TTL_SECS: u64 = 600;
const STATE_COOKIE: &str = "oauth_state";

pub async fn providers(State(state): State<AppState>) -> Json<Value> {
    Json(json!({
        "yandex": oauth::is_enabled(&state.config, Provider::Yandex),
        "vk": oauth::is_enabled(&state.config, Provider::Vk),
    }))
}

pub async fn start(
    State(state): State<AppState>,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    Path(provider): Path<String>,
) -> AppResult<(HeaderMap, Json<Value>)> {
    let provider = Provider::parse(&provider)?;
    let allowed = state
        .redis
        .rate_limit(&format!("ratelimit:oauth-start:{ip}"), 20, 60)
        .await
        .unwrap_or(true);
    if !allowed {
        return Err(AppError::RateLimited(
            "too many authorization attempts, try again later".into(),
        ));
    }

    let (state_id, pending, url) = oauth::start(&state.config, provider)?;
    state
        .redis
        .set_json(&format!("oauth:state:{state_id}"), &pending, STATE_TTL_SECS)
        .await?;

    let mut headers = HeaderMap::new();
    headers.insert(
        SET_COOKIE,
        state_cookie(&state_id, secure(&state), STATE_TTL_SECS as i64),
    );

    Ok((headers, Json(json!({ "url": url }))))
}

#[derive(Debug, Deserialize)]
pub struct CallbackRequest {
    pub code: String,
    pub state: String,
}

pub async fn callback(
    State(state): State<AppState>,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    Path(provider): Path<String>,
    headers: HeaderMap,
    Json(payload): Json<CallbackRequest>,
) -> AppResult<(HeaderMap, Json<LoginResponse>)> {
    let provider = Provider::parse(&provider)?;
    let allowed = state
        .redis
        .rate_limit(&format!("ratelimit:oauth-callback:{ip}"), 20, 60)
        .await
        .unwrap_or(true);
    if !allowed {
        return Err(AppError::RateLimited(
            "too many authorization attempts, try again later".into(),
        ));
    }

    let code = payload.code.trim();
    let callback_state = payload.state.trim();
    if code.is_empty() || callback_state.is_empty() {
        return Err(AppError::BadRequest("code and state are required".into()));
    }

    let cookie_state = cookie_value(&headers, STATE_COOKIE)
        .ok_or_else(|| AppError::BadRequest("authorization request expired".into()))?;
    if cookie_state != callback_state {
        return Err(AppError::BadRequest(
            "authorization request mismatch".into(),
        ));
    }

    let pending: PendingOAuth = state
        .redis
        .take_json(&format!("oauth:state:{callback_state}"))
        .await?
        .ok_or_else(|| AppError::BadRequest("authorization request expired".into()))?;

    if pending.provider != provider {
        return Err(AppError::BadRequest("provider mismatch".into()));
    }

    let identity = oauth::exchange(&state.config, code, &pending).await?;
    let provider_name = provider.as_str();

    let user =
        match db::find_oauth_user(&state.pool, provider_name, &identity.provider_user_id).await? {
            Some(user) => user,
            None => {
                let password_hash = hash_password(&new_refresh_token().0)?;
                db::create_oauth_user(
                    &state.pool,
                    provider_name,
                    &identity.provider_user_id,
                    &identity.username,
                    &password_hash,
                    &identity.display_name,
                    identity.email.as_deref(),
                )
                .await?
            }
        };

    if !user.is_active {
        return Err(AppError::Forbidden("account is disabled".into()));
    }

    let session = issue_session(&state, &user, ip, "auth.oauth.success").await?;

    let mut response_headers = HeaderMap::new();
    response_headers.insert(SET_COOKIE, state_cookie("", secure(&state), 0));
    Ok((response_headers, Json(session)))
}

fn secure(state: &AppState) -> bool {
    let https = |provider: &Option<news_shared::config::OAuthProviderConfig>| {
        provider
            .as_ref()
            .is_some_and(|config| config.redirect_uri.starts_with("https://"))
    };
    state.config.public_url.starts_with("https://")
        || https(&state.config.oauth_yandex)
        || https(&state.config.oauth_vk)
}

fn state_cookie(value: &str, secure: bool, max_age: i64) -> HeaderValue {
    let mut cookie =
        format!("{STATE_COOKIE}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}");
    if secure {
        cookie.push_str("; Secure");
    }
    HeaderValue::from_str(&cookie).expect("oauth state cookie is always valid")
}

fn cookie_value(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get_all(COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(key, _)| *key == name)
        .map(|(_, value)| value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cookie_value_finds_state() {
        let mut headers = HeaderMap::new();
        headers.insert(COOKIE, HeaderValue::from_static("a=1; oauth_state=xyz"));
        assert_eq!(cookie_value(&headers, STATE_COOKIE).as_deref(), Some("xyz"));
    }

    #[test]
    fn state_cookie_has_security_flags() {
        let cookie = state_cookie("abc", true, 600);
        let text = cookie.to_str().unwrap();
        assert!(text.contains("HttpOnly"));
        assert!(text.contains("SameSite=Lax"));
        assert!(text.contains("Secure"));
    }
}
