-- Preserve the existing authorized-extra mode for all previously saved agreements.
ALTER TABLE zc_rates ADD COLUMN travel_policy JSONB NOT NULL DEFAULT '{"mode":"manual","included_meters":0}'::jsonb;
SET CONSTRAINTS zc_orders_parent_order_id_fkey IMMEDIATE;
ALTER TABLE zc_orders ADD COLUMN travel_total_meters INTEGER NOT NULL DEFAULT 0 CHECK(travel_total_meters BETWEEN 0 AND 10000000);
ALTER TABLE zc_orders ADD CONSTRAINT zc_orders_travel_total_exclusive CHECK(travel_total_meters=0 OR (travel_extra_meters=0 AND travel_fee_cents=0));
SET CONSTRAINTS zc_orders_parent_order_id_fkey DEFERRED;
