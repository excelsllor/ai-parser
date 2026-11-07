use std::env;
use std::net::SocketAddr;
use std::path::PathBuf;

use rand_core::{OsRng, RngCore};

use crate::error::{AppError, AppResult};

#[derive(Clone, Debug)]
pub struct LlmConfig {
    pub base_url: String,
    pub api_key: Option<String>,
    pub model: String,
    pub temperature: f32,
    pub max_tokens: u32,
    pub timeout_secs: u64,
    pub concurrency: usize,
    pub input_price_per_1k: f64,
    pub output_price_per_1k: f64,
}

#[derive(Clone, Debug)]
pub struct SmtpConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub from: String,
    pub test_recipient: String,
    pub tls: bool,
    pub starttls: bool,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ScoringWeights {
    pub impact: f64,
    pub scale: f64,
    pub urgency: f64,
    pub relevance: f64,
    pub confidence: f64,
    pub uncertainty_penalty: f64,
}

impl Default for ScoringWeights {
    fn default() -> Self {
        Self {
            impact: 0.35,
            scale: 0.25,
            urgency: 0.20,
            relevance: 0.15,
            confidence: 0.05,
            uncertainty_penalty: 0.15,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Config {
    pub env_name: String,
    pub database_url: String,
    pub redis_url: String,
    pub kafka_brokers: String,
    pub kafka_group_prefix: String,
    pub kafka_security_protocol: String,
    pub kafka_sasl_mechanism: String,
    pub kafka_sasl_username: String,
    pub kafka_sasl_password: String,
    pub kafka_ssl_ca_file: String,
    pub jwt_secret: String,
    pub access_token_ttl_minutes: i64,
    pub refresh_token_ttl_days: i64,
    pub bind_addr: SocketAddr,
    pub data_dir: PathBuf,
    pub frontend_dir: PathBuf,
    pub control_timezone: chrono_tz::Tz,
    pub cors_origins: Vec<String>,
    pub bootstrap_admin_username: String,
    pub bootstrap_admin_password: Option<String>,
    pub llm: LlmConfig,
    pub smtp: SmtpConfig,
    pub live_fetch_enabled: bool,
    pub allowed_source_hosts: Vec<String>,
    pub max_fetch_bytes: usize,
    pub max_articles_per_run: usize,
    pub max_article_chars: usize,
    pub prompt_version: String,
    pub critic_llm: bool,
    pub critic_max_llm_claims: usize,
    pub weights: ScoringWeights,
    pub log_json: bool,
    pub trust_proxy_headers: bool,
    pub metrics_public: bool,
    pub metrics_token: Option<String>,
}

impl Config {
    pub fn from_env() -> AppResult<Self> {
        let _ = dotenvy::dotenv();

        let env_name = env_or("APP_ENV", "dev").to_lowercase();
        let is_prod = matches!(env_name.as_str(), "prod" | "production");

        let database_url = env_or("DATABASE_URL", "postgres://news:news@localhost:5432/news");
        let redis_url = env_or("REDIS_URL", "redis://localhost:6379/0");
        let kafka_brokers = env_or("KAFKA_BROKERS", "localhost:9092");
        let kafka_group_prefix = env_or("KAFKA_GROUP_PREFIX", "news");
        let kafka_security_protocol = env_or("KAFKA_SECURITY_PROTOCOL", "PLAINTEXT");
        let kafka_sasl_mechanism = env_or("KAFKA_SASL_MECHANISM", "SCRAM-SHA-512");
        let kafka_sasl_username = env_or("KAFKA_SASL_USERNAME", "");
        let kafka_sasl_password = env_or("KAFKA_SASL_PASSWORD", "");
        let kafka_ssl_ca_file = env_or("KAFKA_SSL_CA_FILE", "");

        let jwt_secret = match env::var("JWT_SECRET") {
            Ok(v) if v.len() >= 32 => v,
            Ok(_) if is_prod => {
                return Err(AppError::config(
                    "JWT_SECRET must be at least 32 characters in production",
                ))
            }
            Ok(v) => {
                tracing::warn!(
                    "JWT_SECRET is shorter than 32 characters; use a strong secret in production"
                );
                v
            }
            Err(_) if is_prod => {
                return Err(AppError::config("JWT_SECRET is required in production"));
            }
            Err(_) => {
                tracing::warn!("JWT_SECRET is not set; generating an ephemeral development secret");
                random_secret(48)
            }
        };

        let bind_addr = env_or("BIND_ADDR", "0.0.0.0:8080")
            .parse()
            .map_err(|e| AppError::config(format!("invalid BIND_ADDR: {e}")))?;

        let data_dir = PathBuf::from(env_or("DATA_DIR", "./data"));
        let frontend_dir = PathBuf::from(env_or("FRONTEND_DIR", "./frontend/dist"));

        let control_timezone = env_or("CONTROL_TIMEZONE", "Europe/Moscow")
            .parse()
            .unwrap_or(chrono_tz::Europe::Moscow);

        let cors_origins = env_or(
            "CORS_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173",
        )
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();

        let bootstrap_admin_username = env_or("BOOTSTRAP_ADMIN_USERNAME", "admin");
        let bootstrap_admin_password = env::var("BOOTSTRAP_ADMIN_PASSWORD")
            .ok()
            .filter(|s| !s.is_empty());

        let llm = LlmConfig {
            base_url: env_or("LLM_BASE_URL", "http://localhost:8000/v1"),
            api_key: env::var("LLM_API_KEY").ok().filter(|s| !s.is_empty()),
            model: env_or("LLM_MODEL", "Qwen2.5-14B-Instruct"),
            temperature: env_or("LLM_TEMPERATURE", "0.1")
                .parse::<f32>()
                .unwrap_or(0.1)
                .clamp(0.0, 1.0),
            max_tokens: env_or("LLM_MAX_TOKENS", "2000")
                .parse()
                .unwrap_or(2000)
                .clamp(128, 8192),
            timeout_secs: env_or("LLM_TIMEOUT_SECS", "90")
                .parse()
                .unwrap_or(90)
                .clamp(5, 600),
            concurrency: env_or("LLM_CONCURRENCY", "4")
                .parse()
                .unwrap_or(4)
                .clamp(1, 32),
            input_price_per_1k: env_or("LLM_INPUT_PRICE_PER_1K", "0").parse().unwrap_or(0.0),
            output_price_per_1k: env_or("LLM_OUTPUT_PRICE_PER_1K", "0")
                .parse()
                .unwrap_or(0.0),
        };

        let smtp = SmtpConfig {
            host: env_or("SMTP_HOST", "localhost"),
            port: env_or("SMTP_PORT", "1025").parse().unwrap_or(1025),
            username: env_or("SMTP_USERNAME", ""),
            password: env_or("SMTP_PASSWORD", ""),
            from: env_or("SMTP_FROM", "digest@example.local"),
            test_recipient: env_or("TEST_RECIPIENT", "test@example.local"),
            tls: env_or("SMTP_TLS", "false").parse().unwrap_or(false),
            starttls: env_or("SMTP_STARTTLS", "false").parse().unwrap_or(false),
        };

        let allowed_source_hosts = env_or("ALLOWED_SOURCE_HOSTS", "")
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_lowercase())
            .collect::<Vec<_>>();

        let trust_proxy_headers = env_or(
            "TRUST_PROXY_HEADERS",
            if is_prod { "false" } else { "true" },
        )
        .parse()
        .unwrap_or(false);

        Ok(Self {
            env_name,
            database_url,
            redis_url,
            kafka_brokers,
            kafka_group_prefix,
            kafka_security_protocol,
            kafka_sasl_mechanism,
            kafka_sasl_username,
            kafka_sasl_password,
            kafka_ssl_ca_file,
            jwt_secret,
            access_token_ttl_minutes: env_or("ACCESS_TOKEN_TTL_MINUTES", "60")
                .parse()
                .unwrap_or(60)
                .clamp(5, 1440),
            refresh_token_ttl_days: env_or("REFRESH_TOKEN_TTL_DAYS", "14")
                .parse()
                .unwrap_or(14)
                .clamp(1, 90),
            bind_addr,
            data_dir,
            frontend_dir,
            control_timezone,
            cors_origins,
            bootstrap_admin_username,
            bootstrap_admin_password,
            llm,
            smtp,
            live_fetch_enabled: env_or("LIVE_FETCH_ENABLED", "true").parse().unwrap_or(true),
            allowed_source_hosts,
            max_fetch_bytes: env_or("MAX_FETCH_BYTES", "2097152")
                .parse()
                .unwrap_or(2_097_152)
                .clamp(65_536, 16_777_216),
            max_articles_per_run: env_or("MAX_ARTICLES_PER_RUN", "200")
                .parse()
                .unwrap_or(200)
                .clamp(1, 2000),
            max_article_chars: env_or("MAX_ARTICLE_CHARS", "20000")
                .parse()
                .unwrap_or(20_000)
                .clamp(1000, 200_000),
            prompt_version: env_or("PROMPT_VERSION", "v1"),
            critic_llm: env_or("CRITIC_LLM", "true").parse().unwrap_or(true),
            critic_max_llm_claims: env_or("CRITIC_MAX_LLM_CLAIMS", "10")
                .parse()
                .unwrap_or(10)
                .clamp(0, 100),
            weights: ScoringWeights {
                impact: env_or("WEIGHT_IMPACT", "0.35").parse().unwrap_or(0.35),
                scale: env_or("WEIGHT_SCALE", "0.25").parse().unwrap_or(0.25),
                urgency: env_or("WEIGHT_URGENCY", "0.20").parse().unwrap_or(0.20),
                relevance: env_or("WEIGHT_RELEVANCE", "0.15").parse().unwrap_or(0.15),
                confidence: env_or("WEIGHT_CONFIDENCE", "0.05").parse().unwrap_or(0.05),
                uncertainty_penalty: env_or("WEIGHT_UNCERTAINTY", "0.15").parse().unwrap_or(0.15),
            },
            log_json: env_or("LOG_JSON", "false").parse().unwrap_or(false),
            trust_proxy_headers,
            metrics_public: env_or("METRICS_PUBLIC", if is_prod { "false" } else { "true" })
                .parse()
                .unwrap_or(!is_prod),
            metrics_token: env::var("METRICS_TOKEN").ok().filter(|s| !s.is_empty()),
        })
    }

    pub fn is_prod(&self) -> bool {
        matches!(self.env_name.as_str(), "prod" | "production")
    }

    pub fn run_dir(&self, run_id: uuid::Uuid) -> PathBuf {
        self.data_dir.join("runs").join(run_id.to_string())
    }

    pub fn upload_dir(&self, run_id: uuid::Uuid) -> PathBuf {
        self.run_dir(run_id).join("input")
    }

    pub fn artifact_dir(&self, run_id: uuid::Uuid) -> PathBuf {
        self.run_dir(run_id).join("artifacts")
    }
}

fn env_or(key: &str, default: &str) -> String {
    env::var(key).unwrap_or_else(|_| default.to_string())
}

fn random_secret(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    OsRng.fill_bytes(&mut buf);
    hex::encode(buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn random_secret_is_long_enough() {
        assert!(random_secret(32).len() >= 64);
    }
}
