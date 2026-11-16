/**
 * The SQL behind the vendor ⇄ product relationship, with no runtime around it.
 *
 * `vendor-catalog.ts` is the single *writer* the screens call, but the demo
 * seeder (`server/demo/ledger.ts`) only builds a list of statements — it never
 * opens a transaction, so it cannot import that module. Rather than let the
 * seeder keep a fifth copy of the same INSERT, the statements themselves live
 * here: one definition, two callers, and demo data that can no longer drift
 * into a catalogue without a price list.
 *
 * Placeholders are plain `?` so the same string works for libSQL directly and
 * through `src/lib/db`, whose `translate()` leaves `?` alone. Every builder
 * returns its arguments in the order they appear in the SQL.
 *
 * Design notes: `docs/spec-vendor-produk-terintegrasi.md`.
 */

/** Where a price-list row came from; stored in `notes` for traceability. */
export type VendorPriceSource =
  | "form produk"
  | "katalog vendor"
  | "import"
  | "penerimaan barang"
  | "seed demo";

export interface CatalogLinkParams {
  vendorId: string;
  productId: string;
  vendorSku?: string | null;
  lastCost: number;
  leadTimeDays?: number | null;
  minOrderQty?: number | null;
  isPreferred?: boolean;
  /** Only the seeder needs to pre-assign the row id; screens let the default run. */
  id?: string | null;
}

export interface VendorPriceParams {
  vendorId: string;
  variantId: string;
  unitName: string;
  conversionFactor: number;
  buyPrice: number;
  minQty?: number | null;
  userId?: string | null;
  mode: "overwrite" | "gap-only";
  source: VendorPriceSource;
}

/** `{ sql, args }` in the shape `runTransaction`, `query()` and the seeder all take. */
export interface SqlStatement {
  sql: string;
  args: unknown[];
}

/** Trim and collapse inner spaces, so a sheet cell and a typed form agree. */
export function normalizeVendorName(name: string | null | undefined): string {
  return String(name ?? "").trim().replace(/\s+/g, " ");
}

/**
 * Register that a vendor supplies a product.
 *
 * `last_cost` is the one number a later PO starts from, so it always follows the
 * caller. `is_preferred` never downgrades: `MAX()` keeps an existing preferred
 * row preferred until somebody explicitly moves it.
 *
 * `min_order_qty` and `lead_time_days` are 0 when the caller has no answer, and
 * 0 means "leave what is stored alone": the columns are NOT NULL, so an omitted
 * value cannot travel as NULL. A brand-new row therefore starts at 0 = "no
 * minimum recorded", which a later sheet or the link dialog can fill in.
 */
export function vendorCatalogLinkStatement(params: CatalogLinkParams): SqlStatement {
  const columns = [
    "vendor_id",
    "product_id",
    "vendor_sku",
    "last_cost",
    "lead_time_days",
    "min_order_qty",
    "is_preferred",
  ];
  const args: unknown[] = [
    params.vendorId,
    params.productId,
    normalizeVendorName(params.vendorSku) || null,
    Math.max(0, Math.round(Number(params.lastCost) || 0)),
    Math.max(0, Math.trunc(Number(params.leadTimeDays) || 0)),
    Number(params.minOrderQty) > 0 ? Number(params.minOrderQty) : 0,
    params.isPreferred ? 1 : 0,
  ];

  // The seeder knows the row id up front; screens do not and must not care.
  if (params.id) {
    columns.unshift("id");
    args.unshift(params.id);
  }

  return {
    sql: `INSERT INTO vendor_products (${columns.join(", ")})
       VALUES (${columns.map(() => "?").join(", ")})
     ON CONFLICT (vendor_id, product_id) DO UPDATE SET
       last_cost     = excluded.last_cost,
       vendor_sku    = COALESCE(excluded.vendor_sku, vendor_products.vendor_sku),
       lead_time_days = CASE WHEN excluded.lead_time_days > 0
                             THEN excluded.lead_time_days
                             ELSE vendor_products.lead_time_days END,
       min_order_qty = CASE WHEN excluded.min_order_qty > 0
                            THEN excluded.min_order_qty
                            ELSE vendor_products.min_order_qty END,
       is_preferred  = MAX(excluded.is_preferred, vendor_products.is_preferred)`,
    args,
  };
}

/**
 * Goods-receipt policy: a delivery tells us what the goods actually cost, and
 * nothing else. Lead time and minimum order belong to the negotiation, not to
 * one truck, and overwriting them here silently reset them on every delivery.
 */
export function vendorLastCostStatement(params: {
  vendorId: string;
  productId: string;
  lastCost: number;
}): SqlStatement {
  return {
    sql: `INSERT INTO vendor_products (vendor_id, product_id, last_cost, min_order_qty)
       VALUES (?, ?, ?, 1)
     ON CONFLICT (vendor_id, product_id) DO UPDATE SET last_cost = excluded.last_cost`,
    args: [params.vendorId, params.productId, Math.max(0, Math.round(Number(params.lastCost) || 0))],
  };
}

/**
 * Move "preferred" to one vendor for one product.
 *
 * Exactly one row may carry it, otherwise the PO auto-fill would depend on row
 * order. Run after `vendorCatalogLinkStatement` so the target row exists.
 */
export function preferredVendorStatement(params: {
  vendorId: string;
  productId: string;
}): SqlStatement {
  return {
    sql: `UPDATE vendor_products
        SET is_preferred = CASE WHEN vendor_id = ? THEN 1 ELSE 0 END
      WHERE product_id = ?`,
    args: [params.vendorId, params.productId],
  };
}

/**
 * The agreed buy price for one (vendor, variant, pack) — the PO template.
 *
 * Two policies, because two writers mean different things:
 *  * `overwrite` — the owner typed it (vendor screen, product form, bulk sheet),
 *    so it *is* the agreement and replaces the old number;
 *  * `gap-only` — an invoice arrived and no agreement existed; fill the gap and
 *    never touch a negotiated price.
 *
 * Returns `null` when there is nothing to write. A zero price is skipped:
 * "not agreed yet" must stay empty rather than become a free-goods agreement
 * that the PO then prefers over the product's own cost.
 */
export function vendorPriceStatement(params: VendorPriceParams): SqlStatement | null {
  const unitName = normalizeVendorName(params.unitName);
  const buyPrice = Math.round(Number(params.buyPrice) || 0);
  if (!unitName || buyPrice <= 0) return null;

  const factor = Number(params.conversionFactor) > 0 ? Number(params.conversionFactor) : 1;
  const minQty = Number(params.minQty) > 0 ? Number(params.minQty) : 1;
  const conflict =
    params.mode === "overwrite"
      ? `DO UPDATE SET
           conversion_factor = excluded.conversion_factor,
           buy_price         = excluded.buy_price,
           min_qty           = excluded.min_qty,
           status            = 'active',
           notes             = excluded.notes,
           updated_by        = excluded.updated_by,
           updated_at        = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
      : `DO NOTHING`;

  return {
    sql: `INSERT INTO vendor_price_list
       (vendor_id, variant_id, unit_name, conversion_factor, buy_price, min_qty,
        status, notes, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
     ON CONFLICT (vendor_id, variant_id, unit_name) ${conflict}`,
    args: [
      params.vendorId,
      params.variantId,
      unitName,
      factor,
      buyPrice,
      minQty,
      params.source,
      params.userId ?? null,
    ],
  };
}
