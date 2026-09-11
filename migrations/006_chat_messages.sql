CREATE TABLE chat_messages (
  id uuid PRIMARY KEY,
  channel text NOT NULL CHECK (channel IN ('public', 'room')),
  room_id uuid REFERENCES rooms(id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  sender_name text NOT NULL CHECK (char_length(sender_name) BETWEEN 1 AND 24),
  body text NOT NULL CHECK (
    char_length(body) BETWEEN 1 AND 500 AND
    body = btrim(body) AND
    body !~ '[[:cntrl:]]'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (channel = 'public' AND room_id IS NULL) OR
    (channel = 'room' AND room_id IS NOT NULL)
  )
);

CREATE INDEX chat_messages_public_recent
  ON chat_messages(created_at DESC, id DESC)
  WHERE channel = 'public';

CREATE INDEX chat_messages_room_recent
  ON chat_messages(room_id, created_at DESC, id DESC)
  WHERE channel = 'room';
