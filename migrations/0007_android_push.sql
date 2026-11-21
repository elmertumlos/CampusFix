CREATE TABLE staff_push_devices (
  installation TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  session_hash TEXT NOT NULL,
  credential_version INTEGER NOT NULL,
  registered_at TEXT NOT NULL
);

CREATE INDEX staff_push_devices_session ON staff_push_devices (session_hash);

CREATE TABLE report_push_jobs (
  report_id INTEGER PRIMARY KEY REFERENCES reports(id) ON DELETE CASCADE,
  available_ms INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX report_push_jobs_available ON report_push_jobs (available_ms);

CREATE TABLE report_push_receipts (
  report_id INTEGER NOT NULL REFERENCES report_push_jobs(report_id) ON DELETE CASCADE,
  installation TEXT NOT NULL,
  PRIMARY KEY (report_id, installation)
);

CREATE TRIGGER report_push_created AFTER INSERT ON reports
WHEN NEW.tracking_token IS NOT NULL
BEGIN
  INSERT INTO report_push_jobs (report_id) VALUES (NEW.id);
END;
