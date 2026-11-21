ALTER TABLE reports ADD COLUMN status_note TEXT NOT NULL DEFAULT ''
  CHECK (length(status_note) <= 300);
