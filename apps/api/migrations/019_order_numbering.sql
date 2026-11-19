CREATE TABLE zc_order_counters (
 day DATE PRIMARY KEY,
 last_value INTEGER NOT NULL CHECK (last_value BETWEEN 1 AND 4095)
);
