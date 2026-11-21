CREATE TABLE staff_notification_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_read_report_id INTEGER NOT NULL CHECK (last_read_report_id >= 0)
);

INSERT INTO staff_notification_state (id, last_read_report_id)
SELECT 1, COALESCE(MAX(id), 0) FROM reports WHERE tracking_token IS NOT NULL;
