ALTER TABLE users ADD COLUMN avatar_key text;
ALTER TABLE users ADD CONSTRAINT users_avatar_key_format CHECK (
  avatar_key IS NULL OR avatar_key ~ '^avatars/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$'
);
ALTER TABLE users ADD CONSTRAINT users_avatar_key_unique UNIQUE (avatar_key);
