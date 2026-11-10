ALTER TABLE zc_chat_messages ALTER COLUMN technician_id DROP NOT NULL;
ALTER TABLE zc_chat_messages ADD CONSTRAINT zc_chat_team_staff
 CHECK (technician_id IS NOT NULL OR sender_role IN ('admin','operador'));
CREATE UNIQUE INDEX zc_chat_team_request
 ON zc_chat_messages(sender_user_id,request_id) WHERE technician_id IS NULL;
CREATE INDEX zc_chat_thread_sender
 ON zc_chat_messages(technician_id,sender_user_id) WHERE technician_id IS NOT NULL;

ALTER TABLE zc_user_profiles ADD COLUMN avatar_webp TEXT;
ALTER TABLE zc_user_profiles ADD COLUMN avatar_version TEXT;
ALTER TABLE zc_user_profiles ADD CONSTRAINT zc_profile_avatar
 CHECK ((avatar_webp IS NULL AND avatar_version IS NULL)
     OR (avatar_webp IS NOT NULL AND length(avatar_webp) BETWEEN 1 AND 24000
         AND avatar_version IS NOT NULL AND avatar_version ~ '^[0-9a-f]{64}$'));

CREATE TABLE zc_chat_presence (
 user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
 client_id UUID NOT NULL,
 status TEXT NOT NULL CHECK (status IN ('online','away','busy')),
 seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,client_id)
);
CREATE INDEX zc_chat_presence_expiry ON zc_chat_presence(seen_at);
