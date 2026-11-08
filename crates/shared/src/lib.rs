pub mod audit;
pub mod auth;
pub mod bus;
pub mod config;
pub mod db;
pub mod error;
pub mod llm;
pub mod models;
pub mod redis_cache;
pub mod registry;
pub mod security;
pub mod telemetry;
pub mod text;

pub use config::Config;
pub use error::{AppError, AppResult};

pub const TOPIC_RUN_STARTED: &str = "news.run.started";
pub const TOPIC_ITEMS_COLLECTED: &str = "news.items.collected";
pub const TOPIC_ITEMS_NORMALIZED: &str = "news.items.normalized";
pub const TOPIC_ITEMS_ANALYZED: &str = "news.items.analyzed";
pub const TOPIC_EVENTS_CLUSTERED: &str = "news.events.clustered";
pub const TOPIC_EVENTS_SELECTED: &str = "news.events.selected";
pub const TOPIC_DIGEST_DRAFT: &str = "news.digest.draft";
pub const TOPIC_DIGEST_VERIFIED: &str = "news.digest.verified";
pub const TOPIC_ARTIFACTS_READY: &str = "news.artifacts.ready";
pub const TOPIC_RUN_FAILED: &str = "news.run.failed";
pub const TOPIC_AUDIT_EVENTS: &str = "news.audit.events";

pub mod vuln;
