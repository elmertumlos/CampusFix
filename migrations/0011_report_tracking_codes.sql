ALTER TABLE reports ADD COLUMN tracking_code TEXT
  CHECK (length(tracking_code) = 6 AND tracking_code NOT GLOB '*[^A-Z0-9]*');

CREATE UNIQUE INDEX reports_tracking_code ON reports (tracking_code);

CREATE VIEW report_tracking_code_candidate AS
SELECT
  substr(alphabet, 1 + abs(random() % 36), 1) ||
  substr(alphabet, 1 + abs(random() % 36), 1) ||
  substr(alphabet, 1 + abs(random() % 36), 1) ||
  substr(alphabet, 1 + abs(random() % 36), 1) ||
  substr(alphabet, 1 + abs(random() % 36), 1) ||
  substr(alphabet, 1 + abs(random() % 36), 1) AS code
FROM (SELECT 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' AS alphabet);

CREATE TRIGGER fill_report_tracking_code
AFTER UPDATE OF tracking_code ON reports
WHEN NEW.tracking_code IS NULL
BEGIN
  UPDATE reports SET tracking_code = (
    WITH RECURSIVE candidates(code) AS (
      SELECT code FROM report_tracking_code_candidate
      UNION ALL
      SELECT candidate.code
      FROM candidates AS previous, report_tracking_code_candidate AS candidate
      WHERE EXISTS (SELECT 1 FROM reports WHERE tracking_code = previous.code)
    )
    SELECT code FROM candidates
    WHERE NOT EXISTS (SELECT 1 FROM reports WHERE tracking_code = candidates.code)
    LIMIT 1
  ) WHERE id = NEW.id;
END;

CREATE TRIGGER assign_report_tracking_code
AFTER INSERT ON reports
WHEN NEW.tracking_code IS NULL
BEGIN
  UPDATE reports SET tracking_code = NULL WHERE id = NEW.id;
END;

UPDATE reports SET tracking_code = NULL WHERE tracking_code IS NULL;
