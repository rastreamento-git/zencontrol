ALTER TABLE zc_orders ADD COLUMN IF NOT EXISTS travel_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK(travel_fee_cents BETWEEN 0 AND 100000000);
ALTER TABLE zc_requests DROP CONSTRAINT IF EXISTS zc_requests_kind_check;
ALTER TABLE zc_requests ADD CONSTRAINT zc_requests_kind_check CHECK(kind IN ('rate','dispute','stock','expense'));
