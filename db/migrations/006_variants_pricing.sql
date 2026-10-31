-- ---------------------------------------------------------------------------
-- 006 — product variants, per-pack buy price, vendor price list
--
-- Runs once against a tenant database that is still on schema version 5.
-- `scripts/apply-schema-all.mjs` applies this file, then re-applies
-- `db/schema/tenant.sql` and stamps the version, so this file holds only the
-- ALTERs, the two new tables, their indexes and the backfill — the superset
-- lives in tenant.sql for virgin databases.
--
-- Invariant after this migration:
--   * every product has at least one `product_variants` row, so legacy stock,
--     POs, transfers and POS sales still point at a legitimate sellable SKU,
--   * `product_units` belongs to a VARIANT, not a product: one variant may hold
--     Pcs and Karton at once, and two variants no longer collide on "Pcs",
--   * a pack's buy price lives in `product_units.cost` and
--     `vendor_price_list.buy_price`, never derived from the piece price.
--
-- See `docs/spec-varian-harga-vendor.md` for the full design.
-- ---------------------------------------------------------------------------

-- 1. Variant identity --------------------------------------------------------

CREATE TABLE IF NOT EXISTS product_variants (
  -- Kept byte-identical to tenant.sql: upgraded databases must also get the
  -- UUID default, otherwise every INSERT that omits `id` fails NOT NULL.
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  product_id  TEXT NOT NULL,
  sku         TEXT NOT NULL,
  barcode     TEXT,
  name        TEXT NOT NULL,
  attributes  TEXT NOT NULL DEFAULT '{}',
  cost_price  INTEGER NOT NULL DEFAULT 0,
  price       INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 2. Packs own a buy price, and belong to a variant ---------------------------

-- Ordered attribute groups chosen for this product. An empty array means the
-- product has no variants, i.e. exactly one `Default` row.
ALTER TABLE products ADD COLUMN variant_attributes TEXT NOT NULL DEFAULT '[]';

ALTER TABLE product_units ADD COLUMN variant_id TEXT;
-- Buy price per pack (IDR per `name`). 0 = not agreed yet.
ALTER TABLE product_units ADD COLUMN cost       INTEGER NOT NULL DEFAULT 0;

-- 3. Stock and documents carry the variant ----------------------------------
-- SQLite cannot add a NOT NULL column without a constant default, so these stay
-- nullable. Every writer sets them; schema.test.ts asserts no row is left NULL
-- after seeding, and docs/backend.md records the invariant.

ALTER TABLE product_batches      ADD COLUMN variant_id TEXT;
ALTER TABLE transaction_items    ADD COLUMN variant_id TEXT;
ALTER TABLE purchase_order_items ADD COLUMN variant_id TEXT;
ALTER TABLE goods_receipt_items  ADD COLUMN variant_id TEXT;
ALTER TABLE stock_request_items  ADD COLUMN variant_id TEXT;
ALTER TABLE transfer_items       ADD COLUMN variant_id TEXT;

-- 4. Vendor price list = the PO template ------------------------------------

CREATE TABLE IF NOT EXISTS vendor_price_list (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  vendor_id         TEXT NOT NULL,
  variant_id        TEXT NOT NULL,
  unit_name         TEXT NOT NULL,
  conversion_factor REAL    NOT NULL DEFAULT 1,
  buy_price         INTEGER NOT NULL DEFAULT 0,
  min_qty           REAL    NOT NULL DEFAULT 1,
  status            TEXT    NOT NULL DEFAULT 'active',
  notes             TEXT,
  updated_by        TEXT,
  updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 5. Indexes ----------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS idx_variants_sku      ON product_variants(sku);
CREATE INDEX        IF NOT EXISTS idx_variants_product  ON product_variants(product_id, status);
CREATE INDEX        IF NOT EXISTS idx_variants_barcode  ON product_variants(barcode);

-- MANDATORY: the old index stops being correct the moment one product has two
-- variants that each carry a "Pcs" pack (factor 1). Without the DROP here the
-- backfill below collides with a UNIQUE constraint.
DROP INDEX IF EXISTS idx_units_prod_factor;
CREATE UNIQUE INDEX IF NOT EXISTS idx_units_variant_factor ON product_units(variant_id, conversion_factor);
CREATE INDEX        IF NOT EXISTS idx_units_variant        ON product_units(variant_id);

CREATE INDEX        IF NOT EXISTS idx_batches_variant      ON product_batches(variant_id, warehouse_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vprice_pair          ON vendor_price_list(vendor_id, variant_id, unit_name);
CREATE INDEX        IF NOT EXISTS idx_vprice_variant       ON vendor_price_list(variant_id);
CREATE INDEX        IF NOT EXISTS idx_vprice_vendor_active ON vendor_price_list(vendor_id, status);

-- 6. Backfill: every existing product becomes one default variant ------------

INSERT INTO product_variants (product_id, sku, name, attributes, cost_price, price)
SELECT p.id, p.sku, 'Default', '{}', COALESCE(p.cost_price, 0),
       COALESCE((SELECT pu.price FROM product_units pu
                  WHERE pu.product_id = p.id AND pu.conversion_factor = 1
                  ORDER BY pu.created_at ASC LIMIT 1), 0)
  FROM products p
 WHERE NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id);

-- Mapping goes through SKU: at this point the product -> variant relation is
-- still one-to-one, so the join is unambiguous.
UPDATE product_units
   SET variant_id = (SELECT v.id FROM product_variants v
                      WHERE v.product_id = product_units.product_id
                        AND v.sku = (SELECT p.sku FROM products p WHERE p.id = product_units.product_id))
 WHERE variant_id IS NULL;

-- Legacy packs had no buy price at all; seed it from the product's cost so the
-- product form opens with something truthful instead of zero.
UPDATE product_units
   SET cost = (SELECT COALESCE(p.cost_price, 0) FROM products p WHERE p.id = product_units.product_id)
 WHERE cost = 0;

UPDATE product_batches
   SET variant_id = (SELECT v.id FROM product_variants v
                      WHERE v.product_id = product_batches.product_id LIMIT 1)
 WHERE variant_id IS NULL;

UPDATE transaction_items
   SET variant_id = (SELECT v.id FROM product_variants v
                      WHERE v.product_id = transaction_items.product_id LIMIT 1)
 WHERE variant_id IS NULL;

UPDATE purchase_order_items
   SET variant_id = (SELECT v.id FROM product_variants v
                      WHERE v.product_id = purchase_order_items.product_id LIMIT 1)
 WHERE variant_id IS NULL;

UPDATE goods_receipt_items
   SET variant_id = (SELECT v.id FROM product_variants v
                      WHERE v.product_id = goods_receipt_items.product_id LIMIT 1)
 WHERE variant_id IS NULL;

UPDATE stock_request_items
   SET variant_id = (SELECT v.id FROM product_variants v
                      WHERE v.product_id = stock_request_items.product_id LIMIT 1)
 WHERE variant_id IS NULL;

UPDATE transfer_items
   SET variant_id = (SELECT v.id FROM product_variants v
                      WHERE v.product_id = transfer_items.product_id LIMIT 1)
 WHERE variant_id IS NULL;

-- 7. Seed the price list from what is already known -------------------------
-- `vendor_products.last_cost` is a BASE-unit cost, so it is written into the
-- factor-1 pack only. Inventing a carton price from it would be a guess.

INSERT OR IGNORE INTO vendor_price_list
  (vendor_id, variant_id, unit_name, conversion_factor, buy_price, min_qty)
SELECT vp.vendor_id, v.id, COALESCE(pu.name, 'Pcs'), 1,
       COALESCE(vp.last_cost, 0), COALESCE(vp.min_order_qty, 1)
  FROM vendor_products vp
  JOIN product_variants v ON v.product_id = vp.product_id
                         AND v.sku = (SELECT p.sku FROM products p WHERE p.id = vp.product_id)
  LEFT JOIN product_units pu ON pu.variant_id = v.id AND pu.conversion_factor = 1;

-- 8. schema_version is stamped by the runner, not by this file.
