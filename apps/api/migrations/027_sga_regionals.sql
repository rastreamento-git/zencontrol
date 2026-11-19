CREATE TABLE IF NOT EXISTS zc_sga_regionals (
  sga_code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sga_status TEXT NOT NULL DEFAULT '',
  sga_synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
