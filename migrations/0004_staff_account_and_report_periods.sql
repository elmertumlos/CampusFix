CREATE TABLE staff_account (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  username TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1)
);

ALTER TABLE staff_sessions ADD COLUMN credential_version INTEGER NOT NULL DEFAULT 0;

CREATE INDEX reports_received ON reports (created_at DESC, id DESC);
