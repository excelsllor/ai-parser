use std::sync::Arc;

use chrono::Utc;
use news_shared::bus::KafkaBus;
use news_shared::config::Config;
use news_shared::db;
use news_shared::error::AppResult;
use news_shared::models::{ItemsCollectedEvent, ItemsNormalizedEvent};
use news_shared::redis_cache::RedisCache;
use news_shared::telemetry::{init_metrics, init_tracing};
use news_shared::text::{
    canonicalize_url, contains_keyword, detect_injection, normalize_whitespace, similarity,
    strip_html,
};
use serde_json::json;
use sqlx::PgPool;

#[derive(Clone)]
pub struct NormalizerState {
    pub config: Arc<Config>,
    pub pool: PgPool,
    pub redis: RedisCache,
    pub bus: KafkaBus,
}

#[tokio::main]
async fn main() -> AppResult<()> {
    let config = Arc::new(Config::from_env()?);
    init_tracing(config.log_json);
    init_metrics();
    tokio::fs::create_dir_all(&config.data_dir).await?;
    news_shared::registry::spawn_heartbeat(config.data_dir.clone(), "normalizer");
    let pool = db::init_db(&config).await?;
    let redis = RedisCache::new(&config.redis_url).await?;
    let bus = KafkaBus::new(&config)?;
    let state = NormalizerState {
        config,
        pool,
        redis,
        bus,
    };

    tracing::info!("normalizer started");
    let handler_state = state.clone();
    state
        .bus
        .consume_forever(
            news_shared::TOPIC_ITEMS_COLLECTED,
            "normalizer",
            move |payload| {
                let state = handler_state.clone();
                async move { handle(state, payload).await }
            },
        )
        .await
}

async fn handle(state: NormalizerState, payload: serde_json::Value) -> AppResult<()> {
    let event: ItemsCollectedEvent = serde_json::from_value(payload)?;
    let run = db::get_run(&state.pool, event.run_id).await?;
    if run.status == "cancelled" || run.status == "failed" {
        tracing::info!(run_id = %event.run_id, "run is not active, skipping normalization");
        return Ok(());
    }

    let stage_id = db::add_stage(&state.pool, event.run_id, "normalize", "running", None).await?;
    let keywords = db::list_keywords(&state.pool)
        .await?
        .into_iter()
        .map(|k| k.word)
        .collect::<Vec<_>>();

    let mut items = db::get_items(&state.pool, event.run_id).await?;
    items.sort_by_key(|i| i.created_at);

    let mut canonical_seen: std::collections::HashMap<String, uuid::Uuid> =
        std::collections::HashMap::new();
    let mut title_seen: Vec<(String, uuid::Uuid)> = Vec::new();
    for existing in items.iter().filter(|item| item.status != "collected") {
        if !existing.canonical_url.is_empty() {
            canonical_seen
                .entry(existing.canonical_url.clone())
                .or_insert(existing.id);
        }
        if !existing.title.is_empty() {
            title_seen.push((existing.title.clone(), existing.id));
        }
    }
    let mut normalized = 0usize;

    for mut item in items {
        if item.status != "collected" {
            continue;
        }

        let clean = if item.clean_text.contains('<') && item.clean_text.contains('>') {
            strip_html(&item.clean_text)
        } else {
            normalize_whitespace(&item.clean_text)
        };

        item.clean_text = clean.clone();
        if item.title.trim().is_empty() {
            item.title = guess_title(&clean);
        }

        if clean.chars().count() < 120 {
            item.status = "excluded".to_string();
            item.reason = Some(
                "недостаточно данных для пересказа (только заголовок или обрывок текста)"
                    .to_string(),
            );
            db::insert_item(&state.pool, &item).await?;
            db::upsert_journal(
                &state.pool,
                event.run_id,
                item.id,
                "исключён",
                None,
                item.reason.as_deref().unwrap_or(""),
                None,
            )
            .await?;
            continue;
        }

        let parsed = match item.published_at {
            Some(value) => news_shared::text::ParsedDate {
                value: Some(value),
                confirmed: item.date_confirmed,
            },
            None => news_shared::text::ParsedDate::default(),
        };

        if !parsed.confirmed {
            item.status = "excluded".to_string();
            item.reason = Some("дата публикации не подтверждена".to_string());
            item.date_confirmed = false;
            db::insert_item(&state.pool, &item).await?;
            db::upsert_journal(
                &state.pool,
                event.run_id,
                item.id,
                "исключён",
                None,
                "дата публикации не подтверждена",
                None,
            )
            .await?;
            continue;
        }

        if let Some(published) = parsed.value {
            item.published_at = Some(published);
            if published <= run.period_start || published > run.period_end {
                item.status = "excluded".to_string();
                item.reason = Some(format!(
                    "публикация вне периода: {} не входит в ({}; {}]",
                    published, run.period_start, run.period_end
                ));
                db::insert_item(&state.pool, &item).await?;
                db::upsert_journal(
                    &state.pool,
                    event.run_id,
                    item.id,
                    "исключён",
                    None,
                    item.reason.as_deref().unwrap_or(""),
                    None,
                )
                .await?;
                continue;
            }
        } else {
            item.status = "excluded".to_string();
            item.reason = Some("не удалось разобрать дату публикации".to_string());
            db::insert_item(&state.pool, &item).await?;
            db::upsert_journal(
                &state.pool,
                event.run_id,
                item.id,
                "исключён",
                None,
                "не удалось разобрать дату публикации",
                None,
            )
            .await?;
            continue;
        }

        let canonical = if item.canonical_url.is_empty() {
            canonicalize_url(&item.url).unwrap_or_default()
        } else {
            item.canonical_url.clone()
        };
        item.canonical_url = canonical.clone();

        if !canonical.is_empty() {
            if let Some(existing) = canonical_seen.get(&canonical).copied() {
                item.status = "duplicate".to_string();
                item.duplicate_of = Some(existing);
                item.group_key = Some(canonical.clone());
                item.reason = Some("дубликат URL в наборе".to_string());
                db::insert_item(&state.pool, &item).await?;
                db::upsert_journal(
                    &state.pool,
                    event.run_id,
                    item.id,
                    "объединён",
                    Some(&canonical),
                    "дубликат URL в наборе",
                    None,
                )
                .await?;
                continue;
            }
            canonical_seen.insert(canonical.clone(), item.id);
        }

        if let Some((_, existing)) = title_seen
            .iter()
            .find(|(title, _)| similarity(title, &item.title) > 0.93)
        {
            item.status = "duplicate".to_string();
            item.duplicate_of = Some(*existing);
            item.group_key = Some(format!("title:{}", item.title.to_lowercase()));
            item.reason = Some("дубликат заголовка в наборе".to_string());
            db::insert_item(&state.pool, &item).await?;
            db::upsert_journal(
                &state.pool,
                event.run_id,
                item.id,
                "объединён",
                item.group_key.as_deref(),
                "дубликат заголовка в наборе",
                None,
            )
            .await?;
            continue;
        }
        title_seen.push((item.title.clone(), item.id));

        let keyword_hit = contains_keyword(&format!("{} {}", item.title, clean), &keywords);
        let injection = detect_injection(&format!("{} {}", item.title, clean));
        let ad = looks_like_ad(&clean);

        item.status = "normalized".to_string();
        item.reason = None;
        item.analysis = json!({
            "keyword_hit": keyword_hit,
            "injection_detected": injection.is_some(),
            "injection_snippet": injection,
            "ad_suspected": ad,
            "source_trust": item.analysis.get("source_trust").cloned().unwrap_or_else(|| json!("unknown")),
        });
        db::insert_item(&state.pool, &item).await?;

        let journal_reason = if injection.is_some() {
            "обнаружена посторонняя инструкция, обработана как данные"
        } else if keyword_hit {
            "материал относится к теме и входит в период"
        } else {
            "тема требует проверки моделью"
        };
        db::upsert_journal(
            &state.pool,
            event.run_id,
            item.id,
            "включён",
            Some(item.id.to_string().as_str()),
            journal_reason,
            None,
        )
        .await?;
        normalized += 1;
    }

    let _ = db::finish_stage(
        &state.pool,
        stage_id,
        "completed",
        Some(&format!("normalized {normalized} items")),
    )
    .await;

    state
        .bus
        .publish(
            news_shared::TOPIC_ITEMS_NORMALIZED,
            &event.run_id.to_string(),
            &ItemsNormalizedEvent {
                run_id: event.run_id,
                count: normalized,
            },
        )
        .await?;

    tracing::info!(run_id = %event.run_id, normalized, "normalization completed");
    Ok(())
}

fn guess_title(text: &str) -> String {
    let line = text
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("Без заголовка");
    news_shared::text::truncate_chars(line, 160)
}

fn looks_like_ad(text: &str) -> bool {
    let lower = text.to_lowercase();
    let ad_markers = [
        "купить",
        "скидка",
        "промокод",
        "реклама",
        "sponsored",
        "advertisement",
        "подпишись",
        "конкурс",
        "розыгрыш",
        "партнёрский материал",
    ];
    ad_markers.iter().any(|m| lower.contains(m))
}

#[allow(dead_code)]
fn _now() -> chrono::DateTime<Utc> {
    Utc::now()
}
