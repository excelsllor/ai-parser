mod grpc;

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
    let grpc_state = state.clone();
    let grpc_addr = state.config.grpc_addr;
    tokio::spawn(async move {
        if let Err(error) = grpc::serve(grpc_state, grpc_addr).await {
            tracing::error!(error = %error, "normalizer gRPC server failed");
        }
    });

    if state.config.pipeline_transport == "kafka" {
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
    } else {
        tracing::info!("gRPC transport enabled; Kafka consumer disabled");
        tokio::signal::ctrl_c().await?;
        Ok(())
    }
}

pub(crate) async fn process_items_collected(
    state: NormalizerState,
    event: ItemsCollectedEvent,
) -> AppResult<ItemsNormalizedEvent> {
    let run = db::get_run(&state.pool, event.run_id).await?;
    if run.status == "cancelled" || run.status == "failed" {
        tracing::info!(run_id = %event.run_id, "run is not active, skipping normalization");
        return Ok(ItemsNormalizedEvent {
            run_id: event.run_id,
            count: 0,
        });
    }

    let stage_id = db::add_stage(&state.pool, event.run_id, "normalize", "running", None).await?;
    let policies = run.policy_flags();
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
        let injection = detect_injection(&format!("{} {}", item.title, clean));

        let parsed = match item.published_at {
            Some(value) => news_shared::text::ParsedDate {
                value: Some(value),
                confirmed: item.date_confirmed,
            },
            None => news_shared::text::ParsedDate::default(),
        };

        if !parsed.confirmed {
            let reason = with_injection("дата публикации не подтверждена", &injection);
            item.status = "excluded".to_string();
            item.reason = Some(reason.clone());
            item.date_confirmed = false;
            db::insert_item(&state.pool, &item).await?;
            db::upsert_journal(
                &state.pool,
                event.run_id,
                item.id,
                "исключён",
                None,
                &reason,
                None,
            )
            .await?;
            continue;
        }

        if let Some(published) = parsed.value {
            item.published_at = Some(published);
            if published <= run.period_start || published > run.period_end {
                let reason = with_injection(
                    &format!(
                        "публикация вне периода: {} не входит в ({}; {}]",
                        published, run.period_start, run.period_end
                    ),
                    &injection,
                );
                item.status = "excluded".to_string();
                item.reason = Some(reason.clone());
                db::insert_item(&state.pool, &item).await?;
                db::upsert_journal(
                    &state.pool,
                    event.run_id,
                    item.id,
                    "исключён",
                    None,
                    &reason,
                    None,
                )
                .await?;
                continue;
            }
        } else {
            let reason = with_injection("не удалось разобрать дату публикации", &injection);
            item.status = "excluded".to_string();
            item.reason = Some(reason.clone());
            db::insert_item(&state.pool, &item).await?;
            db::upsert_journal(
                &state.pool,
                event.run_id,
                item.id,
                "исключён",
                None,
                &reason,
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

        if policies.dedup && !canonical.is_empty() {
            if let Some(existing) = canonical_seen.get(&canonical).copied() {
                item.status = "duplicate".to_string();
                item.duplicate_of = Some(existing);
                item.group_key = Some(canonical.clone());
                let reason = with_injection("дубликат URL в наборе", &injection);
                item.reason = Some(reason.clone());
                db::insert_item(&state.pool, &item).await?;
                db::upsert_journal(
                    &state.pool,
                    event.run_id,
                    item.id,
                    "объединён",
                    Some(&canonical),
                    &reason,
                    None,
                )
                .await?;
                continue;
            }
            canonical_seen.insert(canonical.clone(), item.id);
        }

        if policies.dedup {
            if let Some((_, existing)) = title_seen
                .iter()
                .find(|(title, _)| similarity(title, &item.title) > 0.93)
            {
                item.status = "duplicate".to_string();
                item.duplicate_of = Some(*existing);
                item.group_key = Some(format!("title:{}", item.title.to_lowercase()));
                let reason = with_injection("дубликат заголовка в наборе", &injection);
                item.reason = Some(reason.clone());
                db::insert_item(&state.pool, &item).await?;
                db::upsert_journal(
                    &state.pool,
                    event.run_id,
                    item.id,
                    "объединён",
                    item.group_key.as_deref(),
                    &reason,
                    None,
                )
                .await?;
                continue;
            }
            title_seen.push((item.title.clone(), item.id));
        }

        if clean.chars().count() < 80 {
            let reason = with_injection(
                "недостаточно данных для пересказа (только заголовок или обрывок текста)",
                &injection,
            );
            item.status = "excluded".to_string();
            item.reason = Some(reason.clone());
            db::insert_item(&state.pool, &item).await?;
            db::upsert_journal(
                &state.pool,
                event.run_id,
                item.id,
                "исключён",
                None,
                &reason,
                None,
            )
            .await?;
            continue;
        }

        let keyword_hit = contains_keyword(&format!("{} {}", item.title, clean), &keywords);
        let injection_detected = injection.is_some();
        let ad = looks_like_ad(&clean);

        item.status = "normalized".to_string();
        item.reason = None;
        item.analysis = json!({
            "keyword_hit": keyword_hit,
            "injection_detected": injection_detected,
            "injection_snippet": injection,
            "ad_suspected": ad,
            "source_trust": item.analysis.get("source_trust").cloned().unwrap_or_else(|| json!("unknown")),
        });
        db::insert_item(&state.pool, &item).await?;

        let journal_reason = if injection_detected {
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

    tracing::info!(run_id = %event.run_id, normalized, "normalization completed");
    Ok(ItemsNormalizedEvent {
        run_id: event.run_id,
        count: normalized,
    })
}

async fn handle(state: NormalizerState, payload: serde_json::Value) -> AppResult<()> {
    let event: ItemsCollectedEvent = serde_json::from_value(payload)?;
    match process_items_collected(state.clone(), event).await {
        Ok(out) => {
            state
                .bus
                .publish(
                    news_shared::TOPIC_ITEMS_NORMALIZED,
                    &out.run_id.to_string(),
                    &out,
                )
                .await?;
        }
        Err(error) => tracing::error!(error = %error, "normalization failed"),
    }
    Ok(())
}

fn with_injection(reason: &str, injection: &Option<String>) -> String {
    if injection.is_some() {
        format!("{reason}; обнаружена посторонняя инструкция")
    } else {
        reason.to_string()
    }
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
