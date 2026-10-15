CREATE TABLE IF NOT EXISTS usuarios (
 id SERIAL PRIMARY KEY,
 login TEXT NOT NULL UNIQUE,
 nome TEXT NOT NULL,
 senha_hash TEXT NOT NULL,
 papel TEXT NOT NULL DEFAULT 'operador' CHECK (papel IN ('admin','operador')),
 ativo BOOLEAN NOT NULL DEFAULT true,
 versao_sessao INTEGER NOT NULL DEFAULT 1,
 criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS zc_technicians (
 id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, phone TEXT NOT NULL DEFAULT '',
 address TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '',
 receive_group TEXT NOT NULL DEFAULT '', receive_group_name TEXT NOT NULL DEFAULT '',
 send_group TEXT NOT NULL DEFAULT '', send_group_name TEXT NOT NULL DEFAULT '',
 price_install INTEGER NOT NULL DEFAULT 0, price_maintenance INTEGER NOT NULL DEFAULT 0,
 price_removal INTEGER NOT NULL DEFAULT 0, price_visit INTEGER NOT NULL DEFAULT 0,
 extra_info JSONB NOT NULL DEFAULT '{}', active BOOLEAN NOT NULL DEFAULT true, version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS zc_volunteers (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, sga_code TEXT NOT NULL DEFAULT '');

CREATE TABLE IF NOT EXISTS zc_orders (
 id TEXT PRIMARY KEY, legacy_id TEXT NOT NULL DEFAULT '', created_date TEXT NOT NULL,
 service TEXT NOT NULL, customer_name TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '',
 vehicle TEXT NOT NULL, chassis TEXT NOT NULL DEFAULT '', fipe_value TEXT NOT NULL DEFAULT '',
 fipe_risk TEXT NOT NULL DEFAULT '', volunteer TEXT NOT NULL DEFAULT '', imei TEXT NOT NULL DEFAULT '',
 term TEXT NOT NULL DEFAULT '', completed_at TEXT NOT NULL DEFAULT '', technician_id INTEGER REFERENCES zc_technicians(id),
 technician_name TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL DEFAULT '',
 closed_by TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, shift TEXT NOT NULL DEFAULT '', scheduled_at TEXT NOT NULL DEFAULT '',
 notes TEXT NOT NULL DEFAULT '', sga_classification TEXT NOT NULL DEFAULT '', sga_status TEXT NOT NULL DEFAULT '',
 sga_id TEXT NOT NULL DEFAULT '', legacy_status TEXT NOT NULL DEFAULT '', raw_legacy JSONB NOT NULL DEFAULT '[]',
 archive TEXT NOT NULL DEFAULT 'HOT' CHECK(archive IN ('HOT','WARM','COLD')),
 dispatched_at TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1,
 updated_at TEXT NOT NULL, deleted_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS zc_order_extras (
 id SERIAL PRIMARY KEY, order_id TEXT NOT NULL REFERENCES zc_orders(id), type TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '', legacy_key TEXT UNIQUE, amount_cents INTEGER NOT NULL CHECK(amount_cents>=0)
);

CREATE TABLE IF NOT EXISTS zc_settlements (
 id TEXT PRIMARY KEY, technician_id INTEGER NOT NULL REFERENCES zc_technicians(id), start_date TEXT NOT NULL,
 end_date TEXT NOT NULL, total_cents INTEGER NOT NULL, snapshot JSONB NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS zc_settlement_orders (order_id TEXT PRIMARY KEY REFERENCES zc_orders(id), settlement_id TEXT NOT NULL REFERENCES zc_settlements(id));

CREATE TABLE IF NOT EXISTS zc_legacy_finance (source_key TEXT PRIMARY KEY, payload JSONB NOT NULL);

CREATE TABLE IF NOT EXISTS zc_audit (
 id SERIAL PRIMARY KEY, created_at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
 entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, detail JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS zc_jobs (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, order_id TEXT REFERENCES zc_orders(id), payload JSONB NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, available_at DOUBLE PRECISION NOT NULL DEFAULT 0,
 started_at DOUBLE PRECISION, finished_at TEXT, last_error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
 idempotency_key TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS zc_webhook_events (message_id TEXT PRIMARY KEY, received_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS zc_wa_sessions (session_key TEXT PRIMARY KEY, payload JSONB NOT NULL, updated_at DOUBLE PRECISION NOT NULL);

CREATE TABLE IF NOT EXISTS zc_batches (
 id TEXT PRIMARY KEY, order_id TEXT REFERENCES zc_orders(id), technician_id INTEGER NOT NULL REFERENCES zc_technicians(id),
 sender TEXT NOT NULL, vehicle TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', state TEXT NOT NULL,
 expected_count INTEGER NOT NULL DEFAULT 0, hub BOOLEAN NOT NULL DEFAULT false, imeis JSONB NOT NULL DEFAULT '[]',
 created_at TEXT NOT NULL, reviewed_by TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '',
 sga_uploaded_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS zc_evidence (
 id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES zc_batches(id), message_id TEXT NOT NULL,
 path TEXT NOT NULL DEFAULT '', mime TEXT NOT NULL DEFAULT '', sha256 TEXT NOT NULL DEFAULT '',
 state TEXT NOT NULL DEFAULT 'pending', original_path TEXT NOT NULL DEFAULT '', UNIQUE(batch_id,message_id)
);

CREATE TABLE IF NOT EXISTS zc_migration_runs (fingerprint TEXT PRIMARY KEY, source TEXT NOT NULL, summary JSONB NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS zc_orders_filter ON zc_orders(deleted_at,archive,status,scheduled_at);
CREATE INDEX IF NOT EXISTS zc_orders_vehicle ON zc_orders(vehicle,technician_id);
CREATE INDEX IF NOT EXISTS zc_jobs_pending ON zc_jobs(state,available_at);
CREATE UNIQUE INDEX IF NOT EXISTS zc_technicians_name_ci ON zc_technicians(translate(name,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'));
CREATE UNIQUE INDEX IF NOT EXISTS zc_volunteers_name_ci ON zc_volunteers(translate(name,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'));
