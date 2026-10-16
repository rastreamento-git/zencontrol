-- Complementary document data from the standalone OS template.
-- Service, appointment and technician remain authoritative fields of zc_orders.
ALTER TABLE zc_orders ADD COLUMN IF NOT EXISTS document_data JSONB NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(document_data)='object');
