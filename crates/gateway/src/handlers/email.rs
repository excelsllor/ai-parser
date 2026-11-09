use std::time::Duration;

use lettre::message::header::ContentType;
use lettre::transport::smtp::authentication::Credentials;
use lettre::transport::smtp::client::{Tls, TlsParameters};
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use news_shared::error::{AppError, AppResult};

use crate::state::AppState;

pub async fn send_html(
    state: &AppState,
    recipient: &str,
    subject: &str,
    html: &str,
) -> AppResult<()> {
    let from = state
        .config
        .smtp
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
    let ipv4 = tokio::net::lookup_host((state.config.smtp.host.as_str(), state.config.smtp.port))
        .await
        .ok()
        .and_then(|addresses| {
            addresses
                .filter(|address| address.is_ipv4())
                .map(|address| address.ip().to_string())
                .next()
        });
    let target = ipv4.as_deref().unwrap_or(state.config.smtp.host.as_str());

    let builder = if state.config.smtp.tls && state.config.smtp.starttls {
        let tls = TlsParameters::new(state.config.smtp.host.clone())
            .map_err(|e| AppError::internal(format!("SMTP STARTTLS init failed: {e}")))?;
        AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(target)
            .port(state.config.smtp.port)
            .tls(Tls::Required(tls))
    } else if state.config.smtp.tls {
        let tls = TlsParameters::new(state.config.smtp.host.clone())
            .map_err(|e| AppError::internal(format!("SMTP relay init failed: {e}")))?;
        AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(target)
            .port(state.config.smtp.port)
            .tls(Tls::Wrapper(tls))
    } else {
        AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(target).port(state.config.smtp.port)
    };

    let builder = if state.config.smtp.username.is_empty() {
        builder
    } else {
        builder.credentials(Credentials::new(
            state.config.smtp.username.clone(),
            state.config.smtp.password.clone(),
        ))
    }
    .timeout(Some(Duration::from_secs(12)));

    builder
        .build()
        .send(email)
        .await
        .map_err(|e| AppError::internal(format!("SMTP send failed: {e}")))?;
    Ok(())
}
