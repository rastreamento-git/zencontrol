ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS activation_required BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS zc_activations (
 user_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
 code_hash TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ,
 created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS zc_auth_events (
 id TEXT PRIMARY KEY, user_id INTEGER, event TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS zc_notifications (
 id TEXT PRIMARY KEY, audience TEXT NOT NULL CHECK(audience IN ('central','technician')),
 technician_id INTEGER REFERENCES zc_technicians(id), event_key TEXT NOT NULL,
 title TEXT NOT NULL, detail JSONB NOT NULL DEFAULT '{}', target TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), read_at TIMESTAMPTZ,
 UNIQUE(audience,event_key,technician_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS zc_notice_central_dedup ON zc_notifications(event_key) WHERE audience='central';
CREATE INDEX IF NOT EXISTS zc_notice_inbox ON zc_notifications(audience,technician_id,created_at DESC);
CREATE TABLE IF NOT EXISTS zc_notification_reads (
 notification_id TEXT REFERENCES zc_notifications(id) ON DELETE CASCADE, user_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
 read_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(notification_id,user_id)
);
ALTER TABLE zc_orders ADD COLUMN IF NOT EXISTS executed_on TEXT NOT NULL DEFAULT '';
ALTER TABLE zc_orders ADD COLUMN IF NOT EXISTS execution_finished_at TEXT NOT NULL DEFAULT '';
ALTER TABLE zc_orders ADD COLUMN IF NOT EXISTS conference_started_at TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS zc_rates (
 id TEXT PRIMARY KEY, technician_id INTEGER NOT NULL REFERENCES zc_technicians(id), effective_on TEXT NOT NULL,
 prices JSONB NOT NULL, created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(technician_id,effective_on)
);
INSERT INTO zc_rates(id,technician_id,effective_on,prices,created_by)
 SELECT 'initial-'||id,id,'1900-01-01',jsonb_build_object('Instalação',price_install,'Reinstalação',price_install,'Manutenção',price_maintenance,'Retirada',price_removal,'Visita',price_visit,'Improdutiva',price_visit),'migration-005'
 FROM zc_technicians ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS zc_closing_policies (
 technician_id INTEGER PRIMARY KEY REFERENCES zc_technicians(id), policy JSONB NOT NULL,
 version INTEGER NOT NULL DEFAULT 1, updated_by TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS zc_holidays (day TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS zc_financial_ledger (
 order_id TEXT PRIMARY KEY REFERENCES zc_orders(id), technician_id INTEGER NOT NULL REFERENCES zc_technicians(id),
 executed_on TEXT NOT NULL, rate_id TEXT NOT NULL REFERENCES zc_rates(id), base_cents INTEGER NOT NULL CHECK(base_cents>=0),
 extras JSONB NOT NULL DEFAULT '[]', total_cents INTEGER NOT NULL CHECK(total_cents>=0),
 state TEXT NOT NULL DEFAULT 'awaiting_approval', eligible_on TEXT NOT NULL DEFAULT '',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS zc_ledger_eligible ON zc_financial_ledger(technician_id,state,eligible_on,executed_on);
CREATE TABLE IF NOT EXISTS zc_requests (
 id TEXT PRIMARY KEY, technician_id INTEGER NOT NULL REFERENCES zc_technicians(id),
 kind TEXT NOT NULL CHECK(kind IN ('rate','dispute','stock')), order_id TEXT REFERENCES zc_orders(id),
 state TEXT NOT NULL DEFAULT 'pending', proposed JSONB NOT NULL, counterproposal JSONB,
 reason TEXT NOT NULL, history JSONB NOT NULL DEFAULT '[]', version INTEGER NOT NULL DEFAULT 1,
 request_key TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS zc_requests_inbox ON zc_requests(technician_id,created_at DESC);
CREATE TABLE IF NOT EXISTS zc_adjustments (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES zc_orders(id), amount_cents INTEGER NOT NULL,
 reason TEXT NOT NULL, created_by TEXT NOT NULL, request_id TEXT UNIQUE REFERENCES zc_requests(id),
 settlement_id TEXT REFERENCES zc_settlements(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE zc_settlements ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'legacy_unverified';
ALTER TABLE zc_settlements ALTER COLUMN state SET DEFAULT 'approved';
ALTER TABLE zc_settlements ADD COLUMN IF NOT EXISTS due_on TEXT NOT NULL DEFAULT '';
ALTER TABLE zc_settlements ADD COLUMN IF NOT EXISTS approved_at TEXT NOT NULL DEFAULT '';
ALTER TABLE zc_settlements ADD COLUMN IF NOT EXISTS approved_by TEXT NOT NULL DEFAULT '';
ALTER TABLE zc_settlements ADD COLUMN IF NOT EXISTS request_key TEXT UNIQUE;
CREATE TABLE IF NOT EXISTS zc_payments (
 id TEXT PRIMARY KEY, settlement_id TEXT NOT NULL REFERENCES zc_settlements(id), amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 paid_on TEXT NOT NULL, reference TEXT NOT NULL, receipt_path TEXT NOT NULL DEFAULT '', receipt_mime TEXT NOT NULL DEFAULT '',
 created_by TEXT NOT NULL, request_key TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS zc_payments_closing ON zc_payments(settlement_id,created_at DESC);
CREATE INDEX IF NOT EXISTS zc_orders_technician_history ON zc_orders(technician_id,executed_on,scheduled_at);

ALTER TABLE zc_batches ADD COLUMN IF NOT EXISTS executed_on TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS zc_payment_external_identity ON zc_payments(settlement_id,reference);

CREATE INDEX IF NOT EXISTS zc_requests_pending_idx ON zc_requests(state,created_at DESC);

CREATE INDEX IF NOT EXISTS zc_adjustments_order_idx ON zc_adjustments(order_id,settlement_id);
