ALTER TABLE runs ADD COLUMN IF NOT EXISTS policies JSONB NOT NULL
    DEFAULT '{"dedup": true, "injection_guard": true, "neutral": true}'::jsonb;
