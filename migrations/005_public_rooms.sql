ALTER TABLE rooms ADD COLUMN is_public boolean NOT NULL DEFAULT false;
CREATE INDEX rooms_public_recent ON rooms(updated_at DESC)
WHERE is_public AND status IN ('waiting', 'active');
