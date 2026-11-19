-- Preserve legacy addresses and all existing financial agreements.
ALTER TABLE zc_technicians ADD COLUMN IF NOT EXISTS operational_base JSONB NOT NULL DEFAULT '{}'::jsonb;
