use std::collections::HashSet;
use std::time::Duration;

use axum::extract::{Extension, Path, Query, State};
use axum::Json;
use news_shared::audit::{write_audit, AuditRecord};
use news_shared::auth::AuthUser;
use news_shared::db;
use news_shared::error::{AppError, AppResult};
use news_shared::models::{Event, TelegramSubscriber};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::handlers::runs::{get_run_for_user, safe_artifact_path};
use crate::middleware::ClientIp;
use crate::state::AppState;

const TELEGRAM_API: &str = "https://api.telegram.org";
const MAX_MESSAGE_CHARS: usize = 4096;
const MAX_CAPTION_CHARS: usize = 1024;

pub fn validate_bot_token(value: &str) -> AppResult<()> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(());
    }
    let Some((bot_id, secret)) = value.split_once(':') else {
        return Err(AppError::Validation(
            "telegram bot token must have the form <bot_id>:<secret>".into(),
        ));
    };
    if bot_id.len() < 5
        || !bot_id.chars().all(|character| character.is_ascii_digit())
        || secret.len() < 20
        || value.chars().any(char::is_whitespace)
    {
        return Err(AppError::Validation(
            "telegram bot token has an invalid format".into(),
        ));
    }
    Ok(())
}

pub fn validate_chat_id(value: &str) -> AppResult<()> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(());
    }
    let valid = value
        .strip_prefix('@')
        .map(|name| {
            !name.is_empty()
                && name.len() <= 64
                && name
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric() || character == '_')
        })
        .unwrap_or_else(|| {
            value
                .trim_start_matches('-')
                .chars()
                .all(|character| character.is_ascii_digit())
                && value != "-"
        });
    if !valid {
        return Err(AppError::Validation(
            "telegram chat id must be numeric or @channel".into(),
        ));
    }
    Ok(())
}

async fn bot_token(state: &AppState) -> AppResult<String> {
    db::get_setting(&state.pool, "telegram_bot_token")
        .await?
        .and_then(|value| value.as_str().map(str::trim).map(ToOwned::to_owned))
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::BadRequest(
                "Telegram bot is not configured. Add a bot token in Admin -> Рассылки.".into(),
            )
        })
}

async fn target_chat_ids(state: &AppState) -> AppResult<Vec<String>> {
    let mut chats = Vec::new();
    let mut has_chat_ids = false;
    if let Some(value) = db::get_setting(&state.pool, "telegram_chat_ids").await? {
        has_chat_ids = true;
        match value {
            Value::Array(values) => {
                chats.extend(
                    values
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(ToOwned::to_owned),
                );
            }
            Value::String(value) => {
                chats.extend(
                    value
                        .split([',', '\n'])
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(ToOwned::to_owned),
                );
            }
            _ => {}
        }
    }
    if !has_chat_ids && chats.is_empty() {
        if let Some(value) = db::get_setting(&state.pool, "telegram_chat_id").await? {
            if let Some(value) = value
                .as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                chats.push(value.to_string());
            }
        }
    }
    let send_to_subscribers = db::get_setting(&state.pool, "telegram_send_to_subscribers")
        .await?
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    if send_to_subscribers {
        for subscriber in db::list_telegram_subscribers(&state.pool).await? {
            if subscriber.is_active {
                chats.push(subscriber.chat_id.to_string());
            }
        }
    }
    let mut seen = HashSet::new();
    chats.retain(|chat| seen.insert(chat.clone()));
    if chats.is_empty() {
        return Err(AppError::BadRequest(
            "Telegram chats are not configured. Add at least one chat in Admin -> Рассылки.".into(),
        ));
    }
    Ok(chats)
}

async fn call_api(
    _state: &AppState,
    token: &str,
    method: &str,
    payload: Option<Value>,
) -> AppResult<Value> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("CyberBug/1.0")
        .build()?;
    let url = format!("{TELEGRAM_API}/bot{token}/{method}");
    let request = if let Some(payload) = payload {
        client.post(url).json(&payload)
    } else {
        client.get(url)
    };
    let response = request
        .send()
        .await
        .map_err(|_| AppError::internal("Telegram API request failed"))?;
    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|_| AppError::internal("Telegram API returned invalid JSON"))?;
    if !status.is_success() || body.get("ok").and_then(Value::as_bool) != Some(true) {
        let description = body
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or("Telegram API request failed");
        return Err(AppError::BadRequest(format!("Telegram: {description}")));
    }
    Ok(body)
}

async fn read_post_text(state: &AppState, run_id: Uuid) -> AppResult<String> {
    let artifact = db::get_artifact(&state.pool, run_id, "post.md").await?;
    let path = safe_artifact_path(state, &artifact.path)?;
    let text = tokio::fs::read_to_string(path).await?;
    if text.trim().is_empty() {
        return Err(AppError::BadRequest(
            "post.md пуст, отправить в Telegram нечего".into(),
        ));
    }
    Ok(text)
}

fn truncate_message(text: &str) -> String {
    if text.chars().count() <= MAX_MESSAGE_CHARS {
        return text.to_string();
    }
    let mut truncated: String = text.chars().take(MAX_MESSAGE_CHARS - 3).collect();
    truncated.push_str("...");
    truncated
}

fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn host_label(value: &str) -> String {
    reqwest::Url::parse(value)
        .ok()
        .and_then(|url| {
            url.host_str()
                .map(|host| host.trim_start_matches("www.").to_string())
        })
        .filter(|host| !host.is_empty())
        .unwrap_or_else(|| value.to_string())
}

fn truncate_caption(text: &str) -> String {
    if text.chars().count() <= MAX_CAPTION_CHARS {
        return text.to_string();
    }
    let mut truncated: String = text.chars().take(MAX_CAPTION_CHARS - 3).collect();
    truncated.push_str("...");
    truncated
}

fn linkify_sources(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while !rest.is_empty() {
        let Some(start) = rest.find('[') else {
            out.push_str(&linkify_raw(rest));
            break;
        };
        out.push_str(&linkify_raw(&rest[..start]));
        let Some(close_rel) = rest[start..].find("](") else {
            out.push_str(&escape_html(&rest[start..]));
            break;
        };
        let close = start + close_rel;
        let url_start = close + 2;
        let Some(end_rel) = rest[url_start..].find(')') else {
            out.push_str(&escape_html(&rest[start..]));
            break;
        };
        let end = url_start + end_rel;
        let url = &rest[url_start..end];
        if url.starts_with("http://") || url.starts_with("https://") {
            let label = host_label(url);
            out.push_str(&format!(
                "<a href=\"{}\">{}</a>",
                escape_html(url),
                escape_html(&label)
            ));
            rest = &rest[end + 1..];
        } else {
            out.push_str(&escape_html(&rest[start..=start]));
            rest = &rest[start + 1..];
        }
    }
    out
}

fn linkify_raw(text: &str) -> String {
    let mut out = String::new();
    for token in text.split_whitespace() {
        if !out.is_empty() {
            out.push(' ');
        }
        if token.starts_with("http://") || token.starts_with("https://") {
            let escaped = escape_html(token);
            out.push_str(&format!(
                "<a href=\"{escaped}\">{}</a>",
                escape_html(&host_label(token))
            ));
        } else {
            out.push_str(&escape_html(token));
        }
    }
    out
}

fn numbered_title(line: &str) -> Option<(&str, &str)> {
    let (number, rest) = line.split_once('.')?;
    if number.is_empty()
        || !number.chars().all(|character| character.is_ascii_digit())
        || rest.trim().is_empty()
    {
        return None;
    }
    Some((number, rest.trim_start()))
}

fn format_post_for_telegram(text: &str) -> String {
    let lines: Vec<&str> = text.lines().map(str::trim).collect();
    let mut out = String::new();
    let mut index = 0usize;
    while index < lines.len() {
        let line = lines[index];
        if line.is_empty() {
            index += 1;
            continue;
        }
        if out.is_empty() {
            out.push_str(&format!("<b>{}</b>\n\n", escape_html(line)));
            index += 1;
            continue;
        }
        if let Some(period) = line.strip_prefix("Период:") {
            out.push_str(&format!("<i>Период:</i>{}\n\n", escape_html(period)));
            index += 1;
            continue;
        }
        if let Some((number, title)) = numbered_title(line) {
            out.push_str(&format!("<b>{number}. {}</b>\n", escape_html(title)));
            index += 1;
            let mut summary = Vec::new();
            while index < lines.len()
                && !lines[index].is_empty()
                && numbered_title(lines[index]).is_none()
                && !lines[index].starts_with("Источники:")
            {
                summary.push(lines[index]);
                index += 1;
            }
            if !summary.is_empty() {
                out.push_str(&escape_html(&summary.join(" ")));
                out.push('\n');
            }
            if index < lines.len() && lines[index].starts_with("Источники:") {
                let sources = lines[index].trim_start_matches("Источники:").trim();
                out.push_str("<i>Источники:</i> ");
                out.push_str(&linkify_sources(sources));
                out.push('\n');
                index += 1;
            }
            out.push('\n');
            continue;
        }
        out.push_str(&escape_html(line));
        out.push('\n');
        index += 1;
    }
    out.trim().to_string()
}

fn prepare_message(text: &str) -> String {
    let formatted = format_post_for_telegram(text);
    if formatted.chars().count() <= MAX_MESSAGE_CHARS {
        formatted
    } else {
        truncate_message(&escape_html(text))
    }
}

#[derive(Debug, Deserialize, Default)]
pub struct SendRunQuery {
    pub event_index: Option<usize>,
    #[serde(default)]
    pub all: bool,
}

struct SendOutcome {
    results: Vec<Value>,
    first_message_id: Option<i64>,
    last_error: Option<AppError>,
    sent: usize,
}

async fn send_photo_to_chats(
    state: &AppState,
    token: &str,
    chat_ids: &[String],
    photo: &str,
    caption: &str,
) -> SendOutcome {
    let mut outcome = SendOutcome {
        results: Vec::new(),
        first_message_id: None,
        last_error: None,
        sent: 0,
    };
    for chat_id in chat_ids {
        let payload = json!({
            "chat_id": chat_id,
            "photo": photo,
            "caption": truncate_caption(&prepare_message(caption)),
            "parse_mode": "HTML",
        });
        match call_api(state, token, "sendPhoto", Some(payload)).await {
            Ok(response) => {
                let message_id = response
                    .pointer("/result/message_id")
                    .and_then(Value::as_i64);
                if outcome.first_message_id.is_none() {
                    outcome.first_message_id = message_id;
                }
                outcome.sent += 1;
                outcome.results.push(json!({
                    "chat_id": chat_id,
                    "message_id": message_id,
                }));
            }
            Err(error) => {
                outcome.results.push(json!({
                    "chat_id": chat_id,
                    "error": error.to_string(),
                }));
                outcome.last_error = Some(error);
            }
        }
    }
    outcome
}

fn event_image(events: &[Event], index: usize) -> Option<String> {
    events
        .get(index)
        .and_then(|event| event.attributes.get("image_url"))
        .and_then(Value::as_str)
        .filter(|value| value.starts_with("http://") || value.starts_with("https://"))
        .map(str::to_string)
}

fn absorb(
    outcome: SendOutcome,
    first_message_id: &mut Option<i64>,
    results: &mut Vec<Value>,
    last_error: &mut Option<AppError>,
    sent: &mut usize,
) {
    if first_message_id.is_none() {
        *first_message_id = outcome.first_message_id;
    }
    *sent += outcome.sent;
    results.extend(outcome.results);
    if outcome.last_error.is_some() {
        *last_error = outcome.last_error;
    }
}

async fn send_text_to_chats(
    state: &AppState,
    token: &str,
    chat_ids: &[String],
    text: &str,
) -> SendOutcome {
    let mut outcome = SendOutcome {
        results: Vec::new(),
        first_message_id: None,
        last_error: None,
        sent: 0,
    };
    for chat_id in chat_ids {
        match send_message(state, token, chat_id, text).await {
            Ok(response) => {
                let message_id = response
                    .pointer("/result/message_id")
                    .and_then(Value::as_i64);
                if outcome.first_message_id.is_none() {
                    outcome.first_message_id = message_id;
                }
                outcome.sent += 1;
                outcome.results.push(json!({
                    "chat_id": chat_id,
                    "message_id": message_id,
                }));
            }
            Err(error) => {
                outcome.results.push(json!({
                    "chat_id": chat_id,
                    "error": error.to_string(),
                }));
                outcome.last_error = Some(error);
            }
        }
    }
    outcome
}

fn split_post_events(text: &str) -> (String, Vec<String>) {
    let mut header = Vec::new();
    let mut blocks = Vec::new();
    let mut current: Option<Vec<&str>> = None;
    for line in text.lines() {
        if numbered_title(line).is_some() {
            if let Some(block) = current.take() {
                blocks.push(block.join("\n").trim().to_string());
            }
            current = Some(vec![line]);
        } else if let Some(block) = current.as_mut() {
            block.push(line);
        } else {
            header.push(line);
        }
    }
    if let Some(block) = current {
        blocks.push(block.join("\n").trim().to_string());
    }
    (header.join("\n").trim().to_string(), blocks)
}

fn event_post(header: &str, block: &str) -> String {
    let mut lines = block.lines();
    let Some(first) = lines.next() else {
        return header.to_string();
    };
    let first = numbered_title(first)
        .map(|(_, title)| format!("1. {title}"))
        .unwrap_or_else(|| first.to_string());
    let rest = lines.collect::<Vec<_>>().join("\n");
    format!("{header}\n\n{first}\n{rest}").trim().to_string()
}

async fn send_message(
    state: &AppState,
    token: &str,
    chat_id: &str,
    text: &str,
) -> AppResult<Value> {
    call_api(
        state,
        token,
        "sendMessage",
        Some(json!({
            "chat_id": chat_id,
            "text": prepare_message(text),
            "parse_mode": "HTML",
            "disable_web_page_preview": true,
        })),
    )
    .await
}

pub async fn send_run(
    State(state): State<AppState>,
    user: AuthUser,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    Path(run_id): Path<Uuid>,
    Query(query): Query<SendRunQuery>,
) -> AppResult<Json<Value>> {
    user.require_write()?;
    let run = get_run_for_user(&state, &user, run_id).await?;
    let token = bot_token(&state).await?;
    let chat_ids = target_chat_ids(&state).await?;
    let text = read_post_text(&state, run_id).await?;
    let (header, blocks) = split_post_events(&text);
    let messages = if query.all && !blocks.is_empty() {
        blocks
            .iter()
            .enumerate()
            .map(|(index, block)| (event_post(&header, block), Some(index)))
            .collect::<Vec<_>>()
    } else if let Some(index) = query.event_index {
        let block = blocks
            .get(index)
            .ok_or_else(|| AppError::BadRequest("event not found in post".into()))?;
        vec![(event_post(&header, block), Some(index))]
    } else {
        vec![(text, None)]
    };
    let events = if run.policy_flags().include_images {
        db::get_events(&state.pool, run_id)
            .await
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    let mut results = Vec::new();
    let mut first_message_id = None;
    let mut last_error = None;
    let mut sent = 0;
    for (message, index) in &messages {
        let mut photo_sent = false;
        if let Some(index) = index {
            if let Some(photo) = event_image(&events, *index) {
                let caption = if message.chars().count() <= MAX_CAPTION_CHARS {
                    message.clone()
                } else {
                    message
                        .lines()
                        .find(|line| numbered_title(line).is_some())
                        .unwrap_or(message)
                        .to_string()
                };
                let outcome =
                    send_photo_to_chats(&state, &token, &chat_ids, &photo, &caption).await;
                photo_sent = outcome.sent > 0;
                absorb(
                    outcome,
                    &mut first_message_id,
                    &mut results,
                    &mut last_error,
                    &mut sent,
                );
            }
        }
        if !photo_sent || message.chars().count() > MAX_CAPTION_CHARS {
            let outcome = send_text_to_chats(&state, &token, &chat_ids, message).await;
            absorb(
                outcome,
                &mut first_message_id,
                &mut results,
                &mut last_error,
                &mut sent,
            );
        }
    }
    if sent == 0 {
        return Err(last_error
            .unwrap_or_else(|| AppError::BadRequest("Telegram send failed for all chats".into())));
    }

    let _ = write_audit(
        &state.pool,
        &AuditRecord::new(
            Some(user.id),
            user.username.clone(),
            "telegram.send",
            format!("run:{run_id}"),
            json!({"targets": results, "message_id": first_message_id, "messages": sent}),
            ip,
        ),
    )
    .await;

    Ok(Json(json!({
        "sent": true,
        "messages": sent,
        "targets": results,
        "message_id": first_message_id,
    })))
}

pub async fn test_bot(State(state): State<AppState>, user: AuthUser) -> AppResult<Json<Value>> {
    user.require_admin()?;
    let token = bot_token(&state).await?;
    let response = call_api(&state, &token, "getMe", None).await?;
    let username = response
        .pointer("/result/username")
        .and_then(Value::as_str)
        .unwrap_or("");
    Ok(Json(json!({"ok": true, "username": username})))
}

pub async fn list_subscribers(
    State(state): State<AppState>,
    user: AuthUser,
) -> AppResult<Json<Vec<TelegramSubscriber>>> {
    user.require_admin()?;
    Ok(Json(db::list_telegram_subscribers(&state.pool).await?))
}

pub async fn sync_subscribers(
    State(state): State<AppState>,
    user: AuthUser,
) -> AppResult<Json<Value>> {
    user.require_admin()?;
    let token = bot_token(&state).await?;
    let response = call_api(
        &state,
        &token,
        "getUpdates?timeout=0&allowed_updates=%5B%22message%22%2C%22my_chat_member%22%5D",
        None,
    )
    .await?;

    let updates = response
        .get("result")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut updated = 0usize;
    for update in updates {
        let chat = update
            .pointer("/message/chat")
            .or_else(|| update.pointer("/my_chat_member/chat"));
        let Some(chat) = chat else {
            continue;
        };
        let Some(chat_id) = chat.get("id").and_then(Value::as_i64) else {
            continue;
        };
        let chat_type = chat
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("private");
        let title = chat.get("title").and_then(Value::as_str).unwrap_or("");
        let username = chat.get("username").and_then(Value::as_str);
        let first_name = chat.get("first_name").and_then(Value::as_str).unwrap_or("");
        let last_name = chat.get("last_name").and_then(Value::as_str).unwrap_or("");
        db::upsert_telegram_subscriber(
            &state.pool,
            chat_id,
            chat_type,
            title,
            username,
            first_name,
            last_name,
        )
        .await?;
        updated += 1;
    }

    let subscribers = db::list_telegram_subscribers(&state.pool).await?;
    Ok(Json(
        json!({"updated": updated, "subscribers": subscribers}),
    ))
}

#[derive(Debug, Deserialize)]
pub struct SubscriberStateRequest {
    pub active: bool,
}

pub async fn set_subscriber_active(
    State(state): State<AppState>,
    user: AuthUser,
    Path(chat_id): Path<i64>,
    Json(payload): Json<SubscriberStateRequest>,
) -> AppResult<Json<Value>> {
    user.require_admin()?;
    db::set_telegram_subscriber_active(&state.pool, chat_id, payload.active).await?;
    Ok(Json(
        json!({"ok": true, "chat_id": chat_id, "active": payload.active}),
    ))
}

#[cfg(test)]
mod tests {
    use super::{validate_bot_token, validate_chat_id};

    #[test]
    fn accepts_telegram_bot_token_shape() {
        assert!(validate_bot_token("123456789:AAH-abcdefghijklmnopqrstuvwxyz_123456").is_ok());
        assert!(validate_bot_token("").is_ok());
    }

    #[test]
    fn rejects_malformed_telegram_bot_token() {
        assert!(validate_bot_token("not-a-token").is_err());
        assert!(validate_bot_token("abc:AAH-abcdefghijklmnopqrstuvwxyz_123456").is_err());
        assert!(validate_bot_token("123456:short").is_err());
    }

    #[test]
    fn accepts_numeric_and_channel_chat_ids() {
        assert!(validate_chat_id("-1001234567890").is_ok());
        assert!(validate_chat_id("@cyberbug_channel").is_ok());
        assert!(validate_chat_id("").is_ok());
    }

    #[test]
    fn rejects_malformed_chat_id() {
        assert!(validate_chat_id("channel name").is_err());
        assert!(validate_chat_id("abc").is_err());
    }
}
