-- Exact per-event OS links, including removal/reuse/reinstallation of the same serial.
-- Older events remain unlinked; do not infer a service from a serial alone.
ALTER TABLE eventos_seriais ADD COLUMN IF NOT EXISTS zen_source TEXT NOT NULL DEFAULT '';
ALTER TABLE eventos_seriais ADD COLUMN IF NOT EXISTS zen_order_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS eventos_tecnico_history_idx ON eventos_seriais(tecnico_id,data DESC,id DESC);
CREATE INDEX IF NOT EXISTS zencontrol_installations_technician_idx ON zencontrol_installations(technician_id);
