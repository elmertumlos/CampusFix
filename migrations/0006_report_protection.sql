ALTER TABLE reports ADD COLUMN submission_key TEXT;
ALTER TABLE reports ADD COLUMN duplicate_of INTEGER REFERENCES reports(id) ON DELETE SET NULL;
ALTER TABLE reports ADD COLUMN dismissed_at TEXT;
ALTER TABLE reports ADD COLUMN dismissal_reason TEXT CHECK (dismissal_reason IN ('Spam', 'Duplicate', 'Invalid'));

CREATE UNIQUE INDEX reports_submission_key ON reports (submission_key);
CREATE INDEX reports_open_location ON reports (location, category)
  WHERE dismissed_at IS NULL AND status IN ('new', 'in_progress');

CREATE TABLE report_throttle (
  created_ms INTEGER NOT NULL,
  browser_key TEXT,
  network_key TEXT NOT NULL
);

CREATE INDEX report_throttle_browser ON report_throttle (browser_key, created_ms);
CREATE INDEX report_throttle_network ON report_throttle (network_key, created_ms);
CREATE INDEX report_throttle_created ON report_throttle (created_ms);

CREATE TABLE report_protection_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  network_salt TEXT NOT NULL
);

INSERT INTO report_protection_settings (id, network_salt) VALUES (1, hex(randomblob(32)));
