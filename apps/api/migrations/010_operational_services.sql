CREATE TABLE IF NOT EXISTS zc_operational_services (
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL DEFAULT 'blocking' CHECK(kind='blocking'),
 provider TEXT NOT NULL DEFAULT 'Rede Veículo' CHECK(provider='Rede Veículo'),
 order_id TEXT REFERENCES zc_orders(id),
 vehicle TEXT NOT NULL,
 customer_name TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'registered' CHECK(status IN ('registered','in_progress','completed','cancelled')),
 notes TEXT NOT NULL DEFAULT '',
 provider_reference TEXT NOT NULL DEFAULT '',
 created_by TEXT NOT NULL, updated_by TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 completed_at TIMESTAMPTZ,
 version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS zc_operational_inbox ON zc_operational_services(status,created_at DESC);
CREATE INDEX IF NOT EXISTS zc_operational_vehicle ON zc_operational_services(vehicle);
