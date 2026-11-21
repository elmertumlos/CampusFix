ALTER TABLE reports ADD COLUMN issue_photo_hash TEXT;

CREATE TABLE report_issue_photos (
  report_id INTEGER PRIMARY KEY REFERENCES reports(id) ON DELETE CASCADE,
  jpeg BLOB NOT NULL CHECK (length(jpeg) BETWEEN 4 AND 250000)
);
