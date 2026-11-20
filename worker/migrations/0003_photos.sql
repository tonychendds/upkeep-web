-- Receipt photos are stored apart from the sync book. A job record only keeps photo ids.
-- data is base64 JPEG (or null once tombstoned). deleted = 1 sticks and is never revived.
CREATE TABLE IF NOT EXISTS photos (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  mime TEXT NOT NULL,
  data TEXT,
  created_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS photos_user_job ON photos (user_id, job_id);
CREATE INDEX IF NOT EXISTS photos_user_updated ON photos (user_id, updated_at);
