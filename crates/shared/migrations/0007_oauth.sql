CREATE TABLE IF NOT EXISTS oauth_identities (
    provider TEXT NOT NULL CHECK (provider IN ('yandex', 'vk')),
    provider_user_id TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, provider_user_id)
);
CREATE INDEX IF NOT EXISTS idx_oauth_identities_user ON oauth_identities(user_id);
