-- ---------------------------------------------------------------------------
-- 012 — payment channels, merchant fee, and online-store order sync
--
-- Runs once against a tenant database still on schema version 11.
-- `scripts/apply-schema-all.mjs` applies this file, then re-applies
-- `db/schema/tenant.sql` and stamps the version, so this file holds only the
-- additive changes; the superset lives in tenant.sql for virgin databases.
-- SQLite `ALTER TABLE ... ADD COLUMN` has no IF NOT EXISTS; the version gate is
-- what keeps these statements from running twice.
--
-- Invariant after this migration:
--   * `transactions.fee_amount` is the MERCHANT cost of the channel at the time
--     of sale — it never changes what the customer paid, so it must not be added
--     to `total_amount`/`amount_paid`; reports show net as total − fee;
--   * `transactions.source` separates a till sale ('pos') from a web order that
--     synced in ('online'); the default keeps every existing row a 'pos' sale;
--   * `storefront_orders` holds one row PER SELLER of a marketplace basket. A
--     `pending_payment` row touches neither stock nor reports until the seller
--     confirms it, which is what writes the `transactions` row it points at.
-- ---------------------------------------------------------------------------

ALTER TABLE transactions ADD COLUMN fee_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN fee_label  TEXT;
ALTER TABLE transactions ADD COLUMN source     TEXT NOT NULL DEFAULT 'pos';

ALTER TABLE tenants ADD COLUMN qris_image TEXT;

CREATE TABLE IF NOT EXISTS storefront_orders (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  -- One basket at the marketplace splits into one row per seller; they share a
  -- parent id so the shopper's order page can reassemble them.
  parent_id       TEXT NOT NULL,
  invoice_number  TEXT NOT NULL,
  shop_name       TEXT,
  customer_name   TEXT,
  customer_phone  TEXT,
  customer_address TEXT,
  -- 'pickup' | 'delivery'
  fulfillment     TEXT NOT NULL DEFAULT 'pickup',
  slot            TEXT,
  notes           TEXT,
  -- channel id from the tenant's payment_channels ('cash'|'transfer'|'qris')
  payment_channel TEXT,
  payment_bank_id TEXT,
  -- Snapshot of what was ordered, in the sold unit and price at order time:
  -- [{"product_id","variant_id","unit_name","conversion_factor","qty","unit_price"}]
  items           TEXT NOT NULL DEFAULT '[]',
  subtotal        INTEGER NOT NULL DEFAULT 0,
  shipping        INTEGER NOT NULL DEFAULT 0,
  total           INTEGER NOT NULL DEFAULT 0,
  -- pending_payment | confirmed | packing | shipped | done | cancelled | void
  status          TEXT NOT NULL DEFAULT 'pending_payment',
  cancel_reason   TEXT,
  confirmed_at    TEXT,
  confirmed_by    TEXT,
  -- The `transactions` row written when this order's payment was confirmed.
  transaction_id  TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_sf_orders_parent  ON storefront_orders(parent_id);
CREATE INDEX IF NOT EXISTS idx_sf_orders_status  ON storefront_orders(status, created_at);
CREATE INDEX IF NOT EXISTS idx_sf_orders_created ON storefront_orders(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sf_orders_invoice ON storefront_orders(invoice_number);

UPDATE schema_version SET version = 12 WHERE id = 1;
