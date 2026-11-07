use std::sync::OnceLock;

use prometheus::{Encoder, HistogramVec, IntCounterVec, IntGauge, Registry, TextEncoder};
use tracing_subscriber::EnvFilter;

static METRICS: OnceLock<Metrics> = OnceLock::new();

pub struct Metrics {
    pub registry: Registry,
    pub http_requests: IntCounterVec,
    pub http_latency: HistogramVec,
    pub llm_calls: IntCounterVec,
    pub llm_tokens: IntCounterVec,
    pub kafka_events: IntCounterVec,
    pub runs: IntCounterVec,
    pub fetch_errors: IntCounterVec,
    pub active_runs: IntGauge,
}

pub fn init_tracing(log_json: bool) {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,news_shared=debug"));
    let builder = tracing_subscriber::fmt().with_env_filter(filter);
    if log_json {
        builder.json().with_current_span(true).init();
    } else {
        builder.init();
    }
}

pub fn init_metrics() -> &'static Metrics {
    METRICS.get_or_init(|| {
        let registry = Registry::new();
        let http_requests = IntCounterVec::new(
            prometheus::Opts::new("http_requests_total", "HTTP requests"),
            &["method", "path", "status"],
        )
        .expect("metric");
        let http_latency = HistogramVec::new(
            prometheus::HistogramOpts::new("http_request_duration_seconds", "HTTP latency"),
            &["method", "path"],
        )
        .expect("metric");
        let llm_calls = IntCounterVec::new(
            prometheus::Opts::new("llm_calls_total", "LLM calls"),
            &["purpose", "status"],
        )
        .expect("metric");
        let llm_tokens = IntCounterVec::new(
            prometheus::Opts::new("llm_tokens_total", "LLM tokens"),
            &["kind"],
        )
        .expect("metric");
        let kafka_events = IntCounterVec::new(
            prometheus::Opts::new("kafka_events_total", "Kafka events"),
            &["topic", "status"],
        )
        .expect("metric");
        let runs = IntCounterVec::new(
            prometheus::Opts::new("runs_total", "Pipeline runs"),
            &["status"],
        )
        .expect("metric");
        let fetch_errors = IntCounterVec::new(
            prometheus::Opts::new("fetch_errors_total", "Source fetch errors"),
            &["source"],
        )
        .expect("metric");
        let active_runs = IntGauge::new("active_runs", "Currently active runs").expect("metric");

        for metric in [
            Box::new(http_requests.clone()) as Box<dyn prometheus::core::Collector>,
            Box::new(http_latency.clone()),
            Box::new(llm_calls.clone()),
            Box::new(llm_tokens.clone()),
            Box::new(kafka_events.clone()),
            Box::new(runs.clone()),
            Box::new(fetch_errors.clone()),
            Box::new(active_runs.clone()),
        ] {
            registry.register(metric).expect("register metric");
        }

        Metrics {
            registry,
            http_requests,
            http_latency,
            llm_calls,
            llm_tokens,
            kafka_events,
            runs,
            fetch_errors,
            active_runs,
        }
    })
}

pub fn render_metrics() -> String {
    let metrics = init_metrics();
    let encoder = TextEncoder::new();
    let mut buffer = Vec::new();
    if encoder
        .encode(&metrics.registry.gather(), &mut buffer)
        .is_err()
    {
        return String::new();
    }
    String::from_utf8(buffer).unwrap_or_default()
}

pub fn metrics() -> &'static Metrics {
    init_metrics()
}
