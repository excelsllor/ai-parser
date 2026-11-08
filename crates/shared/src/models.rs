use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Admin,
    Analyst,
    Viewer,
}

impl Role {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Admin => "admin",
            Self::Analyst => "analyst",
            Self::Viewer => "viewer",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "admin" => Some(Self::Admin),
            "analyst" => Some(Self::Analyst),
            "viewer" => Some(Self::Viewer),
            _ => None,
        }
    }

    pub fn can_write(&self) -> bool {
        matches!(self, Self::Admin | Self::Analyst)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RunMode {
    Live,
    File,
}

impl RunMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Live => "live",
            Self::File => "file",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "live" => Some(Self::Live),
            "file" => Some(Self::File),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RunStatus {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl RunStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct User {
    pub id: Uuid,
    pub username: String,
    #[serde(skip_serializing)]
    pub password_hash: String,
    pub role: String,
    pub is_active: bool,
    pub display_name: String,
    pub department: String,
    pub email: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct RefreshToken {
    pub id: Uuid,
    pub user_id: Uuid,
    pub token_hash: String,
    pub expires_at: DateTime<Utc>,
    pub revoked: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct AuditEntry {
    pub id: Uuid,
    pub actor_id: Option<Uuid>,
    pub actor_username: String,
    pub action: String,
    pub resource: String,
    pub detail: serde_json::Value,
    pub ip: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Source {
    pub id: Uuid,
    pub name: String,
    pub kind: String,
    pub url: String,
    pub enabled: bool,
    pub trust: String,
    pub language: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Keyword {
    pub id: Uuid,
    pub word: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Run {
    pub id: Uuid,
    pub status: String,
    pub mode: String,
    pub control_time: DateTime<Utc>,
    pub period_start: DateTime<Utc>,
    pub period_end: DateTime<Utc>,
    pub model: String,
    pub prompt_version: String,
    pub created_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
    pub error: Option<String>,
    pub stats: serde_json::Value,
    pub interval_hours: i32,
    pub max_items: i32,
    pub parent_run_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct RunStage {
    pub id: Uuid,
    pub run_id: Uuid,
    pub stage: String,
    pub status: String,
    pub message: Option<String>,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Item {
    pub id: Uuid,
    pub run_id: Uuid,
    pub external_id: String,
    pub source_id: Option<Uuid>,
    pub source_name: String,
    pub source_url: Option<String>,
    pub url: String,
    pub canonical_url: String,
    pub title: String,
    pub raw_text: String,
    pub clean_text: String,
    pub published_at: Option<DateTime<Utc>>,
    pub date_confirmed: bool,
    pub status: String,
    pub reason: Option<String>,
    pub group_key: Option<String>,
    pub duplicate_of: Option<Uuid>,
    pub analysis: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Event {
    pub id: Uuid,
    pub run_id: Uuid,
    pub rank: i32,
    pub title: String,
    pub summary: String,
    pub consequences: String,
    pub justification: String,
    pub score: f64,
    pub event_key: String,
    pub attributes: serde_json::Value,
    pub status: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct EventSource {
    pub id: Uuid,
    pub event_id: Uuid,
    pub item_id: Uuid,
    pub source_name: String,
    pub url: String,
    pub title: String,
    pub published_at: Option<DateTime<Utc>>,
    pub is_primary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Claim {
    pub id: Uuid,
    pub event_id: Uuid,
    pub text: String,
    pub supported: bool,
    pub confidence: f64,
    pub source_item_id: Option<Uuid>,
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct JournalRow {
    pub id: Uuid,
    pub run_id: Uuid,
    pub item_id: Uuid,
    pub external_id: String,
    pub status: String,
    pub group_key: Option<String>,
    pub reason: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct LlmCall {
    pub id: Uuid,
    pub run_id: Option<Uuid>,
    pub purpose: String,
    pub model: String,
    pub prompt_hash: String,
    pub prompt_version: String,
    pub input_tokens: i32,
    pub output_tokens: i32,
    pub cost: f64,
    pub latency_ms: i64,
    pub ok: bool,
    pub error: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct CheckResult {
    pub id: Uuid,
    pub run_id: Uuid,
    pub scenario: String,
    pub passed: bool,
    pub input: serde_json::Value,
    pub output: serde_json::Value,
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Artifact {
    pub id: Uuid,
    pub run_id: Uuid,
    pub name: String,
    pub path: String,
    pub mime: String,
    pub size: i64,
    pub sha256: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunStartedEvent {
    pub run_id: Uuid,
    pub mode: String,
    pub control_time: DateTime<Utc>,
    pub sources: Vec<Uuid>,
    pub dataset_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemsCollectedEvent {
    pub run_id: Uuid,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemsNormalizedEvent {
    pub run_id: Uuid,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DigestDraftEvent {
    pub run_id: Uuid,
    pub events: Vec<DraftEvent>,
    pub notes: Vec<String>,
    pub model: String,
    pub prompt_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DigestVerifiedEvent {
    pub run_id: Uuid,
    pub events: Vec<DraftEvent>,
    pub verification: VerificationReport,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtifactsReadyEvent {
    pub run_id: Uuid,
    pub artifacts: Vec<ArtifactInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtifactInfo {
    pub name: String,
    pub path: String,
    pub mime: String,
    pub size: i64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DraftEvent {
    pub event_key: String,
    pub title: String,
    pub summary: String,
    pub consequences: String,
    pub justification: String,
    pub sources: Vec<DraftSource>,
    pub score: f64,
    #[serde(default)]
    pub attributes: EventAttributes,
    #[serde(default)]
    pub claims: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EventAttributes {
    #[serde(default)]
    pub impact: f64,
    #[serde(default)]
    pub scale: f64,
    #[serde(default)]
    pub urgency: f64,
    #[serde(default)]
    pub relevance: f64,
    #[serde(default)]
    pub confidence: f64,
    #[serde(default)]
    pub uncertainty: f64,
    #[serde(default)]
    pub organizations: Vec<String>,
    #[serde(default)]
    pub systems: Vec<String>,
    #[serde(default)]
    pub date_unconfirmed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DraftSource {
    pub item_id: Uuid,
    pub source_name: String,
    pub url: String,
    pub title: String,
    pub published_at: Option<DateTime<Utc>>,
    pub is_primary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VerificationReport {
    #[serde(default)]
    pub checks: Vec<VerificationCheck>,
    #[serde(default)]
    pub unsupported_claims: usize,
    #[serde(default)]
    pub contradictions: Vec<String>,
    #[serde(default)]
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationCheck {
    pub name: String,
    pub passed: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LlmUsage {
    #[serde(default)]
    pub prompt_tokens: i64,
    #[serde(default)]
    pub completion_tokens: i64,
    #[serde(default)]
    pub total_tokens: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmItemAnalysis {
    #[serde(default)]
    pub relevant: bool,
    #[serde(default)]
    pub topic_confidence: f64,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub consequences: String,
    #[serde(default)]
    pub organizations: Vec<String>,
    #[serde(default)]
    pub systems: Vec<String>,
    #[serde(default)]
    pub urgency: f64,
    #[serde(default)]
    pub scale: f64,
    #[serde(default)]
    pub impact: f64,
    #[serde(default)]
    pub relevance: f64,
    #[serde(default)]
    pub confidence: f64,
    #[serde(default)]
    pub uncertainty: f64,
    #[serde(default)]
    pub primary_source: bool,
    #[serde(default)]
    pub ad: bool,
    #[serde(default)]
    pub insufficient_data: bool,
    #[serde(default)]
    pub injection_detected: bool,
    #[serde(default)]
    pub event_key: String,
    #[serde(default)]
    pub facts: Vec<String>,
    #[serde(default)]
    pub affected: String,
    #[serde(default)]
    pub caveats: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunCreateRequest {
    pub control_time: Option<DateTime<Utc>>,
    pub mode: RunMode,
    #[serde(default)]
    pub sources: Vec<Uuid>,
    pub model: Option<String>,
    pub prompt_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddItemRequest {
    pub title: String,
    pub text: String,
    pub source: String,
    pub url: String,
    pub published_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailPreviewRequest {
    pub to: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub token_type: String,
    pub role: String,
    pub username: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserResponse {
    pub id: Uuid,
    pub username: String,
    pub role: String,
    pub is_active: bool,
    pub display_name: String,
    pub department: String,
    pub email: Option<String>,
    pub created_at: DateTime<Utc>,
}

impl From<User> for UserResponse {
    fn from(value: User) -> Self {
        Self {
            id: value.id,
            username: value.username,
            role: value.role,
            is_active: value.is_active,
            display_name: value.display_name,
            department: value.department,
            email: value.email,
            created_at: value.created_at,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunSummary {
    pub id: Uuid,
    pub status: String,
    pub mode: String,
    pub control_time: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
    pub model: String,
    pub prompt_version: String,
    pub error: Option<String>,
    pub parent_run_id: Option<Uuid>,
}

impl From<Run> for RunSummary {
    fn from(value: Run) -> Self {
        Self {
            id: value.id,
            status: value.status,
            mode: value.mode,
            control_time: value.control_time,
            created_at: value.created_at,
            finished_at: value.finished_at,
            model: value.model,
            prompt_version: value.prompt_version,
            error: value.error,
            parent_run_id: value.parent_run_id,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunDetail {
    pub run: Run,
    pub stages: Vec<RunStage>,
    pub artifacts: Vec<Artifact>,
    pub journal: Vec<JournalRow>,
    pub events: Vec<Event>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthResponse {
    pub status: String,
    pub env: String,
    pub database: bool,
    pub redis: bool,
    pub kafka: bool,
    pub version: String,
}
