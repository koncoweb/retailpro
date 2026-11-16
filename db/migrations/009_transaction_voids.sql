-- ---------------------------------------------------------------------------
-- 009 — transaction voids (per item and per bon)
--
-- Runs once against a tenant database that is still on schema version 8.
-- `scripts/apply-schema-all.mjs` applies this file, then re-applies
-- `db/schema/tenant.sql` and stamps the version, so this file holds only the
-- additive changes — the superset lives in tenant.sql for virgin databases.
-- SQLite `ALTER TABLE ... ADD COLUMN` has no IF NOT EXISTS; the version gate
-- above is what keeps these statements from running twice.
--
-- Invariant after this migration:
--   * a voided bon keeps its rows and original `total_amount`; only
--     `status='void'` + these audit columns are added, so every revenue query
--     that filters `status='completed'` excludes it automatically;
--   * a voided line keeps its row with `voided=1` (its stock returns to the
--     batch it left from and it prints struck-through), and the bon's
--     `total_amount`/`amount_paid` are reduced by the line's subtotal so the
--     bon-level discount is preserved.
--   Nothing here touches the money an already-closed shift booked.
-- ---------------------------------------------------------------------------

ALTER TABLE transactions ADD COLUMN void_reason TEXT;
ALTER TABLE transactions ADD COLUMN voided_by   TEXT;
ALTER TABLE transactions ADD COLUMN voided_at   TEXT;

ALTER TABLE transaction_items ADD COLUMN voided      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transaction_items ADD COLUMN void_reason TEXT;
ALTER TABLE transaction_items ADD COLUMN voided_by   TEXT;
ALTER TABLE transaction_items ADD COLUMN voided_at   TEXT;

UPDATE schema_version SET version = 9 WHERE id = 1;
