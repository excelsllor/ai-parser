use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("configuration error: {0}")]
    Config(String),
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("redis error: {0}")]
    Redis(#[from] redis::RedisError),
    #[error("kafka error: {0}")]
    Kafka(String),
    #[error("llm error: {0}")]
    Llm(String),
    #[error("http client error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("jwt error: {0}")]
    Jwt(#[from] jsonwebtoken::errors::Error),
    #[error("hash error: {0}")]
    Hash(String),
    #[error("unauthorized: {0}")]
    Unauthorized(String),
    #[error("forbidden: {0}")]
    Forbidden(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("bad request: {0}")]
    BadRequest(String),
    #[error("conflict: {0}")]
    Conflict(String),
    #[error("rate limited: {0}")]
    RateLimited(String),
    #[error("unsafe url: {0}")]
    UnsafeUrl(String),
    #[error("validation failed: {0}")]
    Validation(String),
    #[error("internal error: {0}")]
    Internal(String),
}

impl AppError {
    pub fn config(msg: impl Into<String>) -> Self {
        Self::Config(msg.into())
    }

    pub fn llm(msg: impl Into<String>) -> Self {
        Self::Llm(msg.into())
    }

    pub fn kafka(msg: impl Into<String>) -> Self {
        Self::Kafka(msg.into())
    }

    pub fn internal(msg: impl Into<String>) -> Self {
        Self::Internal(msg.into())
    }

    pub fn status(&self) -> StatusCode {
        match self {
            Self::Unauthorized(_) => StatusCode::UNAUTHORIZED,
            Self::Forbidden(_) => StatusCode::FORBIDDEN,
            Self::NotFound(_) => StatusCode::NOT_FOUND,
            Self::BadRequest(_) | Self::Validation(_) | Self::UnsafeUrl(_) => {
                StatusCode::BAD_REQUEST
            }
            Self::Conflict(_) => StatusCode::CONFLICT,
            Self::RateLimited(_) => StatusCode::TOO_MANY_REQUESTS,
            Self::Config(_) => StatusCode::INTERNAL_SERVER_ERROR,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    pub fn code(&self) -> &'static str {
        match self {
            Self::Config(_) => "config_error",
            Self::Database(_) => "database_error",
            Self::Redis(_) => "redis_error",
            Self::Kafka(_) => "kafka_error",
            Self::Llm(_) => "llm_error",
            Self::Http(_) => "http_error",
            Self::Serialization(_) => "serialization_error",
            Self::Io(_) => "io_error",
            Self::Jwt(_) => "jwt_error",
            Self::Hash(_) => "hash_error",
            Self::Unauthorized(_) => "unauthorized",
            Self::Forbidden(_) => "forbidden",
            Self::NotFound(_) => "not_found",
            Self::BadRequest(_) => "bad_request",
            Self::Conflict(_) => "conflict",
            Self::RateLimited(_) => "rate_limited",
            Self::UnsafeUrl(_) => "unsafe_url",
            Self::Validation(_) => "validation_error",
            Self::Internal(_) => "internal_error",
        }
    }

    fn public_message(&self) -> String {
        match self {
            Self::Unauthorized(m) | Self::Forbidden(m) | Self::NotFound(m) => m.clone(),
            Self::BadRequest(m) | Self::Conflict(m) | Self::RateLimited(m) => m.clone(),
            Self::Validation(m) => m.clone(),
            Self::UnsafeUrl(_) => "URL is not allowed".to_string(),
            Self::Config(_) => "service is misconfigured".to_string(),
            _ => "internal server error".to_string(),
        }
    }
}

#[derive(Serialize)]
struct ErrorBody {
    error: ErrorDetail,
    request_id: Option<String>,
}

#[derive(Serialize)]
struct ErrorDetail {
    code: &'static str,
    message: String,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = self.status();
        let code = self.code();
        let public = self.public_message();

        if status.is_server_error() {
            match &self {
                Self::Database(_) | Self::Redis(_) | Self::Kafka(_) | Self::Http(_) => {
                    // Connection errors can contain infrastructure details; log only the class.
                    tracing::error!(code, "request failed");
                }
                _ => tracing::error!(error = %self, code, "request failed"),
            }
        } else {
            tracing::warn!(error = %self, code, "request rejected");
        }

        (
            status,
            Json(ErrorBody {
                error: ErrorDetail {
                    code,
                    message: public,
                },
                request_id: None,
            }),
        )
            .into_response()
    }
}

impl From<anyhow::Error> for AppError {
    fn from(value: anyhow::Error) -> Self {
        Self::Internal(value.to_string())
    }
}

impl From<rdkafka::error::KafkaError> for AppError {
    fn from(value: rdkafka::error::KafkaError) -> Self {
        Self::Kafka(value.to_string())
    }
}

impl From<argon2::password_hash::Error> for AppError {
    fn from(value: argon2::password_hash::Error) -> Self {
        Self::Hash(value.to_string())
    }
}

impl From<uuid::Error> for AppError {
    fn from(value: uuid::Error) -> Self {
        Self::BadRequest(value.to_string())
    }
}
