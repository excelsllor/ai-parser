ALTER TABLE runs ADD COLUMN IF NOT EXISTS share_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_runs_share_token
    ON runs(share_token) WHERE share_token IS NOT NULL;
