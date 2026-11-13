CREATE TABLE IF NOT EXISTS zc_user_profiles (
 user_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
 phone TEXT NOT NULL DEFAULT '',
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS zc_google_accounts (
 user_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
 subject TEXT NOT NULL UNIQUE,
 email TEXT NOT NULL,
 linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS zc_google_challenges (
 nonce_hash TEXT PRIMARY KEY,
 intent TEXT NOT NULL CHECK (intent IN ('login','link')),
 origin TEXT NOT NULL,
 user_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
 session_hash TEXT,
 expires_at TIMESTAMPTZ NOT NULL,
 CHECK ((intent='login' AND user_id IS NULL AND session_hash IS NULL)
     OR (intent='link' AND user_id IS NOT NULL AND session_hash IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS zc_google_challenges_expiry
 ON zc_google_challenges(expires_at);

CREATE TABLE IF NOT EXISTS zc_chat_messages (
 id BIGSERIAL PRIMARY KEY,
 technician_id INTEGER NOT NULL REFERENCES zc_technicians(id) ON DELETE CASCADE,
 sender_user_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
 sender_name TEXT NOT NULL,
 sender_role TEXT NOT NULL CHECK (sender_role IN ('admin','operador','tecnico')),
 body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
 request_id UUID NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE (technician_id,sender_user_id,request_id)
);
CREATE INDEX IF NOT EXISTS zc_chat_messages_thread
 ON zc_chat_messages(technician_id,id DESC);
CREATE INDEX IF NOT EXISTS zc_technician_accounts_technician
 ON zc_technician_accounts(technician_id);
