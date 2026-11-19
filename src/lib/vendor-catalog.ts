/**
 * The single writer for everything that ties a vendor to a product.
 *
 * Before this module existed, four screens each had their own SQL for the same
 * three rows: `suppliers` find-or-create (three copies), `vendor_products`
 * (four copies) and `vendor_price_list` (one). They drifted — the product form
 * wrote a catalogue link but no price-list row, so the "template PO" the vendor
 * module shows stayed empty for everything typed by hand, and a vendor name
 * entered on the product screen produced a `suppliers` row with no code and no
 * category. Everything that touches those tables now goes through here, so a
 * product, its vendor and the agreed buy price can never disagree.
 *
 * Every helper takes an executor rather than opening a transaction of its own:
 * the caller decides what is atomic (one product save, one vendor block of a
 * bulk sheet), and a half-written catalogue can never be committed by accident.
 *
 * The module also renders a catalogue as the flat sheet the combined import
 * reads (`vendorCatalogSheetRows`), so the file an owner exports is built from the
 * same column contract as the writes it turns back into.
 *
 * Design notes: `docs/spec-vendor-produk-terintegrasi.md`,
 * `docs/spec-sheet-vendor-satu-vendor.md`.
 */
import { query as executeStatement } from "@/lib/db";
import { VENDOR_CODE_PREFIX, highestVendorCode, nextVendorCode } from "@/lib/vendor";
import {
  VENDOR_PRODUCT_COLUMNS,
  VENDOR_SHEET_KEYS,
  dateStamp,
  downloadCsv,
  downloadXlsx,
  type BulkRow,
} from "@/lib/bulk-io";
import { formatAttributeCell, parseVariantAttributes } from "@/lib/variants";
import {
  normalizeVendorName,
  preferredVendorStatement,
  vendorCatalogLinkStatement,
  vendorLastCostStatement,
  vendorPriceStatement,
  type CatalogLinkParams,
  type VendorPriceParams,
  type VendorPriceSource,
} from "@/lib/vendor-catalog-sql";

export { normalizeVendorName, type VendorPriceSource };
export type {
  CatalogLinkParams,
  SqlStatement,
  VendorPriceParams,
} from "@/lib/vendor-catalog-sql";

/**
 * Anything that can run one statement — `runTransaction`'s `tx` or a bare
 * connection. Kept structural so a caller inside a transaction and one outside
 * share the same helpers.
 */
export interface SqlExecutor {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
}

/**
 * The executor for a helper call that is not part of a transaction: one
 * statement on the bare connection. A combobox that only needs a vendor id uses
 * this; anything that writes several rows belongs in a caller transaction.
 */
export const outsideTransaction: SqlExecutor = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async query<T = any>(sql: string, params: unknown[] = []) {
    const result = await executeStatement<T>(sql, params);
    return { rows: result.rows, rowCount: result.rowCount };
  },
};

/**
 * A product's view of its vendors — the three fields `PRODUCTS_SQL` already
 * projects. Structurally typed so the inventory row, the PO row and a test
 * fixture can all be passed without an adapter.
 */
export interface ProductVendorRefs {
  /** `vendor_products.is_preferred` resolved to a vendor id. */
  preferredVendorId?: string | null;
  /** `products.supplier_id`, the product's main vendor. */
  supplierId?: string | null;
  /** Every vendor holding a `vendor_products` row for this product. */
  vendorIds?: string[] | null;
}

/** The vendor fields a caller may offer. */
export interface VendorIdentity {
  name: string;
  code?: string | null;
  legalName?: string | null;
  category?: string | null;
  status?: string | null;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  paymentTermsDays?: number | null;
  leadTimeDays?: number | null;
}

/**
 * Look a vendor up the way a human types it: case- and space-insensitive.
 * `idx_suppliers_name_nc` (schema v10) backs this; the UNIQUE index above it is
 * case-sensitive, so two spellings can pre-exist and the first match wins.
 */
export async function findVendorByName(
  exec: SqlExecutor,
  name: string
): Promise<{ id: string; name: string; code: string | null } | null> {
  const needle = normalizeVendorName(name);
  if (!needle) return null;
  const res = await exec.query<{ id: string; name: string; code: string | null }>(
    `SELECT id, name, code FROM suppliers WHERE name = $1 COLLATE NOCASE LIMIT 1`,
    [needle]
  );
  return res.rows[0] ?? null;
}

/**
 * Highest generated `VND-####` code in the database, so a new vendor continues
 * the sequence. Codes are read raw and ranked numerically in `highestVendorCode`
 * rather than with `ORDER BY code DESC`: a hand-written code like `VND-SURIYA`
 * sorts above every digit lexically, and then the mint restarts at `VND-0001`,
 * which already exists, and the insert dies on `idx_suppliers_code`.
 */
export async function latestVendorCode(exec: SqlExecutor): Promise<string | null> {
  const res = await exec.query<{ code: string | null }>(
    `SELECT code FROM suppliers WHERE code LIKE $1`,
    [`${VENDOR_CODE_PREFIX}-%`]
  );
  return highestVendorCode(res.rows.map((row) => row.code));
}

/**
 * Look a vendor up by its master code. A sheet that carries `Kode Vendor` means
 * that exact row, even when the spelling of the name drifted — the code is the
 * key the owner maintains.
 */
export async function findVendorByCode(
  exec: SqlExecutor,
  code: string
): Promise<{ id: string; name: string; code: string | null } | null> {
  const needle = normalizeVendorName(code).toUpperCase();
  if (!needle) return null;
  const res = await exec.query<{ id: string; name: string; code: string | null }>(
    `SELECT id, name, code FROM suppliers WHERE code = $1 COLLATE NOCASE LIMIT 1`,
    [needle]
  );
  return res.rows[0] ?? null;
}

/**
 * Find the vendor behind a typed/entered name, or create a proper master row.
 *
 * A supplied code is matched first, then the name: an import that carries
 * `VND-0007` beside a slightly different spelling must extend that vendor's
 * catalogue, not open a second master for the same company.
 *
 * Returns `null` for a blank name — "no vendor" is a legitimate answer on the
 * product form, and it is what keeps name-only supplier stubs out of the
 * database: a vendor created here always has a code and a category, so it reads
 * correctly on the vendor list from the moment it exists.
 *
 * An existing vendor is never renamed or re-categorised: masters are additive.
 */
export async function resolveOrCreateVendor(
  exec: SqlExecutor,
  identity: VendorIdentity | string | null | undefined
): Promise<string | null> {
  const input: VendorIdentity = typeof identity === "string" ? { name: identity } : identity ?? { name: "" };
  const name = normalizeVendorName(input.name);
  if (!name) return null;

  const code = normalizeVendorName(input.code).toUpperCase();
  if (code) {
    const byCode = await findVendorByCode(exec, code);
    if (byCode) return byCode.id;
  }

  const existing = await findVendorByName(exec, name);
  if (existing) return existing.id;

  // A `Kode Vendor` in the sheet means that exact code; a blank one continues the
  // sequence. Two writers can mint the same number in the same instant, and there
  // the answer is the next free number, not the row that won: a code says nothing
  // about the vendor's name, so adopting somebody else's vendor would misfile the
  // whole sheet. An explicit code is different — the owner typed it, so the row
  // carrying it is the one they meant.
  const details = [
    name,
    normalizeVendorName(input.legalName) || null,
    normalizeVendorName(input.category).toLowerCase() || "supplier",
    normalizeVendorName(input.status).toLowerCase() || "active",
    normalizeVendorName(input.contactPerson) || null,
    normalizeVendorName(input.phone) || null,
    normalizeVendorName(input.email).toLowerCase() || null,
    Number.isFinite(input.paymentTermsDays as number) ? Math.trunc(Number(input.paymentTermsDays)) : 30,
    Number.isFinite(input.leadTimeDays as number) ? Math.trunc(Number(input.leadTimeDays)) : 0,
  ];
  let minted = code || nextVendorCode(await latestVendorCode(exec));
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const inserted = await exec.query<{ id: string }>(
        `INSERT INTO suppliers
           (code, name, legal_name, category, status, contact_person, phone, email,
            payment_terms_days, lead_time_days)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [minted, ...details]
      );
      return inserted.rows[0]?.id ?? null;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      // Two sheets (or a product form and an import) naming the same vendor in the
      // same instant collide on `idx_suppliers_name`. The other row is the answer.
      if (/idx_suppliers_name|suppliers\.name/i.test(message)) {
        const raced = await findVendorByName(exec, name);
        if (raced) return raced.id;
        break;
      }
      if (/idx_suppliers_code|suppliers\.code/i.test(message)) {
        if (code) {
          const raced = await findVendorByCode(exec, code);
          if (raced) return raced.id;
          break;
        }
        minted = nextVendorCode(await latestVendorCode(exec));
        continue;
      }
      break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Gagal membuat vendor ${name}`);
}

/**
 * Register that a vendor supplies a product.
 *
 * `last_cost` is the one number a later PO starts from, so it always follows the
 * caller. `is_preferred` never downgrades: `MAX()` keeps an existing preferred
 * row preferred until somebody explicitly moves it with `markPreferredVendor`.
 *
 * `min_order_qty` and `lead_time_days` are 0 when the caller has no answer, and
 * 0 means "leave what is stored alone": the columns are NOT NULL, so an omitted
 * value cannot travel as NULL. A brand-new row therefore starts at 0 = "no
 * minimum recorded", which a later sheet or the link dialog can fill in.
 */
export async function upsertVendorCatalogLink(
  exec: SqlExecutor,
  params: CatalogLinkParams
): Promise<void> {
  const statement = vendorCatalogLinkStatement(params);
  await exec.query(statement.sql, statement.args);
}

/**
 * Goods-receipt policy: a delivery tells us what the goods actually cost, and
 * nothing else. Lead time and minimum order belong to the negotiation, not to
 * one truck, and overwriting them here silently reset them on every delivery.
 */
export async function recordVendorLastCost(
  exec: SqlExecutor,
  params: { vendorId: string; productId: string; lastCost: number }
): Promise<void> {
  const statement = vendorLastCostStatement(params);
  await exec.query(statement.sql, statement.args);
}

/**
 * Move "preferred" to one vendor for one product.
 *
 * Exactly one row may carry it, otherwise the PO auto-fill would depend on row
 * order. Call after `upsertVendorCatalogLink` so the target row exists.
 */
export async function markPreferredVendor(
  exec: SqlExecutor,
  params: { vendorId: string; productId: string }
): Promise<void> {
  const statement = preferredVendorStatement(params);
  await exec.query(statement.sql, statement.args);
}

/**
 * The agreed buy price for one (vendor, variant, pack) — the PO template.
 *
 * The two policies (`overwrite` vs `gap-only`) and the rule that a zero price
 * is never written live in `vendorPriceStatement`, which the demo seeder builds
 * from as well, so a seeded catalogue can no longer arrive without a price row.
 */
export async function upsertVendorPrice(
  exec: SqlExecutor,
  params: VendorPriceParams
): Promise<void> {
  const statement = vendorPriceStatement(params);
  if (!statement) return;
  await exec.query(statement.sql, statement.args);
}

/**
 * Which vendor a purchase order should start from for this product.
 *
 * Precedence is deliberate: an explicitly preferred vendor beats the product's
 * main vendor, because "preferred" is the owner saying *buy this one from them*.
 * The main vendor is next. A single catalogue link still resolves, but several
 * without a preference returns `null` on purpose — guessing between two
 * suppliers would hide a decision the buyer has to make.
 *
 * Inactive and blacklisted vendors are skipped: auto-filling one would put the
 * buyer on a path the vendor screen says not to order from.
 */
export function defaultVendorFor(
  product: ProductVendorRefs | null | undefined,
  vendors: Array<{ id: string; status?: string | null }> | null | undefined
): string | null {
  if (!product) return null;
  const usable = (id?: string | null): string | null => {
    if (!id) return null;
    const vendor = (vendors ?? []).find((candidate) => candidate.id === id);
    // An unknown id is not filtered out: callers may hand a short vendor list.
    if (vendor && vendor.status && vendor.status !== "active") return null;
    return id;
  };

  const preferred = usable(product.preferredVendorId);
  if (preferred) return preferred;
  const main = usable(product.supplierId);
  if (main) return main;

  const linked = (product.vendorIds ?? []).map(usable).filter((id): id is string => Boolean(id));
  const unique = Array.from(new Set(linked));
  return unique.length === 1 ? unique[0] : null;
}

/** ------------------------------------------------------------- catalogue → sheet */

/** One joined row of the catalogue query, before it becomes sheet cells. */
interface CatalogSheetRow {
  vendor_code: string | null;
  vendor_name: string;
  vendor_category: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  payment_terms_days: number | null;
  sku: string | null;
  product_name: string | null;
  product_category: string | null;
  sell_price: number | null;
  stock: number | null;
  min_stock_level: number | null;
  unit_name: string | null;
  conversion_factor: number | null;
  buy_price: number | null;
  min_order_qty: number | null;
  vendor_sku: string | null;
  variant_id: string | null;
  variant_sku: string | null;
  variant_attributes: string | null;
  variant_barcode: string | null;
}

/**
 * The vendor catalogue as sheet rows, in the shape the combined vendor + product
 * import reads, so a file can be exported, repriced in Excel and handed back
 * without a column being retyped.
 *
 * Without `vendorId` that is every vendor's catalogue — one line per (vendor,
 * product, variant, pack) with the vendor repeated on every line, which is what
 * this export has always written. With a `vendorId` it is the one-vendor sheet the
 * template asks for: row 1 carries the vendor and no product, rows 2+ carry that
 * vendor's products, variants and packs with the vendor columns blank for
 * `carryVendorForward()` to fill.
 *
 * Either shape re-imports as a no-op: every line names an existing `SKU`, an
 * existing variant by its existing code, and an existing pack by its existing
 * unit name. That is the guarantee the tests assert, and the reason the row
 * builder lives next to the writers rather than inside one screen.
 */
export async function vendorCatalogSheetRows(vendorId?: string | null): Promise<BulkRow[]> {
  /*
   * One line per (vendor, product, variant, pack): the shape the dialog reads
   * back. `vendor_price_list` is preferred, then the pack's own buy price, then
   * the catalogue's last cost — the same precedence the PO screen uses, so an
   * export shows what ordering would actually quote.
   */
  const res = await executeStatement<CatalogSheetRow>(
    `SELECT
       v.code AS vendor_code, v.name AS vendor_name, v.category AS vendor_category,
       v.contact_person, v.phone, v.email, v.payment_terms_days,
       p.sku, p.name AS product_name, p.category AS product_category,
       p.min_stock_level, vp.vendor_sku, vp.min_order_qty,
       pv.id AS variant_id, pv.sku AS variant_sku, pv.attributes AS variant_attributes,
       pv.barcode AS variant_barcode,
       COALESCE(u.name, 'Pcs') AS unit_name,
       COALESCE(u.conversion_factor, 1) AS conversion_factor,
       COALESCE(u.price, pv.price, 0) AS sell_price,
       COALESCE(vpl.buy_price, u.cost, vp.last_cost, p.cost_price) AS buy_price,
       (SELECT COALESCE(SUM(b.quantity_current), 0) FROM product_batches b
         WHERE b.product_id = p.id) AS stock
     FROM suppliers v
     LEFT JOIN vendor_products vp ON vp.vendor_id = v.id
     LEFT JOIN products p ON p.id = vp.product_id
     LEFT JOIN product_variants pv ON pv.product_id = p.id
     LEFT JOIN product_units u ON u.variant_id = pv.id
     LEFT JOIN vendor_price_list vpl
       ON vpl.vendor_id = v.id AND vpl.variant_id = pv.id AND vpl.unit_name = u.name
     WHERE ($1 IS NULL OR v.id = $1)
     ORDER BY v.name ASC, p.name ASC, pv.created_at ASC, conversion_factor ASC`,
    [vendorId ?? null]
  );

  /*
   * `Kode Varian` is only load-bearing when a product has several variants or the
   * variant carries axes, so a catalogue of plain products exports exactly the
   * columns it always did.
   */
  const variantIds = new Map<string, Set<string>>();
  for (const row of res.rows) {
    const key = row.sku ?? row.product_name ?? "";
    if (!key || !row.variant_id) continue;
    const seen = variantIds.get(key) ?? new Set<string>();
    seen.add(row.variant_id);
    variantIds.set(key, seen);
  }

  const rows: BulkRow[] = res.rows.map((row) => {
    const key = row.sku ?? row.product_name ?? "";
    const attributes = parseVariantAttributes(row.variant_attributes);
    const named = Object.keys(attributes).length > 0 || (variantIds.get(key)?.size ?? 0) > 1;
    return {
      vendorCode: row.vendor_code ?? "",
      vendorName: row.vendor_name ?? "",
      vendorCategory: row.vendor_category ?? "",
      contactPerson: row.contact_person ?? "",
      phone: row.phone ?? "",
      email: row.email ?? "",
      terms: String(row.payment_terms_days ?? ""),
      sku: row.sku ?? "",
      productName: row.product_name ?? "",
      productCategory: row.product_category ?? "",
      price: String(row.sell_price ?? ""),
      stock: String(row.stock ?? ""),
      minStock: String(row.min_stock_level ?? ""),
      unit: row.unit_name ?? "",
      factor: String(row.conversion_factor ?? 1),
      buyPrice: String(row.buy_price ?? ""),
      minOrder: String(row.min_order_qty ?? ""),
      vendorSku: row.vendor_sku ?? "",
      variantSku: named ? row.variant_sku ?? "" : "",
      variantAttrs: named ? formatAttributeCell(attributes) : "",
      barcode: named ? row.variant_barcode ?? "" : "",
    };
  });

  if (!vendorId || rows.length === 0) return rows;

  // The one-vendor shape: the vendor says itself once, on the first row, and the
  // product rows below inherit it. Nothing about the products changes — only how
  // often the file repeats the vendor's address block.
  const vendorOnly: BulkRow = { ...rows[0] };
  for (const key of Object.keys(vendorOnly)) {
    if (!VENDOR_SHEET_KEYS.includes(key)) vendorOnly[key] = "";
  }
  return [
    vendorOnly,
    ...rows.map((row) => {
      const inherited: BulkRow = { ...row };
      for (const key of VENDOR_SHEET_KEYS) inherited[key] = "";
      return inherited;
    }),
  ];
}

/** The file name a one-vendor sheet is known by, code first so it sorts per vendor. */
export function vendorSheetName(
  vendorCode: string | null | undefined,
  format: "csv" | "xlsx"
): string {
  const slug = String(vendorCode ?? "").trim().replace(/[^\w.-]+/g, "-") || "vendor";
  return `sheet_vendor_${slug}_${dateStamp()}.${format}`;
}

/**
 * Hand one vendor's sheet to the operator: the same rows `vendorCatalogSheetRows`
 * builds, in the same two formats the import accepts. Returns the line count so
 * the caller can say what it wrote without asking the database again.
 */
export async function downloadVendorSheet(
  vendorId: string,
  vendorCode: string | null | undefined,
  format: "csv" | "xlsx"
): Promise<number> {
  const rows = await vendorCatalogSheetRows(vendorId);
  const name = vendorSheetName(vendorCode, format);
  if (format === "csv") downloadCsv(name, rows, VENDOR_PRODUCT_COLUMNS);
  else downloadXlsx(name, rows, VENDOR_PRODUCT_COLUMNS, "Vendor");
  return rows.length;
}
