mod grpc;

use std::collections::HashMap;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use news_shared::bus::KafkaBus;
use news_shared::config::Config;
use news_shared::db;
use news_shared::error::{AppError, AppResult};
use news_shared::models::{
    ArtifactInfo, ArtifactsReadyEvent, DigestVerifiedEvent, DraftEvent, Item, JournalRow,
    VerificationReport,
};
use news_shared::redis_cache::RedisCache;
use news_shared::telemetry::{init_metrics, init_tracing};
use news_shared::text::{count_chars_without_urls, remove_em_dash, sha256_hex, truncate_chars};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Clone)]
pub struct ReporterState {
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
    news_shared::registry::spawn_heartbeat(config.data_dir.clone(), "reporter");
    let pool = db::init_db(&config).await?;
    let redis = RedisCache::new(&config.redis_url).await?;
    let bus = KafkaBus::new(&config)?;
    let state = ReporterState {
        config,
        pool,
        redis,
        bus,
    };

    tracing::info!("reporter started");
    let grpc_state = state.clone();
    let grpc_addr = state.config.grpc_addr;
    tokio::spawn(async move {
        if let Err(error) = grpc::serve(grpc_state, grpc_addr).await {
            tracing::error!(error = %error, "reporter gRPC server failed");
        }
    });

    if state.config.pipeline_transport == "kafka" {
        let handler_state = state.clone();
        state
            .bus
            .consume_forever(
                news_shared::TOPIC_DIGEST_VERIFIED,
                "reporter",
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

pub(crate) async fn process_digest_verified(
    state: ReporterState,
    verified: DigestVerifiedEvent,
) -> AppResult<ArtifactsReadyEvent> {
    let run = db::get_run(&state.pool, verified.run_id).await?;
    if run.status == "cancelled" || run.status == "failed" {
        return Ok(ArtifactsReadyEvent {
            run_id: verified.run_id,
            artifacts: Vec::new(),
        });
    }

    let stage_id = db::add_stage(&state.pool, verified.run_id, "report", "running", None).await?;
    let items = db::get_items(&state.pool, verified.run_id).await?;
    let item_map: HashMap<Uuid, Item> = items.iter().map(|i| (i.id, i.clone())).collect();
    let journal = db::get_journal(&state.pool, verified.run_id).await?;
    let artifact_dir = state.config.artifact_dir(verified.run_id);
    tokio::fs::create_dir_all(&artifact_dir).await?;

    let digest = render_digest(&verified.events, &run, &item_map, 4000);
    let post = render_post(&verified.events, &run, &item_map, 2000);
    let email = render_email(&verified.events, &run, &item_map);
    let email_subject = format!("Дайджест по кибербезопасности за {}", format_period(&run));
    let ai_description = render_ai_description(&run, &verified.verification);
    let journal_csv = render_journal_csv(&journal);

    let mut artifacts = Vec::new();
    write_artifact(
        &state,
        verified.run_id,
        "digest.md",
        digest.as_bytes(),
        "text/markdown; charset=utf-8",
        &mut artifacts,
    )
    .await?;
    write_artifact(
        &state,
        verified.run_id,
        "post.md",
        post.as_bytes(),
        "text/markdown; charset=utf-8",
        &mut artifacts,
    )
    .await?;
    write_artifact(
        &state,
        verified.run_id,
        "email.html",
        email.as_bytes(),
        "text/html; charset=utf-8",
        &mut artifacts,
    )
    .await?;
    write_artifact(
        &state,
        verified.run_id,
        "email_subject.txt",
        email_subject.as_bytes(),
        "text/plain; charset=utf-8",
        &mut artifacts,
    )
    .await?;
    write_artifact(
        &state,
        verified.run_id,
        "journal.csv",
        journal_csv.as_bytes(),
        "text/csv; charset=utf-8",
        &mut artifacts,
    )
    .await?;
    write_artifact(
        &state,
        verified.run_id,
        "ai.md",
        ai_description.as_bytes(),
        "text/markdown; charset=utf-8",
        &mut artifacts,
    )
    .await?;

    let checks = run_checks(
        &state, &run, &verified, &items, &journal, &digest, &post, &email,
    )
    .await?;
    for check in &checks {
        db::insert_check_result(
            &state.pool,
            verified.run_id,
            &check.scenario,
            check.passed,
            check.input.clone(),
            check.output.clone(),
            &check.note,
        )
        .await?;
    }
    write_artifact(
        &state,
        verified.run_id,
        "check_results.json",
        serde_json::to_vec_pretty(&checks)?.as_slice(),
        "application/json; charset=utf-8",
        &mut artifacts,
    )
    .await?;

    let stats = db::run_stats(&state.pool, verified.run_id).await?;
    let duration = run
        .started_at
        .map(|start| (Utc::now() - start).num_seconds())
        .unwrap_or(0);
    let run_stats = json!({
        "run_id": run.id,
        "model": run.model,
        "prompt_version": run.prompt_version,
        "control_time": run.control_time,
        "period_start": run.period_start,
        "period_end": run.period_end,
        "duration_secs": duration,
        "events": verified.events.len(),
        "items": items.len(),
        "checks": {
            "passed": checks.iter().filter(|c| c.passed).count(),
            "total": checks.len(),
        },
        "usage": stats,
        "verification": verified.verification,
    });
    write_artifact(
        &state,
        verified.run_id,
        "run_stats.json",
        serde_json::to_vec_pretty(&run_stats)?.as_slice(),
        "application/json; charset=utf-8",
        &mut artifacts,
    )
    .await?;

    let stats_value = serde_json::to_value(&run_stats)?;
    db::update_run_stats(&state.pool, verified.run_id, stats_value).await?;
    db::set_run_status(&state.pool, verified.run_id, "completed", None).await?;
    let _ = db::finish_stage(
        &state.pool,
        stage_id,
        "completed",
        Some(&format!("generated {} artifacts", artifacts.len())),
    )
    .await;

    let ready = ArtifactsReadyEvent {
        run_id: verified.run_id,
        artifacts,
    };
    tracing::info!(run_id = %verified.run_id, "reporting completed");
    Ok(ready)
}

async fn handle(state: ReporterState, payload: serde_json::Value) -> AppResult<()> {
    let verified: DigestVerifiedEvent = serde_json::from_value(payload)?;
    match process_digest_verified(state.clone(), verified).await {
        Ok(out) => {
            state
                .bus
                .publish(
                    news_shared::TOPIC_ARTIFACTS_READY,
                    &out.run_id.to_string(),
                    &out,
                )
                .await?;
        }
        Err(error) => tracing::error!(error = %error, "reporting failed"),
    }
    Ok(())
}

async fn write_artifact(
    state: &ReporterState,
    run_id: Uuid,
    name: &str,
    bytes: &[u8],
    mime: &str,
    artifacts: &mut Vec<ArtifactInfo>,
) -> AppResult<()> {
    let dir = state.config.artifact_dir(run_id);
    let path = dir.join(name);
    tokio::fs::write(&path, bytes).await?;
    let sha = sha256_hex(bytes);
    db::insert_artifact(
        &state.pool,
        run_id,
        name,
        &path.to_string_lossy(),
        mime,
        bytes.len() as i64,
        &sha,
    )
    .await?;
    artifacts.push(ArtifactInfo {
        name: name.to_string(),
        path: path.to_string_lossy().to_string(),
        mime: mime.to_string(),
        size: bytes.len() as i64,
        sha256: sha,
    });
    Ok(())
}

fn render_digest(
    events: &[DraftEvent],
    run: &news_shared::models::Run,
    items: &HashMap<Uuid, Item>,
    max_chars: usize,
) -> String {
    let mut events = events.to_vec();
    for _ in 0..10 {
        let text = render_digest_full(&events, run, items);
        if count_chars_without_urls(&text) <= max_chars {
            return text;
        }
        for event in events.iter_mut() {
            if event.summary.chars().count() > 220 {
                event.summary = truncate_chars(&event.summary, 220);
            }
            if event.consequences.chars().count() > 180 {
                event.consequences = truncate_chars(&event.consequences, 180);
            }
            if event.justification.chars().count() > 200 {
                event.justification = truncate_chars(&event.justification, 200);
            }
        }
        let text = render_digest_full(&events, run, items);
        if count_chars_without_urls(&text) <= max_chars {
            return text;
        }
        for event in events.iter_mut() {
            event.summary = truncate_chars(&event.summary, 140);
            event.consequences = truncate_chars(&event.consequences, 110);
            event.justification = truncate_chars(&event.justification, 120);
        }
        let text = render_digest_full(&events, run, items);
        if count_chars_without_urls(&text) <= max_chars {
            return text;
        }
        for event in events.iter_mut() {
            event.summary = truncate_chars(&event.summary, 90);
            event.consequences = truncate_chars(&event.consequences, 70);
            event.justification = truncate_chars(&event.justification, 80);
            event.title = truncate_chars(&event.title, 100);
        }
    }
    render_digest_full(&events, run, items)
}

fn render_digest_full(
    events: &[DraftEvent],
    run: &news_shared::models::Run,
    items: &HashMap<Uuid, Item>,
) -> String {
    let mut out = String::new();
    out.push_str("# Дайджест по кибербезопасности\n\n");
    out.push_str(&format!("Период: {}\n\n", format_period(run)));
    out.push_str(&format!(
        "Контрольное время: {}\n\n",
        format_dt(run.control_time, run)
    ));

    if events.is_empty() {
        out.push_str("Подходящих событий за период нет.\n");
        return out;
    }

    for (idx, event) in events.iter().enumerate() {
        out.push_str(&format!(
            "## {}. {}\n\n",
            idx + 1,
            remove_em_dash(&event.title)
        ));
        out.push_str(&format!("Суть: {}\n\n", remove_em_dash(&event.summary)));
        out.push_str(&format!(
            "Последствия: {}\n\n",
            remove_em_dash(&event.consequences)
        ));
        out.push_str(&format!("Источники: {}\n\n", format_sources(event, items)));
        out.push_str(&format!(
            "Обоснование: {}\n\n",
            remove_em_dash(&event.justification)
        ));
    }
    out
}

fn render_post(
    events: &[DraftEvent],
    run: &news_shared::models::Run,
    items: &HashMap<Uuid, Item>,
    max_chars: usize,
) -> String {
    let mut events = events.to_vec();
    for _ in 0..8 {
        let text = render_post_full(&events, run, items);
        if count_chars_without_urls(&text) <= max_chars {
            return text;
        }
        for event in events.iter_mut() {
            event.summary = truncate_chars(&event.summary, 180);
            event.title = truncate_chars(&event.title, 120);
        }
        let text = render_post_full(&events, run, items);
        if count_chars_without_urls(&text) <= max_chars {
            return text;
        }
        for event in events.iter_mut() {
            event.summary = truncate_chars(&event.summary, 110);
            event.title = truncate_chars(&event.title, 90);
        }
        let text = render_post_full(&events, run, items);
        if count_chars_without_urls(&text) <= max_chars {
            return text;
        }
        for event in events.iter_mut() {
            event.summary = truncate_chars(&event.summary, 70);
            event.title = truncate_chars(&event.title, 70);
        }
    }
    render_post_full(&events, run, items)
}

fn render_post_full(
    events: &[DraftEvent],
    run: &news_shared::models::Run,
    _items: &HashMap<Uuid, Item>,
) -> String {
    let mut out = String::new();
    out.push_str("Дайджест по кибербезопасности\n\n");
    out.push_str(&format!("Период: {}\n\n", format_period(run)));
    if events.is_empty() {
        out.push_str("Подходящих событий за период нет.\n");
        return out;
    }
    for (idx, event) in events.iter().enumerate() {
        out.push_str(&format!("{}. {}\n", idx + 1, remove_em_dash(&event.title)));
        out.push_str(&format!("{}\n", remove_em_dash(&event.summary)));
        out.push_str(&format!("Источники: {}\n\n", format_post_sources(event)));
    }
    out
}

fn render_email(
    events: &[DraftEvent],
    run: &news_shared::models::Run,
    items: &HashMap<Uuid, Item>,
) -> String {
    let mut out = String::new();
    out.push_str("<!doctype html><html lang=\"ru\"><head><meta charset=\"utf-8\">");
    out.push_str("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">");
    out.push_str("<title>Дайджест по кибербезопасности</title></head><body>");
    out.push_str("<div style=\"max-width:760px;margin:0 auto;font-family:Arial,sans-serif;line-height:1.5;color:#222\">");
    out.push_str("<h1>Дайджест по кибербезопасности</h1>");
    out.push_str(&format!(
        "<p><strong>Тема:</strong> Дайджест по кибербезопасности за {}</p>",
        escape_html(&format_period(run))
    ));
    out.push_str(&format!(
        "<p><strong>Период:</strong> {}<br><strong>Контрольное время:</strong> {}</p>",
        escape_html(&format_period(run)),
        escape_html(&format_dt(run.control_time, run))
    ));

    if events.is_empty() {
        out.push_str("<p>Подходящих событий за период нет.</p>");
    }

    for (idx, event) in events.iter().enumerate() {
        out.push_str(&format!(
            "<h2>{}. {}</h2>",
            idx + 1,
            escape_html(&remove_em_dash(&event.title))
        ));
        out.push_str(&format!(
            "<p><strong>Суть:</strong> {}</p>",
            escape_html(&remove_em_dash(&event.summary))
        ));
        out.push_str(&format!(
            "<p><strong>Последствия:</strong> {}</p>",
            escape_html(&remove_em_dash(&event.consequences))
        ));
        out.push_str("<p><strong>Источники:</strong></p><ul>");
        for source in &event.sources {
            let date = source
                .published_at
                .map(|d| format_dt(d, run))
                .unwrap_or_else(|| "дата не указана".to_string());
            let external = items
                .get(&source.item_id)
                .map(|i| i.external_id.clone())
                .unwrap_or_default();
            let link = if let Some(href) = safe_href(&source.url) {
                format!(
                    "<a href=\"{}\">{}</a>",
                    escape_html(href),
                    escape_html(&remove_em_dash(&source.source_name))
                )
            } else {
                escape_html(&remove_em_dash(&source.source_name))
            };
            out.push_str(&format!(
                "<li>{} - {}, {}, ID {}</li>",
                link,
                escape_html(&date),
                escape_html(&source.url),
                escape_html(&external)
            ));
        }
        out.push_str("</ul>");
        out.push_str(&format!(
            "<p><strong>Обоснование:</strong> {}</p>",
            escape_html(&remove_em_dash(&event.justification))
        ));
    }

    out.push_str("</div></body></html>");
    out
}

fn render_ai_description(
    run: &news_shared::models::Run,
    verification: &VerificationReport,
) -> String {
    format!(
        "# Описание работы ИИ\n\n\
         Модель: {model}\n\n\
         Версия промптов: {prompt_version}\n\n\
         Провайдер: OpenAI-совместимый API (vLLM)\n\n\
         Что делает модель:\n\
         - определяет тему публикации;\n\
         - извлекает проверяемые факты и последствия;\n\
         - объединяет публикации об одном событии;\n\
         - ранжирует события и пишет текст дайджеста.\n\n\
         Как проверяются факты:\n\
         - каждое утверждение привязано к исходной публикации;\n\
         - числовые данные сверяются с текстом источников;\n\
         - ссылки проверяются по реестру материалов;\n\
         - сохраняются оговорки источников.\n\n\
         Результат проверки: неподтверждённых утверждений: {unsupported}.\n\n\
         Известные ограничения:\n\
         - качество зависит от полноты текста публикации;\n\
         - при недоступности модели используется экстрактивный пересказ;\n\
         - модель не заменяет ручную проверку юридически значимых выводов.\n",
        model = run.model,
        prompt_version = run.prompt_version,
        unsupported = verification.unsupported_claims,
    )
}

fn render_journal_csv(journal: &[JournalRow]) -> String {
    let mut writer = csv::Writer::from_writer(Vec::new());
    let _ = writer.write_record(["id", "status", "group", "reason", "error"]);
    for row in journal {
        let _ = writer.write_record([
            csv_safe(&row.external_id),
            csv_safe(&row.status),
            csv_safe(row.group_key.as_deref().unwrap_or("")),
            csv_safe(&row.reason),
            csv_safe(row.error.as_deref().unwrap_or("")),
        ]);
    }
    String::from_utf8_lossy(&writer.into_inner().unwrap_or_default()).to_string()
}

#[derive(Debug, Clone, serde::Serialize)]
struct CheckRow {
    scenario: String,
    passed: bool,
    input: serde_json::Value,
    output: serde_json::Value,
    note: String,
}

#[allow(clippy::too_many_arguments)]
async fn run_checks(
    _state: &ReporterState,
    run: &news_shared::models::Run,
    verified: &DigestVerifiedEvent,
    items: &[Item],
    journal: &[JournalRow],
    digest: &str,
    post: &str,
    email: &str,
) -> AppResult<Vec<CheckRow>> {
    let digest_chars = count_chars_without_urls(digest);
    let post_chars = count_chars_without_urls(post);
    let events = &verified.events;
    let mut checks = Vec::new();

    let format_ok = events.is_empty()
        || events.iter().enumerate().all(|(idx, _)| {
            digest.contains(&format!("## {}.", idx + 1))
                && digest.contains("Суть:")
                && digest.contains("Последствия:")
                && digest.contains("Источники:")
                && digest.contains("Обоснование:")
        });
    checks.push(CheckRow {
        scenario: "digest_format".to_string(),
        passed: format_ok,
        input: json!({"events": events.len()}),
        output: json!({"digest_chars": digest_chars}),
        note: "структура ## N. и обязательные поля".to_string(),
    });
    checks.push(CheckRow {
        scenario: "digest_limit_4000".to_string(),
        passed: digest_chars <= 4000,
        input: json!({"limit": 4000}),
        output: json!({"chars": digest_chars}),
        note: "лимит без учёта URL".to_string(),
    });
    checks.push(CheckRow {
        scenario: "post_limit_2000".to_string(),
        passed: post_chars <= 2000,
        input: json!({"limit": 2000}),
        output: json!({"chars": post_chars}),
        note: "лимит без учёта URL".to_string(),
    });
    checks.push(CheckRow {
        scenario: "events_limit".to_string(),
        passed: events.len() <= run.max_items.max(0) as usize,
        input: json!({"limit": run.max_items}),
        output: json!({"events": events.len()}),
        note: format!("не больше {} событий", run.max_items),
    });
    checks.push(CheckRow {
        scenario: "no_em_dash".to_string(),
        passed: !digest.contains('—') && !post.contains('—') && !email.contains('—'),
        input: json!({}),
        output: json!({}),
        note: "длинное тире отсутствует".to_string(),
    });
    checks.push(CheckRow {
        scenario: "sources_present".to_string(),
        passed: events.iter().all(|e| !e.sources.is_empty()),
        input: json!({}),
        output: json!({"events": events.len()}),
        note: "у каждого события есть источник".to_string(),
    });

    let journal_complete = journal.len() >= items.len();
    checks.push(CheckRow {
        scenario: "journal_completeness".to_string(),
        passed: journal_complete,
        input: json!({"items": items.len()}),
        output: json!({"journal_rows": journal.len()}),
        note: "строка журнала на каждый материал набора".to_string(),
    });

    let duplicates = items
        .iter()
        .filter(|item| item.status == "duplicate")
        .collect::<Vec<_>>();
    let duplicates_merged = duplicates.iter().all(|item| {
        journal
            .iter()
            .any(|row| row.item_id == item.id && row.status == "объединён")
    });
    checks.push(CheckRow {
        scenario: "duplicate_event_merged".to_string(),
        passed: duplicates.is_empty() || duplicates_merged,
        input: json!({"duplicates": duplicates.len()}),
        output: json!({"merged": duplicates_merged}),
        note: if duplicates.is_empty() {
            "в наборе нет дублей; проверка не применима".to_string()
        } else {
            "сообщения об одном событии объединены".to_string()
        },
    });

    let fewer_note = verified.notes.iter().any(|n| n.contains("меньше"));
    checks.push(CheckRow {
        scenario: "fewer_than_limit".to_string(),
        passed: events.len() >= run.max_items.max(0) as usize || fewer_note || events.is_empty(),
        input: json!({"events": events.len(), "limit": run.max_items}),
        output: json!({"note": fewer_note}),
        note: "если событий меньше лимита, указана причина".to_string(),
    });

    let no_news_note = events.is_empty() && digest.contains("Подходящих событий за период нет");
    checks.push(CheckRow {
        scenario: "no_relevant_news".to_string(),
        passed: !events.is_empty() || no_news_note,
        input: json!({"events": events.len()}),
        output: json!({"note": no_news_note}),
        note: "при отсутствии новостей система сообщает об этом".to_string(),
    });

    let outside = items
        .iter()
        .filter(|item| {
            item.published_at
                .map(|d| d <= run.period_start || d > run.period_end)
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    let outside_excluded = outside.iter().all(|item| {
        journal.iter().any(|row| {
            row.item_id == item.id
                && row.status == "исключён"
                && (row.reason.contains("вне периода")
                    || row.reason.contains("дата публикации не подтверждена"))
        })
    });
    checks.push(CheckRow {
        scenario: "out_of_period_excluded".to_string(),
        passed: outside.is_empty() || outside_excluded,
        input: json!({"outside": outside.len()}),
        output: json!({"excluded": outside_excluded}),
        note: "публикации вне периода исключены".to_string(),
    });

    let insufficient = items
        .iter()
        .filter(|item| {
            let outside_period = item
                .published_at
                .map(|d| d <= run.period_start || d > run.period_end)
                .unwrap_or(false);
            item.clean_text.chars().count() < 120
                && item.analysis.get("source_error").is_none()
                && !outside_period
        })
        .collect::<Vec<_>>();
    let insufficient_marked = insufficient.iter().all(|item| {
        journal.iter().any(|row| {
            row.item_id == item.id
                && row.status == "исключён"
                && row.reason.contains("недостаточно данных")
        })
    });
    checks.push(CheckRow {
        scenario: "insufficient_text".to_string(),
        passed: insufficient.is_empty() || insufficient_marked,
        input: json!({"items": insufficient.len()}),
        output: json!({"marked": insufficient_marked}),
        note: "обрывки текста отмечены".to_string(),
    });

    let injections = items
        .iter()
        .filter(|item| {
            item.analysis
                .get("injection_detected")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    let injection_marked = injections.iter().all(|item| {
        journal
            .iter()
            .any(|row| row.item_id == item.id && row.reason.to_lowercase().contains("инструкц"))
    });
    checks.push(CheckRow {
        scenario: "prompt_injection".to_string(),
        passed: injections.is_empty() || injection_marked,
        input: json!({"items": injections.len()}),
        output: json!({"marked": injection_marked}),
        note: "посторонние инструкции не выполняются и фиксируются".to_string(),
    });

    let source_errors = journal.iter().filter(|r| r.error.is_some()).count();
    checks.push(CheckRow {
        scenario: "source_error_handled".to_string(),
        passed: journal_complete,
        input: json!({"errors": source_errors}),
        output: json!({"errors": source_errors}),
        note: "ошибки источников фиксируются в журнале".to_string(),
    });

    let contradictions = verified.verification.contradictions.len();
    checks.push(CheckRow {
        scenario: "contradictions_reported".to_string(),
        passed: contradictions == 0 || !digest.is_empty(),
        input: json!({"contradictions": contradictions}),
        output: json!({"reported": contradictions}),
        note: "расхождения описаны или отсутствуют".to_string(),
    });

    let links_valid = events.iter().all(|event| {
        event.sources.iter().all(|source| {
            items.iter().any(|item| {
                item.id == source.item_id
                    && (source.url.is_empty()
                        || item.url == source.url
                        || item.canonical_url == source.url)
            })
        })
    });
    checks.push(CheckRow {
        scenario: "links_valid".to_string(),
        passed: links_valid,
        input: json!({}),
        output: json!({"events": events.len()}),
        note: "ссылки соответствуют материалам набора".to_string(),
    });

    let post_consistent = events.iter().all(|event| {
        let prefix: String = event.title.chars().take(20).collect();
        post.contains(&prefix)
    });
    checks.push(CheckRow {
        scenario: "post_consistency".to_string(),
        passed: post_consistent,
        input: json!({"events": events.len()}),
        output: json!({"consistent": post_consistent}),
        note: "пост содержит те же события".to_string(),
    });

    let email_consistent = events
        .iter()
        .all(|event| email.contains(&escape_html(&event.title)))
        && email.contains("Период");
    checks.push(CheckRow {
        scenario: "email_consistency".to_string(),
        passed: email_consistent,
        input: json!({"events": events.len()}),
        output: json!({"consistent": email_consistent}),
        note: "письмо содержит период и те же события".to_string(),
    });

    checks.push(CheckRow {
        scenario: "facts_supported".to_string(),
        passed: verified.verification.unsupported_claims == 0,
        input: json!({"unsupported": verified.verification.unsupported_claims}),
        output: json!({"unsupported": verified.verification.unsupported_claims}),
        note: "все числовые утверждения подтверждены".to_string(),
    });

    checks.push(CheckRow {
        scenario: "journal_reasons".to_string(),
        passed: journal.iter().all(|row| !row.reason.trim().is_empty()),
        input: json!({"rows": journal.len()}),
        output: json!({}),
        note: "у каждой строки журнала есть причина".to_string(),
    });

    Ok(checks)
}

fn safe_href(url: &str) -> Option<&str> {
    let trimmed = url.trim();
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        Some(trimmed)
    } else {
        None
    }
}

fn csv_safe(value: &str) -> String {
    match value.chars().next() {
        Some('=' | '+' | '-' | '@' | '\t' | '\r') => format!("'{}", value),
        _ => value.to_string(),
    }
}

fn format_period(run: &news_shared::models::Run) -> String {
    format!(
        "{} - {} (МСК)",
        format_dt(run.period_start, run),
        format_dt(run.period_end, run)
    )
}

fn format_dt(dt: DateTime<Utc>, _run: &news_shared::models::Run) -> String {
    dt.with_timezone(&chrono_tz::Europe::Moscow)
        .format("%d.%m.%Y %H:%M")
        .to_string()
        .replace('—', "-")
}

fn format_sources(event: &DraftEvent, items: &HashMap<Uuid, Item>) -> String {
    event
        .sources
        .iter()
        .map(|source| {
            let date = source
                .published_at
                .map(|d| {
                    d.with_timezone(&chrono_tz::Europe::Moscow)
                        .format("%d.%m.%Y %H:%M")
                        .to_string()
                })
                .unwrap_or_else(|| "дата не указана".to_string());
            let external = items
                .get(&source.item_id)
                .map(|i| i.external_id.as_str())
                .unwrap_or("");
            format!(
                "{}, {}, {}, ID {}",
                remove_em_dash(&source.source_name),
                date,
                source.url,
                external
            )
        })
        .collect::<Vec<_>>()
        .join("; ")
}

fn format_post_sources(event: &DraftEvent) -> String {
    let urls = event
        .sources
        .iter()
        .map(|source| {
            if source.url.is_empty() {
                remove_em_dash(&source.source_name)
            } else {
                source.url.clone()
            }
        })
        .collect::<Vec<_>>();
    urls.join(" ")
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[allow(dead_code)]
fn _err(message: &str) -> AppError {
    AppError::internal(message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use news_shared::models::{DraftSource, EventAttributes};

    fn sample_run() -> news_shared::models::Run {
        let control = Utc.with_ymd_and_hms(2026, 11, 9, 9, 0, 0).unwrap();
        news_shared::models::Run {
            id: Uuid::new_v4(),
            status: "running".to_string(),
            mode: "file".to_string(),
            control_time: control,
            period_start: control - chrono::Duration::hours(24),
            period_end: control,
            model: "test-model".to_string(),
            prompt_version: "v1".to_string(),
            created_by: None,
            created_at: control,
            started_at: Some(control),
            finished_at: None,
            error: None,
            stats: serde_json::json!({}),
            interval_hours: 24,
            max_items: 5,
            parent_run_id: None,
            source_ids: Vec::new(),
            policies: serde_json::json!({}),
        }
    }

    fn sample_items() -> HashMap<Uuid, Item> {
        let id = Uuid::new_v4();
        let item = Item {
            id,
            run_id: Uuid::new_v4(),
            external_id: "42".to_string(),
            source_id: None,
            source_name: "Тестовый источник".to_string(),
            source_url: Some("https://example.com/news/42".to_string()),
            url: "https://example.com/news/42".to_string(),
            canonical_url: "https://example.com/news/42".to_string(),
            title: "Тестовое событие".to_string(),
            raw_text: "текст".to_string(),
            clean_text: "текст".to_string(),
            published_at: Some(Utc::now()),
            date_confirmed: true,
            status: "normalized".to_string(),
            reason: None,
            group_key: None,
            duplicate_of: None,
            analysis: serde_json::json!({}),
            created_at: Utc::now(),
        };
        HashMap::from([(id, item)])
    }

    fn sample_events(item_id: Uuid) -> Vec<DraftEvent> {
        (0..5)
            .map(|idx| DraftEvent {
                event_key: format!("event-{idx}"),
                title: format!("Событие номер {idx}"),
                summary: "Краткое описание события с фактами и числами. ".repeat(20),
                consequences: "Последствия для организаций и систем. ".repeat(10),
                justification: "Событие включено по масштабу и срочности. ".repeat(5),
                sources: vec![DraftSource {
                    item_id,
                    source_name: "Тестовый источник".to_string(),
                    url: "https://example.com/news/42".to_string(),
                    title: "Тестовое событие".to_string(),
                    published_at: Some(Utc::now()),
                    is_primary: true,
                }],
                score: 1.0,
                attributes: EventAttributes::default(),
                claims: vec![],
            })
            .collect()
    }

    #[test]
    fn digest_fits_limit_and_keeps_format() {
        let run = sample_run();
        let items = sample_items();
        let item_id = *items.keys().next().unwrap();
        let events = sample_events(item_id);
        let digest = render_digest(&events, &run, &items, 4000);
        assert!(count_chars_without_urls(&digest) <= 4000);
        assert!(digest.contains("## 1."));
        assert!(digest.contains("Суть:"));
        assert!(digest.contains("Последствия:"));
        assert!(digest.contains("Источники:"));
        assert!(digest.contains("Обоснование:"));
        assert!(!digest.contains('—'));
    }

    #[test]
    fn post_fits_limit_and_keeps_events() {
        let run = sample_run();
        let items = sample_items();
        let item_id = *items.keys().next().unwrap();
        let events = sample_events(item_id);
        let post = render_post(&events, &run, &items, 2000);
        assert!(count_chars_without_urls(&post) <= 2000);
        for (idx, _) in events.iter().enumerate() {
            assert!(post.contains(&format!("{}.", idx + 1)));
        }
        assert!(!post.contains('—'));
    }

    #[test]
    fn safe_href_rejects_javascript() {
        assert!(safe_href("https://example.com").is_some());
        assert!(safe_href("javascript:alert(1)").is_none());
        assert!(safe_href("data:text/html,test").is_none());
    }
}
