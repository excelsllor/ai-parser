use std::net::SocketAddr;

use news_proto::pipeline::pipeline_server::{Pipeline, PipelineServer};
use news_proto::pipeline::{HealthRequest, HealthResponse, ProcessRunRequest, ProcessRunResponse};
use news_shared::error::{AppError, AppResult};
use news_shared::models::ItemsNormalizedEvent;
use tonic::transport::Server;
use tonic::{Request, Response, Status};

use crate::process_items_normalized;
use crate::AnalystState;

pub struct AnalystGrpc {
    state: AnalystState,
}

impl AnalystGrpc {
    pub fn new(state: AnalystState) -> Self {
        Self { state }
    }
}

#[tonic::async_trait]
impl Pipeline for AnalystGrpc {
    async fn health(
        &self,
        _request: Request<HealthRequest>,
    ) -> Result<Response<HealthResponse>, Status> {
        Ok(Response::new(HealthResponse {
            ok: true,
            service: "analyst".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
        }))
    }

    async fn process_run(
        &self,
        request: Request<ProcessRunRequest>,
    ) -> Result<Response<ProcessRunResponse>, Status> {
        let request = request.into_inner();
        let event: ItemsNormalizedEvent = serde_json::from_str(&request.payload_json)
            .map_err(|error| Status::invalid_argument(error.to_string()))?;
        let response = match process_items_normalized(self.state.clone(), event).await {
            Ok(out) => ProcessRunResponse {
                ok: true,
                run_id: out.run_id.to_string(),
                stage: "analyze".to_string(),
                payload_json: serde_json::to_string(&out)
                    .map_err(|error| Status::internal(error.to_string()))?,
                error: String::new(),
            },
            Err(error) => ProcessRunResponse {
                ok: false,
                run_id: request.run_id,
                stage: "analyze".to_string(),
                payload_json: String::new(),
                error: error.to_string(),
            },
        };
        Ok(Response::new(response))
    }
}

pub async fn serve(state: AnalystState, addr: SocketAddr) -> AppResult<()> {
    Server::builder()
        .add_service(PipelineServer::new(AnalystGrpc::new(state)))
        .serve(addr)
        .await
        .map_err(|error| AppError::internal(format!("analyst gRPC failed: {error}")))?;
    Ok(())
}
