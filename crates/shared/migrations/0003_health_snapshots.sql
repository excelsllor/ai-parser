CREATE TABLE IF NOT EXISTS health_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    database_ok BOOLEAN NOT NULL,
    redis_ok BOOLEAN NOT NULL,
    redis_latency_ms BIGINT,
    kafka_ok BOOLEAN NOT NULL,
    llm_ok BOOLEAN NOT NULL,
    registry_alive INTEGER NOT NULL DEFAULT 0,
    registry_total INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_health_snapshots_checked ON health_snapshots(checked_at DESC);
