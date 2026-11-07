use std::future::Future;
use std::time::Duration;

use rdkafka::config::ClientConfig;
use rdkafka::consumer::{CommitMode, Consumer, StreamConsumer};
use rdkafka::message::Message;
use rdkafka::producer::{FutureProducer, FutureRecord, Producer};
use rdkafka::util::Timeout;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::broadcast;

use crate::config::Config;
use crate::error::{AppError, AppResult};
use crate::TOPIC_RUN_FAILED;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub topic: String,
    pub key: String,
    pub payload: Value,
}

#[derive(Clone)]
pub struct KafkaBus {
    producer: FutureProducer,
    brokers: String,
    group_prefix: String,
    security_protocol: String,
    sasl_mechanism: String,
    sasl_username: String,
    sasl_password: String,
    ssl_ca_file: String,
}

impl KafkaBus {
    pub fn new(config: &Config) -> AppResult<Self> {
        let mut client_config = ClientConfig::new();
        client_config
            .set("bootstrap.servers", &config.kafka_brokers)
            .set("message.timeout.ms", "10000")
            .set("acks", "all")
            .set("enable.idempotence", "true")
            .set("compression.type", "none")
            .set("security.protocol", &config.kafka_security_protocol);
        if !config.kafka_sasl_username.is_empty() {
            client_config
                .set("sasl.mechanism", &config.kafka_sasl_mechanism)
                .set("sasl.username", &config.kafka_sasl_username)
                .set("sasl.password", &config.kafka_sasl_password);
        }
        if !config.kafka_ssl_ca_file.is_empty() {
            client_config.set("ssl.ca.location", &config.kafka_ssl_ca_file);
        }
        let producer: FutureProducer = client_config
            .create()
            .map_err(|e| AppError::kafka(format!("producer init failed: {e}")))?;

        Ok(Self {
            producer,
            brokers: config.kafka_brokers.clone(),
            group_prefix: config.kafka_group_prefix.clone(),
            security_protocol: config.kafka_security_protocol.clone(),
            sasl_mechanism: config.kafka_sasl_mechanism.clone(),
            sasl_username: config.kafka_sasl_username.clone(),
            sasl_password: config.kafka_sasl_password.clone(),
            ssl_ca_file: config.kafka_ssl_ca_file.clone(),
        })
    }

    pub async fn publish<T: Serialize>(
        &self,
        topic: &str,
        key: &str,
        payload: &T,
    ) -> AppResult<()> {
        let payload = serde_json::to_vec(payload)?;
        self.producer
            .send(
                FutureRecord::to(topic).payload(&payload).key(key),
                Timeout::After(Duration::from_secs(10)),
            )
            .await
            .map_err(|(e, _)| AppError::kafka(format!("publish to {topic} failed: {e}")))?;
        Ok(())
    }

    pub async fn publish_json(&self, topic: &str, key: &str, payload: Value) -> AppResult<()> {
        self.publish(topic, key, &payload).await
    }

    pub async fn health(&self) -> bool {
        let producer = self.producer.clone();
        tokio::task::spawn_blocking(move || {
            producer
                .client()
                .fetch_metadata(None, Timeout::After(Duration::from_secs(3)))
                .is_ok()
        })
        .await
        .unwrap_or(false)
    }

    pub fn brokers(&self) -> &str {
        &self.brokers
    }

    pub async fn consume_forever<F, Fut>(
        &self,
        topic: &str,
        group_suffix: &str,
        handler: F,
    ) -> AppResult<()>
    where
        F: Fn(Value) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = AppResult<()>> + Send,
    {
        let group_id = format!("{}-{}", self.group_prefix, group_suffix);
        let mut client_config = ClientConfig::new();
        client_config
            .set("bootstrap.servers", &self.brokers)
            .set("group.id", &group_id)
            .set("enable.auto.commit", "false")
            .set("auto.offset.reset", "earliest")
            .set("enable.partition.eof", "false")
            .set("allow.auto.create.topics", "true")
            .set("session.timeout.ms", "30000")
            .set("max.poll.interval.ms", "1800000")
            .set("security.protocol", &self.security_protocol);
        if !self.sasl_username.is_empty() {
            client_config
                .set("sasl.mechanism", &self.sasl_mechanism)
                .set("sasl.username", &self.sasl_username)
                .set("sasl.password", &self.sasl_password);
        }
        if !self.ssl_ca_file.is_empty() {
            client_config.set("ssl.ca.location", &self.ssl_ca_file);
        }
        let consumer: StreamConsumer = client_config
            .create()
            .map_err(|e| AppError::kafka(format!("consumer init failed: {e}")))?;

        consumer
            .subscribe(&[topic])
            .map_err(|e| AppError::kafka(format!("subscribe failed: {e}")))?;

        tracing::info!(topic, group = %group_id, "kafka consumer started");

        loop {
            let message = match consumer.recv().await {
                Ok(m) => m,
                Err(e) => {
                    tracing::error!(error = %e, topic, "kafka receive failed");
                    tokio::time::sleep(Duration::from_secs(2)).await;
                    continue;
                }
            };

            let payload_bytes = match message.payload() {
                Some(bytes) => bytes,
                None => {
                    tracing::warn!(topic, "skipping empty kafka message");
                    let _ = consumer.commit_message(&message, CommitMode::Async);
                    continue;
                }
            };

            let payload: Value = match serde_json::from_slice(payload_bytes) {
                Ok(v) => v,
                Err(e) => {
                    tracing::error!(error = %e, topic, "invalid kafka payload");
                    let _ = consumer.commit_message(&message, CommitMode::Async);
                    continue;
                }
            };

            let mut attempt = 0u32;
            loop {
                attempt += 1;
                match handler(payload.clone()).await {
                    Ok(()) => {
                        let _ = consumer.commit_message(&message, CommitMode::Async);
                        break;
                    }
                    Err(e) => {
                        tracing::error!(error = %e, topic, attempt, "handler failed");
                        if attempt >= 3 {
                            let dlq = serde_json::json!({
                                "original_topic": topic,
                                "error": e.to_string(),
                                "payload": payload,
                            });
                            if let Err(dlq_err) =
                                self.publish_json(TOPIC_RUN_FAILED, "dlq", dlq).await
                            {
                                tracing::error!(error = %dlq_err, "failed to publish DLQ message");
                            }
                            let _ = consumer.commit_message(&message, CommitMode::Async);
                            break;
                        }
                        tokio::time::sleep(Duration::from_secs(2u64.pow(attempt))).await;
                    }
                }
            }
        }
    }
}

#[derive(Clone)]
pub struct MemoryBus {
    sender: broadcast::Sender<Event>,
}

impl MemoryBus {
    pub fn new(capacity: usize) -> Self {
        let (sender, _) = broadcast::channel(capacity.max(16));
        Self { sender }
    }

    pub fn publish<T: Serialize>(&self, topic: &str, key: &str, payload: &T) -> AppResult<()> {
        let event = Event {
            topic: topic.to_string(),
            key: key.to_string(),
            payload: serde_json::to_value(payload)?,
        };
        let _ = self.sender.send(event);
        Ok(())
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Event> {
        self.sender.subscribe()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn memory_bus_roundtrip() {
        let bus = MemoryBus::new(16);
        let mut rx = bus.subscribe();
        bus.publish("test.topic", "key", &serde_json::json!({"ok": true}))
            .unwrap();
        let event = rx.recv().await.unwrap();
        assert_eq!(event.topic, "test.topic");
        assert_eq!(event.payload["ok"], true);
    }
}
