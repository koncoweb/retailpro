-- ---------------------------------------------------------------------------
-- 005 — purchase order lifecycle and goods receipt
--
-- Runs once against a tenant database that is still on schema version 4.
-- `scripts/apply-schema-all.mjs` applies the file, then re-applies
-- `db/schema/tenant.sql` and stamps the new version, so only the ALTERs, the
-- two new tables and their indexes live here.
--
-- Invariant after this migration:
--   * a purchase order is `draft` -> `submitted` -> `approved` before any stock
--     moves; receiving is a separate document,
--   * stock moves only in `goods_receipts`, which may be partial and repeated,
--   * every `product_batches` row created by a purchase carries its
--     `purchase_order_id`, so PO -> batch is a join and not a string match,
--   * `expenses.purchase_order_id` replaces the description-string link.
--
-- See `docs/spec-purchase-order.md` for the full design.
-- ---------------------------------------------------------------------------

-- 1. Purchase order lifecycle -----------------------------------------------

ALTER TABLE purchase_orders ADD COLUMN payment_terms_days INTEGER NOT NULL DEFAULT 30;
ALTER TABLE purchase_orders ADD COLUMN submitted_by        TEXT;
ALTER TABLE purchase_orders ADD COLUMN submitted_at        TEXT;
ALTER TABLE purchase_orders ADD COLUMN approved_by         TEXT;
ALTER TABLE purchase_orders ADD COLUMN approved_at         TEXT;
ALTER TABLE purchase_orders ADD COLUMN rejected_by         TEXT;
ALTER TABLE purchase_orders ADD COLUMN rejected_at         TEXT;
ALTER TABLE purchase_orders ADD COLUMN rejection_reason    TEXT;
ALTER TABLE purchase_orders ADD COLUMN cancelled_by        TEXT;
ALTER TABLE purchase_orders ADD COLUMN cancelled_at        TEXT;
ALTER TABLE purchase_orders ADD COLUMN cancel_reason       TEXT;
ALTER TABLE purchase_orders ADD COLUMN updated_at          TEXT;

-- 2. Line-level received quantity -------------------------------------------

ALTER TABLE purchase_order_items ADD COLUMN quantity_received REAL NOT NULL DEFAULT 0;
ALTER TABLE purchase_order_items ADD COLUMN notes             TEXT;

-- 3. Ledger linkage ---------------------------------------------------------

-- The receipt line points back through `goods_receipt_items.batch_id`, so the
-- batch needs only these two pointers — no third, circular one.
ALTER TABLE product_batches ADD COLUMN purchase_order_id TEXT;
ALTER TABLE product_batches ADD COLUMN goods_receipt_id  TEXT;

ALTER TABLE expenses ADD COLUMN purchase_order_id TEXT;
ALTER TABLE expenses ADD COLUMN goods_receipt_id  TEXT;

-- 4. Delivery documents -----------------------------------------------------

CREATE TABLE IF NOT EXISTS goods_receipts (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  grn_number        TEXT NOT NULL,
  purchase_order_id TEXT NOT NULL,
  warehouse_id      TEXT NOT NULL,
  branch_id         TEXT,
  supplier_id       TEXT,
  supplier_name     TEXT,
  -- The vendor's own delivery-note / invoice number, free text.
  supplier_document TEXT,
  total_amount      INTEGER NOT NULL DEFAULT 0,
  notes             TEXT,
  received_by       TEXT,
  received_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS goods_receipt_items (
  id                     TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  goods_receipt_id       TEXT NOT NULL,
  purchase_order_item_id TEXT NOT NULL,
  product_id             TEXT NOT NULL,
  -- In `unit_name`, the same unit the PO line was ordered in.
  quantity               REAL NOT NULL DEFAULT 0,
  unit_name              TEXT,
  conversion_factor      REAL NOT NULL DEFAULT 1,
  -- Price actually paid on this delivery; may differ from the PO line.
  unit_cost              INTEGER NOT NULL DEFAULT 0,
  subtotal               INTEGER NOT NULL DEFAULT 0,
  batch_id               TEXT,
  batch_number           TEXT,
  expiry_date            TEXT
);

-- 5. Indexes ----------------------------------------------------------------

-- `idx_po_status` already covers (status, created_at) from migration 004's
-- tenant.sql pass, so only the supplier dimension is new here.
CREATE INDEX        IF NOT EXISTS idx_po_supplier      ON purchase_orders(supplier_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_grn_number       ON goods_receipts(grn_number);
CREATE INDEX        IF NOT EXISTS idx_grn_po           ON goods_receipts(purchase_order_id);
CREATE INDEX        IF NOT EXISTS idx_grn_warehouse    ON goods_receipts(warehouse_id, received_at);
CREATE INDEX        IF NOT EXISTS idx_grn_items_grn    ON goods_receipt_items(goods_receipt_id);
CREATE INDEX        IF NOT EXISTS idx_grn_items_poitem ON goods_receipt_items(purchase_order_item_id);
CREATE INDEX        IF NOT EXISTS idx_batches_po       ON product_batches(purchase_order_id);
CREATE INDEX        IF NOT EXISTS idx_expenses_po      ON expenses(purchase_order_id);

-- 6. Backfill existing rows -------------------------------------------------

-- `ordered` is retired: approving a purchase order *is* committing to the
-- vendor. Nothing in the app can distinguish the two — there is no email, no
-- portal and no EDI — so keeping both would be two states that drift apart.
UPDATE purchase_orders SET status = 'approved' WHERE status = 'ordered';

-- Orders the old single-step code marked received really did arrive in full.
UPDATE purchase_order_items
   SET quantity_received = quantity
 WHERE purchase_order_id IN (SELECT id FROM purchase_orders WHERE status = 'received');

-- Snapshot the vendor terms the order was raised under.
UPDATE purchase_orders
   SET payment_terms_days = COALESCE(
         (SELECT s.payment_terms_days FROM suppliers s WHERE s.id = purchase_orders.supplier_id),
         30);

-- Old receipts used `batch_number = po_number` as their only link.
UPDATE product_batches
   SET purchase_order_id = (
         SELECT po.id FROM purchase_orders po WHERE po.po_number = product_batches.batch_number)
 WHERE purchase_order_id IS NULL AND batch_number IS NOT NULL;

-- Old bills used the description string as their only link.
UPDATE expenses
   SET purchase_order_id = (
         SELECT po.id FROM purchase_orders po
          WHERE expenses.description LIKE 'Pembelian stok ' || po.po_number || '%')
 WHERE purchase_order_id IS NULL AND category = 'Pembelian Stok';

UPDATE purchase_orders SET updated_at = created_at WHERE updated_at IS NULL;
