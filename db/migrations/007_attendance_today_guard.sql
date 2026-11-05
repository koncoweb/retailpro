-- ---------------------------------------------------------------------------
-- 007 — attendance date guard (check-in/check-out only for the running day)
--
-- Runs once against a tenant database that is still on schema version 6.
-- `scripts/apply-schema-all.mjs` applies this file, then re-applies
-- `db/schema/tenant.sql` and stamps the version, so this file holds only the
-- new trigger — the superset lives in tenant.sql for virgin databases.
--
-- Invariant after this migration:
--   * every `attendance` INSERT must carry today's date (UTC+7 / WIB); the
--     SPA queries Turso directly, so the locked date input in the modal is
--     decoration — this trigger is the rule that payload manipulation cannot
--     bypass. Existing rows are untouched: the guard is BEFORE INSERT only,
--     so history stays readable and deletable.
-- ---------------------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS trg_attendance_today_only
  BEFORE INSERT ON attendance
BEGIN
  SELECT RAISE(
    ABORT,
    'Absensi standar hanya untuk tanggal hari ini'
  )
  WHERE NEW.date <> date('now', '+7 hours');
END;
