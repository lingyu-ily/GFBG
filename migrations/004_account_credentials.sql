ALTER TABLE users ADD COLUMN login_id text;
ALTER TABLE users ADD COLUMN display_name text;
ALTER TABLE users ADD COLUMN password_digest text;
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
ALTER TABLE users ADD COLUMN legacy boolean NOT NULL DEFAULT false;

UPDATE users SET legacy=true;

DELETE FROM sessions s
USING players p, users u
WHERE s.player_id=p.id AND p.user_id=u.id AND u.legacy;

DROP TABLE login_tokens;
ALTER TABLE users DROP CONSTRAINT users_email_key;

ALTER TABLE users ADD CONSTRAINT users_active_account_fields CHECK (
  legacy OR (
    login_id IS NOT NULL AND
    display_name IS NOT NULL AND
    password_digest IS NOT NULL
  )
);
ALTER TABLE users ADD CONSTRAINT users_login_id_format CHECK (
  login_id IS NULL OR login_id ~ '^[a-z][a-z0-9_]{2,23}$'
);
ALTER TABLE users ADD CONSTRAINT users_display_name_length CHECK (
  display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 24
);

CREATE UNIQUE INDEX users_active_login_id
  ON users(login_id) WHERE NOT legacy;
CREATE UNIQUE INDEX users_active_email
  ON users(lower(email)) WHERE NOT legacy;

CREATE TABLE account_tokens (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('verify_email','reset_password')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_tokens_user_purpose
  ON account_tokens(user_id,purpose);
