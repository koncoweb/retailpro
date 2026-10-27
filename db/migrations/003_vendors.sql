-- ---------------------------------------------------------------------------
-- 003 — vendor (supplier) master data for procurement
--
-- Runs once against a tenant database that is still on schema version 2.
-- `scripts/apply-schema-all.mjs` wraps this file in a transaction and applies
-- `db/schema/tenant.sql` afterwards, so only the ALTERs, the new tables and the
-- backfill live here; everything is repeated defensively for older fleets.
--
-- Invariant after this migration:
--   * every vendor has a unique code (backfilled when it had none),
--   * every product with a main vendor has a matching `vendor_products` row, so
--     the vendor screen shows its catalogue immediately after the upgrade,
--   * vendor debt keeps its running balance in `expenses.amount_paid`, with each
--     instalment recorded in `vendor_payments`.
-- ---------------------------------------------------------------------------

-- 1. Vendor master fields ---------------------------------------------------
-- SQLite can only ADD columns with constant defaults, so `updated_at` is
-- nullable and written by the application rather than defaulted here.

ALTER TABLE suppliers ADD COLUMN code TEXT;
ALTER TABLE suppliers ADD COLUMN legal_name TEXT;
ALTER TABLE suppliers ADD COLUMN category TEXT NOT NULL DEFAULT 'supplier';
ALTER TABLE suppliers ADD COLUMN tax_id TEXT;
ALTER TABLE suppliers ADD COLUMN website TEXT;
ALTER TABLE suppliers ADD COLUMN city TEXT;
ALTER TABLE suppliers ADD COLUMN province TEXT;
ALTER TABLE suppliers ADD COLUMN postal_code TEXT;
ALTER TABLE suppliers ADD COLUMN payment_terms_days INTEGER NOT NULL DEFAULT 30;
ALTER TABLE suppliers ADD COLUMN credit_limit INTEGER NOT NULL DEFAULT 0;
ALTER TABLE suppliers ADD COLUMN currency TEXT NOT NULL DEFAULT 'IDR';
ALTER TABLE suppliers ADD COLUMN bank_name TEXT;
ALTER TABLE suppliers ADD COLUMN bank_account_number TEXT;
ALTER TABLE suppliers ADD COLUMN bank_account_name TEXT;
ALTER TABLE suppliers ADD COLUMN lead_time_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE suppliers ADD COLUMN rating INTEGER NOT NULL DEFAULT 0;
ALTER TABLE suppliers ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE suppliers ADD COLUMN notes TEXT;
ALTER TABLE suppliers ADD COLUMN updated_at TEXT;

-- 2. Vendor catalogue and payment ledger ------------------------------------

CREATE TABLE IF NOT EXISTS vendor_products (
  -- Kept byte-identical to tenant.sql: upgraded databases must also get the
  -- UUID default, otherwise every INSERT that omits `id` fails NOT NULL.
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  vendor_id       TEXT NOT NULL,
  product_id      TEXT NOT NULL,
  vendor_sku      TEXT,
  last_cost       INTEGER NOT NULL DEFAULT 0,
  lead_time_days  INTEGER NOT NULL DEFAULT 0,
  min_order_qty   REAL NOT NULL DEFAULT 1,
  is_preferred    INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS vendor_payments (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  vendor_id         TEXT NOT NULL,
  expense_id        TEXT,
  purchase_order_id TEXT,
  amount            INTEGER NOT NULL DEFAULT 0,
  payment_date      TEXT NOT NULL DEFAULT (date('now')),
  method            TEXT NOT NULL DEFAULT 'transfer',
  reference_number  TEXT,
  notes             TEXT,
  created_by        TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 3. Backfill ---------------------------------------------------------------

-- Existing vendors were created by name from the product/PO form. Give each a
-- stable code so the list and search behave like the new module expects.
UPDATE suppliers
SET code = 'VND-' || printf(
  '%04d',
  (SELECT COUNT(*) FROM suppliers AS earlier WHERE earlier.rowid <= suppliers.rowid)
)
WHERE code IS NULL;

-- A product's main vendor already exists in `products.supplier_id`; mirror it as
-- a preferred catalogue link so the detail page is not empty after the upgrade.
INSERT OR IGNORE INTO vendor_products (vendor_id, product_id, last_cost, is_preferred)
SELECT supplier_id, id, COALESCE(cost_price, 0), 1
FROM products
WHERE supplier_id IS NOT NULL;

-- 4. Indexes ----------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_code       ON suppliers(code) WHERE code IS NOT NULL;
CREATE INDEX        IF NOT EXISTS idx_suppliers_status     ON suppliers(status);
CREATE INDEX        IF NOT EXISTS idx_suppliers_category   ON suppliers(category);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_products_pair ON vendor_products(vendor_id, product_id);
CREATE INDEX        IF NOT EXISTS idx_vendor_products_prod ON vendor_products(product_id);
CREATE INDEX        IF NOT EXISTS idx_vendor_payments_vnd  ON vendor_payments(vendor_id, payment_date);
CREATE INDEX        IF NOT EXISTS idx_vendor_payments_exp  ON vendor_payments(expense_id);

-- 5. schema_version is stamped by the runner, not by this file.
