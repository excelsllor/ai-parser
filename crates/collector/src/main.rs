mod extract;

use std::sync::Arc;

use chrono::Utc;
use news_shared::bus::{KafkaBus, MemoryBus};
use news_shared::config::Config;
use news_shared::db;
use news_shared::error::{AppError, AppResult};
use news_shared::models::{Item, ItemsCollectedEvent, RunStartedEvent};
use news_shared::redis_cache::RedisCache;
use news_shared::telemetry::{init_metrics, init_tracing, metrics};
use news_shared::text::{canonicalize_url, detect_injection};
use news_shared::TOPIC_ITEMS_COLLECTED;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Clone)]
pub struct CollectorState {
    pub config: Arc<Config>,
    pub pool: PgPool,
    pub redis: RedisCache,
    pub bus: KafkaBus,
}

impl CollectorState {
    async fn new() -> AppResult<Self> {
        let config = Arc::new(Config::from_env()?);
        init_tracing(config.log_json);
        init_metrics();
        tokio::fs::create_dir_all(&config.data_dir).await?;
        news_shared::registry::spawn_heartbeat(config.data_dir.clone(), "collector");
        let pool = db::init_db(&config).await?;
        let redis = RedisCache::new(&config.redis_url).await?;
        let bus = KafkaBus::new(&config)?;
        Ok(Self {
            config,
            pool,
            redis,
            bus,
        })
    }
}

#[tokio::main]
async fn main() -> AppResult<()> {
    let state = CollectorState::new().await?;
    tracing::info!("collector started");

    let handler_state = state.clone();
    state
        .bus
        .consume_forever(
            news_shared::TOPIC_RUN_STARTED,
            "collector",
            move |payload| {
                let state = handler_state.clone();
                async move { handle_run_started(state, payload).await }
            },
        )
        .await
}

async fn handle_run_started(state: CollectorState, payload: serde_json::Value) -> AppResult<()> {
    let event: RunStartedEvent = serde_json::from_value(payload)?;
    let run = db::get_run(&state.pool, event.run_id).await?;
    if run.status == "cancelled" {
        tracing::info!(run_id = %event.run_id, "run cancelled, skipping collection");
        return Ok(());
    }

    db::set_run_status(&state.pool, event.run_id, "running", None).await?;
    let stage_id = db::add_stage(&state.pool, event.run_id, "collect", "running", None).await?;
    metrics().active_runs.inc();

    let result = collect(&state, &event).await;

    match result {
        Ok((count, source_errors)) => {
            for error in &source_errors {
                let item = Item {
                    id: Uuid::new_v4(),
                    run_id: event.run_id,
                    external_id: format!("source-error:{}", error.source_name),
                    source_id: None,
                    source_name: error.source_name.clone(),
                    source_url: Some(error.source_url.clone()),
                    url: error.source_url.clone(),
                    canonical_url: String::new(),
                    title: format!("Ошибка источника: {}", error.source_name),
                    raw_text: String::new(),
                    clean_text: String::new(),
                    published_at: None,
                    date_confirmed: false,
                    status: "excluded".to_string(),
                    reason: Some(format!("источник недоступен: {}", error.error)),
                    group_key: None,
                    duplicate_of: None,
                    analysis: json!({"source_error": error.error}),
                    created_at: Utc::now(),
                };
                db::insert_item(&state.pool, &item).await?;
                db::upsert_journal(
                    &state.pool,
                    event.run_id,
                    item.id,
                    "исключён",
                    None,
                    item.reason.as_deref().unwrap_or(""),
                    Some(&error.error),
                )
                .await?;
            }
            let _ = db::finish_stage(
                &state.pool,
                stage_id,
                "completed",
                Some(&format!(
                    "collected {count} items, source errors: {}",
                    source_errors.len()
                )),
            )
            .await;
            metrics().active_runs.dec();
            state
                .bus
                .publish(
                    TOPIC_ITEMS_COLLECTED,
                    &event.run_id.to_string(),
                    &ItemsCollectedEvent {
                        run_id: event.run_id,
                        count: count + source_errors.len(),
                    },
                )
                .await?;
            tracing::info!(
                run_id = %event.run_id,
                count,
                source_errors = source_errors.len(),
                "collection completed"
            );
            Ok(())
        }
        Err(error) => {
            metrics().active_runs.dec();
            let message = error.to_string();
            let _ = db::finish_stage(&state.pool, stage_id, "failed", Some(&message)).await;
            let _ = db::set_run_status(&state.pool, event.run_id, "failed", Some(&message)).await;
            tracing::error!(run_id = %event.run_id, error = %message, "collection failed");
            Ok(())
        }
    }
}

async fn collect(
    state: &CollectorState,
    event: &RunStartedEvent,
) -> AppResult<(usize, Vec<extract::SourceFetchError>)> {
    let (articles, source_errors) = if event.mode == "file" {
        let dir = event
            .dataset_dir
            .as_deref()
            .ok_or_else(|| AppError::BadRequest("dataset_dir is required for file mode".into()))?;
        extract::read_dataset(
            std::path::Path::new(dir),
            &state.config.data_dir,
            state.config.max_articles_per_run,
        )
        .await?
    } else {
        extract::collect_live(state, &event.sources).await?
    };

    let mut count = 0;
    for article in articles.into_iter().take(state.config.max_articles_per_run) {
        let raw = format!("{} {}", article.title, article.text);
        let injection = detect_injection(&raw);
        let source_trust = article.source_trust.clone();
        let canonical = if article.url.is_empty() {
            String::new()
        } else {
            canonicalize_url(&article.url).unwrap_or_else(|| article.url.clone())
        };
        let item = Item {
            id: Uuid::new_v4(),
            run_id: event.run_id,
            external_id: article.external_id,
            source_id: article.source_id,
            source_name: article.source_name,
            source_url: Some(article.url.clone()),
            url: article.url,
            canonical_url: canonical,
            title: article.title,
            raw_text: article.text.clone(),
            clean_text: article.text,
            published_at: article.published_at,
            date_confirmed: article.date_confirmed,
            status: "collected".to_string(),
            reason: None,
            group_key: None,
            duplicate_of: None,
            analysis: json!({
                "injection_detected": injection.is_some(),
                "injection_snippet": injection,
                "source_trust": source_trust,
            }),
            created_at: Utc::now(),
        };
        db::insert_item(&state.pool, &item).await?;
        count += 1;
    }

    Ok((count, source_errors))
}

#[allow(dead_code)]
fn _memory_bus_for_tests() -> MemoryBus {
    MemoryBus::new(16)
}
