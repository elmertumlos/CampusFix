ALTER TABLE reports ADD COLUMN latitude REAL CHECK (latitude BETWEEN -90 AND 90);

ALTER TABLE reports ADD COLUMN longitude REAL CHECK (
  (latitude IS NULL AND longitude IS NULL)
  OR (latitude IS NOT NULL AND longitude IS NOT NULL AND longitude BETWEEN -180 AND 180)
);
