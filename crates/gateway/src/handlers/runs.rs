use std::io::{Cursor, Write};

use axum::body::Body;
use axum::extract::{Extension, Multipart, Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::Response;
use axum::Json;
use chrono::{DateTime, Duration, NaiveDateTime, TimeZone, Utc};
use news_shared::audit::{write_audit, AuditRecord};
use news_shared::auth::AuthUser;
use news_shared::db;
use news_shared::error::{AppError, AppResult};
use news_shared::models::*;
use news_shared::security::sanitize_filename;
use news_shared::text::{canonicalize_url, detect_injection};
use news_shared::{TOPIC_ITEMS_COLLECTED, TOPIC_RUN_STARTED};
use serde::Deserialize;
use serde_json::json;
use tokio::fs;
use uuid::Uuid;

use crate::handlers::email;
use crate::middleware::ClientIp;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct Pagination {
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub offset: Option<i64>,
}

fn can_access_run(user: &AuthUser, run: &Run) -> bool {
    user.role == Role::Admin || run.created_by == Some(user.id)
}

async fn get_run_for_user(state: &AppState, user: &AuthUser, run_id: Uuid) -> AppResult<Run> {
    let run = db::get_run(&state.pool, run_id).await?;
    if !can_access_run(user, &run) {
        return Err(AppError::NotFound("run not found".into()));
    }
    Ok(run)
}

pub async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    mut multipart: Multipart,
) -> AppResult<(StatusCode, Json<Run>)> {
    user.require_write()?;

    let mut control_time_raw: Option<String> = None;
    let mut mode_raw: Option<String> = None;
    let mut model: Option<String> = None;
    let mut prompt_version: Option<String> = None;
    let mut sources: Vec<Uuid> = Vec::new();
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    let mut total_bytes: usize = 0;
    let mut interval_hours: Option<i32> = None;
    let mut max_items: Option<i32> = None;
    let mut parent_run_id: Option<Uuid> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("invalid multipart: {e}")))?
    {
        let name = field.name().unwrap_or_default().to_string();
        match name.as_str() {
            "control_time" => {
                control_time_raw = Some(
                    field
                        .text()
                        .await
                        .map_err(|e| AppError::BadRequest(e.to_string()))?,
                );
            }
            "mode" => {
                mode_raw = Some(
                    field
                        .text()
                        .await
                        .map_err(|e| AppError::BadRequest(e.to_string()))?,
                );
            }
            "model" => {
                model = Some(
                    field
                        .text()
                        .await
                        .map_err(|e| AppError::BadRequest(e.to_string()))?,
                );
            }
            "prompt_version" => {
                prompt_version = Some(
                    field
                        .text()
                        .await
                        .map_err(|e| AppError::BadRequest(e.to_string()))?,
                );
            }
            "interval_hours" => {
                let raw = field
                    .text()
                    .await
                    .map_err(|e| AppError::BadRequest(e.to_string()))?;
                interval_hours = Some(
                    raw.parse::<i32>()
                        .map_err(|_| AppError::BadRequest("invalid interval_hours".into()))?,
                );
            }
            "max_items" => {
                let raw = field
                    .text()
                    .await
                    .map_err(|e| AppError::BadRequest(e.to_string()))?;
                max_items = Some(
                    raw.parse::<i32>()
                        .map_err(|_| AppError::BadRequest("invalid max_items".into()))?,
                );
            }
            "parent_run_id" => {
                let raw = field
                    .text()
                    .await
                    .map_err(|e| AppError::BadRequest(e.to_string()))?;
                if !raw.trim().is_empty() {
                    parent_run_id = Some(
                        Uuid::parse_str(raw.trim())
                            .map_err(|_| AppError::BadRequest("invalid parent_run_id".into()))?,
                    );
                }
            }
            "policies" => {
                let _ = field
                    .text()
                    .await
                    .map_err(|e| AppError::BadRequest(e.to_string()))?;
            }
            "sources" => {
                let raw = field
                    .text()
                    .await
                    .map_err(|e| AppError::BadRequest(e.to_string()))?;
                for part in raw.split(',') {
                    let part = part.trim();
                    if part.is_empty() {
                        continue;
                    }
                    sources.push(
                        Uuid::parse_str(part)
                            .map_err(|_| AppError::BadRequest("invalid source id".into()))?,
                    );
                }
            }
            "files" | "file" => {
                let Some(raw_name) = field.file_name().map(str::to_owned) else {
                    let _ = field.bytes().await;
                    continue;
                };
                if raw_name.trim().is_empty() {
                    let _ = field.bytes().await;
                    continue;
                }
                if files.len() >= 20 {
                    return Err(AppError::BadRequest("too many files (max 20)".into()));
                }
                let filename = sanitize_filename(&raw_name)
                    .ok_or_else(|| AppError::BadRequest("invalid file name".into()))?;
                let bytes = field
                    .bytes()
                    .await
                    .map_err(|e| AppError::BadRequest(format!("failed to read file: {e}")))?;
                if bytes.len() > 20 * 1024 * 1024 {
                    return Err(AppError::BadRequest("file is larger than 20 MB".into()));
                }
                total_bytes += bytes.len();
                if total_bytes > 64 * 1024 * 1024 {
                    return Err(AppError::BadRequest("upload is larger than 64 MB".into()));
                }
                files.push((filename, bytes.to_vec()));
            }
            _ => {
                let _ = field.bytes().await;
            }
        }
    }

    let mode = match mode_raw.as_deref() {
        Some("live") => RunMode::Live,
        Some("file") => RunMode::File,
        Some(_) => return Err(AppError::BadRequest("mode must be live or file".into())),
        None => {
            if files.is_empty() {
                RunMode::Live
            } else {
                RunMode::File
            }
        }
    };

    if mode == RunMode::File && files.is_empty() {
        return Err(AppError::BadRequest(
            "file mode requires at least one dataset file".into(),
        ));
    }

    let control_time = match control_time_raw {
        Some(raw) => parse_control_time(&raw, state.config.control_timezone)?,
        None => Utc::now(),
    };
    let interval_hours = interval_hours.unwrap_or(24);
    if !(1..=168).contains(&interval_hours) {
        return Err(AppError::BadRequest(
            "interval_hours must be between 1 and 168".into(),
        ));
    }
    let max_items = max_items.unwrap_or(5);
    if !(1..=20).contains(&max_items) {
        return Err(AppError::BadRequest(
            "max_items must be between 1 and 20".into(),
        ));
    }
    let period_start = control_time - Duration::hours(i64::from(interval_hours));
    let model = match model {
        Some(value) if !value.trim().is_empty() => value,
        _ => db::get_setting(&state.pool, "model")
            .await?
            .and_then(|value| value.as_str().map(ToOwned::to_owned))
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| state.config.llm.model.clone()),
    };
    let prompt_version = match prompt_version {
        Some(value) if !value.trim().is_empty() => value,
        _ => db::get_setting(&state.pool, "prompt_version")
            .await?
            .and_then(|value| value.as_str().map(ToOwned::to_owned))
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| state.config.prompt_version.clone()),
    };

    let policies = RunPolicies::default();
    let run = db::create_run(
        &state.pool,
        mode.as_str(),
        control_time,
        period_start,
        control_time,
        &model,
        &prompt_version,
        Some(user.id),
        interval_hours,
        max_items,
        parent_run_id,
        &sources,
        &policies,
    )
    .await?;

    let upload_dir = state.config.upload_dir(run.id);
    if let Err(error) = fs::create_dir_all(&upload_dir).await {
        let _ = db::set_run_status(&state.pool, run.id, "failed", Some(&error.to_string())).await;
        return Err(AppError::Io(error));
    }

    let mut saved_files = Vec::new();
    for (mut filename, bytes) in files {
        if upload_dir.join(&filename).exists() {
            filename = format!("{}-{filename}", Uuid::new_v4().simple());
        }
        let path = upload_dir.join(&filename);
        if let Err(error) = fs::write(&path, &bytes).await {
            let _ =
                db::set_run_status(&state.pool, run.id, "failed", Some(&error.to_string())).await;
            return Err(AppError::Io(error));
        }
        saved_files.push(filename);
    }

    let dataset_dir = if mode == RunMode::File {
        Some(upload_dir.to_string_lossy().to_string())
    } else {
        None
    };

    let stage_id = db::add_stage(
        &state.pool,
        run.id,
        "queued",
        "completed",
        Some("run created"),
    )
    .await?;
    let _ = db::finish_stage(&state.pool, stage_id, "completed", Some("run created")).await;

    let event = RunStartedEvent {
        run_id: run.id,
        mode: mode.as_str().to_string(),
        control_time,
        sources,
        dataset_dir,
    };
    let run_id = run.id;
    if state.config.pipeline_transport == "kafka" {
        state
            .bus
            .publish(TOPIC_RUN_STARTED, &run_id.to_string(), &event)
            .await?;
    } else {
        let pipeline_state = state.clone();
        let pipeline_event = event.clone();
        tokio::spawn(async move {
            if let Err(error) =
                crate::grpc_client::run_pipeline(pipeline_state.clone(), pipeline_event).await
            {
                tracing::error!(run_id = %run_id, error = %error, "gRPC pipeline failed");
                let _ = db::set_run_status(
                    &pipeline_state.pool,
                    run_id,
                    "failed",
                    Some(&error.to_string()),
                )
                .await;
            }
        });
    }

    let _ = write_audit(
        &state.pool,
        &AuditRecord::new(
            Some(user.id),
            user.username.clone(),
            "run.create",
            format!("run:{}", run.id),
            json!({
                "mode": mode.as_str(),
                "control_time": control_time,
                "files": saved_files,
                "model": model,
                "interval_hours": interval_hours,
                "max_items": max_items,
                "parent_run_id": parent_run_id,
            }),
            ip,
        ),
    )
    .await;

    Ok((StatusCode::CREATED, Json(run)))
}

pub async fn list(
    State(state): State<AppState>,
    user: AuthUser,
    Query(pagination): Query<Pagination>,
) -> AppResult<Json<Vec<RunSummary>>> {
    let owner = if user.role == Role::Admin {
        None
    } else {
        Some(user.id)
    };
    let runs = db::list_runs(
        &state.pool,
        owner,
        pagination.limit.unwrap_or(50),
        pagination.offset.unwrap_or(0),
    )
    .await?;
    Ok(Json(runs.into_iter().map(RunSummary::from).collect()))
}

pub async fn detail(
    State(state): State<AppState>,
    user: AuthUser,
    Path(run_id): Path<Uuid>,
) -> AppResult<Json<RunDetail>> {
    let run = get_run_for_user(&state, &user, run_id).await?;
    let stages = db::get_stages(&state.pool, run_id).await?;
    let artifacts = db::get_artifacts(&state.pool, run_id).await?;
    let journal = db::get_journal(&state.pool, run_id).await?;
    let events = db::get_events(&state.pool, run_id).await?;
    Ok(Json(RunDetail {
        run,
        stages,
        artifacts,
        journal,
        events,
    }))
}

pub async fn status(
    State(state): State<AppState>,
    user: AuthUser,
    Path(run_id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let run = get_run_for_user(&state, &user, run_id).await?;
    let stages = db::get_stages(&state.pool, run_id).await?;
    let stats = db::run_stats(&state.pool, run_id).await?;
    Ok(Json(json!({
        "run": run,
        "stages": stages,
        "stats": stats,
    })))
}

pub async fn cancel(
    State(state): State<AppState>,
    user: AuthUser,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    Path(run_id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    user.require_write()?;
    get_run_for_user(&state, &user, run_id).await?;
    db::set_run_status(&state.pool, run_id, "cancelled", Some("cancelled by user")).await?;
    let _ = write_audit(
        &state.pool,
        &AuditRecord::new(
            Some(user.id),
            user.username.clone(),
            "run.cancel",
            format!("run:{run_id}"),
            json!({}),
            ip,
        ),
    )
    .await;
    Ok(Json(json!({"ok": true})))
}

pub async fn delete(
    State(state): State<AppState>,
    user: AuthUser,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    Path(run_id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    user.require_write()?;
    let run = get_run_for_user(&state, &user, run_id).await?;
    if run.status == "queued" || run.status == "running" {
        db::set_run_status(&state.pool, run_id, "cancelled", Some("deleted by user")).await?;
    }
    db::delete_run(&state.pool, run_id).await?;
    let run_dir = state.config.run_dir(run_id);
    if let Err(error) = fs::remove_dir_all(&run_dir).await {
        if error.kind() != std::io::ErrorKind::NotFound {
            tracing::warn!(run_id = %run_id, error = %error, "run directory cleanup failed");
        }
    }
    let upload_dir = state.config.upload_dir(run_id);
    if let Err(error) = fs::remove_dir_all(&upload_dir).await {
        if error.kind() != std::io::ErrorKind::NotFound {
            tracing::warn!(run_id = %run_id, error = %error, "upload directory cleanup failed");
        }
    }
    let _ = write_audit(
        &state.pool,
        &AuditRecord::new(
            Some(user.id),
            user.username.clone(),
            "run.delete",
            format!("run:{run_id}"),
            json!({}),
            ip,
        ),
    )
    .await;
    Ok(Json(json!({"ok": true})))
}

pub async fn rerun(
    State(state): State<AppState>,
    user: AuthUser,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    Path(run_id): Path<Uuid>,
) -> AppResult<(StatusCode, Json<Run>)> {
    user.require_write()?;
    let old = get_run_for_user(&state, &user, run_id).await?;

    let run = db::create_run(
        &state.pool,
        &old.mode,
        old.control_time,
        old.period_start,
        old.period_end,
        &old.model,
        &old.prompt_version,
        Some(user.id),
        old.interval_hours,
        old.max_items,
        Some(old.id),
        &old.source_ids,
        &RunPolicies::default(),
    )
    .await?;

    let dataset_dir = if old.mode == "file" {
        Some(
            state
                .config
                .upload_dir(old.id)
                .to_string_lossy()
                .to_string(),
        )
    } else {
        None
    };

    let event = RunStartedEvent {
        run_id: run.id,
        mode: old.mode.clone(),
        control_time: old.control_time,
        sources: old.source_ids.clone(),
        dataset_dir,
    };
    let run_id = run.id;
    if state.config.pipeline_transport == "kafka" {
        state
            .bus
            .publish(TOPIC_RUN_STARTED, &run_id.to_string(), &event)
            .await?;
    } else {
        let pipeline_state = state.clone();
        let pipeline_event = event.clone();
        tokio::spawn(async move {
            if let Err(error) =
                crate::grpc_client::run_pipeline(pipeline_state.clone(), pipeline_event).await
            {
                tracing::error!(run_id = %run_id, error = %error, "gRPC pipeline failed");
                let _ = db::set_run_status(
                    &pipeline_state.pool,
                    run_id,
                    "failed",
                    Some(&error.to_string()),
                )
                .await;
            }
        });
    }

    let _ = write_audit(
        &state.pool,
        &AuditRecord::new(
            Some(user.id),
            user.username.clone(),
            "run.rerun",
            format!("run:{}", run.id),
            json!({"source_run": run_id}),
            ip,
        ),
    )
    .await;

    Ok((StatusCode::CREATED, Json(run)))
}

fn safe_artifact_path(state: &AppState, path: &str) -> AppResult<std::path::PathBuf> {
    let path = std::path::Path::new(path);
    let data_root = state
        .config
        .data_dir
        .canonicalize()
        .unwrap_or_else(|_| state.config.data_dir.clone());
    let canonical = path
        .canonicalize()
        .map_err(|_| AppError::NotFound("artifact file not found".into()))?;
    if !canonical.starts_with(&data_root) {
        return Err(AppError::Forbidden(
            "artifact path is outside data directory".into(),
        ));
    }
    Ok(canonical)
}

pub async fn artifact(
    State(state): State<AppState>,
    user: AuthUser,
    Path((run_id, name)): Path<(Uuid, String)>,
    headers: HeaderMap,
) -> AppResult<Response> {
    get_run_for_user(&state, &user, run_id).await?;
    let artifact = db::get_artifact(&state.pool, run_id, &name).await?;
    let canonical = safe_artifact_path(&state, &artifact.path)?;
    let bytes = fs::read(&canonical).await?;
    Ok(artifact_response(&artifact, bytes, &headers))
}

fn artifact_response(artifact: &Artifact, bytes: Vec<u8>, headers: &HeaderMap) -> Response {
    let download = headers
        .get(header::ACCEPT)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.contains("text/html"))
        .unwrap_or(false);

    let content_type = if artifact.mime.is_empty() {
        "application/octet-stream".to_string()
    } else {
        artifact.mime.clone()
    };

    let mut response = Response::new(Body::from(bytes));
    *response.status_mut() = StatusCode::OK;
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&content_type)
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    let disposition = if download {
        "inline".to_string()
    } else {
        format!("attachment; filename=\"{}\"", artifact.name)
    };
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&disposition)
            .unwrap_or_else(|_| HeaderValue::from_static("attachment")),
    );
    response
}

pub async fn journal_csv(
    State(state): State<AppState>,
    user: AuthUser,
    Path(run_id): Path<Uuid>,
) -> AppResult<Response> {
    get_run_for_user(&state, &user, run_id).await?;
    if let Ok(artifact) = db::get_artifact(&state.pool, run_id, "journal.csv").await {
        if let Ok(path) = safe_artifact_path(&state, &artifact.path) {
            if let Ok(bytes) = fs::read(&path).await {
                let mut response = Response::new(Body::from(bytes));
                response.headers_mut().insert(
                    header::CONTENT_TYPE,
                    HeaderValue::from_static("text/csv; charset=utf-8"),
                );
                response.headers_mut().insert(
                    header::CONTENT_DISPOSITION,
                    HeaderValue::from_static("attachment; filename=\"journal.csv\""),
                );
                return Ok(response);
            }
        }
    }

    let rows = db::get_journal(&state.pool, run_id).await?;
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record(["id", "status", "group", "reason", "error"])
        .map_err(|e| AppError::internal(e.to_string()))?;
    for row in rows {
        writer
            .write_record([
                csv_safe(&row.external_id),
                csv_safe(&row.status),
                csv_safe(&row.group_key.unwrap_or_default()),
                csv_safe(&row.reason),
                csv_safe(&row.error.unwrap_or_default()),
            ])
            .map_err(|e| AppError::internal(e.to_string()))?;
    }
    let bytes = writer
        .into_inner()
        .map_err(|e| AppError::internal(e.to_string()))?;
    let mut response = Response::new(Body::from(bytes));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/csv; charset=utf-8"),
    );
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_static("attachment; filename=\"journal.csv\""),
    );
    Ok(response)
}

pub async fn add_item(
    State(state): State<AppState>,
    user: AuthUser,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    Path(run_id): Path<Uuid>,
    Json(payload): Json<AddItemRequest>,
) -> AppResult<(StatusCode, Json<serde_json::Value>)> {
    user.require_write()?;
    let run = get_run_for_user(&state, &user, run_id).await?;

    if payload.title.trim().is_empty() || payload.text.trim().is_empty() {
        return Err(AppError::BadRequest("title and text are required".into()));
    }
    if payload.text.len() > 200_000 {
        return Err(AppError::BadRequest("text is too long".into()));
    }

    let canonical_url =
        canonicalize_url(&payload.url).unwrap_or_else(|| payload.url.trim().to_string());
    let injection = detect_injection(&format!("{} {}", payload.title, payload.text));
    let source_name = if payload.source.trim().is_empty() {
        "manual".to_string()
    } else {
        payload.source.trim().to_string()
    };

    let item = Item {
        id: Uuid::new_v4(),
        run_id,
        external_id: String::new(),
        source_id: None,
        source_name,
        source_url: Some(payload.url.clone()),
        url: payload.url.clone(),
        canonical_url,
        title: payload.title.clone(),
        raw_text: payload.text.clone(),
        clean_text: payload.text.clone(),
        published_at: payload.published_at,
        date_confirmed: payload.published_at.is_some(),
        status: "collected".to_string(),
        reason: None,
        group_key: None,
        duplicate_of: None,
        analysis: json!({"injection_detected": injection.is_some()}),
        created_at: Utc::now(),
    };
    db::insert_item(&state.pool, &item).await?;

    let collected = ItemsCollectedEvent { run_id, count: 1 };
    if state.config.pipeline_transport == "kafka" {
        state
            .bus
            .publish(TOPIC_ITEMS_COLLECTED, &run.id.to_string(), &collected)
            .await?;
    } else {
        let pipeline_state = state.clone();
        tokio::spawn(async move {
            if let Err(error) =
                crate::grpc_client::run_from_normalizer(pipeline_state.clone(), collected).await
            {
                tracing::error!(run_id = %run_id, error = %error, "gRPC pipeline failed");
                let _ = db::set_run_status(
                    &pipeline_state.pool,
                    run_id,
                    "failed",
                    Some(&error.to_string()),
                )
                .await;
            }
        });
    }

    let _ = write_audit(
        &state.pool,
        &AuditRecord::new(
            Some(user.id),
            user.username.clone(),
            "run.add_item",
            format!("run:{run_id}"),
            json!({"item_id": item.id, "source": item.source_name, "injection": injection.is_some()}),
            ip,
        ),
    )
    .await;

    Ok((StatusCode::CREATED, Json(json!({"item_id": item.id}))))
}

pub async fn checks(
    State(state): State<AppState>,
    user: AuthUser,
    Path(run_id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    get_run_for_user(&state, &user, run_id).await?;
    let checks = db::get_check_results(&state.pool, run_id).await?;
    Ok(Json(json!(checks)))
}

pub async fn sources_list(
    State(state): State<AppState>,
    _user: AuthUser,
) -> AppResult<Json<serde_json::Value>> {
    let sources = db::list_enabled_sources(&state.pool).await?;
    Ok(Json(json!(sources)))
}

pub async fn email_preview(
    State(state): State<AppState>,
    user: AuthUser,
    Path(run_id): Path<Uuid>,
) -> AppResult<Response> {
    get_run_for_user(&state, &user, run_id).await?;
    let artifact = db::get_artifact(&state.pool, run_id, "email.html").await?;
    let path = safe_artifact_path(&state, &artifact.path)?;
    let bytes = fs::read(&path).await?;
    let mut response = Response::new(Body::from(bytes));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    response.headers_mut().insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(
            "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'",
        ),
    );
    Ok(response)
}

pub async fn email_send(
    State(state): State<AppState>,
    user: AuthUser,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    Path(run_id): Path<Uuid>,
    body: Option<Json<EmailPreviewRequest>>,
) -> AppResult<Json<serde_json::Value>> {
    user.require_write()?;
    get_run_for_user(&state, &user, run_id).await?;
    let artifact = db::get_artifact(&state.pool, run_id, "email.html").await?;
    let path = safe_artifact_path(&state, &artifact.path)?;
    let html = fs::read_to_string(&path).await?;
    let subject = if let Ok(subject_artifact) =
        db::get_artifact(&state.pool, run_id, "email_subject.txt").await
    {
        match safe_artifact_path(&state, &subject_artifact.path) {
            Ok(subject_path) => fs::read_to_string(&subject_path)
                .await
                .unwrap_or_else(|_| "Дайджест по кибербезопасности".to_string()),
            Err(_) => "Дайджест по кибербезопасности".to_string(),
        }
    } else {
        "Дайджест по кибербезопасности".to_string()
    };

    let requested = body.and_then(|Json(req)| req.to).unwrap_or_default();
    let recipient = if requested.trim().is_empty() {
        state.config.smtp.test_recipient.clone()
    } else if requested
        .trim()
        .eq_ignore_ascii_case(&state.config.smtp.test_recipient)
    {
        requested.trim().to_string()
    } else {
        return Err(AppError::Forbidden(
            "only the configured test recipient is allowed".into(),
        ));
    };

    email::send_html(&state, &recipient, subject.trim(), &html).await?;

    let _ = write_audit(
        &state.pool,
        &AuditRecord::new(
            Some(user.id),
            user.username.clone(),
            "email.send",
            format!("run:{run_id}"),
            json!({"to": recipient}),
            ip,
        ),
    )
    .await;

    Ok(Json(json!({"sent": true, "to": recipient})))
}

pub async fn share_run(
    State(state): State<AppState>,
    user: AuthUser,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    Path(run_id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let run = get_run_for_user(&state, &user, run_id).await?;
    let token = match run.share_token {
        Some(token) => token,
        None => {
            let token = Uuid::new_v4().simple().to_string();
            db::set_run_share_token(&state.pool, run_id, &token).await?;
            token
        }
    };
    let _ = write_audit(
        &state.pool,
        &AuditRecord::new(
            Some(user.id),
            user.username.clone(),
            "run.share",
            format!("run:{run_id}"),
            json!({}),
            ip,
        ),
    )
    .await;
    Ok(Json(json!({"token": token})))
}

pub async fn unshare_run(
    State(state): State<AppState>,
    user: AuthUser,
    Path(run_id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    get_run_for_user(&state, &user, run_id).await?;
    db::clear_run_share_token(&state.pool, run_id).await?;
    Ok(Json(json!({"ok": true})))
}

async fn build_archive(state: &AppState, run_id: Uuid) -> AppResult<Vec<u8>> {
    let artifacts = db::get_artifacts(&state.pool, run_id).await?;
    let mut cursor = Cursor::new(Vec::new());
    {
        let mut archive = zip::ZipWriter::new(&mut cursor);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for artifact in artifacts {
            let path = safe_artifact_path(state, &artifact.path)?;
            let bytes = fs::read(&path).await?;
            archive
                .start_file(&artifact.name, options)
                .map_err(|e| AppError::internal(format!("failed to add {}: {e}", artifact.name)))?;
            archive.write_all(&bytes).map_err(|e| {
                AppError::internal(format!("failed to write {}: {e}", artifact.name))
            })?;
        }
        archive
            .finish()
            .map_err(|e| AppError::internal(format!("failed to finish archive: {e}")))?;
    }
    Ok(cursor.into_inner())
}

fn archive_response(bytes: Vec<u8>, run_id: Uuid) -> Response {
    let mut response = Response::new(Body::from(bytes));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/zip"),
    );
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!(
            "attachment; filename=\"run-{}.zip\"",
            &run_id.to_string()[..8]
        ))
        .unwrap_or_else(|_| HeaderValue::from_static("attachment")),
    );
    response
}

pub async fn archive(
    State(state): State<AppState>,
    user: AuthUser,
    Path(run_id): Path<Uuid>,
) -> AppResult<Response> {
    get_run_for_user(&state, &user, run_id).await?;
    Ok(archive_response(
        build_archive(&state, run_id).await?,
        run_id,
    ))
}

pub async fn public_detail(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> AppResult<Json<RunDetail>> {
    let mut run = db::get_run_by_share_token(&state.pool, &token).await?;
    run.created_by = None;
    run.share_token = None;
    run.error = None;
    let run_id = run.id;
    let stages = db::get_stages(&state.pool, run_id).await?;
    let artifacts = db::get_artifacts(&state.pool, run_id)
        .await?
        .into_iter()
        .map(|mut artifact| {
            artifact.path.clear();
            artifact
        })
        .collect();
    let journal = db::get_journal(&state.pool, run_id).await?;
    let events = db::get_events(&state.pool, run_id).await?;
    Ok(Json(RunDetail {
        run,
        stages,
        artifacts,
        journal,
        events,
    }))
}

pub async fn public_artifact(
    State(state): State<AppState>,
    Path((token, name)): Path<(String, String)>,
    headers: HeaderMap,
) -> AppResult<Response> {
    let run = db::get_run_by_share_token(&state.pool, &token).await?;
    let artifact = db::get_artifact(&state.pool, run.id, &name).await?;
    let canonical = safe_artifact_path(&state, &artifact.path)?;
    let bytes = fs::read(&canonical).await?;
    Ok(artifact_response(&artifact, bytes, &headers))
}

pub async fn public_archive(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> AppResult<Response> {
    let run = db::get_run_by_share_token(&state.pool, &token).await?;
    Ok(archive_response(
        build_archive(&state, run.id).await?,
        run.id,
    ))
}

fn csv_safe(value: &str) -> String {
    match value.chars().next() {
        Some('=' | '+' | '-' | '@' | '\t' | '\r') => format!("'{}", value),
        _ => value.to_string(),
    }
}

fn parse_control_time(raw: &str, tz: chrono_tz::Tz) -> AppResult<DateTime<Utc>> {
    let raw = raw.trim();
    if let Ok(dt) = DateTime::parse_from_rfc3339(raw) {
        return Ok(dt.with_timezone(&Utc));
    }
    for fmt in [
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%d.%m.%Y %H:%M",
    ] {
        if let Ok(naive) = NaiveDateTime::parse_from_str(raw, fmt) {
            if let Some(dt) = tz.from_local_datetime(&naive).single() {
                return Ok(dt.with_timezone(&Utc));
            }
        }
    }
    for fmt in ["%Y-%m-%d", "%d.%m.%Y"] {
        if let Ok(date) = chrono::NaiveDate::parse_from_str(raw, fmt) {
            let naive = date.and_hms_opt(12, 0, 0).unwrap_or_default();
            if let Some(dt) = tz.from_local_datetime(&naive).single() {
                return Ok(dt.with_timezone(&Utc));
            }
        }
    }
    Err(AppError::BadRequest(
        "control_time must be RFC3339 or YYYY-MM-DDTHH:MM".into(),
    ))
}
