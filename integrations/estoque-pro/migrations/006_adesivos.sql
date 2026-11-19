CREATE TABLE adesivo_saldos (
 id SERIAL PRIMARY KEY, titular TEXT NOT NULL UNIQUE, tecnico_id INTEGER UNIQUE REFERENCES tecnicos(id), quantidade INTEGER NOT NULL DEFAULT 0 CHECK(quantidade>=0),
 CHECK((titular='MATRIZ' AND tecnico_id IS NULL) OR (tecnico_id IS NOT NULL AND titular='TECNICO:'||tecnico_id::text))
);
CREATE TABLE adesivo_movimentos (
 id BIGSERIAL PRIMARY KEY, tecnico_id INTEGER REFERENCES tecnicos(id), tipo TEXT NOT NULL CHECK(tipo IN ('ENTRADA','TRANSFERENCIA','DEVOLUCAO','APLICACAO')),
 quantidade INTEGER NOT NULL CHECK(quantidade>0), operador TEXT NOT NULL, order_id TEXT NOT NULL DEFAULT '', source_system TEXT NOT NULL DEFAULT '',
 idempotency_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL, data TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
