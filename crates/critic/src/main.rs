mod grpc;
mod prompts;

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use news_shared::bus::KafkaBus;
use news_shared::config::Config;
use news_shared::db;
use news_shared::error::AppResult;
use news_shared::llm::LlmClient;
use news_shared::models::{
    DigestDraftEvent, DigestVerifiedEvent, DraftEvent, VerificationCheck, VerificationReport,
};
use news_shared::redis_cache::RedisCache;
use news_shared::telemetry::{init_metrics, init_tracing};
use news_shared::text::{extract_numbers, remove_em_dash, truncate_chars};
use sqlx::PgPool;

#[derive(Clone)]
pub struct CriticState {
    pub config: Arc<Config>,
    pub pool: PgPool,
    pub redis: RedisCache,
    pub bus: KafkaBus,
    pub llm: LlmClient,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct CriticVerdict {
    #[serde(default)]
    supported: bool,
    #[serde(default)]
    confidence: f64,
    #[serde(default)]
    note: String,
}

#[tokio::main]
async fn main() -> AppResult<()> {
    let config = Arc::new(Config::from_env()?);
    init_tracing(config.log_json);
    init_metrics();
    tokio::fs::create_dir_all(&config.data_dir).await?;
    news_shared::registry::spawn_heartbeat(config.data_dir.clone(), "critic");
    let pool = db::init_db(&config).await?;
    let redis = RedisCache::new(&config.redis_url).await?;
    let bus = KafkaBus::new(&config)?;
    let llm = LlmClient::new(&config.llm, Some(redis.clone()))?;
    let state = CriticState {
        config,
        pool,
        redis,
        bus,
        llm,
    };

    tracing::info!("critic started");
    let grpc_state = state.clone();
    let grpc_addr = state.config.grpc_addr;
    tokio::spawn(async move {
        if let Err(error) = grpc::serve(grpc_state, grpc_addr).await {
            tracing::error!(error = %error, "critic gRPC server failed");
        }
    });

    if state.config.pipeline_transport == "kafka" {
        let handler_state = state.clone();
        state
            .bus
            .consume_forever(news_shared::TOPIC_DIGEST_DRAFT, "critic", move |payload| {
                let state = handler_state.clone();
                async move { handle(state, payload).await }
            })
            .await
    } else {
        tracing::info!("gRPC transport enabled; Kafka consumer disabled");
        tokio::signal::ctrl_c().await?;
        Ok(())
    }
}

pub(crate) async fn process_digest_draft(
    state: CriticState,
    draft: DigestDraftEvent,
) -> AppResult<DigestVerifiedEvent> {
    let run = db::get_run(&state.pool, draft.run_id).await?;
    if run.status == "cancelled" || run.status == "failed" {
        return Ok(DigestVerifiedEvent {
            run_id: draft.run_id,
            events: Vec::new(),
            verification: VerificationReport::default(),
            notes: vec!["прогон отменён или завершился ошибкой".to_string()],
        });
    }

    let stage_id = db::add_stage(&state.pool, draft.run_id, "critic", "running", None).await?;
    let llm_base_url = db::get_setting(&state.pool, "llm_base_url")
        .await?
        .and_then(|value| value.as_str().map(ToOwned::to_owned))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| state.config.llm.base_url.clone());
    let llm_api_key = db::get_setting(&state.pool, "llm_api_key")
        .await?
        .and_then(|value| value.as_str().map(str::trim).map(ToOwned::to_owned))
        .filter(|value| !value.is_empty())
        .or_else(|| state.config.llm.api_key.clone());
    let items = db::get_items(&state.pool, draft.run_id).await?;
    let source_texts: HashMap<uuid::Uuid, String> = items
        .iter()
        .map(|item| (item.id, format!("{} {}", item.title, item.clean_text)))
        .collect();
    let valid_item_ids: HashSet<uuid::Uuid> = items.iter().map(|i| i.id).collect();

    let mut checks = Vec::new();
    let mut unsupported_claims = 0usize;
    let mut contradictions = Vec::new();
    let mut notes = draft.notes.clone();
    let mut verified_events = Vec::new();
    let mut llm_calls_used = 0usize;

    for mut event in draft.events {
        if event.sources.is_empty() {
            notes.push(format!(
                "Событие «{}» исключено: нет источников.",
                event.title
            ));
            continue;
        }

        let before = event.sources.len();
        event
            .sources
            .retain(|source| valid_item_ids.contains(&source.item_id));
        if event.sources.len() != before {
            notes.push(format!(
                "Событие «{}»: удалены источники, отсутствующие в наборе.",
                event.title
            ));
        }
        if event.sources.is_empty() {
            notes.push(format!(
                "Событие «{}» исключено: источники не подтверждены.",
                event.title
            ));
            continue;
        }

        let source_text = event
            .sources
            .iter()
            .filter_map(|s| source_texts.get(&s.item_id))
            .cloned()
            .collect::<Vec<_>>()
            .join("\n");

        let mut event_unsupported = 0usize;
        for claim in &event.claims {
            let numbers = extract_numbers(claim);
            if numbers.is_empty() {
                continue;
            }
            let missing = numbers
                .iter()
                .filter(|n| !number_present(n, &source_text))
                .count();
            if missing == 0 {
                continue;
            }

            let mut supported_by_llm = false;
            if state.config.critic_llm && llm_calls_used < state.config.critic_max_llm_claims {
                llm_calls_used += 1;
                let user = prompts::prompt(claim, &truncate_chars(&source_text, 6000));
                match state
                    .llm
                    .with_api_key(llm_api_key.clone())
                    .chat_json_with_model::<CriticVerdict>(
                        &llm_base_url,
                        &run.model,
                        "critic_claim",
                        &run.prompt_version,
                        prompts::SYSTEM,
                        &user,
                    )
                    .await
                {
                    Ok(outcome) => {
                        supported_by_llm =
                            outcome.value.supported && outcome.value.confidence >= 0.5;
                        let _ = db::insert_llm_call(
                            &state.pool,
                            Some(draft.run_id),
                            "critic_claim",
                            &run.model,
                            &outcome.prompt_hash,
                            &run.prompt_version,
                            &outcome.usage,
                            outcome.cost,
                            outcome.latency_ms,
                            true,
                            None,
                        )
                        .await;
                        if !supported_by_llm && !outcome.value.note.is_empty() {
                            contradictions.push(format!(
                                "Утверждение «{}»: {}",
                                truncate_chars(claim, 120),
                                truncate_chars(&outcome.value.note, 200)
                            ));
                        }
                    }
                    Err(error) => {
                        tracing::warn!(error = %error, "LLM critic failed, using deterministic verdict");
                        let _ = db::insert_llm_call(
                            &state.pool,
                            Some(draft.run_id),
                            "critic_claim",
                            &run.model,
                            "unavailable",
                            &run.prompt_version,
                            &Default::default(),
                            0.0,
                            0,
                            false,
                            Some(&error.to_string()),
                        )
                        .await;
                    }
                }
            }

            if !supported_by_llm {
                event_unsupported += 1;
                if !contradictions
                    .iter()
                    .any(|note| note.contains(&truncate_chars(claim, 40)))
                {
                    contradictions.push(format!(
                        "Утверждение «{}» содержит числа, не найденные в источниках.",
                        truncate_chars(claim, 120)
                    ));
                }
            }
        }
        unsupported_claims += event_unsupported;

        let original_title = event.title.clone();
        event.title = clean_text(&event.title);
        event.summary = clean_text(&event.summary);
        event.consequences = clean_text(&event.consequences);
        event.justification = clean_text(&event.justification);
        event.title = truncate_chars(&event.title, 180);

        if event.title.trim().is_empty() {
            event.title = truncate_chars(&original_title, 180);
        }
        if event.summary.trim().is_empty() {
            event.summary = "Сведения о событии в публикации ограничены.".to_string();
        }
        if event.consequences.trim().is_empty() {
            event.consequences = "Сведения о последствиях в публикации не указаны.".to_string();
        }
        if event.justification.trim().is_empty() {
            event.justification =
                "Событие включено по совокупности сведений источника.".to_string();
        }

        if event_unsupported > 0 {
            event
                .summary
                .push_str(" Проверка: часть числовых данных не подтверждена текстом источников.");
        }

        verified_events.push(event);
    }

    verified_events.truncate((run.max_items.max(1) as usize).min(20));
    let events_count = verified_events.len();
    let no_em_dash = verified_events.iter().all(|e| {
        !e.title.contains('—')
            && !e.summary.contains('—')
            && !e.consequences.contains('—')
            && !e.justification.contains('—')
    });
    let sources_valid = verified_events.iter().all(|e| {
        !e.sources.is_empty()
            && e.sources
                .iter()
                .all(|s| !s.url.is_empty() || !s.source_name.is_empty())
    });

    checks.push(VerificationCheck {
        name: "sources_valid".to_string(),
        passed: sources_valid,
        detail: "все события содержат источники из набора".to_string(),
    });
    checks.push(VerificationCheck {
        name: "no_em_dash".to_string(),
        passed: no_em_dash,
        detail: "длинное тире отсутствует".to_string(),
    });
    checks.push(VerificationCheck {
        name: "claims_checked".to_string(),
        passed: unsupported_claims == 0,
        detail: format!("неподтверждённых утверждений: {unsupported_claims}"),
    });
    checks.push(VerificationCheck {
        name: "events_limit".to_string(),
        passed: events_count <= 5,
        detail: format!("событий: {events_count}"),
    });

    if events_count == 0 {
        notes.push("Подходящих событий за период нет.".to_string());
    } else if events_count < 5 && !notes.iter().any(|n| n.contains("меньше пяти")) {
        notes.push(format!(
            "Подходящих событий меньше пяти: найдено {events_count}."
        ));
    }

    let verification = VerificationReport {
        checks,
        unsupported_claims,
        contradictions,
        notes: notes.clone(),
    };

    db::replace_events(&state.pool, draft.run_id, &verified_events).await?;
    let _ = db::finish_stage(
        &state.pool,
        stage_id,
        "completed",
        Some(&format!("verified {events_count} events")),
    )
    .await;

    let verified = DigestVerifiedEvent {
        run_id: draft.run_id,
        events: verified_events,
        verification,
        notes,
    };
    tracing::info!(run_id = %draft.run_id, events = verified.events.len(), "critic completed");
    Ok(verified)
}

async fn handle(state: CriticState, payload: serde_json::Value) -> AppResult<()> {
    let draft: DigestDraftEvent = serde_json::from_value(payload)?;
    match process_digest_draft(state.clone(), draft).await {
        Ok(out) => {
            state
                .bus
                .publish(
                    news_shared::TOPIC_DIGEST_VERIFIED,
                    &out.run_id.to_string(),
                    &out,
                )
                .await?;
        }
        Err(error) => tracing::error!(error = %error, "critic failed"),
    }
    Ok(())
}

fn clean_text(text: &str) -> String {
    let cleaned = remove_em_dash(text);
    news_shared::text::normalize_whitespace(&cleaned)
}

fn number_present(number: &str, source_text: &str) -> bool {
    let variants = [
        number.to_string(),
        number.replace('.', ","),
        number.replace(',', "."),
    ];
    variants.iter().any(|v| source_text.contains(v))
}

#[allow(dead_code)]
fn _events_len(events: &[DraftEvent]) -> usize {
    events.len()
}
