use std::net::SocketAddr;

use news_proto::pipeline::pipeline_server::{Pipeline, PipelineServer};
use news_proto::pipeline::{HealthRequest, HealthResponse, ProcessRunRequest, ProcessRunResponse};
use news_shared::error::{AppError, AppResult};
use news_shared::models::DigestDraftEvent;
use tonic::transport::Server;
use tonic::{Request, Response, Status};

use crate::process_digest_draft;
use crate::CriticState;

pub struct CriticGrpc {
    state: CriticState,
}

impl CriticGrpc {
    pub fn new(state: CriticState) -> Self {
        Self { state }
    }
}

#[tonic::async_trait]
impl Pipeline for CriticGrpc {
    async fn health(
        &self,
        _request: Request<HealthRequest>,
    ) -> Result<Response<HealthResponse>, Status> {
        Ok(Response::new(HealthResponse {
            ok: true,
            service: "critic".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
        }))
    }

    async fn process_run(
        &self,
        request: Request<ProcessRunRequest>,
    ) -> Result<Response<ProcessRunResponse>, Status> {
        let request = request.into_inner();
        let draft: DigestDraftEvent = serde_json::from_str(&request.payload_json)
            .map_err(|error| Status::invalid_argument(error.to_string()))?;
        let response = match process_digest_draft(self.state.clone(), draft).await {
            Ok(out) => ProcessRunResponse {
                ok: true,
                run_id: out.run_id.to_string(),
                stage: "critic".to_string(),
                payload_json: serde_json::to_string(&out)
                    .map_err(|error| Status::internal(error.to_string()))?,
                error: String::new(),
            },
            Err(error) => ProcessRunResponse {
                ok: false,
                run_id: request.run_id,
                stage: "critic".to_string(),
                payload_json: String::new(),
                error: error.to_string(),
            },
        };
        Ok(Response::new(response))
    }
}

pub async fn serve(state: CriticState, addr: SocketAddr) -> AppResult<()> {
    Server::builder()
        .add_service(PipelineServer::new(CriticGrpc::new(state)))
        .serve(addr)
        .await
        .map_err(|error| AppError::internal(format!("critic gRPC failed: {error}")))?;
    Ok(())
}
