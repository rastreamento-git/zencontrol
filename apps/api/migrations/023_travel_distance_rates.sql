-- Distância extra autorizada pela central e valor por km versionado com as tarifas.
-- Registros financeiros anteriores permanecem intactos.
ALTER TABLE zc_rates ADD COLUMN IF NOT EXISTS travel_km_cents INTEGER NOT NULL DEFAULT 0 CHECK(travel_km_cents BETWEEN 0 AND 100000);
ALTER TABLE zc_orders ADD COLUMN IF NOT EXISTS travel_extra_meters INTEGER NOT NULL DEFAULT 0 CHECK(travel_extra_meters BETWEEN 0 AND 10000000);
ALTER TABLE zc_orders ADD CONSTRAINT zc_orders_travel_one_mode CHECK(travel_extra_meters=0 OR travel_fee_cents=0);
