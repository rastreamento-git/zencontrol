CREATE TABLE IF NOT EXISTS zencontrol_installations (
 id TEXT PRIMARY KEY,
 idempotency_key TEXT NOT NULL UNIQUE,
 source_system TEXT NOT NULL,
 order_id TEXT NOT NULL,
 submission_id TEXT NOT NULL,
 technician_id INTEGER NOT NULL REFERENCES tecnicos(id),
 request_hash TEXT NOT NULL,
 result JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(source_system,order_id)
);
