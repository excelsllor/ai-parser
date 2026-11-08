use std::collections::HashSet;
use std::env;
use std::time::Duration;

use futures::{stream, StreamExt};
use once_cell::sync::Lazy;
use regex::Regex;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::models::Item;

static CVE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bCVE-\d{4}-\d{4,}\b").expect("CVE regex"));
static BDU_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\bBDU[:\s-]*(\d{4})[-\s]*(\d{3,6})\b").expect("BDU regex"));
static CVSS_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)CVSS\s*(?:3\.1|3\.0|2\.0)?[^0-9]{0,24}(\d{1,2}(?:\.\d)?)").expect("CVSS regex")
});
static FIXED_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(?:до\s+версии|устраня(?:ется|емой|емых)?\s+.*?версии?|fixed\s+in|patched\s+in)[:\s]*([A-Za-z0-9][\w.\-]*)").expect("fixed regex")
});
static VERSION_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\b(\d+(?:\.\d+){1,4}(?:[A-Za-z][\w]*)?)\b").expect("version regex"));

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VulnerabilityRecord {
    pub item_id: Uuid,
    pub item_title: String,
    pub item_url: String,
    pub cve_id: String,
    pub bdu_id: String,
    pub title: String,
    pub description: String,
    pub software: String,
    pub severity: String,
    pub cvss_score: Option<f64>,
    pub cvss_version: String,
    pub cpe: String,
    pub affected_range: String,
    pub fixed_version: String,
    pub patch_url: String,
    pub cmdb_match: bool,
    pub cmdb_error: String,
    pub current_version: String,
    pub target_version: String,
    pub recommendation: String,
    pub source: String,
    pub external_errors: Vec<String>,
}

#[derive(Debug, Clone)]
struct Candidate {
    item_id: Uuid,
    item_title: String,
    item_url: String,
    cve_id: String,
    bdu_id: String,
    sentence: String,
    full_text: String,
}

#[derive(Debug, Clone)]
struct Enriched {
    source: String,
    cve_id: String,
    bdu_id: String,
    title: String,
    description: String,
    severity: String,
    cvss_score: Option<f64>,
    cvss_version: String,
    cpe: String,
    affected_range: String,
    fixed_version: String,
    patch_url: String,
}

#[derive(Debug, Clone)]
struct InventoryItem {
    name: String,
    version: String,
    cpe: String,
}

struct SecurityConfig {
    enabled: bool,
    nvd_base: String,
    nvd_key: Option<String>,
    bdu_base: String,
    cmdb_endpoint: Option<String>,
    cmdb_auth_type: String,
    cmdb_token: Option<String>,
    bdu_insecure_fallback: bool,
    concurrency: usize,
}

pub async fn enrich_items(items: &[Item]) -> Vec<VulnerabilityRecord> {
    let config = SecurityConfig::from_env();
    if !config.enabled {
        return Vec::new();
    }

    let candidates = extract_candidates(items);
    if candidates.is_empty() {
        return Vec::new();
    }

    let client = match Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(12))
        .connect_timeout(Duration::from_secs(5))
        .user_agent("news-digest-security/0.1")
        .build()
    {
        Ok(client) => client,
        Err(_) => return Vec::new(),
    };

    let bdu_client = if config.bdu_insecure_fallback {
        Client::builder()
            .no_proxy()
            .danger_accept_invalid_certs(true)
            .timeout(Duration::from_secs(12))
            .connect_timeout(Duration::from_secs(5))
            .user_agent("news-digest-security/0.1")
            .build()
            .ok()
    } else {
        None
    };
    let bdu_client = bdu_client.as_ref().unwrap_or(&client);

    stream::iter(candidates)
        .map(|candidate| {
            let client = client.clone();
            let bdu_client = bdu_client.clone();
            let config = &config;
            async move { enrich_candidate(&client, &bdu_client, config, candidate).await }
        })
        .buffer_unordered(config.concurrency)
        .filter_map(|value| async move { value })
        .collect()
        .await
}

impl SecurityConfig {
    fn from_env() -> Self {
        let cmdb_endpoint = env::var("CMDB_ENDPOINT")
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        Self {
            enabled: env::var("SECURITY_ENRICH_ENABLED")
                .map(|value| value != "0" && !value.eq_ignore_ascii_case("false"))
                .unwrap_or(true),
            nvd_base: env::var("NVD_API_BASE")
                .unwrap_or_else(|_| "https://services.nvd.nist.gov".to_owned())
                .trim_end_matches('/')
                .to_owned(),
            nvd_key: env::var("NVD_API_KEY")
                .ok()
                .filter(|value| !value.is_empty()),
            bdu_base: env::var("BDU_API_BASE")
                .unwrap_or_else(|_| "https://bdu.fstec.ru".to_owned())
                .trim_end_matches('/')
                .to_owned(),
            cmdb_endpoint,
            cmdb_auth_type: env::var("CMDB_AUTH_TYPE").unwrap_or_else(|_| "none".to_owned()),
            cmdb_token: env::var("CMDB_AUTH_TOKEN")
                .ok()
                .filter(|value| !value.is_empty()),
            bdu_insecure_fallback: env::var("FSTEC_BDU_INSECURE_FALLBACK")
                .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
                .unwrap_or(false),
            concurrency: env::var("SECURITY_LOOKUP_CONCURRENCY")
                .ok()
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(4)
                .clamp(1, 16),
        }
    }
}

fn extract_candidates(items: &[Item]) -> Vec<Candidate> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();

    for item in items {
        let text = format!("{} {}", item.title, item.clean_text);
        for found in CVE_RE.find_iter(&text) {
            let cve_id = found.as_str().to_uppercase();
            let key = format!("{}:{}", item.id, cve_id);
            if !seen.insert(key) {
                continue;
            }
            out.push(Candidate {
                item_id: item.id,
                item_title: item.title.clone(),
                item_url: item.url.clone(),
                cve_id,
                bdu_id: String::new(),
                sentence: sentence_around(&text, found.start(), found.end()),
                full_text: text.clone(),
            });
        }
        for caps in BDU_RE.captures_iter(&text) {
            let bdu_id = format!("BDU:{}-{}", &caps[1], &caps[2]);
            let key = format!("{}:{}", item.id, bdu_id);
            if !seen.insert(key) {
                continue;
            }
            let matched = caps.get(0).expect("BDU match");
            out.push(Candidate {
                item_id: item.id,
                item_title: item.title.clone(),
                item_url: item.url.clone(),
                cve_id: String::new(),
                bdu_id,
                sentence: sentence_around(&text, matched.start(), matched.end()),
                full_text: text.clone(),
            });
        }
    }
    out
}

fn sentence_around(text: &str, start: usize, end: usize) -> String {
    let mut left = start.min(text.len());
    let mut right = end.min(text.len());
    let min = start.saturating_sub(500);
    let max = (end + 500).min(text.len());
    while left > min {
        let Some(ch) = text[..left].chars().next_back() else {
            break;
        };
        if matches!(ch, '.' | '!' | '?' | '\n') {
            break;
        }
        left -= ch.len_utf8();
    }
    while right < max {
        let Some(ch) = text[right..].chars().next() else {
            break;
        };
        right += ch.len_utf8();
        if matches!(ch, '.' | '!' | '?' | '\n') {
            break;
        }
    }
    text[left..right].trim().to_owned()
}

async fn enrich_candidate(
    client: &Client,
    bdu_client: &Client,
    config: &SecurityConfig,
    candidate: Candidate,
) -> Option<VulnerabilityRecord> {
    let mut errors = Vec::new();
    let software = extract_software(&candidate.sentence, &candidate.item_title);
    let bdu = if candidate.bdu_id.is_empty() {
        None
    } else {
        match fetch_bdu(bdu_client, &config.bdu_base, &candidate.bdu_id).await {
            Ok(value) => Some(value),
            Err(error) => {
                errors.push(format!("BDU:{}:{}", candidate.bdu_id, error));
                None
            }
        }
    };
    let nvd = if candidate.cve_id.is_empty() {
        None
    } else {
        match fetch_nvd(client, config, &candidate.cve_id, &software).await {
            Ok(value) => Some(value),
            Err(error) => {
                errors.push(format!("NVD:{}:{}", candidate.cve_id, error));
                None
            }
        }
    };

    let mut enriched = match (bdu, nvd) {
        (Some(mut bdu), Some(nvd)) => {
            if bdu.cpe.is_empty() {
                bdu.cpe = nvd.cpe;
            }
            if bdu.fixed_version.is_empty() {
                bdu.fixed_version = nvd.fixed_version;
            }
            if bdu.patch_url.is_empty() {
                bdu.patch_url = nvd.patch_url;
            }
            if bdu.cve_id.is_empty() {
                bdu.cve_id = nvd.cve_id;
            }
            bdu
        }
        (Some(bdu), None) => bdu,
        (None, Some(nvd)) => nvd,
        (None, None) => return None,
    };

    let mut cmdb_match = false;
    let mut cmdb_error = String::new();
    let mut current_version = String::new();
    if let Some(endpoint) = &config.cmdb_endpoint {
        match fetch_cmdb(client, endpoint, config, &software).await {
            Ok(items) => {
                if let Some(item) = items
                    .into_iter()
                    .find(|item| inventory_matches(item, &software, &enriched))
                {
                    cmdb_match = true;
                    current_version = item.version;
                }
            }
            Err(error) => cmdb_error = format!("cmdb:{software}:{error}"),
        }
    }
    if enriched.fixed_version.is_empty() {
        let hint = extract_fixed(&candidate.sentence);
        enriched.fixed_version = if hint.is_empty() {
            extract_fixed(&candidate.full_text)
        } else {
            hint
        };
    }
    let target_version = enriched.fixed_version.clone();
    let recommendation = if cmdb_match && !target_version.is_empty() {
        format!("Обновить {software} с {current_version} до {target_version}")
    } else {
        "Обновить ПО до версии, закрывающей уязвимость".to_owned()
    };

    Some(VulnerabilityRecord {
        item_id: candidate.item_id,
        item_title: candidate.item_title,
        item_url: candidate.item_url,
        cve_id: enriched.cve_id,
        bdu_id: enriched.bdu_id,
        title: enriched.title,
        description: enriched.description,
        software,
        severity: enriched.severity,
        cvss_score: enriched.cvss_score,
        cvss_version: enriched.cvss_version,
        cpe: enriched.cpe,
        affected_range: enriched.affected_range,
        fixed_version: enriched.fixed_version,
        patch_url: enriched.patch_url,
        cmdb_match,
        cmdb_error,
        current_version,
        target_version,
        recommendation,
        source: enriched.source,
        external_errors: errors,
    })
}

async fn fetch_nvd(
    client: &Client,
    config: &SecurityConfig,
    cve_id: &str,
    software: &str,
) -> Result<Enriched, String> {
    let mut request = client
        .get(format!("{}/rest/json/cves/2.0", config.nvd_base))
        .query(&[("cveId", cve_id)]);
    if let Some(key) = &config.nvd_key {
        request = request.header("X-Api-Key", key);
    }
    let response = request.send().await.map_err(|error| error.to_string())?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("not found".to_owned());
    }
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let data: Value = response.json().await.map_err(|error| error.to_string())?;
    let cve = data
        .get("vulnerabilities")
        .and_then(Value::as_array)
        .and_then(|values| values.first())
        .and_then(|value| value.get("cve"))
        .ok_or_else(|| "empty NVD response".to_owned())?;
    let description = cve
        .get("descriptions")
        .and_then(Value::as_array)
        .and_then(|values| {
            values
                .iter()
                .find(|value| value.get("lang").and_then(Value::as_str) == Some("en"))
        })
        .and_then(|value| value.get("value"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let metrics = cve.get("metrics");
    let metric = ["cvssMetricV31", "cvssMetricV30", "cvssMetricV2"]
        .iter()
        .find_map(|key| {
            metrics
                .and_then(|value| value.get(key))
                .and_then(Value::as_array)
                .and_then(|values| values.first())
        });
    let cvss_data = metric.and_then(|value| value.get("cvssData"));
    let cvss_score = cvss_data
        .and_then(|value| value.get("baseScore"))
        .and_then(Value::as_f64);
    let cvss_version = cvss_data
        .and_then(|value| value.get("version"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let severity = metric
        .and_then(|value| value.get("baseSeverity"))
        .or_else(|| cvss_data.and_then(|value| value.get("baseSeverity")))
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_lowercase();
    let needle = software
        .split_whitespace()
        .last()
        .unwrap_or("")
        .to_lowercase();
    let matches = cve
        .get("configurations")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(|config| {
            config
                .get("nodes")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .flat_map(|node| {
            node.get("cpeMatch")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .filter(|item| {
            item.get("vulnerable")
                .and_then(Value::as_bool)
                .unwrap_or(true)
        })
        .collect::<Vec<_>>();
    let selected = matches
        .iter()
        .find(|item| {
            item.get("criteria")
                .and_then(Value::as_str)
                .map(|criteria| criteria.to_lowercase().contains(&needle))
                .unwrap_or(false)
        })
        .copied()
        .or_else(|| matches.first().copied());
    let cpe = selected
        .and_then(|value| value.get("criteria"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let affected_range = selected
        .map(|value| {
            let start = value.get("versionStartIncluding").and_then(Value::as_str);
            let end = value.get("versionEndExcluding").and_then(Value::as_str);
            match (start, end) {
                (Some(start), Some(end)) => format!(">={start},<{end}"),
                (Some(start), None) => format!(">={start}"),
                (None, Some(end)) => format!("<{end}"),
                _ => "*".to_owned(),
            }
        })
        .unwrap_or_else(|| "*".to_owned());
    let patch_url = cve
        .get("references")
        .and_then(Value::as_array)
        .and_then(|values| values.first())
        .and_then(|value| value.get("url"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    Ok(Enriched {
        source: "nvd".to_owned(),
        cve_id: cve_id.to_owned(),
        bdu_id: String::new(),
        title: cve_id.to_owned(),
        description,
        severity,
        cvss_score,
        cvss_version,
        cpe,
        affected_range,
        fixed_version: String::new(),
        patch_url,
    })
}

async fn fetch_bdu(client: &Client, base: &str, bdu_id: &str) -> Result<Enriched, String> {
    let path_id = bdu_id.split(':').next_back().unwrap_or(bdu_id).trim();
    if !path_id.chars().all(|ch| ch.is_ascii_digit() || ch == '-') {
        return Err("invalid BDU id".to_owned());
    }
    let response = client
        .get(format!("{base}/vul/print/{path_id}"))
        .header(
            "User-Agent",
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
        )
        .query(&[("unid", bdu_id)])
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("not found".to_owned());
    }
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let page = response.text().await.map_err(|error| error.to_string())?;
    let model = extract_vmodel(&page).ok_or_else(|| "v_model not found".to_owned())?;
    let critu = model.get("vul_critu").and_then(Value::as_str).unwrap_or("");
    let title = model
        .get("vul_name")
        .and_then(Value::as_str)
        .unwrap_or(bdu_id)
        .to_owned();
    let description = model
        .get("vul_desc")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let severity = if critu.to_lowercase().contains("критическ") {
        "critical"
    } else if critu.to_lowercase().contains("высок") {
        "high"
    } else if critu.to_lowercase().contains("средн") {
        "medium"
    } else if critu.to_lowercase().contains("низк") {
        "low"
    } else {
        "unknown"
    };
    let cvss_score = CVSS_RE
        .captures(critu)
        .and_then(|caps| caps.get(1))
        .and_then(|value| value.as_str().parse::<f64>().ok());
    Ok(Enriched {
        source: "bdu".to_owned(),
        cve_id: String::new(),
        bdu_id: bdu_id.to_owned(),
        title,
        description,
        severity: severity.to_owned(),
        cvss_score,
        cvss_version: "3.1".to_owned(),
        cpe: String::new(),
        affected_range: "*".to_owned(),
        fixed_version: extract_fixed(critu),
        patch_url: format!("{base}/vul/{path_id}"),
    })
}

fn extract_vmodel(page: &str) -> Option<Value> {
    let marker = "v_model = reactive(";
    let marker_start = page.find(marker)? + marker.len();
    let start = page[marker_start..].find('{')? + marker_start;
    let bytes = page.as_bytes();
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escaped = false;
    for (offset, byte) in bytes[start..].iter().enumerate() {
        match *byte {
            b'"' if !escaped => in_string = !in_string,
            b'\\' if in_string => escaped = !escaped,
            b'{' if !in_string => depth += 1,
            b'}' if !in_string => {
                depth -= 1;
                if depth == 0 {
                    let end = start + offset + 1;
                    return serde_json::from_str(&page[start..end]).ok();
                }
            }
            _ => escaped = false,
        }
    }
    None
}

async fn fetch_cmdb(
    client: &Client,
    endpoint: &str,
    config: &SecurityConfig,
    software: &str,
) -> Result<Vec<InventoryItem>, String> {
    let mut request = client
        .get(endpoint)
        .query(&[("query", software), ("page", "1")]);
    match config.cmdb_auth_type.to_lowercase().as_str() {
        "bearer" => {
            if let Some(token) = &config.cmdb_token {
                request = request.bearer_auth(token);
            }
        }
        "basic" => {
            if let Some(token) = &config.cmdb_token {
                request = request.basic_auth(token, Some(""));
            }
        }
        _ => {}
    }
    let response = request.send().await.map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let data: Value = response.json().await.map_err(|error| error.to_string())?;
    let items = data
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok(items
        .into_iter()
        .map(|value| InventoryItem {
            name: value
                .get("product")
                .or_else(|| value.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned(),
            version: value
                .get("version")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned(),
            cpe: value
                .get("cpe")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned(),
        })
        .filter(|item| !item.name.is_empty())
        .collect())
}

fn inventory_matches(item: &InventoryItem, software: &str, enriched: &Enriched) -> bool {
    let name = item.name.to_lowercase();
    let software = software.to_lowercase();
    let name_match = !software.is_empty() && (name.contains(&software) || software.contains(&name));
    let cpe_match = !item.cpe.is_empty() && !enriched.cpe.is_empty() && item.cpe == enriched.cpe;
    if !(name_match || cpe_match) {
        return false;
    }
    if item.version.is_empty() {
        return false;
    }
    if enriched.fixed_version.is_empty() {
        return true;
    }
    item.version != enriched.fixed_version
}

fn extract_software(sentence: &str, title: &str) -> String {
    let known = [
        ("apache log4j", "Apache Log4j"),
        ("log4j", "Apache Log4j"),
        ("openssl", "OpenSSL"),
        ("samba", "Samba"),
        ("citrix", "Citrix"),
        ("windows", "Microsoft Windows"),
        ("chrome", "Google Chrome"),
        ("edge", "Microsoft Edge"),
        ("sharepoint", "Microsoft SharePoint"),
        ("weblogic", "Oracle WebLogic"),
        ("oracle", "Oracle"),
        ("glpi", "GLPI"),
        ("react", "React"),
        ("next.js", "Next.js"),
        ("1с", "1С:Предприятие"),
    ];
    let haystack = format!("{sentence} {title}").to_lowercase();
    for (needle, name) in known {
        if haystack.contains(needle) {
            return name.to_owned();
        }
    }
    title
        .split([':', '—', '-'])
        .next()
        .unwrap_or(title)
        .trim()
        .chars()
        .take(80)
        .collect()
}

fn extract_fixed(text: &str) -> String {
    FIXED_RE
        .captures(text)
        .and_then(|caps| caps.get(1))
        .map(|value| {
            value
                .as_str()
                .trim_matches(|ch: char| !ch.is_ascii_alphanumeric() && ch != '.' && ch != '-')
                .to_owned()
        })
        .filter(|value| value.chars().any(|ch| ch.is_ascii_digit()))
        .or_else(|| {
            VERSION_RE
                .captures(text)
                .and_then(|caps| caps.get(1))
                .map(|value| value.as_str().to_owned())
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::sentence_around;

    #[test]
    fn extracts_bdu_vmodel() {
        let page = "v_model = reactive({\"vul_name\":\"Test\",\"vul_desc\":\"Описание\",\"vul_critu\":\"CVSS 3.1 9.8\"});";
        let model = super::extract_vmodel(page).expect("model");
        assert_eq!(
            model.get("vul_name").and_then(|value| value.as_str()),
            Some("Test")
        );
        assert!(super::CVSS_RE.is_match("CVSS 3.1 9.8"));
    }

    #[test]
    fn sentence_around_handles_cyrillic_boundaries() {
        let text = format!("{} CVE-2021-44228 {}", "а".repeat(700), "б".repeat(700));
        let start = text.find("CVE").expect("CVE position");
        let end = start + "CVE-2021-44228".len();
        let sentence = sentence_around(&text, start, end);
        assert!(sentence.contains("CVE-2021-44228"));
        assert!(sentence.chars().count() <= 1001);
    }
}
