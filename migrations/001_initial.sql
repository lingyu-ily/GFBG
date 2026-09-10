CREATE TABLE users (
 id uuid PRIMARY KEY, email text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE players (
 id uuid PRIMARY KEY, name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 24),
 user_id uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX players_user ON players(user_id);
CREATE TABLE sessions (
 token_hash text PRIMARY KEY, player_id uuid NOT NULL REFERENCES players(id), csrf text NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE TABLE login_tokens (
 token_hash text PRIMARY KEY, player_id uuid NOT NULL REFERENCES players(id), email text NOT NULL,
 expires_at timestamptz NOT NULL, consumed_at timestamptz
);
CREATE TABLE rooms (
 id uuid PRIMARY KEY, code text NOT NULL UNIQUE, game_id text NOT NULL,
 host_id uuid NOT NULL REFERENCES players(id), status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','active','finished','aborted')),
 version integer NOT NULL DEFAULT 0, state jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE members (
 room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, player_id uuid NOT NULL REFERENCES players(id),
 position integer NOT NULL, ready boolean NOT NULL DEFAULT false,
 last_seen timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(room_id,player_id), UNIQUE(room_id,position)
);
CREATE TABLE operations (
 room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, operation_id uuid NOT NULL,
 player_id uuid NOT NULL REFERENCES players(id), version integer NOT NULL,
 PRIMARY KEY(room_id, operation_id)
);
CREATE TABLE matches (
 id uuid PRIMARY KEY REFERENCES rooms(id), game_id text NOT NULL, rules_version text NOT NULL, finished_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE results (
 match_id uuid NOT NULL REFERENCES matches(id), player_id uuid NOT NULL REFERENCES players(id),
 user_id uuid REFERENCES users(id), name text NOT NULL, score integer NOT NULL, won boolean NOT NULL,
 PRIMARY KEY(match_id, player_id)
);
CREATE INDEX results_user ON results(user_id);
CREATE TABLE rate_limits (
 key text PRIMARY KEY, count integer NOT NULL, reset_at timestamptz NOT NULL
);
