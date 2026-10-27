-- ---------------------------------------------------------------------------
-- 002 — split selling locations (branches) from stocking locations (warehouses)
--
-- Runs once against a tenant database that is still on schema version 1.
-- `scripts/apply-schema-all.mjs` wraps this file in a transaction and applies
-- `db/schema/tenant.sql` afterwards, so only the ALTERs and the backfill live
-- here; index/table creation is repeated defensively for older fleets.
--
-- Invariant after this migration: every product batch belongs to a warehouse,
-- no table still carries a branch-keyed stock column, and every branch is
-- mapped to at least its own warehouse.
-- ---------------------------------------------------------------------------

-- 1. Branch becomes a channel, not a stockroom ------------------------------

ALTER TABLE branches ADD COLUMN type TEXT NOT NULL DEFAULT 'store';
ALTER TABLE branches ADD COLUMN is_headquarters INTEGER NOT NULL DEFAULT 0;
ALTER TABLE branches ADD COLUMN parent_branch_id TEXT;

-- The oldest branch becomes the head office when the tenant has no HQ yet.
UPDATE branches SET is_headquarters = 1
WHERE id = (SELECT id FROM branches ORDER BY created_at, name LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM branches WHERE is_headquarters = 1);

-- 2. Warehouses and their fulfilment mapping -------------------------------

CREATE TABLE IF NOT EXISTS warehouses (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  code       TEXT,
  type       TEXT NOT NULL DEFAULT 'store',
  branch_id  TEXT,
  address    TEXT,
  status     TEXT NOT NULL DEFAULT 'active',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS branch_warehouses (
  branch_id    TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  is_default   INTEGER NOT NULL DEFAULT 0,
  priority     INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (branch_id, warehouse_id)
);

CREATE INDEX IF NOT EXISTS idx_warehouses_branch ON warehouses(branch_id);
CREATE INDEX IF NOT EXISTS idx_wh_branches_wh    ON branch_warehouses(warehouse_id);

-- One backroom per existing branch, so no stock is left without a location.
INSERT INTO warehouses (id, name, code, type, branch_id, status, is_default)
SELECT
  lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||
        substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))),
  b.name || ' - Gudang',
  COALESCE(NULLIF(b.code, ''), 'WH') || '-GD',
  'store',
  b.id,
  'active',
  0
FROM branches b
WHERE NOT EXISTS (SELECT 1 FROM warehouses w WHERE w.branch_id = b.id);

-- A tenant with no branches still needs somewhere to receive stock.
INSERT INTO warehouses (id, name, code, type, branch_id, status, is_default)
SELECT
  lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||
        substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))),
  'Gudang Utama', 'WH-01', 'central', NULL, 'active', 1
WHERE NOT EXISTS (SELECT 1 FROM warehouses);

-- The head office warehouse is the company default (used when a branch has no
-- mapping of its own).
UPDATE warehouses SET is_default = 1
WHERE branch_id IS NOT NULL
  AND branch_id = (SELECT id FROM branches WHERE is_headquarters = 1)
  AND NOT EXISTS (SELECT 1 FROM warehouses WHERE is_default = 1);

UPDATE warehouses SET is_default = 1
WHERE id = (SELECT id FROM warehouses ORDER BY name LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM warehouses WHERE is_default = 1);

-- Every branch sells from its own warehouse by default.
INSERT OR IGNORE INTO branch_warehouses (branch_id, warehouse_id, is_default, priority)
SELECT branch_id, id, 1, 1 FROM warehouses WHERE branch_id IS NOT NULL;

-- 3. Stock moves from branch_id to warehouse_id ----------------------------

ALTER TABLE product_batches ADD COLUMN warehouse_id TEXT;

UPDATE product_batches
SET warehouse_id = COALESCE(
  (SELECT w.id FROM warehouses w
    WHERE w.branch_id = product_batches.branch_id
    ORDER BY w.is_default DESC, w.name LIMIT 1),
  (SELECT id FROM warehouses ORDER BY is_default DESC, name LIMIT 1)
)
WHERE warehouse_id IS NULL;

-- Rebuild so `warehouse_id` is NOT NULL and `branch_id` disappears entirely:
-- leaving a NOT NULL branch_id behind would force every future insert to write
-- two competing sources of truth.
CREATE TABLE product_batches_v2 (
  id               TEXT PRIMARY KEY,
  warehouse_id     TEXT NOT NULL,
  product_id       TEXT NOT NULL,
  batch_number     TEXT,
  expiry_date      TEXT,
  quantity_initial REAL NOT NULL DEFAULT 0,
  quantity_current REAL NOT NULL DEFAULT 0,
  cost_price       INTEGER NOT NULL DEFAULT 0,
  received_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  supplier_id      TEXT
);

INSERT INTO product_batches_v2
  (id, warehouse_id, product_id, batch_number, expiry_date,
   quantity_initial, quantity_current, cost_price, received_at, supplier_id)
SELECT
   id, warehouse_id, product_id, batch_number, expiry_date,
   quantity_initial, quantity_current, cost_price, received_at, supplier_id
FROM product_batches;

DROP TABLE product_batches;
ALTER TABLE product_batches_v2 RENAME TO product_batches;

-- 4. Transfers and purchase orders reference warehouses --------------------

ALTER TABLE stock_transfers ADD COLUMN source_warehouse_id TEXT;
ALTER TABLE stock_transfers ADD COLUMN destination_warehouse_id TEXT;

UPDATE stock_transfers
SET source_warehouse_id = COALESCE(
  (SELECT w.id FROM warehouses w
    WHERE w.branch_id = stock_transfers.source_branch_id
    ORDER BY w.is_default DESC, w.name LIMIT 1),
  (SELECT id FROM warehouses ORDER BY is_default DESC, name LIMIT 1)
)
WHERE source_warehouse_id IS NULL;

UPDATE stock_transfers
SET destination_warehouse_id = COALESCE(
  (SELECT w.id FROM warehouses w
    WHERE w.branch_id = stock_transfers.destination_branch_id
    ORDER BY w.is_default DESC, w.name LIMIT 1),
  (SELECT id FROM warehouses ORDER BY is_default DESC, name LIMIT 1)
)
WHERE destination_warehouse_id IS NULL;

-- The old branch columns are NOT NULL, so they have to go rather than linger
-- as an unused second truth. Their indexes must be dropped first.
DROP INDEX IF EXISTS idx_transfers_source;
DROP INDEX IF EXISTS idx_transfers_dest;

ALTER TABLE stock_transfers DROP COLUMN source_branch_id;
ALTER TABLE stock_transfers DROP COLUMN destination_branch_id;

ALTER TABLE purchase_orders ADD COLUMN warehouse_id TEXT;

UPDATE purchase_orders
SET warehouse_id = (
  SELECT COALESCE(
    (SELECT w.id FROM warehouses w
      WHERE w.branch_id = purchase_orders.branch_id
      ORDER BY w.is_default DESC, w.name LIMIT 1),
    (SELECT id FROM warehouses ORDER BY is_default DESC, name LIMIT 1)
  )
)
WHERE warehouse_id IS NULL;

-- 5. schema_version is stamped by the runner, not by this file.
