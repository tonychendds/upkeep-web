-- Additive only. Existing users keep a null recovery email. Records and sessions are unchanged.
ALTER TABLE users ADD COLUMN recovery_email TEXT;

-- Reset tokens are stored as SHA-256 hashes. used_at marks a single-use token.
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE INDEX IF NOT EXISTS password_resets_user ON password_resets (user_id, created_at);

CREATE TABLE IF NOT EXISTS reset_rate_limits (
  bucket TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  hits INTEGER NOT NULL
);
