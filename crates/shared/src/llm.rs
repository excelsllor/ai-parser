use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::Semaphore;

use crate::config::LlmConfig;
use crate::error::{AppError, AppResult};
use crate::models::LlmUsage;
use crate::redis_cache::RedisCache;
use crate::text::sha256_hex;

const CACHE_TTL_SECS: u64 = 7 * 24 * 60 * 60;

#[derive(Clone)]
pub struct LlmClient {
    client: reqwest::Client,
    config: LlmConfig,
    cache: Option<RedisCache>,
    semaphore: Arc<Semaphore>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmOutcome<T> {
    pub value: T,
    pub usage: LlmUsage,
    pub cost: f64,
    pub latency_ms: i64,
    pub cache_hit: bool,
    pub prompt_hash: String,
    pub raw: String,
}

#[derive(Debug, Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: Vec<ChatMessage<'a>>,
    temperature: f32,
    max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_format: Option<Value>,
}

#[derive(Debug, Serialize)]
struct ChatMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    #[serde(default)]
    choices: Vec<Choice>,
    #[serde(default)]
    usage: Option<Usage>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: Message,
}

#[derive(Debug, Deserialize)]
struct Message {
    #[serde(default)]
    content: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct Usage {
    #[serde(default)]
    prompt_tokens: i64,
    #[serde(default)]
    completion_tokens: i64,
    #[serde(default)]
    total_tokens: i64,
}

#[derive(Debug, Serialize, Deserialize)]
struct CachedResponse {
    content: String,
    usage: LlmUsage,
}

impl LlmClient {
    pub fn new(config: &LlmConfig, cache: Option<RedisCache>) -> AppResult<Self> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(config.timeout_secs))
            .connect_timeout(Duration::from_secs(10))
            .user_agent("news-digest/0.1")
            .https_only(config.base_url.starts_with("https://"))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(AppError::from)?;

        Ok(Self {
            client,
            config: config.clone(),
            cache,
            semaphore: Arc::new(Semaphore::new(config.concurrency)),
        })
    }

    pub async fn chat_json<T: DeserializeOwned>(
        &self,
        purpose: &str,
        prompt_version: &str,
        system: &str,
        user: &str,
    ) -> AppResult<LlmOutcome<T>> {
        self.chat_json_with_model(&self.config.model, purpose, prompt_version, system, user)
            .await
    }

    pub async fn chat_json_with_model<T: DeserializeOwned>(
        &self,
        model: &str,
        purpose: &str,
        prompt_version: &str,
        system: &str,
        user: &str,
    ) -> AppResult<LlmOutcome<T>> {
        let outcome = self
            .chat_raw(model, purpose, prompt_version, system, user, true)
            .await?;
        let value = parse_json::<T>(&outcome.raw)?;
        Ok(LlmOutcome {
            value,
            usage: outcome.usage,
            cost: outcome.cost,
            latency_ms: outcome.latency_ms,
            cache_hit: outcome.cache_hit,
            prompt_hash: outcome.prompt_hash,
            raw: outcome.raw,
        })
    }

    pub async fn chat_text(
        &self,
        purpose: &str,
        prompt_version: &str,
        system: &str,
        user: &str,
    ) -> AppResult<LlmOutcome<String>> {
        let outcome = self
            .chat_raw(
                &self.config.model,
                purpose,
                prompt_version,
                system,
                user,
                false,
            )
            .await?;
        let raw = outcome.raw.clone();
        Ok(LlmOutcome {
            value: raw,
            usage: outcome.usage,
            cost: outcome.cost,
            latency_ms: outcome.latency_ms,
            cache_hit: outcome.cache_hit,
            prompt_hash: outcome.prompt_hash,
            raw: outcome.raw,
        })
    }

    async fn chat_raw(
        &self,
        model: &str,
        purpose: &str,
        prompt_version: &str,
        system: &str,
        user: &str,
        json_mode: bool,
    ) -> AppResult<LlmOutcome<String>> {
        let cache_key = format!(
            "llm:cache:{}",
            sha256_hex(
                format!(
                    "{}|{}|{}|{}|{}",
                    model, prompt_version, purpose, system, user
                )
                .as_bytes()
            )
        );

        if let Some(cache) = &self.cache {
            if let Ok(Some(cached)) = cache.get_json::<CachedResponse>(&cache_key).await {
                return Ok(LlmOutcome {
                    value: cached.content.clone(),
                    usage: cached.usage,
                    cost: 0.0,
                    latency_ms: 0,
                    cache_hit: true,
                    prompt_hash: cache_key,
                    raw: cached.content,
                });
            }
        }

        let _permit = self
            .semaphore
            .acquire()
            .await
            .map_err(|_| AppError::llm("LLM semaphore closed"))?;

        let url = format!(
            "{}/chat/completions",
            self.config.base_url.trim_end_matches('/')
        );
        let started = Instant::now();
        let mut last_error = None;
        let mut use_json_mode = json_mode;

        for attempt in 1..=3u32 {
            let body = ChatRequest {
                model,
                messages: vec![
                    ChatMessage {
                        role: "system",
                        content: system,
                    },
                    ChatMessage {
                        role: "user",
                        content: user,
                    },
                ],
                temperature: self.config.temperature,
                max_tokens: self.config.max_tokens,
                response_format: if use_json_mode {
                    Some(json!({"type": "json_object"}))
                } else {
                    None
                },
            };

            let mut request = self.client.post(&url).json(&body);
            if let Some(key) = &self.config.api_key {
                request = request.bearer_auth(key);
            }

            match request.send().await {
                Ok(response) => {
                    let status = response.status();
                    if status.is_success() {
                        let parsed: ChatResponse = response.json().await?;
                        let content = parsed
                            .choices
                            .into_iter()
                            .next()
                            .and_then(|c| c.message.content)
                            .ok_or_else(|| AppError::llm("empty LLM response"))?;
                        let usage = parsed.usage.unwrap_or_default();
                        let usage = LlmUsage {
                            prompt_tokens: usage.prompt_tokens,
                            completion_tokens: usage.completion_tokens,
                            total_tokens: if usage.total_tokens == 0 {
                                usage.prompt_tokens + usage.completion_tokens
                            } else {
                                usage.total_tokens
                            },
                        };
                        let cost = (usage.prompt_tokens as f64 / 1000.0)
                            * self.config.input_price_per_1k
                            + (usage.completion_tokens as f64 / 1000.0)
                                * self.config.output_price_per_1k;
                        let latency_ms = started.elapsed().as_millis() as i64;

                        if let Some(cache) = &self.cache {
                            let cached = CachedResponse {
                                content: content.clone(),
                                usage: usage.clone(),
                            };
                            let _ = cache.set_json(&cache_key, &cached, CACHE_TTL_SECS).await;
                        }

                        return Ok(LlmOutcome {
                            value: content.clone(),
                            usage,
                            cost,
                            latency_ms,
                            cache_hit: false,
                            prompt_hash: cache_key,
                            raw: content,
                        });
                    }

                    let status_code = status.as_u16();
                    let text = response.text().await.unwrap_or_default();
                    if status_code == 400 && use_json_mode {
                        use_json_mode = false;
                        last_error = Some(AppError::llm(format!(
                            "json mode rejected by provider, retrying: {text}"
                        )));
                        continue;
                    }
                    if status_code == 429 || status_code >= 500 {
                        last_error = Some(AppError::llm(format!("LLM HTTP {status_code}: {text}")));
                        tokio::time::sleep(Duration::from_secs(2u64.pow(attempt))).await;
                        continue;
                    }
                    return Err(AppError::llm(format!("LLM HTTP {status_code}: {text}")));
                }
                Err(error) => {
                    last_error = Some(AppError::llm(format!("LLM request failed: {error}")));
                    tokio::time::sleep(Duration::from_secs(2u64.pow(attempt))).await;
                }
            }
        }

        Err(last_error.unwrap_or_else(|| AppError::llm("LLM request failed")))
    }

    pub async fn health(&self) -> bool {
        let url = format!("{}/models", self.config.base_url.trim_end_matches('/'));
        let mut request = self.client.get(url).timeout(Duration::from_secs(5));
        if let Some(key) = &self.config.api_key {
            request = request.bearer_auth(key);
        }
        request
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    }
}

pub fn parse_json<T: DeserializeOwned>(raw: &str) -> AppResult<T> {
    let trimmed = raw.trim();
    let unfenced = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .and_then(|s| s.strip_suffix("```"))
        .map(str::trim)
        .unwrap_or(trimmed);

    let candidate = match (unfenced.find('{'), unfenced.rfind('}')) {
        (Some(start), Some(end)) if end > start => &unfenced[start..=end],
        _ => unfenced,
    };

    serde_json::from_str::<T>(candidate)
        .map_err(|e| AppError::llm(format!("invalid JSON from model: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_fenced_json() {
        let value: Value = parse_json("```json\n{\"a\": 1}\n```").unwrap();
        assert_eq!(value["a"], 1);
    }

    #[test]
    fn parses_json_with_prefix() {
        let value: Value = parse_json("Вот результат: {\"a\": 2} конец").unwrap();
        assert_eq!(value["a"], 2);
    }
}
