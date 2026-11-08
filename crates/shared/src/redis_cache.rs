use std::time::Duration;

use redis::aio::ConnectionManager;
use redis::{AsyncCommands, Script};
use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::error::{AppError, AppResult};

#[derive(Clone)]
pub struct RedisCache {
    manager: ConnectionManager,
}

impl RedisCache {
    pub async fn new(url: &str) -> AppResult<Self> {
        let client = redis::Client::open(url)?;
        let manager = ConnectionManager::new(client).await?;
        Ok(Self { manager })
    }

    pub async fn ping(&self) -> bool {
        let mut conn = self.manager.clone();
        redis::cmd("PING")
            .query_async::<String>(&mut conn)
            .await
            .map(|v| v == "PONG")
            .unwrap_or(false)
    }

    pub async fn get_json<T: DeserializeOwned>(&self, key: &str) -> AppResult<Option<T>> {
        let mut conn = self.manager.clone();
        let value: Option<String> = conn.get(key).await?;
        match value {
            Some(raw) => Ok(serde_json::from_str(&raw).ok()),
            None => Ok(None),
        }
    }

    pub async fn set_json<T: Serialize>(
        &self,
        key: &str,
        value: &T,
        ttl_secs: u64,
    ) -> AppResult<()> {
        let mut conn = self.manager.clone();
        let raw = serde_json::to_string(value)?;
        let _: () = conn.set_ex(key, raw, ttl_secs).await?;
        Ok(())
    }

    pub async fn take_json<T: DeserializeOwned>(&self, key: &str) -> AppResult<Option<T>> {
        let mut conn = self.manager.clone();
        let value: Option<String> = redis::cmd("GETDEL")
            .arg(key)
            .query_async::<Option<String>>(&mut conn)
            .await?;
        match value {
            Some(raw) => Ok(serde_json::from_str(&raw).ok()),
            None => Ok(None),
        }
    }

    pub async fn get_string(&self, key: &str) -> AppResult<Option<String>> {
        let mut conn = self.manager.clone();
        let value: Option<String> = conn.get(key).await?;
        Ok(value)
    }

    pub async fn set_string(&self, key: &str, value: &str, ttl_secs: u64) -> AppResult<()> {
        let mut conn = self.manager.clone();
        let _: () = conn.set_ex(key, value, ttl_secs).await?;
        Ok(())
    }

    pub async fn set_nx(&self, key: &str, value: &str, ttl_secs: u64) -> AppResult<bool> {
        let mut conn = self.manager.clone();
        let result: Option<String> = redis::cmd("SET")
            .arg(key)
            .arg(value)
            .arg("NX")
            .arg("EX")
            .arg(ttl_secs)
            .query_async(&mut conn)
            .await?;
        Ok(result.is_some())
    }

    pub async fn delete(&self, key: &str) -> AppResult<()> {
        let mut conn = self.manager.clone();
        let _: () = conn.del(key).await?;
        Ok(())
    }

    pub async fn sadd(&self, key: &str, value: &str, ttl_secs: u64) -> AppResult<bool> {
        let mut conn = self.manager.clone();
        let added: i64 = conn.sadd(key, value).await?;
        if added > 0 {
            let _: bool = conn.expire(key, ttl_secs as i64).await?;
        }
        Ok(added > 0)
    }

    pub async fn sismember(&self, key: &str, value: &str) -> AppResult<bool> {
        let mut conn = self.manager.clone();
        let member: bool = conn.sismember(key, value).await?;
        Ok(member)
    }

    pub async fn rate_limit(&self, key: &str, limit: u64, window_secs: u64) -> AppResult<bool> {
        let mut conn = self.manager.clone();
        let script = Script::new(
            "local c = redis.call('INCR', KEYS[1]) \
             if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end \
             return c",
        );
        let count: u64 = script
            .key(key)
            .arg(window_secs)
            .invoke_async(&mut conn)
            .await?;
        Ok(count <= limit)
    }

    pub async fn incr(&self, key: &str, ttl_secs: u64) -> AppResult<u64> {
        let mut conn = self.manager.clone();
        let value: u64 = conn.incr(key, 1).await?;
        if value == 1 {
            let _: bool = conn.expire(key, ttl_secs as i64).await?;
        }
        Ok(value)
    }

    pub async fn health_latency(&self) -> Option<Duration> {
        let start = std::time::Instant::now();
        if self.ping().await {
            Some(start.elapsed())
        } else {
            None
        }
    }

    pub async fn lock(&self, key: &str, ttl_secs: u64) -> AppResult<bool> {
        self.set_nx(key, "1", ttl_secs).await
    }

    pub async fn unlock(&self, key: &str) -> AppResult<()> {
        self.delete(key).await
    }

    pub async fn redis_error(&self) -> Option<String> {
        let mut conn = self.manager.clone();
        match redis::cmd("INFO")
            .arg("server")
            .query_async::<String>(&mut conn)
            .await
        {
            Ok(_) => None,
            Err(e) => Some(AppError::from(e).to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn redis_key_shape() {
        let key = format!("run:{}:status", uuid::Uuid::nil());
        assert!(key.starts_with("run:"));
    }
}
