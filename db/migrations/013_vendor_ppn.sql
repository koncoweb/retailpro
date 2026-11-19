-- ---------------------------------------------------------------------------
-- 013 — vendor PPN snapshots for purchase orders and goods receipts
--
-- Vendor prices remain exclusive of PPN. A taxable vendor uses the fixed 11%
-- rate for NEW purchase orders; every order and receipt stores its own snapshot
-- so later vendor edits never rewrite historical documents or liabilities.
-- Existing rows remain non-PPN and retain their exact total_amount values.
-- ---------------------------------------------------------------------------

ALTER TABLE suppliers ADD COLUMN ppn_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (ppn_enabled IN (0, 1));

ALTER TABLE purchase_orders ADD COLUMN subtotal_amount INTEGER NOT NULL DEFAULT 0
  CHECK (subtotal_amount >= 0);
ALTER TABLE purchase_orders ADD COLUMN ppn_rate INTEGER NOT NULL DEFAULT 0
  CHECK (ppn_rate IN (0, 11));
ALTER TABLE purchase_orders ADD COLUMN ppn_amount INTEGER NOT NULL DEFAULT 0
  CHECK (ppn_amount >= 0);

ALTER TABLE goods_receipts ADD COLUMN subtotal_amount INTEGER NOT NULL DEFAULT 0
  CHECK (subtotal_amount >= 0);
ALTER TABLE goods_receipts ADD COLUMN ppn_rate INTEGER NOT NULL DEFAULT 0
  CHECK (ppn_rate IN (0, 11));
ALTER TABLE goods_receipts ADD COLUMN ppn_amount INTEGER NOT NULL DEFAULT 0
  CHECK (ppn_amount >= 0);

-- Before v13 total_amount meant the tax-exclusive total. Preserve that number
-- while making the new subtotal field honest and leaving PPN at zero.
UPDATE purchase_orders SET subtotal_amount = total_amount;
UPDATE goods_receipts SET subtotal_amount = total_amount;

UPDATE schema_version SET version = 13 WHERE id = 1;
