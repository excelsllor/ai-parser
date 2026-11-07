use serde_json::Value;
use uuid::Uuid;

use crate::db;
use crate::error::AppResult;
use sqlx::PgPool;

#[derive(Debug, Clone)]
pub struct AuditRecord {
    pub actor_id: Option<Uuid>,
    pub actor_username: String,
    pub action: String,
    pub resource: String,
    pub detail: Value,
    pub ip: String,
}

impl AuditRecord {
    pub fn new(
        actor_id: Option<Uuid>,
        actor_username: impl Into<String>,
        action: impl Into<String>,
        resource: impl Into<String>,
        detail: Value,
        ip: impl Into<String>,
    ) -> Self {
        Self {
            actor_id,
            actor_username: actor_username.into(),
            action: action.into(),
            resource: resource.into(),
            detail,
            ip: ip.into(),
        }
    }
}

pub async fn write_audit(pool: &PgPool, record: &AuditRecord) -> AppResult<()> {
    db::log_audit(
        pool,
        record.actor_id,
        &record.actor_username,
        &record.action,
        &record.resource,
        record.detail.clone(),
        &record.ip,
    )
    .await
}
