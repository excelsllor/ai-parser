use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono::{DateTime, Utc};
use dom_smoothie::Readability;
use futures::StreamExt;
use news_shared::db;
use news_shared::error::{AppError, AppResult};
use news_shared::security::validate_public_url;
use news_shared::telemetry::metrics;
use news_shared::text::{
    canonicalize_url, decode_bytes, normalize_whitespace, parse_date, strip_html, truncate_chars,
};
use scraper::{Html, Selector};
use serde_json::Value;
use url::Url;
use uuid::Uuid;

use crate::CollectorState;

#[derive(Debug, Clone)]
pub struct SourceFetchError {
    pub source_name: String,
    pub source_url: String,
    pub error: String,
}

pub struct RawArticle {
    pub external_id: String,
    pub source_id: Option<Uuid>,
    pub source_name: String,
    pub source_trust: String,
    pub title: String,
    pub text: String,
    pub url: String,
    pub published_at: Option<DateTime<Utc>>,
    pub date_confirmed: bool,
}

pub async fn read_dataset(
    dir: &Path,
    data_root: &Path,
    max_articles: usize,
) -> AppResult<(Vec<RawArticle>, Vec<SourceFetchError>)> {
    let canonical_dir = dir
        .canonicalize()
        .map_err(|_| AppError::BadRequest("dataset directory not found".into()))?;
    let canonical_root = data_root
        .canonicalize()
        .unwrap_or_else(|_| data_root.to_path_buf());
    if !canonical_dir.starts_with(&canonical_root) {
        return Err(AppError::Forbidden(
            "dataset directory is outside the data directory".into(),
        ));
    }

    let mut paths = Vec::new();
    collect_paths(&canonical_dir, &mut paths, 0, 16).await?;
    paths.sort();

    let mut out = Vec::new();
    let mut errors = Vec::new();
    for path in paths {
        if out.len() >= max_articles {
            break;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("dataset")
            .to_string();
        let bytes = match tokio::fs::read(&path).await {
            Ok(bytes) => bytes,
            Err(error) => {
                errors.push(SourceFetchError {
                    source_name: name,
                    source_url: path.to_string_lossy().to_string(),
                    error: error.to_string(),
                });
                continue;
            }
        };
        if bytes.len() > 64 * 1024 * 1024 {
            tracing::warn!(path = %path.display(), "skipping dataset file larger than 64 MB");
            errors.push(SourceFetchError {
                source_name: name,
                source_url: path.to_string_lossy().to_string(),
                error: "file is larger than 64 MB".to_string(),
            });
            continue;
        }
        match parse_dataset_file(&name, &bytes, "dataset", chrono_tz::Europe::Moscow) {
            Ok(mut articles) => out.append(&mut articles),
            Err(error) => {
                tracing::warn!(file = %name, error = %error, "dataset file parse failed");
                errors.push(SourceFetchError {
                    source_name: name,
                    source_url: path.to_string_lossy().to_string(),
                    error: error.to_string(),
                });
            }
        }
    }

    out.truncate(max_articles);
    Ok((out, errors))
}

async fn collect_paths(
    dir: &Path,
    out: &mut Vec<PathBuf>,
    depth: usize,
    max_depth: usize,
) -> AppResult<()> {
    if depth > max_depth || out.len() > 500 {
        return Ok(());
    }
    let mut entries = tokio::fs::read_dir(dir).await?;
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        let file_type = entry.file_type().await?;
        if file_type.is_symlink() {
            tracing::warn!(path = %path.display(), "skipping symlink in dataset");
            continue;
        }
        if file_type.is_dir() {
            Box::pin(collect_paths(&path, out, depth + 1, max_depth)).await?;
        } else if file_type.is_file() {
            out.push(path);
        }
    }
    Ok(())
}

pub fn parse_dataset_file(
    name: &str,
    bytes: &[u8],
    source_name: &str,
    tz: chrono_tz::Tz,
) -> AppResult<Vec<RawArticle>> {
    let lower = name.to_lowercase();
    if lower.ends_with(".zip") {
        return parse_zip(name, bytes, source_name, tz);
    }
    if lower.ends_with(".json") || lower.ends_with(".jsonl") || lower.ends_with(".ndjson") {
        return parse_json(name, bytes, source_name, tz);
    }
    if lower.ends_with(".csv") {
        return parse_csv(name, bytes, source_name, tz);
    }
    if lower.ends_with(".html") || lower.ends_with(".htm") {
        let html = decode_bytes(bytes);
        return Ok(vec![parse_html_article(
            &html,
            source_name,
            source_name,
            "html",
            tz,
        )]);
    }
    if lower.ends_with(".txt") || lower.ends_with(".md") || lower.ends_with(".eml") {
        let text = decode_bytes(bytes);
        return Ok(vec![parse_text_article(name, source_name, &text, tz)]);
    }

    let text = decode_bytes(bytes);
    if text.trim().is_empty() {
        return Err(AppError::BadRequest("empty file".into()));
    }
    if text.len() > 50 {
        Ok(vec![parse_text_article(name, source_name, &text, tz)])
    } else {
        Ok(Vec::new())
    }
}

fn parse_zip(
    name: &str,
    bytes: &[u8],
    source_name: &str,
    tz: chrono_tz::Tz,
) -> AppResult<Vec<RawArticle>> {
    let reader = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(reader)
        .map_err(|e| AppError::BadRequest(format!("invalid zip {name}: {e}")))?;
    let mut out = Vec::new();
    let mut total = 0usize;

    for idx in 0..archive.len().min(200) {
        let file = match archive.by_index(idx) {
            Ok(f) => f,
            Err(_) => continue,
        };
        if file.is_dir() {
            continue;
        }
        let file_name = match file.name() {
            Ok(name) => name.to_string(),
            Err(_) => continue,
        };
        if file_name.contains("..") {
            continue;
        }
        let size = file.size() as usize;
        total = total.saturating_add(size);
        if total > 64 * 1024 * 1024 {
            break;
        }
        let remaining = 64 * 1024 * 1024 - total.min(64 * 1024 * 1024);
        let mut data = Vec::with_capacity(size.min(2 * 1024 * 1024));
        let mut limited = file.take(remaining as u64);
        if limited.read_to_end(&mut data).is_err() {
            continue;
        }
        if data.len() >= remaining {
            break;
        }
        if let Ok(mut parsed) = parse_dataset_file(&file_name, &data, source_name, tz) {
            out.append(&mut parsed);
        }
    }
    Ok(out)
}

fn parse_json(
    name: &str,
    bytes: &[u8],
    source_name: &str,
    tz: chrono_tz::Tz,
) -> AppResult<Vec<RawArticle>> {
    let text = decode_bytes(bytes);
    let text = text.trim_start_matches('\u{feff}');
    if text.trim().is_empty() {
        return Err(AppError::BadRequest("empty json dataset".into()));
    }
    let mut values: Vec<Value> = Vec::new();

    if let Ok(value) = serde_json::from_str::<Value>(text) {
        match value {
            Value::Array(items) => values.extend(items),
            Value::Object(mut map) => {
                let mut found = false;
                for key in ["items", "articles", "records", "data", "publications"] {
                    if let Some(Value::Array(items)) = map.remove(key) {
                        values.extend(items);
                        found = true;
                        break;
                    }
                }
                if !found {
                    values.push(Value::Object(map));
                }
            }
            _ => {}
        }
    } else {
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if let Ok(value) = serde_json::from_str::<Value>(line) {
                values.push(value);
            }
        }
    }

    let mut out = Vec::new();
    for (idx, value) in values.into_iter().enumerate() {
        if !value.is_object() {
            continue;
        }
        let external_id = get_str(&value, &["id", "external_id", "article_id"])
            .unwrap_or_else(|| format!("{name}:{idx}"));
        let title = get_str(&value, &["title", "headline", "name"]).unwrap_or_default();
        let text = get_str(
            &value,
            &[
                "text",
                "content",
                "body",
                "description",
                "summary",
                "full_text",
            ],
        )
        .unwrap_or_default();
        let url = get_str(&value, &["url", "link", "source_url"]).unwrap_or_default();
        let source = get_str(&value, &["source", "source_name", "publisher"])
            .unwrap_or_else(|| source_name.to_string());
        let raw_date = get_str(
            &value,
            &[
                "published_at",
                "published",
                "date",
                "pub_date",
                "created_at",
            ],
        )
        .unwrap_or_default();
        let parsed = parse_date(&raw_date, tz);
        let title = if title.trim().is_empty() {
            guess_title(&text)
        } else {
            title
        };
        out.push(RawArticle {
            external_id,
            source_id: None,
            source_name: source,
            source_trust: "unknown".to_string(),
            title,
            text,
            url,
            published_at: parsed.value,
            date_confirmed: parsed.confirmed,
        });
    }
    Ok(out)
}

fn parse_csv(
    name: &str,
    bytes: &[u8],
    source_name: &str,
    tz: chrono_tz::Tz,
) -> AppResult<Vec<RawArticle>> {
    let text = decode_bytes(bytes);
    if text.trim().is_empty() {
        return Err(AppError::BadRequest("empty csv dataset".into()));
    }
    let first_line = text.lines().next().unwrap_or("");
    let delimiter = if first_line.matches(';').count() > first_line.matches(',').count() {
        b';'
    } else {
        b','
    };
    let mut reader = csv::ReaderBuilder::new()
        .flexible(true)
        .delimiter(delimiter)
        .from_reader(text.as_bytes());
    let headers = reader
        .headers()
        .map_err(|e| AppError::BadRequest(format!("invalid csv {name}: {e}")))?
        .iter()
        .map(|h| h.trim_start_matches('\u{feff}').to_lowercase())
        .collect::<Vec<_>>();

    let mut out = Vec::new();
    for (idx, record) in reader.records().enumerate() {
        let record = match record {
            Ok(r) => r,
            Err(_) => continue,
        };
        let get = |names: &[&str]| -> Option<String> {
            for (i, header) in headers.iter().enumerate() {
                if names.iter().any(|n| header == n) {
                    if let Some(value) = record.get(i) {
                        let value = value.trim();
                        if !value.is_empty() {
                            return Some(value.to_string());
                        }
                    }
                }
            }
            None
        };
        let external_id = get(&["id", "external_id"]).unwrap_or_else(|| format!("{name}:{idx}"));
        let title = get(&["title", "headline"]).unwrap_or_default();
        let text = get(&["text", "content", "body", "description"]).unwrap_or_default();
        let url = get(&["url", "link"]).unwrap_or_default();
        let source =
            get(&["source", "source_name", "publisher"]).unwrap_or_else(|| source_name.to_string());
        let raw_date = get(&["published_at", "published", "date"]).unwrap_or_default();
        let parsed = parse_date(&raw_date, tz);
        let title = if title.is_empty() {
            guess_title(&text)
        } else {
            title
        };
        out.push(RawArticle {
            external_id,
            source_id: None,
            source_name: source,
            source_trust: "unknown".to_string(),
            title,
            text,
            url,
            published_at: parsed.value,
            date_confirmed: parsed.confirmed,
        });
    }
    Ok(out)
}

fn parse_text_article(name: &str, source_name: &str, text: &str, tz: chrono_tz::Tz) -> RawArticle {
    let normalized = news_shared::text::normalize_whitespace(text);
    let first_line = normalized.lines().next().unwrap_or("").to_string();
    let title = if first_line.chars().count() <= 180 {
        first_line
    } else {
        truncate_chars(&first_line, 180)
    };
    let parsed = find_date_in_text(&normalized, tz);
    RawArticle {
        external_id: name.to_string(),
        source_id: None,
        source_name: source_name.to_string(),
        source_trust: "unknown".to_string(),
        title: if title.is_empty() {
            guess_title(&normalized)
        } else {
            title
        },
        text: normalized,
        url: String::new(),
        published_at: parsed.value,
        date_confirmed: parsed.confirmed,
    }
}

fn find_date_in_text(text: &str, tz: chrono_tz::Tz) -> news_shared::text::ParsedDate {
    let re = regex::Regex::new(
        r"(?x)
        (\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}) |
        (\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}) |
        (\d{2}\.\d{2}\.\d{4}) |
        (\d{4}-\d{2}-\d{2})",
    )
    .expect("date regex");
    if let Some(capture) = re.find(text) {
        return parse_date(capture.as_str(), tz);
    }
    news_shared::text::ParsedDate::default()
}

fn guess_title(text: &str) -> String {
    let first = text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("Без заголовка");
    truncate_chars(first, 160)
}

pub async fn collect_live(
    state: &CollectorState,
    source_ids: &[Uuid],
) -> AppResult<(Vec<RawArticle>, Vec<SourceFetchError>)> {
    if !state.config.live_fetch_enabled {
        return Err(AppError::Forbidden("live fetch is disabled".into()));
    }
    let sources = db::list_enabled_sources(&state.pool).await?;
    let sources: Vec<_> = if source_ids.is_empty() {
        sources
    } else {
        sources
            .into_iter()
            .filter(|s| source_ids.contains(&s.id))
            .collect()
    };
    if sources.is_empty() {
        return Err(AppError::BadRequest("no enabled sources".into()));
    }

    let mut allowed_hosts = state.config.allowed_source_hosts.clone();
    for source in &sources {
        if let Ok(url) = Url::parse(&source.url) {
            if let Some(host) = url.host_str() {
                let host = host.to_lowercase();
                let bare = host.strip_prefix("www.").unwrap_or(&host).to_string();
                for candidate in [host, bare] {
                    if !allowed_hosts.contains(&candidate) {
                        allowed_hosts.push(candidate);
                    }
                }
            }
        }
    }

    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(20))
        .connect_timeout(Duration::from_secs(10))
        .user_agent("NewsDigestBot/0.1 (+https://example.local/bot)")
        .build()
        .map_err(AppError::from)?;

    let mut out = Vec::new();
    let mut errors = Vec::new();
    for source in sources {
        let before = out.len();
        let result = match source.kind.as_str() {
            "rss" => fetch_rss_source(state, &client, &source, &allowed_hosts, &mut out).await,
            "html" => fetch_html_source(state, &client, &source, &allowed_hosts, &mut out).await,
            other => {
                tracing::warn!(kind = other, "unknown source kind");
                Err(AppError::BadRequest(format!(
                    "unknown source kind: {other}"
                )))
            }
        };
        let mut sync_error = None;
        if let Err(error) = result {
            metrics()
                .fetch_errors
                .with_label_values(&[&source.name])
                .inc();
            tracing::warn!(source = %source.name, error = %error, "source fetch failed");
            sync_error = Some(error.to_string());
            errors.push(SourceFetchError {
                source_name: source.name.clone(),
                source_url: source.url.clone(),
                error: error.to_string(),
            });
        }
        if let Err(error) = db::record_source_sync(
            &state.pool,
            source.id,
            sync_error.as_deref(),
            out.len().saturating_sub(before),
        )
        .await
        {
            tracing::warn!(source = %source.name, error = %error, "source sync stats update failed");
        }
        if out.len() >= state.config.max_articles_per_run {
            break;
        }
    }
    Ok((out, errors))
}

async fn fetch_rss_source(
    state: &CollectorState,
    client: &reqwest::Client,
    source: &news_shared::models::Source,
    allowed_hosts: &[String],
    out: &mut Vec<RawArticle>,
) -> AppResult<()> {
    let (_, body, _) = fetch_bytes(
        state,
        client,
        &source.url,
        allowed_hosts,
        state.config.max_fetch_bytes,
    )
    .await?;
    let feed = feed_rs::parser::parse(&body[..])
        .map_err(|e| AppError::BadRequest(format!("invalid feed {}: {e}", source.name)))?;

    let entries = feed
        .entries
        .into_iter()
        .take(state.config.max_articles_per_source)
        .collect::<Vec<_>>();
    for entry in entries {
        if out.len() >= state.config.max_articles_per_run {
            break;
        }
        let title = entry
            .title
            .map(|t| t.content)
            .unwrap_or_else(|| "Без заголовка".to_string());
        let summary = entry
            .summary
            .map(|t| t.content)
            .or_else(|| entry.content.and_then(|c| c.body))
            .unwrap_or_default();
        let link = entry
            .links
            .iter()
            .find(|l| l.rel.as_deref() == Some("alternate") || l.rel.is_none())
            .or_else(|| entry.links.first())
            .map(|l| l.href.clone())
            .unwrap_or_default();
        let published = entry
            .published
            .or(entry.updated)
            .map(|d| d.with_timezone(&Utc));

        let mut text = summary.clone();
        let mut page_title = title.clone();
        let mut published_at = published;
        let mut date_confirmed = published.is_some();

        if !link.is_empty() {
            match fetch_article_page(state, client, &link, allowed_hosts).await {
                Ok(article) => {
                    if article.text.chars().count() > summary.chars().count() {
                        text = article.text;
                    }
                    if !article.title.is_empty() {
                        page_title = article.title;
                    }
                    if let Some(date) = article.published_at {
                        published_at = Some(date);
                        date_confirmed = article.date_confirmed;
                    }
                }
                Err(error) => {
                    tracing::debug!(url = %link, error = %error, "article fetch failed, using feed summary");
                }
            }
        }

        out.push(RawArticle {
            external_id: entry.id,
            source_id: Some(source.id),
            source_name: source.name.clone(),
            source_trust: source.trust.clone(),
            title: if page_title.trim().is_empty() {
                guess_title(&text)
            } else {
                page_title
            },
            text,
            url: link,
            published_at,
            date_confirmed,
        });
    }
    Ok(())
}

fn is_probable_article_link(source_url: &str, candidate: &Url) -> bool {
    if !matches!(candidate.scheme(), "http" | "https") {
        return false;
    }
    let path = candidate.path().trim_end_matches('/');
    if path.is_empty() || path == "/" {
        return false;
    }
    let source_path = Url::parse(source_url)
        .map(|url| url.path().trim_end_matches('/').to_string())
        .unwrap_or_default();
    if path == source_path {
        return false;
    }
    let lower = path.to_lowercase();
    for skip in [
        "/tag/",
        "/tags/",
        "/search",
        "/login",
        "/auth",
        "/privacy",
        "/contacts",
        "/rss",
        "/feed",
        "/sitemap",
        "/wp-",
        "/category/",
    ] {
        if lower.contains(skip) {
            return false;
        }
    }
    let segments = path
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    if segments.len() < 2 {
        return false;
    }
    let has_long_segment = segments.iter().any(|segment| segment.chars().count() >= 8);
    let has_numeric_id = segments
        .iter()
        .any(|segment| segment.len() >= 4 && segment.chars().all(|c| c.is_ascii_digit()));
    let known_section = [
        "/news/",
        "/blog/",
        "/press-center/publications/",
        "/security-reports/",
        "/about/news/",
        "/events/news/",
        "/analytics/",
    ]
    .iter()
    .any(|prefix| lower.contains(prefix));
    has_long_segment || has_numeric_id || known_section
}

async fn fetch_html_source(
    state: &CollectorState,
    client: &reqwest::Client,
    source: &news_shared::models::Source,
    allowed_hosts: &[String],
    out: &mut Vec<RawArticle>,
) -> AppResult<()> {
    let (base_url, body, content_type) = fetch_bytes(
        state,
        client,
        &source.url,
        allowed_hosts,
        state.config.max_fetch_bytes,
    )
    .await?;
    let html = decode_bytes(&body);
    let is_xml = content_type
        .as_deref()
        .map(|value| value.contains("xml"))
        .unwrap_or(false)
        || html.trim_start().starts_with("<?xml")
        || html.contains("<urlset")
        || html.contains("<sitemapindex");

    let links = if is_xml {
        // Sitemap sources (for example UserGate) expose <loc> URLs instead of links.
        let re = regex::Regex::new(r"<loc>\s*([^<\s]+)\s*</loc>").expect("sitemap regex");
        let mut links = Vec::new();
        for capture in re.captures_iter(&html) {
            let raw = capture.get(1).map(|m| m.as_str()).unwrap_or_default();
            if let Ok(joined) = base_url.join(raw) {
                if joined.host_str() == base_url.host_str() {
                    let canonical =
                        canonicalize_url(joined.as_str()).unwrap_or_else(|| joined.to_string());
                    if !links.contains(&canonical) {
                        links.push(canonical);
                    }
                }
            }
        }
        links
    } else {
        let doc = Html::parse_document(&html);
        let selector = Selector::parse("a[href]").expect("selector");
        let mut links = Vec::new();
        for element in doc.select(&selector) {
            if let Some(href) = element.value().attr("href") {
                if let Ok(joined) = base_url.join(href) {
                    if joined.host_str() == base_url.host_str()
                        && is_probable_article_link(&source.url, &joined)
                    {
                        let canonical =
                            canonicalize_url(joined.as_str()).unwrap_or_else(|| joined.to_string());
                        if !links.contains(&canonical) {
                            links.push(canonical);
                        }
                    }
                }
            }
        }
        links
    };

    if base_url.host_str() == Some("usergate.com") {
        for link in links.into_iter().take(state.config.max_articles_per_source) {
            if out.len() >= state.config.max_articles_per_run {
                break;
            }
            match fetch_usergate_article(state, client, &link, allowed_hosts).await {
                Ok(mut article) => {
                    article.source_id = Some(source.id);
                    article.source_name = source.name.clone();
                    article.source_trust = source.trust.clone();
                    out.push(article);
                }
                Err(error) => {
                    tracing::debug!(url = %link, error = %error, "UserGate article fetch failed");
                }
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        return Ok(());
    }

    for link in links.into_iter().take(state.config.max_articles_per_source) {
        if out.len() >= state.config.max_articles_per_run {
            break;
        }
        match fetch_article_page(state, client, &link, allowed_hosts).await {
            Ok(mut article) => {
                article.source_id = Some(source.id);
                article.source_name = source.name.clone();
                article.source_trust = source.trust.clone();
                out.push(article);
            }
            Err(error) => {
                tracing::debug!(url = %link, error = %error, "article fetch failed");
            }
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    Ok(())
}

async fn fetch_usergate_article(
    state: &CollectorState,
    client: &reqwest::Client,
    link: &str,
    allowed_hosts: &[String],
) -> AppResult<RawArticle> {
    let parsed = Url::parse(link)
        .map_err(|error| AppError::BadRequest(format!("invalid UserGate url: {error}")))?;
    let path = parsed.path();
    let api_url = format!("https://usergate.com/api/v1/page/ru{path}");
    let (_, body, _) = fetch_bytes(
        state,
        client,
        &api_url,
        allowed_hosts,
        state.config.max_fetch_bytes,
    )
    .await?;
    let value: serde_json::Value = serde_json::from_slice(&body)?;
    let data = value
        .get("data")
        .ok_or_else(|| AppError::BadRequest("UserGate API returned no data".into()))?;
    let title = data
        .pointer("/seo/title")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
        .to_string();

    let mut text_parts = Vec::new();
    let mut date_raw = String::new();
    if let Some(blocks) = data.get("blocks").and_then(serde_json::Value::as_array) {
        for block in blocks {
            let Some(content) = block.get("content") else {
                continue;
            };
            if date_raw.is_empty() {
                if let Some(date) = content.get("date").and_then(serde_json::Value::as_str) {
                    date_raw = date.to_string();
                }
            }
            for key in ["description", "text", "body", "content"] {
                if let Some(raw) = content.get(key).and_then(serde_json::Value::as_str) {
                    let clean = strip_html(raw);
                    if clean.chars().count() > 20 {
                        text_parts.push(clean);
                    }
                }
            }
        }
    }

    let text = normalize_whitespace(&text_parts.join("\n"));
    if text.chars().count() < 50 {
        return Err(AppError::BadRequest(
            "UserGate article text is too short".into(),
        ));
    }
    let parsed_date = parse_date(&date_raw, state.config.control_timezone);
    Ok(RawArticle {
        external_id: path.trim_start_matches('/').to_string(),
        source_id: None,
        source_name: "UserGate".to_string(),
        source_trust: "primary".to_string(),
        title: if title.trim().is_empty() {
            path.trim_start_matches('/').to_string()
        } else {
            title
        },
        text,
        url: link.to_string(),
        published_at: parsed_date.value,
        date_confirmed: parsed_date.confirmed,
    })
}

fn looks_like_challenge(text: &str) -> bool {
    let lower = text.to_lowercase();
    let markers = [
        "get_cookie_spsn",
        "js-challenge",
        "captcha",
        "проверка браузера",
        "ddos-guard",
        "just a moment",
        "access denied",
        "enable javascript",
        "включите javascript",
        "document.addeventlistener",
        "window.location",
        "document.cookie",
    ];
    text.chars().count() < 200 || markers.iter().any(|marker| lower.contains(marker))
}

async fn fetch_article_page(
    state: &CollectorState,
    client: &reqwest::Client,
    url: &str,
    allowed_hosts: &[String],
) -> AppResult<RawArticle> {
    let (final_url, body, content_type) = fetch_bytes(
        state,
        client,
        url,
        allowed_hosts,
        state.config.max_fetch_bytes,
    )
    .await?;
    let html = decode_bytes(&body);
    let is_feed = content_type
        .as_deref()
        .map(|ct| ct.contains("rss") || ct.contains("atom") || ct.contains("xml"))
        .unwrap_or(false);
    if is_feed {
        return Err(AppError::BadRequest(
            "expected html article, got feed".into(),
        ));
    }
    let mut article = parse_html_article(
        &html,
        final_url.as_str(),
        final_url.host_str().unwrap_or("source"),
        "live",
        state.config.control_timezone,
    );
    if looks_like_challenge(&article.text) {
        return Err(AppError::BadRequest(
            "article page is a JavaScript or captcha challenge".into(),
        ));
    }
    article.url = final_url.to_string();
    Ok(article)
}

async fn fetch_bytes(
    state: &CollectorState,
    client: &reqwest::Client,
    raw_url: &str,
    allowed_hosts: &[String],
    max_bytes: usize,
) -> AppResult<(Url, Vec<u8>, Option<String>)> {
    let mut url = validate_public_url(raw_url, allowed_hosts).await?;

    for _ in 0..5 {
        let host = url.host_str().unwrap_or("unknown").to_string();
        let rate_key = format!("ratelimit:fetch:{host}");
        let allowed = state
            .redis
            .rate_limit(&rate_key, 2, 1)
            .await
            .unwrap_or(true);
        if !allowed {
            tokio::time::sleep(Duration::from_millis(600)).await;
        }

        let response = client
            .get(url.clone())
            .header(reqwest::header::ACCEPT, "text/html,application/xhtml+xml,application/xml,application/rss+xml;q=0.9,*/*;q=0.8")
            .send()
            .await
            .map_err(AppError::from)?;

        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| AppError::BadRequest("redirect without location".into()))?;
            let next = url
                .join(location)
                .map_err(|_| AppError::BadRequest("invalid redirect target".into()))?;
            if url.scheme() == "https" && next.scheme() != "https" {
                return Err(AppError::UnsafeUrl(
                    "redirect downgrades https to http".into(),
                ));
            }
            url = validate_public_url(next.as_str(), allowed_hosts).await?;
            continue;
        }

        if !response.status().is_success() {
            return Err(AppError::BadRequest(format!(
                "source returned HTTP {}",
                response.status()
            )));
        }

        if let Some(length) = response.content_length() {
            if length as usize > max_bytes {
                return Err(AppError::BadRequest("response is too large".into()));
            }
        }

        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(ToOwned::to_owned);

        let mut data = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(AppError::from)?;
            if data.len() + chunk.len() > max_bytes {
                return Err(AppError::BadRequest("response is too large".into()));
            }
            data.extend_from_slice(&chunk);
        }
        return Ok((url, data, content_type));
    }

    Err(AppError::BadRequest("too many redirects".into()))
}

pub fn parse_html_article(
    html: &str,
    url: &str,
    source_name: &str,
    external_id: &str,
    tz: chrono_tz::Tz,
) -> RawArticle {
    let doc = Html::parse_document(html);
    let fallback_title = meta_content(&doc, "meta[property='og:title']")
        .or_else(|| meta_content(&doc, "meta[name='twitter:title']"))
        .or_else(|| text_of(&doc, "h1"))
        .or_else(|| text_of(&doc, "title"))
        .unwrap_or_default();
    let fallback_date = meta_content(&doc, "meta[property='article:published_time']")
        .or_else(|| meta_content(&doc, "meta[property='og:published_time']"))
        .or_else(|| meta_content(&doc, "meta[name='date']"))
        .or_else(|| meta_content(&doc, "meta[name='pubdate']"))
        .or_else(|| meta_content(&doc, "meta[name='publish-date']"))
        .or_else(|| attr_of(&doc, "time[datetime]", "datetime"))
        .or_else(|| json_ld_value(&doc, &["datePublished", "dateCreated"]))
        .unwrap_or_default();

    // Readability removes navigation, scripts and boilerplate. Fall back to the
    // simple DOM extraction only when the readable body is too short.
    let readable = Readability::new(html, Some(url), None)
        .ok()
        .and_then(|mut readability| readability.parse().ok());
    let (title, text, raw_date) = if let Some(article) = readable {
        let text = normalize_whitespace(&article.text_content);
        if text.chars().count() >= 200 {
            (
                if article.title.trim().is_empty() {
                    fallback_title.clone()
                } else {
                    article.title
                },
                text,
                article.published_time.unwrap_or(fallback_date.clone()),
            )
        } else {
            (
                fallback_title.clone(),
                strip_html(html),
                fallback_date.clone(),
            )
        }
    } else {
        (
            fallback_title.clone(),
            strip_html(html),
            fallback_date.clone(),
        )
    };

    let parsed = parse_date(&raw_date, tz);
    let canonical = meta_content(&doc, "link[rel='canonical']")
        .and_then(|href| canonicalize_url(&href))
        .or_else(|| canonicalize_url(url))
        .unwrap_or_else(|| url.to_string());

    RawArticle {
        external_id: if external_id.is_empty() {
            canonical.clone()
        } else {
            external_id.to_string()
        },
        source_id: None,
        source_name: source_name.to_string(),
        source_trust: "unknown".to_string(),
        title: if title.trim().is_empty() {
            guess_title(&text)
        } else {
            title
        },
        text,
        url: canonical,
        published_at: parsed.value,
        date_confirmed: parsed.confirmed,
    }
}

fn meta_content(doc: &Html, selector: &str) -> Option<String> {
    let selector = Selector::parse(selector).ok()?;
    doc.select(&selector)
        .next()
        .and_then(|e| e.value().attr("content").map(ToOwned::to_owned))
}

fn attr_of(doc: &Html, selector: &str, attr: &str) -> Option<String> {
    let selector = Selector::parse(selector).ok()?;
    doc.select(&selector)
        .next()
        .and_then(|e| e.value().attr(attr).map(ToOwned::to_owned))
}

fn text_of(doc: &Html, selector: &str) -> Option<String> {
    let selector = Selector::parse(selector).ok()?;
    doc.select(&selector)
        .next()
        .map(|e| e.text().collect::<Vec<_>>().join(" ").trim().to_string())
        .filter(|s| !s.is_empty())
}

fn json_ld_value(doc: &Html, keys: &[&str]) -> Option<String> {
    let selector = Selector::parse("script[type='application/ld+json']").ok()?;
    for element in doc.select(&selector) {
        let raw = element.text().collect::<String>();
        if let Ok(value) = serde_json::from_str::<Value>(&raw) {
            if let Some(found) = find_json_value(&value, keys) {
                return Some(found);
            }
        }
    }
    None
}

fn find_json_value(value: &Value, keys: &[&str]) -> Option<String> {
    match value {
        Value::Object(map) => {
            for key in keys {
                if let Some(Value::String(found)) = map.get(*key) {
                    if !found.trim().is_empty() {
                        return Some(found.clone());
                    }
                }
            }
            for child in map.values() {
                if let Some(found) = find_json_value(child, keys) {
                    return Some(found);
                }
            }
            None
        }
        Value::Array(items) => items.iter().find_map(|item| find_json_value(item, keys)),
        _ => None,
    }
}

fn get_str(value: &Value, keys: &[&str]) -> Option<String> {
    let map = value.as_object()?;
    for (key, val) in map {
        let key_lower = key.to_lowercase();
        if keys.iter().any(|k| key_lower == *k) {
            match val {
                Value::String(s) if !s.trim().is_empty() => return Some(s.trim().to_string()),
                Value::Number(n) => return Some(n.to_string()),
                _ => {}
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_json_dataset() {
        let data = r#"[
            {"id":"1","title":"Утечка данных","text":"Текст достаточно длинный для обработки.","source":"Test","url":"https://example.com/1","published_at":"2026-11-07 12:00"}
        ]"#;
        let items = parse_json(
            "dataset.json",
            data.as_bytes(),
            "dataset",
            chrono_tz::Europe::Moscow,
        )
        .unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].external_id, "1");
        assert_eq!(items[0].title, "Утечка данных");
        assert!(items[0].date_confirmed);
    }

    #[test]
    fn parses_csv_dataset() {
        let data = "id,title,text,source,url,published_at\n2,Атака,Текст,Test,https://example.com/2,2026-11-07 12:00\n";
        let items = parse_csv(
            "dataset.csv",
            data.as_bytes(),
            "dataset",
            chrono_tz::Europe::Moscow,
        )
        .unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].external_id, "2");
        assert_eq!(items[0].title, "Атака");
    }

    #[test]
    fn parses_html_article() {
        let html = r#"<html><head><title>Заголовок</title>
            <meta property="article:published_time" content="2026-11-07T12:00:00+03:00">
            </head><body><article><p>Текст новости про кибербезопасность.</p></article></body></html>"#;
        let item = parse_html_article(
            html,
            "https://example.com/news/1",
            "Test",
            "1",
            chrono_tz::Europe::Moscow,
        );
        assert_eq!(item.title, "Заголовок");
        assert!(item.text.contains("кибербезопасность"));
        assert!(item.date_confirmed);
    }
}
