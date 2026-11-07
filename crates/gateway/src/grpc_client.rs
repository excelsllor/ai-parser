use std::time::Duration;

use news_proto::pipeline::pipeline_client::PipelineClient;
use news_proto::pipeline::ProcessRunRequest;
use news_shared::error::{AppError, AppResult};
use news_shared::models::{ItemsCollectedEvent, RunStartedEvent};
use serde_json::Value;
use tonic::transport::Endpoint;
use tonic::Request;
use uuid::Uuid;

use crate::state::AppState;

async fn call_stage(
    state: &AppState,
    service: &str,
    url: &str,
    run_id: Uuid,
    payload: &Value,
) -> AppResult<Value> {
    let endpoint = Endpoint::from_shared(url.to_string())
        .map_err(|error| AppError::internal(format!("invalid {service} gRPC URL: {error}")))?
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(state.config.grpc_timeout_secs));
    let channel = endpoint
        .connect()
        .await
        .map_err(|error| AppError::internal(format!("{service} gRPC connect failed: {error}")))?;
    let mut client = PipelineClient::new(channel);

    let request = ProcessRunRequest {
        run_id: run_id.to_string(),
        payload_json: serde_json::to_string(payload)?,
    };
    let response = client
        .process_run(Request::new(request))
        .await
        .map_err(|error| AppError::internal(format!("{service} gRPC call failed: {error}")))?
        .into_inner();

    if !response.ok {
        return Err(AppError::internal(format!(
            "{service} failed: {}",
            response.error
        )));
    }

    serde_json::from_str(&response.payload_json)
        .map_err(|error| AppError::internal(format!("{service} invalid payload: {error}")))
}

async fn call_with_retry(
    state: &AppState,
    service: &str,
    url: &str,
    run_id: Uuid,
    payload: &Value,
) -> AppResult<Value> {
    let mut last_error = None;
    for attempt in 1..=3u32 {
        match call_stage(state, service, url, run_id, payload).await {
            Ok(value) => return Ok(value),
            Err(error) => {
                tracing::warn!(service, attempt, error = %error, "gRPC stage failed");
                last_error = Some(error);
                if attempt < 3 {
                    tokio::time::sleep(Duration::from_secs(2u64.pow(attempt))).await;
                }
            }
        }
    }
    Err(last_error.unwrap_or_else(|| AppError::internal("gRPC stage failed")))
}

pub async fn run_pipeline(state: AppState, event: RunStartedEvent) -> AppResult<()> {
    let run_id = event.run_id;
    let mut payload = serde_json::to_value(&event)?;
    let stages = [
        ("collector", state.config.collector_grpc_url.as_str()),
        ("normalizer", state.config.normalizer_grpc_url.as_str()),
        ("analyst", state.config.analyst_grpc_url.as_str()),
        ("critic", state.config.critic_grpc_url.as_str()),
        ("reporter", state.config.reporter_grpc_url.as_str()),
    ];

    for (service, url) in stages {
        payload = call_with_retry(&state, service, url, run_id, &payload).await?;
        tracing::info!(run_id = %run_id, service, "gRPC stage completed");
    }
    Ok(())
}

pub async fn run_from_normalizer(state: AppState, event: ItemsCollectedEvent) -> AppResult<()> {
    let run_id = event.run_id;
    let mut payload = serde_json::to_value(&event)?;
    let stages = [
        ("normalizer", state.config.normalizer_grpc_url.as_str()),
        ("analyst", state.config.analyst_grpc_url.as_str()),
        ("critic", state.config.critic_grpc_url.as_str()),
        ("reporter", state.config.reporter_grpc_url.as_str()),
    ];

    for (service, url) in stages {
        payload = call_with_retry(&state, service, url, run_id, &payload).await?;
        tracing::info!(run_id = %run_id, service, "gRPC stage completed");
    }
    Ok(())
}
