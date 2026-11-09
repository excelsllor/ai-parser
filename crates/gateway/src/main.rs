mod grpc_client;
mod handlers;
mod middleware;
mod state;

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::DefaultBodyLimit;
use axum::http::header::{AUTHORIZATION, CONTENT_DISPOSITION, CONTENT_TYPE};
use axum::http::{HeaderValue, Method, StatusCode};
use axum::middleware as axum_mw;
use axum::routing::{any, delete, get, post, put};
use axum::Router;
use news_shared::bus::KafkaBus;
use news_shared::config::Config;
use news_shared::db;
use news_shared::error::AppResult;
use news_shared::llm::LlmClient;
use news_shared::redis_cache::RedisCache;
use news_shared::telemetry::{init_metrics, init_tracing};
use tower_http::compression::CompressionLayer;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::TraceLayer;

use crate::state::AppState;

#[tokio::main]
async fn main() -> AppResult<()> {
    let config = Arc::new(Config::from_env()?);
    init_tracing(config.log_json);
    init_metrics();

    tracing::info!(
        env = %config.env_name,
        bind = %config.bind_addr,
        model = %config.llm.model,
        "starting news digest gateway"
    );

    tokio::fs::create_dir_all(&config.data_dir).await?;
    news_shared::registry::spawn_heartbeat(config.data_dir.clone(), "gateway");

    let pool = db::init_db(&config).await?;
    let redis = RedisCache::new(&config.redis_url).await?;
    let bus = KafkaBus::new(&config)?;
    let llm = LlmClient::new(&config.llm, Some(redis.clone()))?;
    let state = AppState::new(config.clone(), pool, redis, bus, llm);

    spawn_token_cleanup(state.clone());
    spawn_health_sampler(state.clone());

    let app = build_router(state);

    let listener = tokio::net::TcpListener::bind(config.bind_addr).await?;
    tracing::info!(addr = %config.bind_addr, "gateway listening");
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await
    .map_err(|e| news_shared::AppError::internal(format!("server failed: {e}")))?;

    Ok(())
}

fn build_router(state: AppState) -> Router {
    let cors = build_cors(&state.config);

    let public = Router::new()
        .route("/api/health", get(handlers::health::health))
        .route("/api/auth/status", get(handlers::auth::status))
        .route("/api/auth/providers", get(handlers::oauth::providers))
        .route(
            "/api/auth/oauth/{provider}/start",
            post(handlers::oauth::start),
        )
        .route(
            "/api/auth/oauth/{provider}/callback",
            post(handlers::oauth::callback),
        )
        .route("/api/auth/login", post(handlers::auth::login))
        .route("/api/auth/register", post(handlers::auth::register))
        .route(
            "/api/auth/password/forgot",
            post(handlers::auth::forgot_password),
        )
        .route(
            "/api/auth/password/reset",
            post(handlers::auth::reset_password),
        )
        .route(
            "/api/auth/email/confirm",
            post(handlers::auth::confirm_email),
        )
        .route("/api/auth/refresh", post(handlers::auth::refresh))
        .route("/api/auth/logout", post(handlers::auth::logout))
        .route(
            "/api/public/runs/{token}",
            get(handlers::runs::public_detail),
        )
        .route(
            "/api/public/runs/{token}/archive",
            get(handlers::runs::public_archive),
        )
        .route(
            "/api/public/runs/{token}/artifacts/{name}",
            get(handlers::runs::public_artifact),
        )
        .route("/metrics", get(handlers::health::metrics))
        .route("/api/ready", get(handlers::health::ready));

    let protected = Router::new()
        .route(
            "/api/auth/me",
            get(handlers::auth::me).patch(handlers::auth::update_profile),
        )
        .route("/api/auth/password", post(handlers::auth::change_password))
        .route("/api/auth/email/verify", post(handlers::auth::verify_email))
        .route(
            "/api/auth/email/request",
            post(handlers::auth::request_email_verification),
        )
        .route("/api/auth/sessions", get(handlers::auth::list_sessions))
        .route(
            "/api/auth/sessions/revoke-others",
            post(handlers::auth::revoke_other_sessions),
        )
        .route(
            "/api/auth/sessions/{id}",
            delete(handlers::auth::revoke_session),
        )
        .route(
            "/api/runs",
            get(handlers::runs::list).post(handlers::runs::create),
        )
        .route(
            "/api/runs/{id}",
            get(handlers::runs::detail).delete(handlers::runs::delete),
        )
        .route(
            "/api/runs/{id}/status",
            get(handlers::runs::status).patch(handlers::runs::set_status),
        )
        .route("/api/runs/{id}/cancel", post(handlers::runs::cancel))
        .route("/api/runs/{id}/rerun", post(handlers::runs::rerun))
        .route("/api/runs/{id}/archive", get(handlers::runs::archive))
        .route(
            "/api/runs/{id}/title",
            axum::routing::patch(handlers::runs::rename),
        )
        .route(
            "/api/runs/{id}/share",
            post(handlers::runs::share_run).delete(handlers::runs::unshare_run),
        )
        .route(
            "/api/runs/{id}/artifacts/{name}",
            get(handlers::runs::artifact),
        )
        .route(
            "/api/runs/{id}/journal.csv",
            get(handlers::runs::journal_csv),
        )
        .route("/api/runs/{id}/items", post(handlers::runs::add_item))
        .route(
            "/api/runs/{id}/email/preview",
            get(handlers::runs::email_preview),
        )
        .route("/api/runs/{id}/checks", get(handlers::runs::checks))
        .route("/api/sources", get(handlers::runs::sources_list))
        .route(
            "/api/runs/{id}/email/send",
            post(handlers::runs::email_send),
        )
        .route(
            "/api/runs/{id}/telegram/send",
            post(handlers::telegram::send_run),
        )
        .route(
            "/api/admin/users",
            get(handlers::admin::list_users).post(handlers::admin::create_user),
        )
        .route(
            "/api/admin/users/{id}",
            put(handlers::admin::update_user).delete(handlers::admin::delete_user),
        )
        .route(
            "/api/admin/sources",
            get(handlers::admin::list_sources).post(handlers::admin::create_source),
        )
        .route(
            "/api/admin/sources/{id}",
            put(handlers::admin::toggle_source).delete(handlers::admin::delete_source),
        )
        .route(
            "/api/admin/keywords",
            get(handlers::admin::list_keywords).post(handlers::admin::create_keyword),
        )
        .route(
            "/api/admin/keywords/{id}",
            axum::routing::delete(handlers::admin::delete_keyword),
        )
        .route(
            "/api/admin/settings",
            get(handlers::admin::get_settings).put(handlers::admin::put_setting),
        )
        .route("/api/admin/llm/models", get(handlers::admin::llm_models))
        .route(
            "/api/admin/telegram/test",
            post(handlers::telegram::test_bot),
        )
        .route(
            "/api/admin/telegram/sync",
            post(handlers::telegram::sync_subscribers),
        )
        .route(
            "/api/admin/telegram/subscribers",
            get(handlers::telegram::list_subscribers),
        )
        .route(
            "/api/admin/telegram/subscribers/{chat_id}",
            put(handlers::telegram::set_subscriber_active),
        )
        .route("/api/admin/audit", get(handlers::admin::audit))
        .route("/api/admin/metrics", get(handlers::admin::metrics))
        .route(
            "/api/admin/health/history",
            get(handlers::admin::health_history),
        )
        .route(
            "/api/admin/debug/services",
            get(handlers::admin::debug_services),
        )
        .route("/api/admin/debug/kafka", get(handlers::admin::debug_kafka))
        .route("/api/admin/debug/redis", get(handlers::admin::debug_redis))
        .route(
            "/api/admin/debug/llm-calls",
            get(handlers::admin::debug_llm_calls),
        )
        .route(
            "/api/admin/debug/runs/{id}",
            get(handlers::admin::debug_run),
        )
        .route_layer(axum_mw::from_fn_with_state(
            state.clone(),
            middleware::auth_middleware,
        ));

    let api = public
        .merge(protected)
        .route("/api/{*rest}", any(handlers::health::api_not_found))
        .layer(axum_mw::from_fn(middleware::metrics_middleware))
        .layer(axum_mw::from_fn_with_state(
            state.clone(),
            middleware::rate_limit_middleware,
        ));

    let frontend_dir = state.config.frontend_dir.clone();
    let index_file = frontend_dir.join("index.html");
    let static_files = ServeDir::new(&frontend_dir).fallback(ServeFile::new(index_file));

    Router::new()
        .merge(api)
        .fallback_service(static_files)
        .layer(axum_mw::from_fn(news_shared::security::security_headers))
        .layer(axum_mw::from_fn_with_state(
            state.clone(),
            middleware::client_ip_middleware,
        ))
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http())
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            Duration::from_secs(300),
        ))
        .layer(DefaultBodyLimit::max(64 * 1024 * 1024))
        .layer(cors)
        .with_state(state)
}

fn build_cors(config: &Config) -> CorsLayer {
    let origins = config
        .cors_origins
        .iter()
        .filter_map(|origin| origin.parse::<HeaderValue>().ok())
        .collect::<Vec<_>>();

    let cors = CorsLayer::new()
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([AUTHORIZATION, CONTENT_TYPE])
        .expose_headers([CONTENT_DISPOSITION])
        .max_age(Duration::from_secs(3600));

    if origins.is_empty() {
        cors
    } else {
        cors.allow_origin(AllowOrigin::list(origins))
    }
}

fn spawn_token_cleanup(state: AppState) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(6 * 60 * 60));
        loop {
            interval.tick().await;
            if let Err(e) =
                sqlx::query("DELETE FROM refresh_tokens WHERE expires_at < now() OR revoked = TRUE")
                    .execute(&state.pool)
                    .await
            {
                tracing::warn!(error = %e, "refresh token cleanup failed");
            }
        }
    });
}

fn spawn_health_sampler(state: AppState) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        loop {
            interval.tick().await;
            let database_ok = news_shared::db::db_ping(&state.pool).await;
            let redis_latency = state.redis.health_latency().await;
            let kafka_ok = state.bus.health().await;
            let llm_base_url = news_shared::db::get_setting(&state.pool, "llm_base_url")
                .await
                .ok()
                .flatten()
                .and_then(|value| value.as_str().map(ToOwned::to_owned))
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| state.config.llm.base_url.clone());
            let llm_ok = state.llm.health_at(&llm_base_url).await;
            let registry = news_shared::registry::read_services(&state.config.data_dir);
            let registry_alive = registry.iter().filter(|service| service.alive).count();

            if let Err(error) = sqlx::query(
                "INSERT INTO health_snapshots
                    (database_ok, redis_ok, redis_latency_ms, kafka_ok, llm_ok,
                     registry_alive, registry_total)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)",
            )
            .bind(database_ok)
            .bind(redis_latency.is_some())
            .bind(redis_latency.map(|value| value.as_millis() as i64))
            .bind(kafka_ok)
            .bind(llm_ok)
            .bind(registry_alive as i32)
            .bind(registry.len() as i32)
            .execute(&state.pool)
            .await
            {
                tracing::warn!(error = %error, "health snapshot insert failed");
            }

            let _ = sqlx::query(
                "DELETE FROM health_snapshots WHERE checked_at < now() - interval '7 days'",
            )
            .execute(&state.pool)
            .await;
        }
    });
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("shutdown signal received");
}
