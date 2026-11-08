use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use chrono::Utc;
use serde_json::json;
use sqlx::postgres::{PgPoolOptions, PgRow};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::config::Config;
use crate::error::{AppError, AppResult};
use crate::models::*;

pub async fn init_db(config: &Config) -> AppResult<PgPool> {
    fs::create_dir_all(&config.data_dir)?;
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .min_connections(1)
        .acquire_timeout(std::time::Duration::from_secs(10))
        .connect(&config.database_url)
        .await?;

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .map_err(|e| AppError::internal(format!("migrations failed: {e}")))?;

    // Serialize first-start initialization across all service processes.
    let mut conn = pool.acquire().await?;
    sqlx::query("SELECT pg_advisory_lock($1)")
        .bind(987654321_i64)
        .execute(&mut *conn)
        .await?;
    bootstrap_admin(&pool, config).await?;
    seed_sources(&pool).await?;
    seed_keywords(&pool).await?;
    sqlx::query("SELECT pg_advisory_unlock($1)")
        .bind(987654321_i64)
        .execute(&mut *conn)
        .await?;
    drop(conn);

    Ok(pool)
}

pub async fn bootstrap_admin(pool: &PgPool, config: &Config) -> AppResult<()> {
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM users")
        .fetch_one(pool)
        .await?;
    if count > 0 {
        return Ok(());
    }

    let password = match &config.bootstrap_admin_password {
        Some(p) => p.clone(),
        None => {
            let generated = generate_password(20);
            let path = config.data_dir.join("bootstrap_password.txt");
            fs::write(&path, &generated)?;
            let mut perms = fs::metadata(&path)?.permissions();
            perms.set_mode(0o600);
            fs::set_permissions(&path, perms)?;
            tracing::warn!(
                path = %path.display(),
                "bootstrap admin password generated; read it from the file"
            );
            generated
        }
    };

    let hash = crate::auth::hash_password(&password)?;
    sqlx::query("INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'admin')")
        .bind(config.bootstrap_admin_username.to_lowercase())
        .bind(hash)
        .execute(pool)
        .await?;

    tracing::info!(username = %config.bootstrap_admin_username, "bootstrap administrator created");
    Ok(())
}

pub async fn seed_sources(pool: &PgPool) -> AppResult<()> {
    // Appendix 1 of the hackathon case. RSS feeds are preferred; sites without a
    // stable feed are connected through HTML extraction.
    let defaults = [
        (
            "SecurityLab",
            "rss",
            "https://www.securitylab.ru/_services/export/rss/news/",
            "reprint",
        ),
        ("Хакер", "rss", "https://xakep.ru/feed/", "reprint"),
        ("ComNews", "rss", "https://www.comnews.ru/rss", "reprint"),
        (
            "Коммерсантъ",
            "rss",
            "https://www.kommersant.ru/RSS/news.xml",
            "reprint",
        ),
        ("ТАСС", "rss", "https://tass.ru/rss/v2.xml", "reprint"),
        (
            "РИА Новости",
            "rss",
            "https://ria.ru/export/rss2/archive/index.xml",
            "reprint",
        ),
        ("IT-World", "rss", "https://www.it-world.ru/rss/", "reprint"),
        (
            "SecurityMedia",
            "rss",
            "https://securitymedia.org/rss/",
            "reprint",
        ),
        (
            "InfoWatch",
            "html",
            "https://www.infowatch.ru/sitemap.xml",
            "primary",
        ),
        (
            "Инфобезопасность",
            "rss",
            "https://infobezopasnost.ru/blog/news/rss/",
            "reprint",
        ),
        (
            "ICT.Moscow",
            "html",
            "https://ict.moscow/projects/cybersecurity/",
            "reprint",
        ),
        (
            "Газета.Ru",
            "rss",
            "https://www.gazeta.ru/export/rss/first.xml",
            "reprint",
        ),
        (
            "Аргументы и факты",
            "rss",
            "https://aif.ru/rss/techno.php",
            "reprint",
        ),
        (
            "CNews Safe",
            "rss",
            "https://safe.cnews.ru/inc/rss/news.xml",
            "reprint",
        ),
        (
            "Habr InfoSecurity",
            "rss",
            "https://habr.com/ru/rss/hubs/infosecurity/all/?fl=ru",
            "reprint",
        ),
        ("RB.RU", "rss", "https://rb.ru/feeds/news_ex/", "reprint"),
        ("3DNews", "rss", "https://3dnews.ru/news/rss/", "reprint"),
        (
            "Компьютерра",
            "rss",
            "https://www.computerra.ru/tag/security/feed/",
            "reprint",
        ),
        (
            "ITWeek",
            "rss",
            "https://www.itweek.ru/rss/index.php",
            "reprint",
        ),
        (
            "iXBT",
            "rss",
            "https://www.ixbt.com/export/news.rss",
            "reprint",
        ),
        (
            "Overclockers",
            "html",
            "https://overclockers.ru/news",
            "reprint",
        ),
        (
            "Российская газета",
            "rss",
            "https://rg.ru/xml/index.xml",
            "reprint",
        ),
        (
            "Известия",
            "rss",
            "https://iz.ru/xml/rss/all.xml",
            "reprint",
        ),
        (
            "Positive Technologies",
            "html",
            "https://ptsecurity.com/about/news/",
            "primary",
        ),
        (
            "Солар",
            "html",
            "https://rt-solar.ru/events/news/",
            "primary",
        ),
        (
            "Лаборатория Касперского",
            "rss",
            "https://www.kaspersky.ru/blog/feed/",
            "primary",
        ),
        (
            "UserGate",
            "html",
            "https://usergate.com/sitemap-iblock-11.xml",
            "primary",
        ),
        (
            "ИнфоТеКС",
            "html",
            "https://infotecs.ru/press-center/publications/?filter%5Bsection_id%5D%5B%5D=109",
            "primary",
        ),
    ];

    sqlx::query("DELETE FROM sources WHERE name = $1 AND url <> $2")
        .bind("InfoWatch")
        .bind("https://www.infowatch.ru/sitemap.xml")
        .execute(pool)
        .await?;

    for (name, kind, url, trust) in defaults {
        sqlx::query(
            "INSERT INTO sources (name, kind, url, trust) VALUES ($1, $2, $3, $4)
             ON CONFLICT (url) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, trust = EXCLUDED.trust",
        )
        .bind(name)
        .bind(kind)
        .bind(url)
        .bind(trust)
        .execute(pool)
        .await?;
    }
    Ok(())
}
pub async fn seed_keywords(pool: &PgPool) -> AppResult<()> {
    let words = [
        "кибербезопасность",
        "информационная безопасность",
        "ИБ",
        "кибератака",
        "киберинцидент",
        "утечка",
        "уязвимость",
        "фишинг",
        "ransomware",
        "вымогатель",
        "DDoS",
        "ботнет",
        "malware",
        "вредоносное ПО",
        "бэкдор",
        "троян",
        "стекер",
        "криптомайнер",
        "APT",
        "supply chain",
        "взлом",
        "компрометация",
        "brute force",
        "credential stuffing",
        "RDP",
        "VPN",
        "RCE",
        "zero-day",
        "0-day",
        "эксплойт",
        "персональные данные",
        "ПДн",
        "MFA",
        "двухфакторная аутентификация",
        "SOC",
        "SIEM",
        "SOAR",
        "EDR",
        "XDR",
        "WAF",
        "DLP",
        "NGFW",
        "Zero Trust",
        "DevSecOps",
        "ФСТЭК",
        "ФСБ",
        "Роскомнадзор",
        "Минцифры",
        "НКЦКИ",
        "ГосСОПКА",
        "КИИ",
        "критическая информационная инфраструктура",
        "ГИС",
        "сертификация СЗИ",
        "prompt injection",
        "deepfake",
        "дипфейк",
        "AI security",
    ];
    for word in words {
        sqlx::query("INSERT INTO keywords (word) VALUES ($1) ON CONFLICT (word) DO NOTHING")
            .bind(word)
            .execute(pool)
            .await?;
    }
    Ok(())
}

pub async fn log_audit(
    pool: &PgPool,
    actor_id: Option<Uuid>,
    actor_username: &str,
    action: &str,
    resource: &str,
    detail: serde_json::Value,
    ip: &str,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO audit_log (actor_id, actor_username, action, resource, detail, ip)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(actor_id)
    .bind(actor_username)
    .bind(action)
    .bind(resource)
    .bind(detail)
    .bind(ip)
    .execute(pool)
    .await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub async fn create_run(
    pool: &PgPool,
    mode: &str,
    control_time: chrono::DateTime<Utc>,
    period_start: chrono::DateTime<Utc>,
    period_end: chrono::DateTime<Utc>,
    model: &str,
    prompt_version: &str,
    created_by: Option<Uuid>,
    interval_hours: i32,
    max_items: i32,
    parent_run_id: Option<Uuid>,
    source_ids: &[Uuid],
) -> AppResult<Run> {
    let run = sqlx::query_as::<_, Run>(
        "INSERT INTO runs (mode, control_time, period_start, period_end, model, prompt_version,
                           created_by, interval_hours, max_items, parent_run_id, source_ids)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *",
    )
    .bind(mode)
    .bind(control_time)
    .bind(period_start)
    .bind(period_end)
    .bind(model)
    .bind(prompt_version)
    .bind(created_by)
    .bind(interval_hours)
    .bind(max_items)
    .bind(parent_run_id)
    .bind(source_ids.to_vec())
    .fetch_one(pool)
    .await?;
    Ok(run)
}

pub async fn delete_run(pool: &PgPool, run_id: Uuid) -> AppResult<()> {
    let result = sqlx::query("DELETE FROM runs WHERE id = $1")
        .bind(run_id)
        .execute(pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("run not found".into()));
    }
    Ok(())
}

pub async fn set_run_status(
    pool: &PgPool,
    run_id: Uuid,
    status: &str,
    error: Option<&str>,
) -> AppResult<()> {
    sqlx::query(
        "UPDATE runs SET status = $1, error = $2,
         started_at = COALESCE(started_at, CASE WHEN $1 = 'running' THEN now() ELSE started_at END),
         finished_at = CASE WHEN $1 IN ('completed', 'failed', 'cancelled') THEN now() ELSE finished_at END
         WHERE id = $3",
    )
    .bind(status)
    .bind(error)
    .bind(run_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn update_run_stats(
    pool: &PgPool,
    run_id: Uuid,
    stats: serde_json::Value,
) -> AppResult<()> {
    sqlx::query("UPDATE runs SET stats = $1 WHERE id = $2")
        .bind(stats)
        .bind(run_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn get_run(pool: &PgPool, run_id: Uuid) -> AppResult<Run> {
    sqlx::query_as::<_, Run>("SELECT * FROM runs WHERE id = $1")
        .bind(run_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("run not found".into()))
}

pub async fn list_runs(pool: &PgPool, limit: i64, offset: i64) -> AppResult<Vec<Run>> {
    let rows =
        sqlx::query_as::<_, Run>("SELECT * FROM runs ORDER BY created_at DESC LIMIT $1 OFFSET $2")
            .bind(limit.clamp(1, 200))
            .bind(offset.max(0))
            .fetch_all(pool)
            .await?;
    Ok(rows)
}

pub async fn add_stage(
    pool: &PgPool,
    run_id: Uuid,
    stage: &str,
    status: &str,
    message: Option<&str>,
) -> AppResult<Uuid> {
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO run_stages (run_id, stage, status, message) VALUES ($1, $2, $3, $4) RETURNING id",
    )
    .bind(run_id)
    .bind(stage)
    .bind(status)
    .bind(message)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

pub async fn finish_stage(
    pool: &PgPool,
    stage_id: Uuid,
    status: &str,
    message: Option<&str>,
) -> AppResult<()> {
    sqlx::query(
        "UPDATE run_stages SET status = $1, message = $2, finished_at = now() WHERE id = $3",
    )
    .bind(status)
    .bind(message)
    .bind(stage_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn get_stages(pool: &PgPool, run_id: Uuid) -> AppResult<Vec<RunStage>> {
    let rows = sqlx::query_as::<_, RunStage>(
        "SELECT * FROM run_stages WHERE run_id = $1 ORDER BY started_at ASC",
    )
    .bind(run_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn insert_item(pool: &PgPool, item: &Item) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO items (id, run_id, external_id, source_id, source_name, source_url, url, canonical_url,
            title, raw_text, clean_text, published_at, date_confirmed, status, reason, group_key,
            duplicate_of, analysis)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (id) DO UPDATE SET
            external_id = EXCLUDED.external_id,
            source_id = EXCLUDED.source_id,
            source_name = EXCLUDED.source_name,
            source_url = EXCLUDED.source_url,
            url = EXCLUDED.url,
            canonical_url = EXCLUDED.canonical_url,
            title = EXCLUDED.title,
            raw_text = EXCLUDED.raw_text,
            clean_text = EXCLUDED.clean_text,
            published_at = EXCLUDED.published_at,
            date_confirmed = EXCLUDED.date_confirmed,
            status = EXCLUDED.status,
            reason = EXCLUDED.reason,
            group_key = EXCLUDED.group_key,
            duplicate_of = EXCLUDED.duplicate_of,
            analysis = EXCLUDED.analysis",
    )
    .bind(item.id)
    .bind(item.run_id)
    .bind(&item.external_id)
    .bind(item.source_id)
    .bind(&item.source_name)
    .bind(&item.source_url)
    .bind(&item.url)
    .bind(&item.canonical_url)
    .bind(&item.title)
    .bind(&item.raw_text)
    .bind(&item.clean_text)
    .bind(item.published_at)
    .bind(item.date_confirmed)
    .bind(&item.status)
    .bind(&item.reason)
    .bind(&item.group_key)
    .bind(item.duplicate_of)
    .bind(&item.analysis)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn get_items(pool: &PgPool, run_id: Uuid) -> AppResult<Vec<Item>> {
    let rows =
        sqlx::query_as::<_, Item>("SELECT * FROM items WHERE run_id = $1 ORDER BY created_at ASC")
            .bind(run_id)
            .fetch_all(pool)
            .await?;
    Ok(rows)
}

pub async fn get_item(pool: &PgPool, item_id: Uuid) -> AppResult<Item> {
    sqlx::query_as::<_, Item>("SELECT * FROM items WHERE id = $1")
        .bind(item_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("item not found".into()))
}

#[allow(clippy::too_many_arguments)]
pub async fn update_item_status(
    pool: &PgPool,
    item_id: Uuid,
    status: &str,
    reason: Option<&str>,
    group_key: Option<&str>,
    duplicate_of: Option<Uuid>,
) -> AppResult<()> {
    sqlx::query(
        "UPDATE items SET status = $1, reason = $2, group_key = $3, duplicate_of = $4 WHERE id = $5",
    )
    .bind(status)
    .bind(reason)
    .bind(group_key)
    .bind(duplicate_of)
    .bind(item_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn update_item_analysis(
    pool: &PgPool,
    item_id: Uuid,
    analysis: serde_json::Value,
    group_key: Option<&str>,
) -> AppResult<()> {
    sqlx::query("UPDATE items SET analysis = $1, group_key = COALESCE($2, group_key), status = 'analyzed' WHERE id = $3")
        .bind(analysis)
        .bind(group_key)
        .bind(item_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn upsert_journal(
    pool: &PgPool,
    run_id: Uuid,
    item_id: Uuid,
    status: &str,
    group_key: Option<&str>,
    reason: &str,
    error: Option<&str>,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO journal (run_id, item_id, status, group_key, reason, error)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (run_id, item_id) DO UPDATE SET
            status = EXCLUDED.status,
            group_key = EXCLUDED.group_key,
            reason = EXCLUDED.reason,
            error = EXCLUDED.error",
    )
    .bind(run_id)
    .bind(item_id)
    .bind(status)
    .bind(group_key)
    .bind(reason)
    .bind(error)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn get_journal(pool: &PgPool, run_id: Uuid) -> AppResult<Vec<JournalRow>> {
    let rows = sqlx::query_as::<_, JournalRow>(
        "SELECT j.*, COALESCE(NULLIF(i.external_id, ''), j.item_id::text) AS external_id              FROM journal j JOIN items i ON i.id = j.item_id              WHERE j.run_id = $1 ORDER BY j.status, j.group_key NULLS LAST, j.reason",
    )
    .bind(run_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn replace_events(
    pool: &PgPool,
    run_id: Uuid,
    events: &[DraftEvent],
) -> AppResult<Vec<Event>> {
    sqlx::query("DELETE FROM events WHERE run_id = $1")
        .bind(run_id)
        .execute(pool)
        .await?;

    let mut out = Vec::new();
    for (idx, draft) in events.iter().enumerate() {
        let ev = sqlx::query_as::<_, Event>(
            "INSERT INTO events (run_id, rank, title, summary, consequences, justification, score, event_key, attributes, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft') RETURNING *",
        )
        .bind(run_id)
        .bind((idx + 1) as i32)
        .bind(&draft.title)
        .bind(&draft.summary)
        .bind(&draft.consequences)
        .bind(&draft.justification)
        .bind(draft.score)
        .bind(&draft.event_key)
        .bind(serde_json::to_value(&draft.attributes)?)
        .fetch_one(pool)
        .await?;

        for src in &draft.sources {
            sqlx::query(
                "INSERT INTO event_sources (event_id, item_id, source_name, url, title, published_at, is_primary)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)
                 ON CONFLICT (event_id, item_id) DO NOTHING",
            )
            .bind(ev.id)
            .bind(src.item_id)
            .bind(&src.source_name)
            .bind(&src.url)
            .bind(&src.title)
            .bind(src.published_at)
            .bind(src.is_primary)
            .execute(pool)
            .await?;
        }
        out.push(ev);
    }
    Ok(out)
}

pub async fn get_events(pool: &PgPool, run_id: Uuid) -> AppResult<Vec<Event>> {
    let rows =
        sqlx::query_as::<_, Event>("SELECT * FROM events WHERE run_id = $1 ORDER BY rank ASC")
            .bind(run_id)
            .fetch_all(pool)
            .await?;
    Ok(rows)
}

pub async fn get_event_sources(pool: &PgPool, event_id: Uuid) -> AppResult<Vec<EventSource>> {
    let rows = sqlx::query_as::<_, EventSource>(
        "SELECT * FROM event_sources WHERE event_id = $1 ORDER BY is_primary DESC, source_name",
    )
    .bind(event_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

#[allow(clippy::too_many_arguments)]
pub async fn insert_llm_call(
    pool: &PgPool,
    run_id: Option<Uuid>,
    purpose: &str,
    model: &str,
    prompt_hash: &str,
    prompt_version: &str,
    usage: &LlmUsage,
    cost: f64,
    latency_ms: i64,
    ok: bool,
    error: Option<&str>,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO llm_calls (run_id, purpose, model, prompt_hash, prompt_version, input_tokens, output_tokens, cost, latency_ms, ok, error)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    )
    .bind(run_id)
    .bind(purpose)
    .bind(model)
    .bind(prompt_hash)
    .bind(prompt_version)
    .bind(usage.prompt_tokens as i32)
    .bind(usage.completion_tokens as i32)
    .bind(cost)
    .bind(latency_ms)
    .bind(ok)
    .bind(error)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn insert_check_result(
    pool: &PgPool,
    run_id: Uuid,
    scenario: &str,
    passed: bool,
    input: serde_json::Value,
    output: serde_json::Value,
    note: &str,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO check_results (run_id, scenario, passed, input, output, note)
         VALUES ($1,$2,$3,$4,$5,$6)",
    )
    .bind(run_id)
    .bind(scenario)
    .bind(passed)
    .bind(input)
    .bind(output)
    .bind(note)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn get_check_results(pool: &PgPool, run_id: Uuid) -> AppResult<Vec<CheckResult>> {
    let rows = sqlx::query_as::<_, CheckResult>(
        "SELECT * FROM check_results WHERE run_id = $1 ORDER BY created_at",
    )
    .bind(run_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn insert_artifact(
    pool: &PgPool,
    run_id: Uuid,
    name: &str,
    path: &str,
    mime: &str,
    size: i64,
    sha256: &str,
) -> AppResult<Artifact> {
    let art = sqlx::query_as::<_, Artifact>(
        "INSERT INTO artifacts (run_id, name, path, mime, size, sha256)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (run_id, name) DO UPDATE SET path = EXCLUDED.path, mime = EXCLUDED.mime,
            size = EXCLUDED.size, sha256 = EXCLUDED.sha256
         RETURNING *",
    )
    .bind(run_id)
    .bind(name)
    .bind(path)
    .bind(mime)
    .bind(size)
    .bind(sha256)
    .fetch_one(pool)
    .await?;
    Ok(art)
}

pub async fn get_artifacts(pool: &PgPool, run_id: Uuid) -> AppResult<Vec<Artifact>> {
    let rows =
        sqlx::query_as::<_, Artifact>("SELECT * FROM artifacts WHERE run_id = $1 ORDER BY name")
            .bind(run_id)
            .fetch_all(pool)
            .await?;
    Ok(rows)
}

pub async fn get_artifact(pool: &PgPool, run_id: Uuid, name: &str) -> AppResult<Artifact> {
    sqlx::query_as::<_, Artifact>("SELECT * FROM artifacts WHERE run_id = $1 AND name = $2")
        .bind(run_id)
        .bind(name)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound("artifact not found".into()))
}

pub async fn list_users(pool: &PgPool) -> AppResult<Vec<User>> {
    let rows = sqlx::query_as::<_, User>("SELECT * FROM users ORDER BY username")
        .fetch_all(pool)
        .await?;
    Ok(rows)
}

pub async fn find_user_by_username(pool: &PgPool, username: &str) -> AppResult<Option<User>> {
    let row = sqlx::query_as::<_, User>("SELECT * FROM users WHERE username = $1")
        .bind(username)
        .fetch_optional(pool)
        .await?;
    Ok(row)
}

pub async fn create_user(
    pool: &PgPool,
    username: &str,
    password_hash: &str,
    role: &str,
) -> AppResult<User> {
    let user = sqlx::query_as::<_, User>(
        "INSERT INTO users (username, password_hash, role) VALUES ($1,$2,$3) RETURNING *",
    )
    .bind(username)
    .bind(password_hash)
    .bind(role)
    .fetch_one(pool)
    .await?;
    Ok(user)
}

pub async fn set_user_active(pool: &PgPool, user_id: Uuid, active: bool) -> AppResult<()> {
    sqlx::query("UPDATE users SET is_active = $1, updated_at = now() WHERE id = $2")
        .bind(active)
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn set_user_role(pool: &PgPool, user_id: Uuid, role: &str) -> AppResult<()> {
    sqlx::query("UPDATE users SET role = $1, updated_at = now() WHERE id = $2")
        .bind(role)
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn update_user_profile(
    pool: &PgPool,
    user_id: Uuid,
    display_name: &str,
    department: &str,
    email: Option<&str>,
) -> AppResult<User> {
    sqlx::query_as::<_, User>(
        "UPDATE users SET display_name = $1, department = $2, email = $3, updated_at = now()
         WHERE id = $4 RETURNING *",
    )
    .bind(display_name)
    .bind(department)
    .bind(email)
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(AppError::from)
}

pub async fn set_user_password(pool: &PgPool, user_id: Uuid, password_hash: &str) -> AppResult<()> {
    sqlx::query("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2")
        .bind(password_hash)
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn prune_user_sessions(pool: &PgPool, user_id: Uuid, keep: i64) -> AppResult<()> {
    sqlx::query(
        "UPDATE refresh_tokens SET revoked = TRUE
         WHERE user_id = $1 AND revoked = FALSE
           AND id NOT IN (
             SELECT id FROM refresh_tokens
             WHERE user_id = $1 AND revoked = FALSE
             ORDER BY created_at DESC LIMIT $2
           )",
    )
    .bind(user_id)
    .bind(keep.max(1))
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn list_user_sessions(pool: &PgPool, user_id: Uuid) -> AppResult<Vec<RefreshToken>> {
    sqlx::query_as::<_, RefreshToken>(
        "SELECT * FROM refresh_tokens
         WHERE user_id = $1 AND revoked = FALSE AND expires_at > now()
         ORDER BY created_at DESC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(AppError::from)
}

pub async fn revoke_user_session(
    pool: &PgPool,
    user_id: Uuid,
    session_id: Uuid,
) -> AppResult<()> {
    let result = sqlx::query(
        "UPDATE refresh_tokens SET revoked = TRUE WHERE id = $1 AND user_id = $2",
    )
    .bind(session_id)
    .bind(user_id)
    .execute(pool)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("session not found".into()));
    }
    Ok(())
}

pub async fn revoke_other_sessions(
    pool: &PgPool,
    user_id: Uuid,
    current_hash: &str,
) -> AppResult<()> {
    sqlx::query(
        "UPDATE refresh_tokens SET revoked = TRUE
         WHERE user_id = $1 AND token_hash <> $2 AND revoked = FALSE",
    )
    .bind(user_id)
    .bind(current_hash)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn record_source_sync(
    pool: &PgPool,
    source_id: Uuid,
    error: Option<&str>,
    collected: usize,
) -> AppResult<()> {
    sqlx::query(
        "UPDATE sources SET last_synced_at = now(), last_error = $2,
         items_collected = items_collected + $3 WHERE id = $1",
    )
    .bind(source_id)
    .bind(error)
    .bind(collected as i64)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn list_sources(pool: &PgPool) -> AppResult<Vec<Source>> {
    let rows = sqlx::query_as::<_, Source>("SELECT * FROM sources ORDER BY name")
        .fetch_all(pool)
        .await?;
    Ok(rows)
}

pub async fn list_enabled_sources(pool: &PgPool) -> AppResult<Vec<Source>> {
    let rows =
        sqlx::query_as::<_, Source>("SELECT * FROM sources WHERE enabled = TRUE ORDER BY name")
            .fetch_all(pool)
            .await?;
    Ok(rows)
}

pub async fn create_source(
    pool: &PgPool,
    name: &str,
    kind: &str,
    url: &str,
    trust: &str,
) -> AppResult<Source> {
    let source = sqlx::query_as::<_, Source>(
        "INSERT INTO sources (name, kind, url, trust) VALUES ($1,$2,$3,$4) RETURNING *",
    )
    .bind(name)
    .bind(kind)
    .bind(url)
    .bind(trust)
    .fetch_one(pool)
    .await?;
    Ok(source)
}

pub async fn set_source_enabled(pool: &PgPool, source_id: Uuid, enabled: bool) -> AppResult<()> {
    sqlx::query("UPDATE sources SET enabled = $1 WHERE id = $2")
        .bind(enabled)
        .bind(source_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete_source(pool: &PgPool, source_id: Uuid) -> AppResult<()> {
    sqlx::query("DELETE FROM sources WHERE id = $1")
        .bind(source_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn list_keywords(pool: &PgPool) -> AppResult<Vec<Keyword>> {
    let rows = sqlx::query_as::<_, Keyword>("SELECT * FROM keywords ORDER BY word")
        .fetch_all(pool)
        .await?;
    Ok(rows)
}

pub async fn create_keyword(pool: &PgPool, word: &str) -> AppResult<Keyword> {
    let keyword = sqlx::query_as::<_, Keyword>(
        "INSERT INTO keywords (word) VALUES ($1) ON CONFLICT (word) DO UPDATE SET word = EXCLUDED.word RETURNING *",
    )
    .bind(word)
    .fetch_one(pool)
    .await?;
    Ok(keyword)
}

pub async fn delete_keyword(pool: &PgPool, keyword_id: Uuid) -> AppResult<()> {
    sqlx::query("DELETE FROM keywords WHERE id = $1")
        .bind(keyword_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn get_setting(pool: &PgPool, key: &str) -> AppResult<Option<serde_json::Value>> {
    let row: Option<(serde_json::Value,)> =
        sqlx::query_as("SELECT value FROM settings WHERE key = $1")
            .bind(key)
            .fetch_optional(pool)
            .await?;
    Ok(row.map(|r| r.0))
}

pub async fn set_setting(pool: &PgPool, key: &str, value: serde_json::Value) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES ($1,$2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn list_audit(pool: &PgPool, limit: i64, offset: i64) -> AppResult<Vec<AuditEntry>> {
    let rows = sqlx::query_as::<_, AuditEntry>(
        "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    )
    .bind(limit.clamp(1, 500))
    .bind(offset.max(0))
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn list_llm_calls(
    pool: &PgPool,
    run_id: Option<Uuid>,
    limit: i64,
) -> AppResult<Vec<LlmCall>> {
    let rows = if let Some(run_id) = run_id {
        sqlx::query_as::<_, LlmCall>(
            "SELECT * FROM llm_calls WHERE run_id = $1 ORDER BY created_at DESC LIMIT $2",
        )
        .bind(run_id)
        .bind(limit.clamp(1, 500))
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as::<_, LlmCall>("SELECT * FROM llm_calls ORDER BY created_at DESC LIMIT $1")
            .bind(limit.clamp(1, 500))
            .fetch_all(pool)
            .await?
    };
    Ok(rows)
}

pub async fn db_ping(pool: &PgPool) -> bool {
    sqlx::query("SELECT 1").execute(pool).await.is_ok()
}

pub async fn run_stats(pool: &PgPool, run_id: Uuid) -> AppResult<serde_json::Value> {
    let row: Option<PgRow> = sqlx::query(
        "SELECT
            (SELECT count(*) FROM items WHERE run_id = $1) AS items,
            (SELECT count(*) FROM events WHERE run_id = $1) AS events,
            (SELECT count(*) FROM journal WHERE run_id = $1) AS journal_rows,
            (SELECT count(*) FROM check_results WHERE run_id = $1 AND passed) AS checks_passed,
            (SELECT count(*) FROM check_results WHERE run_id = $1) AS checks_total,
            (SELECT COALESCE(sum(input_tokens),0) FROM llm_calls WHERE run_id = $1) AS input_tokens,
            (SELECT COALESCE(sum(output_tokens),0) FROM llm_calls WHERE run_id = $1) AS output_tokens,
            (SELECT COALESCE(sum(cost),0) FROM llm_calls WHERE run_id = $1) AS cost,
            (SELECT COALESCE(avg(latency_ms),0)::double precision FROM llm_calls WHERE run_id = $1 AND ok) AS avg_latency_ms",
    )
    .bind(run_id)
    .fetch_optional(pool)
    .await?;

    Ok(match row {
        Some(row) => json!({
            "items": row.try_get::<i64, _>("items").unwrap_or(0),
            "events": row.try_get::<i64, _>("events").unwrap_or(0),
            "journal_rows": row.try_get::<i64, _>("journal_rows").unwrap_or(0),
            "checks_passed": row.try_get::<i64, _>("checks_passed").unwrap_or(0),
            "checks_total": row.try_get::<i64, _>("checks_total").unwrap_or(0),
            "input_tokens": row.try_get::<i64, _>("input_tokens").unwrap_or(0),
            "output_tokens": row.try_get::<i64, _>("output_tokens").unwrap_or(0),
            "cost": row.try_get::<f64, _>("cost").unwrap_or(0.0),
            "avg_latency_ms": row.try_get::<f64, _>("avg_latency_ms").unwrap_or(0.0),
        }),
        None => json!({}),
    })
}

pub fn generate_password(len: usize) -> String {
    use rand_core::{OsRng, RngCore};
    const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
    let mut out = String::with_capacity(len);
    let mut rng = OsRng;
    for _ in 0..len {
        let idx = (rng.next_u32() as usize) % ALPHABET.len();
        out.push(ALPHABET[idx] as char);
    }
    out
}

pub async fn ensure_dir(path: &Path) -> AppResult<()> {
    fs::create_dir_all(path)?;
    Ok(())
}
