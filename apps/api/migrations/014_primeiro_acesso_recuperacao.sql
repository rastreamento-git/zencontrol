ALTER TABLE zc_activations ALTER COLUMN code_hash DROP NOT NULL;
ALTER TABLE usuarios ADD COLUMN recovery_email TEXT
 CHECK (recovery_email IS NULL OR
        (char_length(recovery_email) BETWEEN 5 AND 254 AND recovery_email=lower(recovery_email)));
CREATE UNIQUE INDEX zc_users_recovery_email ON usuarios(recovery_email)
 WHERE recovery_email IS NOT NULL;

CREATE TABLE zc_password_resets (
 user_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL UNIQUE,
 user_version INTEGER NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 expires_at TIMESTAMPTZ NOT NULL,
 used_at TIMESTAMPTZ
);
