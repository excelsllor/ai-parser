use askama::Template;
use std::time::Duration;

use lettre::message::header::ContentType;
use lettre::transport::smtp::authentication::Credentials;
use lettre::transport::smtp::client::{Tls, TlsParameters};
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use news_shared::db;
use news_shared::error::{AppError, AppResult};

use crate::state::AppState;

#[derive(Clone, Debug)]
pub struct SmtpSettings {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub from: String,
    pub test_recipient: String,
    pub tls: bool,
    pub starttls: bool,
}

pub struct ActionEmail<'a> {
    pub title: &'a str,
    pub intro: &'a str,
    pub button: &'a str,
    pub link: &'a str,
    pub note: &'a str,
}

#[derive(Template)]
#[template(path = "action_email.html")]
struct ActionEmailTemplate<'a> {
    title: &'a str,
    intro: &'a str,
    button: &'a str,
    link: &'a str,
    note: &'a str,
}

pub fn render_action_email(email: &ActionEmail<'_>) -> AppResult<String> {
    ActionEmailTemplate {
        title: email.title,
        intro: email.intro,
        button: email.button,
        link: email.link,
        note: email.note,
    }
    .render()
    .map_err(|error| AppError::Internal(error.to_string()))
}

pub struct CodeEmail<'a> {
    pub title: &'a str,
    pub intro: &'a str,
    pub code: &'a str,
    pub note: &'a str,
}

#[derive(Template)]
#[template(path = "two_factor_code.html")]
struct CodeEmailTemplate<'a> {
    title: &'a str,
    intro: &'a str,
    code: &'a str,
    note: &'a str,
}

pub fn render_code_email(email: &CodeEmail<'_>) -> AppResult<String> {
    CodeEmailTemplate {
        title: email.title,
        intro: email.intro,
        code: email.code,
        note: email.note,
    }
    .render()
    .map_err(|error| AppError::Internal(error.to_string()))
}

async fn string_setting(state: &AppState, key: &str, fallback: &str) -> AppResult<String> {
    Ok(db::get_setting(&state.pool, key)
        .await?
        .and_then(|value| value.as_str().map(str::trim).map(ToOwned::to_owned))
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| fallback.to_string()))
}

async fn bool_setting(state: &AppState, key: &str, fallback: bool) -> AppResult<bool> {
    Ok(db::get_setting(&state.pool, key)
        .await?
        .and_then(|value| value.as_bool())
        .unwrap_or(fallback))
}

pub async fn smtp_settings(state: &AppState) -> AppResult<SmtpSettings> {
    let fallback = &state.config.smtp;
    let port = db::get_setting(&state.pool, "smtp_port")
        .await?
        .and_then(|value| {
            value
                .as_u64()
                .map(|value| value as u16)
                .or_else(|| value.as_str().and_then(|value| value.parse().ok()))
        })
        .unwrap_or(fallback.port);
    Ok(SmtpSettings {
        host: string_setting(state, "smtp_host", &fallback.host).await?,
        port,
        username: string_setting(state, "smtp_username", &fallback.username).await?,
        password: string_setting(state, "smtp_password", &fallback.password).await?,
        from: string_setting(state, "smtp_from", &fallback.from).await?,
        test_recipient: string_setting(state, "smtp_test_recipient", &fallback.test_recipient)
            .await?,
        tls: bool_setting(state, "smtp_tls", fallback.tls).await?,
        starttls: bool_setting(state, "smtp_starttls", fallback.starttls).await?,
    })
}

pub async fn send_html(
    state: &AppState,
    recipient: &str,
    subject: &str,
    html: &str,
) -> AppResult<()> {
    let settings = smtp_settings(state).await?;
    let from = settings
        .from
        .parse()
        .map_err(|e| AppError::BadRequest(format!("invalid SMTP from address: {e}")))?;
    let to = recipient
        .parse()
        .map_err(|e| AppError::BadRequest(format!("invalid recipient address: {e}")))?;

    let email = Message::builder()
        .from(from)
        .to(to)
        .subject(subject)
        .header(ContentType::TEXT_HTML)
        .body(html.to_string())
        .map_err(|e| AppError::internal(format!("failed to build email: {e}")))?;

    // Docker networks often have no IPv6 route. Connect to the resolved IPv4
    // address while keeping the hostname for TLS SNI and certificate checks.
    let ipv4 = tokio::net::lookup_host((settings.host.as_str(), settings.port))
        .await
        .ok()
        .and_then(|addresses| {
            addresses
                .filter(|address| address.is_ipv4())
                .map(|address| address.ip().to_string())
                .next()
        });
    let target = ipv4.as_deref().unwrap_or(settings.host.as_str());

    let starttls = if settings.tls && settings.starttls {
        Some(
            TlsParameters::new(settings.host.clone())
                .map_err(|e| AppError::internal(format!("SMTP STARTTLS init failed: {e}")))?,
        )
    } else {
        None
    };
    let wrapper = if settings.tls && !settings.starttls {
        Some(
            TlsParameters::new(settings.host.clone())
                .map_err(|e| AppError::internal(format!("SMTP relay init failed: {e}")))?,
        )
    } else {
        None
    };

    let base = || {
        if let Some(tls) = &starttls {
            AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(target)
                .port(settings.port)
                .tls(Tls::Required(tls.clone()))
        } else if let Some(tls) = &wrapper {
            AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(target)
                .port(settings.port)
                .tls(Tls::Wrapper(tls.clone()))
        } else {
            AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(target).port(settings.port)
        }
        .timeout(Some(Duration::from_secs(12)))
    };

    let with_credentials = !settings.username.is_empty();
    let mailer = if with_credentials {
        base()
            .credentials(Credentials::new(
                settings.username.clone(),
                settings.password.clone(),
            ))
            .build()
    } else {
        base().build()
    };

    match mailer.send(email.clone()).await {
        Ok(_) => Ok(()),
        // Local relays (Mailpit/MailHog) advertise no AUTH. Retry anonymously
        // instead of failing on the configured credentials.
        // shortcut: matches lettre's error text; revisit if the message changes.
        Err(error)
            if with_credentials
                && error
                    .to_string()
                    .contains("No compatible authentication mechanism") =>
        {
            base().build().send(email).await.map(|_| ()).map_err(|e| {
                AppError::internal(format!(
                    "SMTP send failed ({}:{} via {target}): {e}",
                    settings.host, settings.port
                ))
            })
        }
        Err(e) => Err(AppError::internal(format!(
            "SMTP send failed ({}:{} via {target}): {e}",
            settings.host, settings.port
        ))),
    }
}
