CREATE TABLE IF NOT EXISTS zc_sso_codes (
 code_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
 session_version INTEGER NOT NULL, app TEXT NOT NULL CHECK(app IN ('zencontrol','zenfield','stock')),
 challenge TEXT NOT NULL, state TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS zc_sso_codes_expiry ON zc_sso_codes(expires_at);
CREATE TABLE IF NOT EXISTS zc_sso_grants (
 token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
 session_version INTEGER NOT NULL, expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS zc_sso_grants_expiry ON zc_sso_grants(expires_at);
