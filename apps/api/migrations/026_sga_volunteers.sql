ALTER TABLE zc_volunteers ADD COLUMN IF NOT EXISTS sga_status TEXT NOT NULL DEFAULT '';
ALTER TABLE zc_volunteers ADD COLUMN IF NOT EXISTS sga_synced_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS zc_volunteers_sga_code_idx ON zc_volunteers(sga_code);
