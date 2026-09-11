ALTER TABLE matches ADD COLUMN room_id uuid REFERENCES rooms(id);
UPDATE matches SET room_id=id;
ALTER TABLE matches ALTER COLUMN room_id SET NOT NULL;
ALTER TABLE matches DROP CONSTRAINT matches_id_fkey;
CREATE INDEX matches_room ON matches(room_id);
