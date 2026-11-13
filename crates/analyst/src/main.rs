mod grpc;
mod prompts;

use std::collections::HashMap;
use std::sync::Arc;

use chrono::Utc;
use futures::StreamExt;
use news_shared::bus::KafkaBus;
use news_shared::config::{Config, ScoringWeights};
use news_shared::db;
use news_shared::error::{AppError, AppResult};
use news_shared::llm::LlmClient;
use news_shared::models::{
    DigestDraftEvent, DraftEvent, DraftSource, EventAttributes, Item, ItemsNormalizedEvent,
    LlmItemAnalysis, RunPolicies,
};
use news_shared::redis_cache::RedisCache;
use news_shared::telemetry::{init_metrics, init_tracing};
use news_shared::text::{sha256_hex, slugify, truncate_chars};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Clone)]
pub struct AnalystState {
    pub config: Arc<Config>,
    pub pool: PgPool,
    pub redis: RedisCache,
    pub bus: KafkaBus,
    pub llm: LlmClient,
}

#[derive(Debug, Clone)]
struct AnalyzedItem {
    item: Item,
    analysis: LlmItemAnalysis,
}

#[tokio::main]
async fn main() -> AppResult<()> {
    let config = Arc::new(Config::from_env()?);
    init_tracing(config.log_json);
    init_metrics();
    tokio::fs::create_dir_all(&config.data_dir).await?;
    news_shared::registry::spawn_heartbeat(config.data_dir.clone(), "analyst");
    let pool = db::init_db(&config).await?;
    let redis = RedisCache::new(&config.redis_url).await?;
    let bus = KafkaBus::new(&config)?;
    let llm = LlmClient::new(&config.llm, Some(redis.clone()))?;
    let state = AnalystState {
        config,
        pool,
        redis,
        bus,
        llm,
    };

    tracing::info!("analyst started");
    let grpc_state = state.clone();
    let grpc_addr = state.config.grpc_addr;
    tokio::spawn(async move {
        if let Err(error) = grpc::serve(grpc_state, grpc_addr).await {
            tracing::error!(error = %error, "analyst gRPC server failed");
        }
    });

    if state.config.pipeline_transport == "kafka" {
        let handler_state = state.clone();
        state
            .bus
            .consume_forever(
                news_shared::TOPIC_ITEMS_NORMALIZED,
                "analyst",
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

pub(crate) async fn process_items_normalized(
    state: AnalystState,
    event: ItemsNormalizedEvent,
) -> AppResult<DigestDraftEvent> {
    let run = db::get_run(&state.pool, event.run_id).await?;
    if run.status == "cancelled" || run.status == "failed" {
        return Ok(DigestDraftEvent {
            run_id: event.run_id,
            events: Vec::new(),
            notes: vec!["прогон отменён или завершился ошибкой".to_string()],
            model: run.model,
            prompt_version: run.prompt_version,
        });
    }

    let stage_id = db::add_stage(&state.pool, event.run_id, "analyze", "running", None).await?;
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
    let policies = run.policy_flags();
    let all_items = db::get_items(&state.pool, event.run_id).await?;
    let mut duplicates: HashMap<Uuid, Vec<Item>> = HashMap::new();
    for item in all_items.iter().filter(|i| i.status == "duplicate") {
        if let Some(target) = item.duplicate_of {
            duplicates.entry(target).or_default().push(item.clone());
        }
    }

    let normalized = all_items
        .iter()
        .filter(|i| i.status == "normalized")
        .cloned()
        .collect::<Vec<_>>();

    // Incremental runs (add publication) must keep previously analyzed events.
    let existing_analyzed = all_items
        .iter()
        .filter(|i| i.status == "analyzed")
        .filter_map(|item| {
            let analysis = item.analysis.get("analysis")?.clone();
            let analysis = serde_json::from_value::<LlmItemAnalysis>(analysis).ok()?;
            Some(AnalyzedItem {
                item: item.clone(),
                analysis,
            })
        })
        .collect::<Vec<_>>();

    let concurrency = state.config.llm.concurrency.max(1);
    let analyzed = futures::stream::iter(normalized)
        .map(|item| {
            let state = state.clone();
            let run_id = event.run_id;
            let prompt_version = run.prompt_version.clone();
            let model = run.model.clone();
            let llm_base_url = llm_base_url.clone();
            let llm_api_key = llm_api_key.clone();
            let policies = policies.clone();
            async move {
                analyze_item(
                    state,
                    run_id,
                    llm_base_url,
                    llm_api_key,
                    model,
                    prompt_version,
                    policies,
                    item,
                )
                .await
            }
        })
        .buffer_unordered(concurrency)
        .collect::<Vec<AppResult<AnalyzedItem>>>()
        .await;

    let mut accepted: Vec<AnalyzedItem> = Vec::new();
    for result in analyzed {
        match result {
            Ok(item) => {
                let analysis = &item.analysis;
                let include = analysis.relevant
                    && !analysis.ad
                    && !analysis.insufficient_data
                    && analysis.topic_confidence >= 0.5;

                if !include {
                    let llm_used = item
                        .item
                        .analysis
                        .get("llm_used")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    let reason = if !llm_used {
                        "модель недоступна, использован экстрактивный fallback"
                    } else if analysis.ad {
                        "рекламный или партнёрский материал"
                    } else if !analysis.relevant {
                        "публикация не относится к теме кибербезопасности"
                    } else if analysis.insufficient_data {
                        "недостаточно данных для пересказа"
                    } else {
                        "низкая уверенность тематической классификации"
                    };
                    db::update_item_status(
                        &state.pool,
                        item.item.id,
                        "excluded",
                        Some(reason),
                        None,
                        None,
                    )
                    .await?;
                    db::upsert_journal(
                        &state.pool,
                        event.run_id,
                        item.item.id,
                        "исключён",
                        None,
                        reason,
                        None,
                    )
                    .await?;
                } else {
                    accepted.push(item);
                }
            }
            Err(error) => {
                tracing::error!(error = %error, "item analysis failed");
            }
        }
    }

    accepted.extend(existing_analyzed);

    let mut groups: HashMap<String, Vec<AnalyzedItem>> = HashMap::new();
    for item in accepted {
        let key = if item.analysis.event_key.trim().is_empty() {
            slugify(&item.item.title, 80)
        } else {
            slugify(&item.analysis.event_key, 80)
        };
        groups.entry(key).or_default().push(item);
    }

    let weights = db::get_setting(&state.pool, "weights")
        .await?
        .and_then(|value| serde_json::from_value::<ScoringWeights>(value).ok())
        .unwrap_or_else(|| state.config.weights.clone());

    let mut drafts = Vec::new();
    for (event_key, group) in groups {
        let primary = group
            .iter()
            .max_by(|a, b| {
                let a_primary = a.analysis.primary_source
                    || a.item
                        .analysis
                        .get("source_trust")
                        .and_then(|v| v.as_str())
                        .map(|v| v == "primary")
                        .unwrap_or(false);
                let b_primary = b.analysis.primary_source
                    || b.item
                        .analysis
                        .get("source_trust")
                        .and_then(|v| v.as_str())
                        .map(|v| v == "primary")
                        .unwrap_or(false);
                a_primary.cmp(&b_primary).then_with(|| {
                    a.analysis
                        .confidence
                        .partial_cmp(&b.analysis.confidence)
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
            })
            .ok_or_else(|| AppError::internal("empty event group"))?;

        let mut sources = Vec::new();
        let mut seen_urls = std::collections::HashSet::new();
        for member in &group {
            push_source(
                &mut sources,
                &mut seen_urls,
                &member.item,
                member.item.id == primary.item.id,
            );
            if let Some(dups) = duplicates.get(&member.item.id) {
                for dup in dups {
                    push_source(&mut sources, &mut seen_urls, dup, false);
                }
            }
        }

        sources.sort_by_key(|source| !source.is_primary);
        let attributes = EventAttributes {
            impact: primary.analysis.impact,
            scale: primary.analysis.scale,
            urgency: primary.analysis.urgency,
            relevance: primary.analysis.relevance,
            confidence: primary.analysis.confidence,
            uncertainty: primary.analysis.uncertainty,
            organizations: primary.analysis.organizations.clone(),
            systems: primary.analysis.systems.clone(),
            date_unconfirmed: !primary.item.date_confirmed,
            image_url: primary
                .item
                .analysis
                .get("image_url")
                .and_then(|value| value.as_str())
                .map(str::to_string),
        };
        let score = score_event(&weights, &attributes);
        let title = if primary.analysis.title.trim().is_empty() {
            primary.item.title.clone()
        } else {
            primary.analysis.title.clone()
        };
        let summary = build_summary(primary);
        let mut consequences = if primary.analysis.consequences.trim().is_empty() {
            "Сведения о последствиях в публикации не указаны.".to_string()
        } else {
            primary.analysis.consequences.clone()
        };
        if !primary.analysis.caveats.is_empty() {
            consequences.push_str(" Оговорка: ");
            consequences.push_str(&primary.analysis.caveats.join("; "));
        }
        let justification = justification(&primary.analysis, &primary.item);

        let draft = DraftEvent {
            event_key: event_key.clone(),
            title,
            summary,
            consequences,
            justification,
            sources,
            score,
            attributes,
            claims: primary.analysis.facts.clone(),
        };

        for member in &group {
            let is_primary = member.item.id == primary.item.id;
            let injected = member
                .item
                .analysis
                .get("injection_detected")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let reason = match (is_primary, injected) {
                (true, true) => "событие включено в дайджест; обнаружена посторонняя инструкция",
                (true, false) => "событие включено в дайджест",
                (false, true) => {
                    "сообщение об одном событии объединено; обнаружена посторонняя инструкция"
                }
                (false, false) => "сообщение об одном событии объединено",
            };
            db::upsert_journal(
                &state.pool,
                event.run_id,
                member.item.id,
                if is_primary {
                    "включён"
                } else {
                    "объединён"
                },
                Some(&event_key),
                reason,
                None,
            )
            .await?;
        }
        if let Some(dups) = duplicates.get(&primary.item.id) {
            for dup in dups {
                db::upsert_journal(
                    &state.pool,
                    event.run_id,
                    dup.id,
                    "объединён",
                    Some(&event_key),
                    "дубликат объединён с основным сообщением",
                    None,
                )
                .await?;
            }
        }

        drafts.push(draft);
    }

    drafts.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let total_events = drafts.len();
    drafts.truncate(5);

    let mut notes = Vec::new();
    if drafts.is_empty() {
        notes.push("Подходящих событий за период нет.".to_string());
    } else if drafts.len() < 5 {
        notes.push(format!(
            "Подходящих событий меньше пяти: найдено {}.",
            drafts.len()
        ));
    }
    if total_events > 5 {
        notes.push(format!(
            "Из {} подходящих событий выбраны пять наиболее значимых.",
            total_events
        ));
    }

    db::replace_events(&state.pool, event.run_id, &drafts).await?;

    let _ = db::finish_stage(
        &state.pool,
        stage_id,
        "completed",
        Some(&format!("selected {} events", drafts.len())),
    )
    .await;

    let draft_event = DigestDraftEvent {
        run_id: event.run_id,
        events: drafts,
        notes,
        model: run.model.clone(),
        prompt_version: run.prompt_version.clone(),
    };
    tracing::info!(run_id = %event.run_id, events = draft_event.events.len(), "analysis completed");
    Ok(draft_event)
}

async fn handle(state: AnalystState, payload: serde_json::Value) -> AppResult<()> {
    let event: ItemsNormalizedEvent = serde_json::from_value(payload)?;
    match process_items_normalized(state.clone(), event).await {
        Ok(out) => {
            state
                .bus
                .publish(
                    news_shared::TOPIC_DIGEST_DRAFT,
                    &out.run_id.to_string(),
                    &out,
                )
                .await?;
        }
        Err(error) => tracing::error!(error = %error, "analysis failed"),
    }
    Ok(())
}

async fn analyze_item(
    state: AnalystState,
    run_id: Uuid,
    llm_base_url: String,
    llm_api_key: Option<String>,
    model: String,
    prompt_version: String,
    policies: RunPolicies,
    item: Item,
) -> AppResult<AnalyzedItem> {
    let text = truncate_chars(&item.clean_text, state.config.max_article_chars);
    let published = item
        .published_at
        .map(|d| d.to_rfc3339())
        .unwrap_or_else(|| "не указана".to_string());
    let source_trust = item
        .analysis
        .get("source_trust")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let user = prompts::user_prompt(
        &item.external_id,
        &item.source_name,
        source_trust,
        &item.url,
        &published,
        &item.title,
        &text,
        policies.injection_guard,
    );
    let system = prompts::system(&policies);

    let result = state
        .llm
        .with_api_key(llm_api_key)
        .chat_json_with_model::<LlmItemAnalysis>(
            &llm_base_url,
            &model,
            "item_analysis",
            &prompt_version,
            &system,
            &user,
        )
        .await;

    match result {
        Ok(outcome) => {
            let mut analysis = outcome.value;
            analysis.topic_confidence = analysis.topic_confidence.clamp(0.0, 1.0);
            for value in [
                &mut analysis.urgency,
                &mut analysis.scale,
                &mut analysis.impact,
                &mut analysis.relevance,
                &mut analysis.confidence,
                &mut analysis.uncertainty,
            ] {
                *value = value.clamp(0.0, 5.0);
            }
            if analysis.title.trim().is_empty() {
                analysis.title = item.title.clone();
            }
            if analysis.summary.trim().is_empty() {
                analysis.insufficient_data = true;
            }
            if item
                .analysis
                .get("ad_suspected")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
                && analysis.topic_confidence < 0.5
            {
                analysis.ad = true;
            }
            if item
                .analysis
                .get("injection_detected")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                analysis.injection_detected = true;
            }

            let analysis_json = json!({
                "llm_used": true,
                "cache_hit": outcome.cache_hit,
                "prompt_hash": outcome.prompt_hash,
                "prompt_version": prompt_version,
                "keyword_hit": item.analysis.get("keyword_hit").cloned().unwrap_or(json!(false)),
                "source_trust": item.analysis.get("source_trust").cloned().unwrap_or(json!("unknown")),
                "injection_detected": item.analysis.get("injection_detected").cloned().unwrap_or(json!(false)),
                "ad_suspected": item.analysis.get("ad_suspected").cloned().unwrap_or(json!(false)),
                "analysis": &analysis,
            });
            db::update_item_analysis(&state.pool, item.id, analysis_json, None).await?;

            let _ = db::insert_llm_call(
                &state.pool,
                Some(run_id),
                "item_analysis",
                &model,
                &outcome.prompt_hash,
                &prompt_version,
                &outcome.usage,
                outcome.cost,
                outcome.latency_ms,
                true,
                None,
            )
            .await;

            Ok(AnalyzedItem { item, analysis })
        }
        Err(error) => {
            tracing::warn!(item_id = %item.id, error = %error, "LLM unavailable, using fallback");
            let analysis = fallback_analysis(&item);
            let prompt_hash = sha256_hex(user.as_bytes());
            let analysis_json = json!({
                "llm_used": false,
                "prompt_hash": prompt_hash,
                "prompt_version": prompt_version,
                "keyword_hit": item.analysis.get("keyword_hit").cloned().unwrap_or(json!(false)),
                "source_trust": item.analysis.get("source_trust").cloned().unwrap_or(json!("unknown")),
                "injection_detected": item.analysis.get("injection_detected").cloned().unwrap_or(json!(false)),
                "ad_suspected": item.analysis.get("ad_suspected").cloned().unwrap_or(json!(false)),
                "analysis": &analysis,
                "error": error.to_string(),
            });
            db::update_item_analysis(&state.pool, item.id, analysis_json, None).await?;
            let _ = db::insert_llm_call(
                &state.pool,
                Some(run_id),
                "item_analysis",
                &model,
                &prompt_hash,
                &prompt_version,
                &Default::default(),
                0.0,
                0,
                false,
                Some(&error.to_string()),
            )
            .await;
            Ok(AnalyzedItem { item, analysis })
        }
    }
}

fn fallback_analysis(item: &Item) -> LlmItemAnalysis {
    let keyword_hit = item
        .analysis
        .get("keyword_hit")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let mut summary = truncate_chars(
        &news_shared::text::normalize_whitespace(&item.clean_text),
        400,
    );
    if let Some(snippet) = news_shared::text::detect_injection(&summary) {
        summary = summary.replace(&snippet, "[фрагмент с посторонней инструкцией удалён]");
    }
    LlmItemAnalysis {
        relevant: keyword_hit,
        topic_confidence: if keyword_hit { 0.55 } else { 0.2 },
        title: item.title.clone(),
        summary,
        consequences: "Сведения о последствиях в публикации не указаны.".to_string(),
        organizations: Vec::new(),
        systems: Vec::new(),
        urgency: 2.0,
        scale: 1.0,
        impact: 2.0,
        relevance: if keyword_hit { 3.0 } else { 1.0 },
        confidence: 1.0,
        uncertainty: 4.0,
        primary_source: item
            .analysis
            .get("source_trust")
            .and_then(|v| v.as_str())
            .map(|v| v == "primary")
            .unwrap_or(false),
        ad: false,
        insufficient_data: false,
        injection_detected: item
            .analysis
            .get("injection_detected")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        event_key: slugify(&item.title, 80),
        facts: Vec::new(),
        affected: String::new(),
        caveats: vec!["модель недоступна, использован экстрактивный пересказ".to_string()],
    }
}

fn push_source(
    sources: &mut Vec<DraftSource>,
    seen: &mut std::collections::HashSet<String>,
    item: &Item,
    is_primary: bool,
) {
    let key = if item.canonical_url.is_empty() {
        item.url.clone()
    } else {
        item.canonical_url.clone()
    };
    if !key.is_empty() && !seen.insert(key) {
        return;
    }
    sources.push(DraftSource {
        item_id: item.id,
        source_name: item.source_name.clone(),
        url: item.url.clone(),
        title: item.title.clone(),
        published_at: item.published_at,
        is_primary,
    });
}

fn score_event(w: &ScoringWeights, attributes: &EventAttributes) -> f64 {
    w.impact * attributes.impact
        + w.scale * attributes.scale
        + w.urgency * attributes.urgency
        + w.relevance * attributes.relevance
        + w.confidence * attributes.confidence
        - w.uncertainty_penalty * attributes.uncertainty
}

fn build_summary(primary: &AnalyzedItem) -> String {
    primary.analysis.summary.trim().to_string()
}

fn justification(analysis: &LlmItemAnalysis, item: &Item) -> String {
    let has_scale =
        analysis.scale > 0.0 || !analysis.organizations.is_empty() || !analysis.systems.is_empty();
    let scale = if has_scale {
        format!(
            "затронуто организаций: {}, систем: {}; масштаб {:.0}/5, срочность {:.0}/5, влияние {:.0}/5",
            analysis.organizations.len(),
            analysis.systems.len(),
            analysis.scale,
            analysis.urgency,
            analysis.impact
        )
    } else {
        "данные о масштабе и последствиях в публикации отсутствуют".to_string()
    };
    format!(
        "Событие включено: {}; источник: {}; уверенность {:.0}/5.",
        scale, item.source_name, analysis.confidence
    )
}

#[allow(dead_code)]
fn _now() -> chrono::DateTime<Utc> {
    Utc::now()
}
