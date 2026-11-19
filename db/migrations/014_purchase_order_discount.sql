-- Document discounts are applied before PPN. Existing history is unchanged.
ALTER TABLE purchase_orders ADD COLUMN discount_type TEXT NOT NULL DEFAULT 'none'
  CHECK (discount_type IN ('none', 'percent', 'amount'));
ALTER TABLE purchase_orders ADD COLUMN discount_value REAL NOT NULL DEFAULT 0
  CHECK (discount_value >= 0 AND (discount_type != 'percent' OR discount_value <= 100));
ALTER TABLE purchase_orders ADD COLUMN discount_amount INTEGER NOT NULL DEFAULT 0
  CHECK (discount_amount >= 0 AND discount_amount <= subtotal_amount);
ALTER TABLE goods_receipts ADD COLUMN discount_amount INTEGER NOT NULL DEFAULT 0
  CHECK (discount_amount >= 0 AND discount_amount <= subtotal_amount);
UPDATE schema_version SET version = 14 WHERE id = 1;
