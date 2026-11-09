CREATE TABLE IF NOT EXISTS runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    mode TEXT NOT NULL CHECK (mode IN ('live', 'file')),
    control_time TIMESTAMPTZ NOT NULL,
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    prompt_version TEXT NOT NULL DEFAULT 'v1',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    error TEXT,
    stats JSONB NOT NULL DEFAULT '{}'::jsonb,
    interval_hours INTEGER NOT NULL DEFAULT 24,
    max_items INTEGER NOT NULL DEFAULT 5,
    parent_run_id UUID REFERENCES runs(id) ON DELETE SET NULL,
    source_ids UUID[] NOT NULL DEFAULT '{}',
    policies JSONB NOT NULL
        DEFAULT '{"dedup": true, "injection_guard": true, "neutral": true}'::jsonb,
    share_token TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_parent ON runs(parent_run_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_share_token
    ON runs(share_token) WHERE share_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS run_stages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    stage TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    message TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_run_stages_run ON run_stages(run_id);
