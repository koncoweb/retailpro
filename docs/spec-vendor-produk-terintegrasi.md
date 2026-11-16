# RetailPro — Vendor-Produk Terintegrasi (one writer, auto-vendor PO)

| | |
|---|---|
| Document | `docs/spec-vendor-produk-terintegrasi.md` |
| Status | **Shipped** — schema v10, all write paths rerouted (verified 2026-11-17) |
| Date | 2026-11-17 |
| Replaces | four ad-hoc copies of "find-or-create supplier" and "link product to vendor" |
| Schema impact | migration `010`, schema version 9 → **10** — indexes only, **no new table or column** |
| Builds on | [spec-varian-harga-vendor.md](spec-varian-harga-vendor.md) (v6: `product_variants`, `vendor_price_list`) and [spec-purchase-order.md](spec-purchase-order.md) (v5: PO lifecycle) |

> **Status note (2026-11-17).** This body is a point-in-time design record and is kept frozen.
> Everything in it is in the codebase: `src/lib/vendor-catalog.ts` + `src/lib/vendor-catalog-sql.ts`
> (single writer), `src/lib/product-write.ts` (one product writer for form, import and vendor
> screen), `src/lib/vendor-import.ts` (pure sheet planner), `src/components/vendors/`
> `VendorProductImport.tsx` (the flat sheet UI), and the vendor auto-fill in
> `src/components/inventory/PurchaseOrderModal.tsx`. Proven by `src/lib/vendor-catalog.test.ts`
> (25), `src/lib/vendor-import.test.ts` (24, including the e2e fixture itself), the demo-seed
> invariants in `db/__tests__/demo-tenant.test.ts`, and `tests/vendor-catalog.e2e.ts` (4 browser
> cases).

---

## 0. Summary

The vendor data model was already complete. The **writers** were not.

| Leak | Evidence at the time |
|---|---|
| The product form wrote `vendor_products` but never `vendor_price_list`, so the "template PO" stayed empty for anything typed by hand | `Inventory.tsx` L1003-1010 |
| A vendor name typed on the product screen produced `INSERT INTO suppliers (name)` — no code, no category | `Inventory.tsx` L599-610, `AddProductModal.tsx` L592 |
| `is_preferred` was never set by any screen, so "who should a PO start from" had no answer | grep: 0 writers |
| The vendor form never touched products at all | `VendorFormModal.tsx` |
| Importing vendors made orphan `suppliers` rows; importing products made different orphans | `Vendors.tsx` L381-476 |
| A PO required picking the vendor first; changing the vendor **silently deleted** the other vendor's lines | `PurchaseOrderModal.tsx` L216-224, L706-713 |
| Three copies of find-or-create, four copies of the catalogue link, one of the price upsert — and they had drifted | `Inventory.tsx`, `AddProductModal.tsx`, `VendorDetail.tsx`, `goods-receipt.ts` |

Fixing the UI alone would have left six ways to write the same three rows. This change makes
**one module** the only author of those rows and then routes every screen, sheet and seed
through it.

---

## 1. Decisions (locked before implementation)

1. **One vendor per purchase order, plus auto-fill.** A PO header carries one `supplier_id`
   (unchanged), so a draft is a single-vendor document. What changes is who fills it: picking a
   product resolves that product's vendor. No schema change for POs.
2. **One flat import sheet**, one row = vendor × product × pack. Vendor columns repeat on every
   line — that is what makes the sheet readable in Excel and what `keepValid(rows, ["vendorName"])`
   enforces.
3. **Masters are additive; prices may be updated.** Re-importing a sheet never renames a vendor
   or a product that already exists, but `vendor_products.last_cost` and
   `vendor_price_list.buy_price` follow the sheet when it carries a number.
4. **Product entry from the vendor screen reuses `AddProductModal`**, prefilled with
   `defaultSupplier`, rather than adding a second inline product form.

---

## 2. Why no table and no column

| Need | Already available |
|---|---|
| "which vendor supplies this product" | `vendor_products` UNIQUE `(vendor_id, product_id)` with `vendor_sku`, `last_cost`, `min_order_qty`, `lead_time_days` |
| "who should a PO start from" | `vendor_products.is_preferred` + `products.supplier_id` |
| "what did we agree to pay per pack" | `vendor_price_list` UNIQUE `(vendor_id, variant_id, unit_name)` with `conversion_factor`, `buy_price`, `min_qty`, `status` |
| "where did this price come from" | `vendor_price_list.notes` — used as provenance (`import`, `form produk`, `katalog vendor`, `penerimaan barang`, `seed demo`) instead of adding a column |
| "one vendor per PO" | `purchase_orders.supplier_id` |

Only two indexes were missing, because two query shapes became hot:

```sql
-- db/migrations/010_vendor_catalog_indexes.sql
CREATE INDEX IF NOT EXISTS idx_vendor_products_pref ON vendor_products(product_id, is_preferred);
CREATE INDEX IF NOT EXISTS idx_suppliers_name_nc    ON suppliers(name COLLATE NOCASE);
```

`idx_vendor_products_pref` backs the new `preferred_vendor_id` subselect in `PRODUCTS_SQL`;
`idx_suppliers_name_nc` backs the case-insensitive name lookup that imports and typed vendor
names depend on. **Known limitation:** the older `idx_suppliers_name` is UNIQUE and
case-sensitive, so two spellings of one vendor can already coexist in a tenant; deduplicating
existing rows is out of scope.

---

## 3. The single writer

`src/lib/vendor-catalog.ts` (296 lines) is the only module allowed to author a vendor⇄product
relationship. Every helper takes an executor, not a transaction, so the caller decides what is
atomic:

| Helper | Contract |
|---|---|
| `normalizeVendorName` | trim + collapse inner spaces (case is preserved — `unit_name` must keep matching `product_units.name`) |
| `findVendorByName` / `findVendorByCode` | `WHERE name = $1 COLLATE NOCASE` / code first, so a sheet carrying `VND-0007` extends that vendor even when the spelling drifted |
| `resolveOrCreateVendor` | returns an id; mints `VND-xxxx` from `MAX(code) LIKE 'VND-%'` **inside** the transaction; **never updates** an existing vendor |
| `upsertVendorCatalogLink` | `ON CONFLICT DO UPDATE`; `last_cost` always follows the caller, `is_preferred` never downgrades (`MAX()`), 0 means "leave stored `min_order_qty`/`lead_time_days` alone" |
| `markPreferredVendor` | moves preference: exactly one `is_preferred = 1` row per product |
| `recordVendorLastCost` | goods receipt policy — cost only, never lead time / MOQ |
| `upsertVendorPrice` | two modes: `overwrite` (owner typed it) and `gap-only` (`DO NOTHING`, an invoice filling a hole); a zero price is never written |
| `defaultVendorFor(product, vendors)` | pure resolver, skipped for vendors whose `status !== 'active'` |

The SQL itself lives one level lower, in `src/lib/vendor-catalog-sql.ts` (201 lines), which
imports nothing. That split exists for one reason: the demo seeder
(`server/demo/ledger.ts`) only **builds** statements — it never opens a transaction — so it
cannot import a module that pulls in `src/lib/db`. Sharing the statement builders instead means
a seeded catalogue can no longer arrive without a price row, which `db/__tests__/demo-tenant.test.ts`
now asserts (`notes = 'seed demo'` on every price row; no `vendor_products` row without a
base-pack `vendor_price_list` row; `SUM(is_preferred) = 1` per product).

`src/lib/goods-receipt.ts` L317-330 was replaced by a call to `upsertVendorPrice(mode:
'gap-only')`, so the receipt policy has exactly one definition.

---

## 4. The single product writer

`src/lib/product-write.ts` (660 lines) is an extraction, not a rewrite: the body of
`handleSaveProduct` and the per-row block of `handleImport` moved out of `Inventory.tsx`
(≈1,100 lines of UI) into two functions.

```ts
saveProductDraft(params: { product, editing?, warehouses, userId, branchId,
                           mayEditVariant, mayEditVendorPrice, vendorLink? })
insertImportedProduct(tx, row, { warehouseId, vendorId })
```

`Inventory.tsx` is now a thin caller and `VendorDetail.tsx` uses the same functions — there is no
second product writer. Two write rules were added inside it, which is where the §0 leaks close:

1. **Main vendor.** A vendor typed as text becomes a real master row (`resolveOrCreateVendor`),
   gets a catalogue link with `isPreferred: true`, and `markPreferredVendor` moves preference to
   it; `products.supplier_id` is set to the same vendor.
2. **Buy prices.** For every (variant, pack) with `cost > 0`: `upsertVendorPrice(mode:
   'overwrite')` when the operator holds `manage_vendor_prices`, otherwise `mode: 'gap-only'` —
   so a product form can never trample a negotiated price it has no business touching.

Everything stays inside one `runTransaction()` and one `logAuditTx()`.

---

## 5. The flat sheet

`VENDOR_PRODUCT_COLUMNS` in `src/lib/bulk-io.ts` is the single source of the header, used by the
template download, the catalogue export and the importer:

```
Kode Vendor · Nama Vendor · Kategori Vendor · Kontak · Telepon · Email · Termin (hari) ·
SKU · Nama Produk · Kategori Produk · Harga Jual · Stok Awal · Stok Minimum ·
Satuan · Faktor · Harga Beli · Min Order · Vendor SKU
```

Grouping rules (`groupVendorProductRows`) and the write plan (`planVendorProductImport`, pure,
542 lines in `src/lib/vendor-import.ts`) are separate from execution, which is what makes them
unit-testable:

* **Vendor key** — `Kode Vendor` (upper-cased) when present, otherwise the normalised name. A row
  with no product columns is a vendor-only row.
* **Product key** — `SKU` when filled; an empty SKU with a known product name **links** the
  existing product rather than duplicating it or inventing a SKU; a filled SKU that already exists
  skips the product but still writes its price lines.
* **Packs** — one row = one pack; an empty `Satuan` is the base pack. Every product needs a factor
  1 row; if the sheet has none, any row's `Harga Beli` is promoted to the base pack. No variant or
  attribute import (out of scope).
* **Pack actions** — `create` | `overwrite` | `fill` | `skip`, so the preview can say "4 harga beli
  (4 diperbarui)" before anything is written.

Execution policy in `VendorProductImport.tsx`: read the sheet, normalise, group, resolve the
existing universe in **one** pass (`suppliers`, `products`, and `vendor_products` for the vendor
ids in the sheet), show the preview, then **one `runTransaction()` per vendor block** — a cloud
connection must not roll back a 2,000-row file because row 1,900 was malformed, and one bad
vendor must not undo its neighbours. Every write is audited with `via: "import vendor + produk"`.

The same screen now exports the catalogue in exactly this shape, so an export can be edited and
imported back.

---

## 6. Purchase order auto-fill

`PRODUCTS_SQL` gained one projection:

```sql
(SELECT vendor_id FROM vendor_products WHERE product_id = p.id AND is_preferred = 1 LIMIT 1)
  AS preferred_vendor_id
```

`defaultVendorFor()` resolves **preferred → main (`supplier_id`) → sole linked vendor**, skipping
vendors that are not `active`. Ambiguity is answered with `null` on purpose: two linked vendors and
no preference is a decision the buyer has to make, not a guess the app should hide.

Behaviour:

* No vendor chosen → the picker lists **all** products, each row captioned with the vendor it would
  order from (`PT Sumber Makmur`). Choosing one applies its vendor, prefills the expected date from
  `lead_time_days`, and loads the agreed prices that already existed.
* Vendor chosen → products are filtered to that vendor, as before (one PO, one vendor).
* The vendor field shows the caption **"Vendor (otomatis dari produk)"** with an **Ubah** button, so
  an auto-filled value is visibly editable.
* Switching vendor with foreign lines in the cart now opens an **AlertDialog** naming the vendor and
  counting the lines at stake, replacing the silent drop.
* "Auto-fill from low stock" and "fill from template" group their lines by `defaultVendorFor`;
  more than one vendor means the lines are not written and the buyer is told which vendor needs its
  own PO — `validatePurchaseOrder` still requires a single `supplierId`.

---

## 7. Permissions

No new keys. The combined flow requires **`manage_variants` AND `manage_vendor_prices`**: nested
`PermissionGate`s in the UI and a refusal inside `src/lib/product-write.ts` — enforcement is not
only a hidden button. `manage_sell_prices` still owns sell prices.

---

## 8. Out of scope

Multi-vendor POs (one header, one `supplier_id`), variant/attribute import, quantity price tiers,
PPN and landed cost, server-side authorisation (the SPA still holds a full tenant token — see
[spec-varian-harga-vendor.md](spec-varian-harga-vendor.md) §15 poin 10), and deduplication of vendors
that already exist under two spellings.

---

## 9. How to re-verify (measured 2026-11-17)

Every number quoted in this document comes from a command. If a command disagrees with the table
below, the table is the bug — fix the table, do not restate the old figure.

| Command | Expected result |
|---|---|
| `npm run typecheck` | 0 errors (app program) |
| `npx tsc -p tsconfig.node.json --noEmit` | 0 errors (server, api, db, scripts) |
| `npx vitest run` | **30 files / 419 tests** passed — `vendor-catalog.test.ts` (25) and `vendor-import.test.ts` (24) are the two new ones, `schema.test.ts` guards the v10 indexes, `demo-tenant.test.ts` the seed invariants |
| `npx eslint <files changed by this release>` | 0 errors; the repo-wide `no-explicit-any` backlog (25 errors in dashboards/reports) predates this change and is untouched |
| `npx e2e run tests/vendor-catalog.e2e.ts` | 4 browser cases passed (+ 1 auth setup), all four write paths observed in a real Chromium session |
| `npm run audit:sql` | 530 literals collected, 471 replayed, 59 dynamic, 8 dropped as comment text, 2 known findings in `translate.test.ts` |
| `npm run docs:check` | OK — schema v10 agrees in all three places. The run prints how many files, table rows and `§` refs it actually read; only the verdict is quoted here, because row and anchor counts move with every edit and a doc that restates them is the exact bug this gate exists to catch |
| `npm run schema:apply-all` | dry-run, every tenant `up to date (v10)`; `--apply` is idempotent (two `CREATE INDEX IF NOT EXISTS`) |

The last two rows are new in this follow-up. `audit:sql` used to harvest SQL out of comments, which
manufactured findings for prose; `docs:check` did not exist, so every broken table and every stale
count in the release docs had to be found by reading. Both are described in
[kendala-solusi.md](kendala-solusi.md) KS-49, and `docs:check` ships with a positive control:
`node scripts/check-docs.mjs --root scripts/__fixtures__/docs-check` must report exactly 8 problems,
which is how a gate that silently checks nothing gets caught.
