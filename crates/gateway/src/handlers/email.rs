use std::time::Duration;

use lettre::message::header::ContentType;
use lettre::transport::smtp::authentication::Credentials;
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

    let builder = if state.config.smtp.tls && state.config.smtp.starttls {
        AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&state.config.smtp.host)
            .map_err(|e| AppError::internal(format!("SMTP STARTTLS init failed: {e}")))?
            .port(state.config.smtp.port)
    } else if state.config.smtp.tls {
        AsyncSmtpTransport::<Tokio1Executor>::relay(&state.config.smtp.host)
            .map_err(|e| AppError::internal(format!("SMTP relay init failed: {e}")))?
            .port(state.config.smtp.port)
    } else {
        AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&state.config.smtp.host)
            .port(state.config.smtp.port)
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
