-- ---------------------------------------------------------------------------
-- 010 — vendor/catalogue read paths for the vendor-product integration
--
-- Runs once against a tenant database that is still on schema version 9.
-- `scripts/apply-schema-all.mjs` applies this file, then re-applies
-- `db/schema/tenant.sql` and stamps the version, so this file holds only what
-- an existing database is missing — the superset lives in tenant.sql for virgin
-- databases.
--
-- No table or column is added: `vendor_products.is_preferred` (003) and
-- `vendor_price_list` (006) already carry everything the integrated write path
-- needs. What is new is HOW they are read, and two of those reads had no index.
--
-- Invariant after this migration:
--   * a product's preferred vendor is resolved by
--     `WHERE product_id = ? AND is_preferred = 1`, on every product row the
--     inventory screen loads — served by `idx_vendor_products_pref`;
--   * a vendor typed by name (product form, bulk import) is looked up
--     case-insensitively, served by `idx_suppliers_name_nc`. `idx_suppliers_name`
--     stays case-sensitive UNIQUE, so two spellings of one vendor can still
--     pre-exist; the app matches NOCASE and never rewrites the old rows.
-- See `docs/spec-vendor-produk-terintegrasi.md`.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_vendor_products_pref ON vendor_products(product_id, is_preferred);
CREATE INDEX IF NOT EXISTS idx_suppliers_name_nc    ON suppliers(name COLLATE NOCASE);

UPDATE schema_version SET version = 10 WHERE id = 1;
