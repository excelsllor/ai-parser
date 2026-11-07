use std::sync::Arc;

use news_shared::bus::KafkaBus;
use news_shared::config::Config;
use news_shared::llm::LlmClient;
use news_shared::redis_cache::RedisCache;
use sqlx::PgPool;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub pool: PgPool,
    pub redis: RedisCache,
    pub bus: KafkaBus,
    pub llm: LlmClient,
}

impl AppState {
    pub fn new(
        config: Arc<Config>,
        pool: PgPool,
        redis: RedisCache,
        bus: KafkaBus,
        llm: LlmClient,
    ) -> Self {
        Self {
            config,
            pool,
            redis,
            bus,
            llm,
        }
    }
}
