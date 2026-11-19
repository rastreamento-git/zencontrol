ALTER TABLE zc_orders ADD COLUMN sga_check JSONB NOT NULL DEFAULT '{}';
ALTER TABLE zc_orders ADD COLUMN proposed_scheduled_at TEXT NOT NULL DEFAULT '';
ALTER TABLE zc_orders ADD COLUMN sticker_discount_opt_in BOOLEAN NOT NULL DEFAULT false;
