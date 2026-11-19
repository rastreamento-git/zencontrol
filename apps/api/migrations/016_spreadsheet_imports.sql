CREATE TABLE zc_spreadsheet_imports (
 id UUID PRIMARY KEY, filename TEXT NOT NULL, fingerprint TEXT NOT NULL,
 created_by INTEGER REFERENCES usuarios(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours',
 rows JSONB NOT NULL, approved_by INTEGER REFERENCES usuarios(id), approved_at TIMESTAMPTZ,
 result JSONB
);
CREATE INDEX zc_spreadsheet_imports_created ON zc_spreadsheet_imports(created_at DESC);
