ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_papel_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_papel_check CHECK(papel IN ('admin','operador','tecnico'));
ALTER TABLE zc_technicians ADD COLUMN IF NOT EXISTS stock_technician_id INTEGER UNIQUE;
CREATE TABLE IF NOT EXISTS zc_technician_accounts (
 user_id INTEGER PRIMARY KEY REFERENCES usuarios(id),
 technician_id INTEGER NOT NULL REFERENCES zc_technicians(id)
);
ALTER TABLE zc_orders ADD COLUMN IF NOT EXISTS workflow_mode TEXT NOT NULL DEFAULT 'legacy' CHECK(workflow_mode IN ('legacy','controlled'));
ALTER TABLE zc_orders ADD COLUMN IF NOT EXISTS stock_sync_state TEXT NOT NULL DEFAULT '';
ALTER TABLE zc_orders ADD COLUMN IF NOT EXISTS stock_receipt JSONB;
ALTER TABLE zc_batches ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'whatsapp';
ALTER TABLE zc_batches ADD COLUMN IF NOT EXISTS source_user_id INTEGER REFERENCES usuarios(id);
ALTER TABLE zc_batches ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE zc_batches ADD COLUMN IF NOT EXISTS order_version INTEGER;
ALTER TABLE zc_batches ADD COLUMN IF NOT EXISTS order_snapshot JSONB NOT NULL DEFAULT '{}';
ALTER TABLE zc_batches ADD COLUMN IF NOT EXISTS submitted_at TEXT NOT NULL DEFAULT '';
ALTER TABLE zc_batches ADD COLUMN IF NOT EXISTS reviewed_at TEXT NOT NULL DEFAULT '';
ALTER TABLE zc_batches ADD COLUMN IF NOT EXISTS rejection_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE zc_batches ADD COLUMN IF NOT EXISTS approval_payload JSONB;
ALTER TABLE zc_evidence ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'other';
ALTER TABLE zc_evidence ADD COLUMN IF NOT EXISTS serial_code TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS zc_active_portal_submission ON zc_batches(order_id) WHERE source='portal' AND state IN ('draft','submitted','approved_sync','stock_failed');
CREATE TABLE IF NOT EXISTS zc_service_rules (
 service TEXT PRIMARY KEY,
 stock_action TEXT NOT NULL CHECK(stock_action IN ('install','none')),
 min_serials INTEGER NOT NULL DEFAULT 0 CHECK(min_serials BETWEEN 0 AND 20),
 required_photos JSONB NOT NULL,
 version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO zc_service_rules(service,stock_action,min_serials,required_photos) VALUES
 ('Instalação','install',1,'[{"kind":"vehicle","label":"Placa ou chassi","min":1},{"kind":"label","label":"Etiqueta do equipamento","min":1},{"kind":"installed","label":"Equipamento instalado","min":1}]'),
 ('Reinstalação','install',1,'[{"kind":"vehicle","label":"Placa ou chassi","min":1},{"kind":"label","label":"Etiqueta do equipamento","min":1},{"kind":"installed","label":"Equipamento instalado","min":1}]'),
 ('Manutenção','none',0,'[{"kind":"vehicle","label":"Placa ou chassi","min":1},{"kind":"service","label":"Serviço realizado","min":1}]'),
 ('Retirada','none',0,'[{"kind":"vehicle","label":"Placa ou chassi","min":1},{"kind":"service","label":"Serviço realizado","min":1}]'),
 ('Improdutiva','none',0,'[{"kind":"vehicle","label":"Placa ou chassi","min":1},{"kind":"service","label":"Evidência do atendimento","min":1}]'),
 ('Visita','none',0,'[{"kind":"vehicle","label":"Placa ou chassi","min":1},{"kind":"service","label":"Evidência do atendimento","min":1}]')
 ON CONFLICT(service) DO NOTHING;
