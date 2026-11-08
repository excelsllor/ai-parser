use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use url::Url;

use crate::config::{Config, OAuthProviderConfig};
use crate::error::{AppError, AppResult};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Yandex,
    Vk,
}

impl Provider {
    pub fn parse(value: &str) -> AppResult<Self> {
        match value {
            "yandex" => Ok(Self::Yandex),
            "vk" => Ok(Self::Vk),
            _ => Err(AppError::NotFound("unknown oauth provider".into())),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Yandex => "yandex",
            Self::Vk => "vk",
        }
    }

    fn config(self, config: &Config) -> AppResult<&OAuthProviderConfig> {
        match self {
            Self::Yandex => config.oauth_yandex.as_ref(),
            Self::Vk => config.oauth_vk.as_ref(),
        }
        .ok_or_else(|| AppError::Config(format!("{} oauth is not configured", self.as_str())))
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PendingOAuth {
    pub provider: Provider,
    pub verifier: String,
    pub device_id: String,
    pub redirect_uri: String,
}

#[derive(Clone, Debug)]
pub struct OAuthIdentity {
    pub provider_user_id: String,
    pub username: String,
    pub email: Option<String>,
    pub display_name: String,
}

pub fn is_enabled(config: &Config, provider: Provider) -> bool {
    provider.config(config).is_ok()
}

pub fn start(config: &Config, provider: Provider) -> AppResult<(String, PendingOAuth, String)> {
    let provider_config = provider.config(config)?;
    let state = random_token(32);
    let verifier = random_token(32);
    let device_id = random_token(16);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));

    let mut url = Url::parse(match provider {
        Provider::Yandex => "https://oauth.yandex.ru/authorize",
        Provider::Vk => "https://id.vk.com/authorize",
    })
    .map_err(|e| AppError::internal(format!("invalid oauth url: {e}")))?;

    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("response_type", "code")
            .append_pair("client_id", &provider_config.client_id)
            .append_pair("redirect_uri", &provider_config.redirect_uri)
            .append_pair("state", &state);
        if provider == Provider::Vk {
            query
                .append_pair("scope", "email")
                .append_pair("code_challenge", &challenge)
                .append_pair("code_challenge_method", "S256")
                .append_pair("device_id", &device_id);
        }
    }

    let pending = PendingOAuth {
        provider,
        verifier,
        device_id,
        redirect_uri: provider_config.redirect_uri.clone(),
    };

    Ok((state, pending, url.to_string()))
}

pub async fn exchange(
    config: &Config,
    code: &str,
    pending: &PendingOAuth,
) -> AppResult<OAuthIdentity> {
    let provider_config = pending.provider.config(config)?;
    match pending.provider {
        Provider::Yandex => exchange_yandex(provider_config, code, &pending.redirect_uri).await,
        Provider::Vk => exchange_vk(provider_config, code, pending).await,
    }
}

async fn exchange_yandex(
    config: &OAuthProviderConfig,
    code: &str,
    redirect_uri: &str,
) -> AppResult<OAuthIdentity> {
    let token = post_form(
        "https://oauth.yandex.ru/token",
        &[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("client_id", &config.client_id),
            ("client_secret", &config.client_secret),
            ("redirect_uri", redirect_uri),
        ],
    )
    .await?;

    let access_token = token
        .get("access_token")
        .and_then(|value| value.as_str())
        .ok_or_else(|| AppError::BadRequest("yandex token response has no access_token".into()))?;

    let response = reqwest::Client::new()
        .get("https://login.yandex.ru/info?format=json")
        .header("Authorization", format!("OAuth {access_token}"))
        .send()
        .await?;
    let profile = json_response(response).await?;

    let provider_user_id = profile
        .get("id")
        .and_then(json_scalar)
        .ok_or_else(|| AppError::BadRequest("yandex profile has no id".into()))?;
    let login = profile
        .get("login")
        .and_then(|value| value.as_str())
        .unwrap_or("yandex-user");
    let display_name = profile
        .get("real_name")
        .and_then(|value| value.as_str())
        .or_else(|| profile.get("display_name").and_then(|value| value.as_str()))
        .unwrap_or(login);
    let email = profile
        .get("default_email")
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned);

    Ok(OAuthIdentity {
        provider_user_id,
        username: sanitize_username(login),
        email,
        display_name: display_name.to_string(),
    })
}

async fn exchange_vk(
    config: &OAuthProviderConfig,
    code: &str,
    pending: &PendingOAuth,
) -> AppResult<OAuthIdentity> {
    let token = post_form(
        "https://id.vk.com/oauth2/auth",
        &[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("client_id", &config.client_id),
            ("redirect_uri", &config.redirect_uri),
            ("code_verifier", &pending.verifier),
            ("device_id", &pending.device_id),
        ],
    )
    .await?;

    let access_token = token
        .get("access_token")
        .and_then(|value| value.as_str())
        .ok_or_else(|| AppError::BadRequest("vk token response has no access_token".into()))?;

    let response = post_form(
        "https://id.vk.com/oauth2/user_info",
        &[
            ("client_id", &config.client_id),
            ("access_token", access_token),
        ],
    )
    .await?;
    let user = response.get("user").unwrap_or(&response);

    let provider_user_id = user
        .get("user_id")
        .and_then(json_scalar)
        .ok_or_else(|| AppError::BadRequest("vk profile has no user_id".into()))?;
    let first_name = user
        .get("first_name")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let last_name = user
        .get("last_name")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let display_name = format!("{first_name} {last_name}").trim().to_string();
    let email = user
        .get("email")
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned);

    let username = if display_name.is_empty() {
        format!("vk{provider_user_id}")
    } else {
        format!("vk_{provider_user_id}")
    };

    Ok(OAuthIdentity {
        provider_user_id,
        username: sanitize_username(&username),
        email,
        display_name: if display_name.is_empty() {
            username
        } else {
            display_name
        },
    })
}

async fn post_form(url: &str, form: &[(&str, &str)]) -> AppResult<serde_json::Value> {
    let response = reqwest::Client::new().post(url).form(form).send().await?;
    json_response(response).await
}

async fn json_response(response: reqwest::Response) -> AppResult<serde_json::Value> {
    let status = response.status();
    let body = response.text().await?;
    let value: serde_json::Value = serde_json::from_str(&body)
        .unwrap_or_else(|_| serde_json::Value::String(body.chars().take(200).collect()));

    if !status.is_success() {
        return Err(AppError::BadRequest(format!(
            "oauth provider returned {status}: {}",
            value
        )));
    }

    if let Some(error) = value.get("error").and_then(|value| value.as_str()) {
        let description = value
            .get("error_description")
            .and_then(|value| value.as_str())
            .unwrap_or(error);
        return Err(AppError::BadRequest(format!(
            "oauth provider error: {description}"
        )));
    }

    Ok(value)
}

fn random_token(bytes: usize) -> String {
    let mut buffer = vec![0u8; bytes];
    OsRng.fill_bytes(&mut buffer);
    URL_SAFE_NO_PAD.encode(buffer)
}

fn json_scalar(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(text) => Some(text.clone()),
        serde_json::Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

fn sanitize_username(value: &str) -> String {
    let mut cleaned: String = value
        .to_lowercase()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.' | '-') {
                ch
            } else {
                '_'
            }
        })
        .collect();
    cleaned.truncate(32);
    if cleaned.len() < 3 {
        cleaned = format!("user_{cleaned}");
    }
    cleaned
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn username_is_sanitized() {
        assert_eq!(sanitize_username("Ivan Petrov"), "ivan_petrov");
        assert_eq!(sanitize_username("ab"), "user_ab");
    }
}
