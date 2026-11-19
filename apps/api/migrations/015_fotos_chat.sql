ALTER TABLE zc_chat_messages
  ADD COLUMN photos JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE zc_chat_messages
  DROP CONSTRAINT zc_chat_messages_body_check,
  ADD CONSTRAINT zc_chat_messages_content_check CHECK (
    jsonb_typeof(photos) = 'array' AND jsonb_array_length(photos) <= 4
    AND char_length(body) <= 2000
    AND (char_length(body) > 0 OR jsonb_array_length(photos) > 0)
  );
