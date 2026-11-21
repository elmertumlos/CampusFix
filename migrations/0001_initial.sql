CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tracking_token TEXT UNIQUE,
  location TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'resolved')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE report_events (
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('new', 'in_progress', 'resolved')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (report_id, version)
);

CREATE TRIGGER report_created AFTER INSERT ON reports
BEGIN
  INSERT INTO report_events (report_id, version, status, created_at)
  VALUES (NEW.id, NEW.version, NEW.status, NEW.created_at);
END;

CREATE TRIGGER report_status_changed AFTER UPDATE OF status ON reports
WHEN OLD.status != NEW.status
BEGIN
  INSERT INTO report_events (report_id, version, status, created_at)
  VALUES (NEW.id, NEW.version, NEW.status, NEW.updated_at);
END;

CREATE TABLE staff_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE INDEX staff_sessions_expiry ON staff_sessions (expires_at);
