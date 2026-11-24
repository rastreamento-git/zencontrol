CREATE TABLE zc_sga_intake_config (
 id INTEGER PRIMARY KEY CHECK(id=1), enabled BOOLEAN NOT NULL DEFAULT false,
 daily_time TEXT NOT NULL DEFAULT '18:00', pending_kind TEXT NOT NULL DEFAULT 'classifications',
 pending_code TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1,
 updated_at TEXT NOT NULL DEFAULT '', updated_by TEXT NOT NULL DEFAULT ''
);
CREATE TABLE zc_sga_intake_runs (
 id TEXT PRIMARY KEY, run_key TEXT UNIQUE NOT NULL, day TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('queued','running','completed','failed')),
 config JSONB NOT NULL, actor TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
 started_at BIGINT NOT NULL DEFAULT 0, available_at BIGINT NOT NULL DEFAULT 0,
 finished_at TEXT NOT NULL DEFAULT '', summary JSONB NOT NULL DEFAULT '{}',
 message TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE TABLE zc_sga_intake (
 id TEXT PRIMARY KEY, sga_vehicle_id TEXT NOT NULL UNIQUE,
 customer_key TEXT NOT NULL, vehicle_key TEXT NOT NULL,
 customer_name TEXT NOT NULL, vehicle TEXT NOT NULL, chassis TEXT NOT NULL DEFAULT '',
 movement_at TEXT NOT NULL, received_at TEXT NOT NULL, run_id TEXT NOT NULL REFERENCES zc_sga_intake_runs(id),
 data JSONB NOT NULL, raw_source JSONB NOT NULL,
 order_id TEXT REFERENCES zc_orders(id), assigned_at TEXT NOT NULL DEFAULT '', assigned_by TEXT NOT NULL DEFAULT '',
 UNIQUE(customer_key,vehicle_key)
);
CREATE INDEX zc_sga_intake_queue ON zc_sga_intake(received_at DESC) WHERE order_id IS NULL;
CREATE INDEX zc_sga_intake_runs_queue ON zc_sga_intake_runs(state,available_at);
