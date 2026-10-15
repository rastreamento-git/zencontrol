-- Additive schema migration. It does not delete user records or rebuild existing tables.
CREATE TABLE IF NOT EXISTS produtos (
 id SERIAL PRIMARY KEY, nome TEXT NOT NULL, categoria TEXT NOT NULL DEFAULT 'RASTREADOR',
 quantidade_matriz INTEGER NOT NULL DEFAULT 0 CHECK (quantidade_matriz>=0), estoque_minimo INTEGER NOT NULL DEFAULT 5 CHECK (estoque_minimo>=0)
);
CREATE TABLE IF NOT EXISTS tecnicos (
 id SERIAL PRIMARY KEY, nome TEXT NOT NULL, ativo BOOLEAN NOT NULL DEFAULT true,
 estoque_minimo INTEGER NOT NULL DEFAULT 5 CHECK (estoque_minimo>=0)
);
CREATE TABLE IF NOT EXISTS estoque_tecnicos (
 id SERIAL PRIMARY KEY, tecnico_id INTEGER NOT NULL REFERENCES tecnicos(id), produto_id INTEGER NOT NULL REFERENCES produtos(id),
 quantidade INTEGER NOT NULL DEFAULT 0 CHECK (quantidade>=0), UNIQUE (tecnico_id,produto_id)
);
CREATE TABLE IF NOT EXISTS equipamentos_seriais (
 codigo_serial TEXT PRIMARY KEY, produto_id INTEGER NOT NULL REFERENCES produtos(id), tecnico_id INTEGER REFERENCES tecnicos(id),
 status TEXT NOT NULL DEFAULT 'MATRIZ' CHECK (status IN ('MATRIZ','TECNICO','INSTALADO','TRIAGEM','SUCATA')),
 data_atualizacao TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS movimentacoes (
 id SERIAL PRIMARY KEY, tipo TEXT NOT NULL, produto_id INTEGER REFERENCES produtos(id), tecnico_id INTEGER REFERENCES tecnicos(id),
 quantidade INTEGER NOT NULL CHECK (quantidade>0), data TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS categoria TEXT NOT NULL DEFAULT 'RASTREADOR';
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS estoque_minimo INTEGER NOT NULL DEFAULT 5;
ALTER TABLE tecnicos ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE tecnicos ADD COLUMN IF NOT EXISTS estoque_minimo INTEGER NOT NULL DEFAULT 5;
ALTER TABLE equipamentos_seriais ADD COLUMN IF NOT EXISTS arquivado BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS eventos_seriais (
 id BIGSERIAL PRIMARY KEY, movimentacao_id INTEGER REFERENCES movimentacoes(id), codigo_serial TEXT NOT NULL,
 produto_id INTEGER REFERENCES produtos(id), tecnico_id INTEGER REFERENCES tecnicos(id),
 status_anterior TEXT, status_novo TEXT NOT NULL, data TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS estoque_tecnicos_par_unique ON estoque_tecnicos(tecnico_id,produto_id);
CREATE UNIQUE INDEX IF NOT EXISTS equipamentos_codigo_unique ON equipamentos_seriais(codigo_serial);
CREATE INDEX IF NOT EXISTS equipamentos_produto_status_idx ON equipamentos_seriais(produto_id,status);
CREATE INDEX IF NOT EXISTS equipamentos_tecnico_idx ON equipamentos_seriais(tecnico_id,produto_id) WHERE status='TECNICO';
CREATE INDEX IF NOT EXISTS movimentacoes_data_tipo_idx ON movimentacoes(tipo,data);
CREATE INDEX IF NOT EXISTS movimentacoes_produto_idx ON movimentacoes(produto_id,data);
CREATE INDEX IF NOT EXISTS eventos_serial_idx ON eventos_seriais(codigo_serial,data);
