-- ---------------------------------------------------------------------------
-- 008 — attendance geolocation & face recognition
--
-- Runs once against a tenant database that is still on schema version 7.
-- `scripts/apply-schema-all.mjs` applies this file, then re-applies
-- `db/schema/tenant.sql` and stamps the version, so this file holds only the
-- additive changes — the superset lives in tenant.sql for virgin databases.
-- SQLite `ALTER TABLE ... ADD COLUMN` has no IF NOT EXISTS; the version gate
-- above is what keeps these statements from running twice.
--
-- Invariant after this migration:
--   * branches/warehouses carry a workplace point + radius + the two
--     verification toggles used by the attendance geofence;
--   * attendance carries the GPS/face audit columns + a `source` marker;
--   * face_enrollments holds the 128-float descriptors per employee.
--   Nothing here changes the v7 today-only attendance trigger.
-- ---------------------------------------------------------------------------

ALTER TABLE branches ADD COLUMN latitude     REAL;
ALTER TABLE branches ADD COLUMN longitude    REAL;
ALTER TABLE branches ADD COLUMN geo_radius_m INTEGER NOT NULL DEFAULT 150;
ALTER TABLE branches ADD COLUMN require_geo  INTEGER NOT NULL DEFAULT 1;
ALTER TABLE branches ADD COLUMN require_face INTEGER NOT NULL DEFAULT 1;

ALTER TABLE warehouses ADD COLUMN latitude     REAL;
ALTER TABLE warehouses ADD COLUMN longitude    REAL;
ALTER TABLE warehouses ADD COLUMN geo_radius_m INTEGER NOT NULL DEFAULT 150;
ALTER TABLE warehouses ADD COLUMN require_geo  INTEGER NOT NULL DEFAULT 1;
ALTER TABLE warehouses ADD COLUMN require_face INTEGER NOT NULL DEFAULT 1;

ALTER TABLE attendance ADD COLUMN location_type  TEXT;
ALTER TABLE attendance ADD COLUMN location_id    TEXT;
ALTER TABLE attendance ADD COLUMN check_in_lat   REAL;
ALTER TABLE attendance ADD COLUMN check_in_lng   REAL;
ALTER TABLE attendance ADD COLUMN check_in_acc   REAL;
ALTER TABLE attendance ADD COLUMN check_in_dist  INTEGER;
ALTER TABLE attendance ADD COLUMN check_out_lat  REAL;
ALTER TABLE attendance ADD COLUMN check_out_lng  REAL;
ALTER TABLE attendance ADD COLUMN check_out_dist INTEGER;
ALTER TABLE attendance ADD COLUMN face_score     REAL;
ALTER TABLE attendance ADD COLUMN face_verified  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE attendance ADD COLUMN source         TEXT NOT NULL DEFAULT 'owner';

CREATE TABLE IF NOT EXISTS face_enrollments (
  employee_id     TEXT PRIMARY KEY,
  descriptors     TEXT NOT NULL DEFAULT '[]',
  sample_count    INTEGER NOT NULL DEFAULT 0,
  match_threshold REAL NOT NULL DEFAULT 0.5,
  model_version   TEXT,
  enrolled_by     TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

UPDATE schema_version SET version = 8 WHERE id = 1;
