/**
 * Turning a flat "vendor + product" sheet into the rows the writers need.
 *
 * The shape a file is asked to have is ONE VENDOR PER FILE: a row carrying only
 * the vendor's columns, then rows carrying products with the vendor columns left
 * blank. Either way the sheet is read as lines of (vendor, product, variant,
 * pack) — the vendor of a continuation line is the one above it, and that is the
 * shape the catalogue export writes too, so a file can be exported, edited in
 * Excel and imported back.
 *
 * Deliberately pure: no SQL, no React, so the grouping rules can be unit tested.
 * What the database already holds is read by the caller and handed to
 * `planVendorProductImport()` as plain rows, so the decision of what a sheet will
 * change — and what it will leave alone — is testable without a connection. The
 * caller still owns the writes and therefore what is atomic.
 *
 * Design notes: `docs/spec-vendor-produk-terintegrasi.md`,
 * `docs/spec-sheet-vendor-satu-vendor.md`.
 */
import { parseIdNumber, VENDOR_SHEET_KEYS, type BulkRow } from "./bulk-io";
import { normalizeVendorName } from "./vendor-catalog";
import { parseVendorPpn } from "./vendor";
import {
  groupsFromAttributes,
  parseAttributeCell,
  variantKey,
  type VariantAttributeGroup,
  type VariantAttributes,
} from "./variants";

/** The vendor half of a row group. Blank fields are left for the master to fill. */
export interface VendorSeed {
  /** Sheet key: uppercase code when given, otherwise the normalised name. */
  key: string;
  code: string | null;
  name: string;
  category: string | null;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  paymentTermsDays: number | null;
  ppnEnabled: boolean;
  /** How many sheet lines produced this vendor; used for the summary counts. */
  rowCount: number;
}

/**
 * One pack (pecahan) of one variant, priced the way the vendor quoted it.
 *
 * `variantSku`/`variantKey` come from the sheet's `Kode Varian`/`Atribut Varian`
 * columns and say WHICH variant this pack line is quoting. Both are empty for a
 * line written against a product without variants — which is every file that
 * existed before those columns, and stays valid.
 */
export interface PackSeed {
  unitName: string;
  conversionFactor: number;
  /** Buy price per pack. 0 = the sheet carried no price for this pack. */
  buyPrice: number;
  /** Sell price per pack. 0 = not given. */
  sellPrice: number;
  minOrderQty: number | null;
  vendorSku: string | null;
  variantSku: string | null;
  /** `variantKey(attributes)` of the cell, "" when the line names no variant. */
  variantKey: string;
  /**
   * The parsed `Atribut Varian` cell, `{}` when the line names no variant. The
   * one place a sheet line says what a variant IS, so a variant the product does
   * not have yet can be created from the line instead of being reported.
   */
  attributes: VariantAttributes;
  /** `Barcode Varian` of this line's variant; null unless a line gives one. */
  barcode: string | null;
  /**
   * True when `groupVendorProductRows` invented this line because a variant was
   * quoted only in cartons. It exists so a NEW product still gets a factor-1
   * pack; on an existing product its price is another pack's number and must
   * never be written.
   */
  synthesized?: boolean;
}

/**
 * A product as the sheet describes it.
 *
 * `sku` empty means "the operator did not type one" — the caller then either
 * links by name or lets the app mint a SKU. One line describes ONE (variant,
 * pack); a product with three variants and two packs each is six lines repeating
 * the same `SKU`. A product the database already has keeps its own attribute
 * axes, and lines naming a variant it lacks become variant writes the caller may
 * apply (`docs/spec-sheet-vendor-satu-vendor.md`).
 */
export interface ProductSeed {
  sku: string | null;
  name: string;
  category: string | null;
  /** Sell price of the base pack; the product summary the table shows. */
  price: number;
  /** Buy price of the base pack. */
  cost: number;
  stock: number;
  minStock: number;
  packs: PackSeed[];
}

/** One vendor with every product its lines mention. */
export interface VendorProductGroup {
  vendor: VendorSeed;
  products: ProductSeed[];
}

/** A vendor without a name and without a code cannot be found or created. */
function vendorKeyOf(row: BulkRow): string | null {
  const code = normalizeVendorName(row.vendorCode).toUpperCase();
  if (code) return `code:${code}`;
  const name = normalizeVendorName(row.vendorName).toLowerCase();
  return name ? `name:${name}` : null;
}

/** First value written wins: the sheet repeats a vendor on every line. */
function firstText(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const text = normalizeVendorName(value);
    if (text) return text;
  }
  return null;
}

function firstNumber(values: Array<string | number | null | undefined>): number | null {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = parseIdNumber(value);
    if (parsed > 0) return parsed;
  }
  return null;
}

function productKeyOf(row: BulkRow): string | null {
  const sku = normalizeVendorName(row.sku).toUpperCase();
  if (sku) return `sku:${sku}`;
  const name = normalizeVendorName(row.productName).toLowerCase();
  return name ? `name:${name}` : null;
}

/**
 * A line with no `Satuan` is the base pack; a named pack without a usable factor
 * still holds one unit of itself.
 */
function packOf(row: BulkRow): PackSeed {
  const unitName = normalizeVendorName(row.unit) || "Pcs";
  const givenFactor = parseIdNumber(row.factor ?? "");
  const conversionFactor = normalizeVendorName(row.unit) ? (givenFactor > 0 ? givenFactor : 1) : 1;
  const attributes = parseAttributeCell(row.variantAttrs);
  return {
    unitName,
    conversionFactor,
    buyPrice: Math.max(0, Math.round(parseIdNumber(row.buyPrice ?? ""))),
    sellPrice: Math.max(0, Math.round(parseIdNumber(row.price ?? ""))),
    minOrderQty: firstNumber([row.minOrder]),
    vendorSku: firstText([row.vendorSku]),
    variantSku: normalizeVendorName(row.variantSku) || null,
    variantKey: variantKey(attributes),
    attributes,
    barcode: normalizeVendorName(row.barcode) || null,
  };
}

/**
 * Which variant a pack line is quoting.
 *
 * `Kode Varian` wins over `Atribut Varian`, and both are empty on a line written
 * against a product without variants — so every file that predates those columns
 * groups exactly as it did before.
 */
function variantIdentityOf(pack: PackSeed): string {
  if (pack.variantSku) return `sku:${pack.variantSku.toUpperCase()}`;
  return pack.variantKey ? `attrs:${pack.variantKey}` : "";
}

/** Merge a repeated pack: the first non-zero value for each field wins. */
function mergePack(existing: PackSeed, incoming: PackSeed): void {
  if (!existing.buyPrice && incoming.buyPrice) existing.buyPrice = incoming.buyPrice;
  if (!existing.sellPrice && incoming.sellPrice) existing.sellPrice = incoming.sellPrice;
  if (existing.minOrderQty == null && incoming.minOrderQty != null) {
    existing.minOrderQty = incoming.minOrderQty;
  }
  if (!existing.vendorSku && incoming.vendorSku) existing.vendorSku = incoming.vendorSku;
  // A barcode typed on either line belongs to the same variant, so it survives
  // the merge; the variant's axes are part of the merge key and cannot differ.
  if (!existing.barcode && incoming.barcode) existing.barcode = incoming.barcode;
  // A factor typed on a later line is the correction, not a duplicate.
  if (incoming.conversionFactor > 1 && existing.conversionFactor === 1) {
    existing.conversionFactor = incoming.conversionFactor;
  }
}

/**
 * Vendor columns a continuation line inherits from the line above.
 *
 * Only the vendor's own fields: a line's product columns always describe that
 * line, so a sheet can list five products of one vendor without typing the
 * vendor five times. The list is the one the sheet's own columns declare
 * (`VENDOR_SHEET_KEYS`), because the one-vendor export blanks exactly these on
 * every row but the first — two ends of the same rule, one definition.
 */
const VENDOR_CARRY_KEYS = VENDOR_SHEET_KEYS;

/** Does this line mention a product at all (so it may inherit a vendor)? */
function mentionsProduct(row: BulkRow): boolean {
  return Boolean(
    normalizeVendorName(row.sku) ||
      normalizeVendorName(row.productName) ||
      normalizeVendorName(row.variantSku) ||
      normalizeVendorName(row.variantAttrs)
  );
}

/**
 * Fill the blank vendor columns of a line from the last line that carried them.
 *
 * Runs before `keepValid`, so the grouping rules never have to know about it.
 * A line that names no vendor AND no product is left untouched: it stays invalid,
 * which is what stops a stray empty row in the middle of a sheet from silently
 * duplicating the vendor above it.
 */
export function carryVendorForward(rows: BulkRow[]): BulkRow[] {
  let last: BulkRow | null = null;
  return rows.map((row) => {
    if (vendorKeyOf(row)) {
      last = row;
      return row;
    }
    if (!last || !mentionsProduct(row)) return row;
    const merged: BulkRow = { ...row };
    for (const key of VENDOR_CARRY_KEYS) {
      if (!normalizeVendorName(merged[key])) merged[key] = last[key] ?? "";
    }
    return merged;
  });
}

/** Separators accepted inside one multi-value cell. Comma is NOT one of them. */
const CELL_LIST_SEPARATOR = /[;|\r\n]+/;

/**
 * Turn one line whose `SKU`/`Kode Produk` cell lists several codes into one line
 * per code: `KOP-001;GUL-002;TER-003` attaches three existing products with a
 * single quoted price.
 *
 * The split lines deliberately lose `Nama Produk` and `Kategori Produk`. Those
 * columns describe ONE product, and copying a name onto three new products would
 * invent three look-alikes sharing a label; a split line therefore only ever
 * links products the database already has, and an unknown code is reported
 * instead of created.
 */
export function expandProductCodes(rows: BulkRow[]): BulkRow[] {
  const out: BulkRow[] = [];
  for (const row of rows) {
    const codes = normalizeVendorName(row.sku)
      .split(CELL_LIST_SEPARATOR)
      .map((code) => code.trim())
      .filter(Boolean);
    if (codes.length === 0) {
      out.push(row);
      continue;
    }
    if (codes.length === 1) {
      // Still worth a pass: a code typed with stray spaces is written trimmed.
      out.push(codes[0] === row.sku ? row : { ...row, sku: codes[0] });
      continue;
    }
    for (const code of codes) {
      out.push({ ...row, sku: code, productName: "", productCategory: "" });
    }
  }
  return out;
}

/**
 * Group sheet rows into vendor blocks.
 *
 * Rules (agreed with the owner, see the spec):
 *  * vendor identity = `Kode Vendor` (uppercase) when present, else the
 *    normalised name — so "pt sumber makmur" and "PT Sumber Makmur" are one
 *    vendor here and one row in the database afterwards;
 *  * product identity = `SKU` when present, else the normalised product name,
 *    which is what lets a line attach a new vendor to a product that already
 *    exists without duplicating it;
 *  * one line is one pack of one variant; the base pack (`Faktor` 1) is mandatory
 *    and is synthesised from any line carrying a buy price when the sheet forgot
 *    it;
 *  * `Kode Varian`/`Atribut Varian` say which variant the pack line quotes. A
 *    product with variants and a line that names none is ambiguous, and the
 *    planner says so rather than picking one;
 *  * a line with vendor fields and no product fields is a vendor on its own.
 *
 * Lines with neither a vendor nor a product are dropped — the caller counts them
 * through `keepValid` before it ever gets here.
 */
export function groupVendorProductRows(rows: BulkRow[]): VendorProductGroup[] {
  const groups = new Map<string, VendorProductGroup>();
  /** Products are matched per vendor: the same SKU under two vendors is two lines of work. */
  const productsByVendor = new Map<string, Map<string, ProductSeed>>();
  const packByProduct = new Map<string, Map<string, PackSeed>>();

  for (const row of rows) {
    const vendorKey = vendorKeyOf(row);
    if (!vendorKey) continue;

    let group = groups.get(vendorKey);
    if (!group) {
      group = {
        vendor: {
          key: vendorKey,
          code: null,
          name: "",
          category: null,
          contactPerson: null,
          phone: null,
          email: null,
          paymentTermsDays: null,
          ppnEnabled: parseVendorPpn(row.ppn) === true,
          rowCount: 0,
        },
        products: [],
      };
      groups.set(vendorKey, group);
      productsByVendor.set(vendorKey, new Map());
    }

    const vendor = group.vendor;
    vendor.rowCount += 1;
    const code = firstText([row.vendorCode]);
    if (!vendor.code && code) vendor.code = code.toUpperCase();
    if (!vendor.name) vendor.name = firstText([row.vendorName]) ?? "";
    if (!vendor.category) vendor.category = firstText([row.vendorCategory]);
    if (!vendor.contactPerson) vendor.contactPerson = firstText([row.contactPerson]);
    if (!vendor.phone) vendor.phone = firstText([row.phone]);
    if (!vendor.email) vendor.email = firstText([row.email]);
    if (vendor.paymentTermsDays == null) {
      vendor.paymentTermsDays = firstNumber([row.terms]);
    }

    const productKey = productKeyOf(row);
    if (!productKey) continue;

    const productMap = productsByVendor.get(vendorKey) as Map<string, ProductSeed>;
    let product = productMap.get(productKey);
    if (!product) {
      const sku = normalizeVendorName(row.sku).toUpperCase();
      product = {
        sku: sku || null,
        name: firstText([row.productName]) ?? "",
        category: firstText([row.productCategory]),
        price: 0,
        cost: 0,
        stock: Math.max(0, parseIdNumber(row.stock ?? "")),
        minStock: Math.max(0, parseIdNumber(row.minStock ?? "")),
        packs: [],
      };
      productMap.set(productKey, product);
      group.products.push(product);
      packByProduct.set(`${vendorKey}\u0000${productKey}`, new Map());
    } else {
      // A later line of the same product may fill in what the first left blank.
      if (!product.name) product.name = firstText([row.productName]) ?? "";
      if (!product.category) product.category = firstText([row.productCategory]);
      if (!product.sku) {
        const sku = normalizeVendorName(row.sku).toUpperCase();
        if (sku) product.sku = sku;
      }
      if (!product.stock) product.stock = Math.max(0, parseIdNumber(row.stock ?? ""));
      if (!product.minStock) product.minStock = Math.max(0, parseIdNumber(row.minStock ?? ""));
    }

    const packMap = packByProduct.get(`${vendorKey}\u0000${productKey}`) as Map<string, PackSeed>;
    const pack = packOf(row);
    // The variant is part of the pack identity: `Pcs` of two flavours is two
    // agreements, and merging them would silently reprice one of them.
    const packKey = `${variantIdentityOf(pack)}\u0000${pack.unitName.toLowerCase()}`;
    const existing = packMap.get(packKey);
    if (existing) {
      mergePack(existing, pack);
      continue;
    }
    packMap.set(packKey, pack);
    product.packs.push(pack);
  }

  // Every variant needs a factor-1 pack: it is where the POS buys and sells a
  // single unit. A sheet that only listed cartons gets one made from the first
  // line that carries a price — for THAT variant, never for another flavour.
  for (const group of groups.values()) {
    for (const product of group.products) {
      const byVariant = new Map<string, PackSeed[]>();
      for (const pack of product.packs) {
        const identity = variantIdentityOf(pack);
        const list = byVariant.get(identity) ?? [];
        list.push(pack);
        byVariant.set(identity, list);
      }

      for (const [identity, packs] of byVariant) {
        const base =
          packs.find((pack) => pack.conversionFactor === 1) ??
          packs.find((pack) => pack.buyPrice > 0 || pack.sellPrice > 0) ??
          packs[0];
        if (!base || base.conversionFactor === 1) continue;
        // Spliced in front of the variant's own lines, so `packs[0]` stays the
        // base pack — the order the writers and the pinned tests rely on.
        const first = packs[0];
        product.packs.splice(product.packs.indexOf(first), 0, {
          unitName: "Pcs",
          conversionFactor: 1,
          buyPrice: base.buyPrice,
          sellPrice: base.sellPrice,
          minOrderQty: base.minOrderQty,
          vendorSku: null,
          variantSku: identity.startsWith("sku:") ? identity.slice(4) : null,
          variantKey: identity.startsWith("attrs:") ? identity.slice(6) : "",
          // The invented line belongs to THIS variant, so it wears its identity:
          // a new variant quoted only in cartons still has to be named.
          attributes: { ...first.attributes },
          barcode: null,
          synthesized: true,
        });
      }

      const basePack = product.packs.find((pack) => pack.conversionFactor === 1);
      product.cost = basePack?.buyPrice ?? 0;
      product.price = basePack?.sellPrice ?? 0;
      // Minimum order is a property of the vendor/product agreement, so the base
      // pack's answer is the one the catalogue row stores.
      product.stock = Number.isFinite(product.stock) ? product.stock : 0;
      product.minStock = Number.isFinite(product.minStock) ? product.minStock : 0;
    }
  }

  return Array.from(groups.values());
}

/**
 * Product lines across all vendors, for the "M produk" count of the summary.
 * The same product under two vendors is two writes but one product.
 */
export function distinctProductCount(groups: VendorProductGroup[]): number {
  const names = new Set<string>();
  for (const group of groups) {
    for (const product of group.products) {
      names.add((product.sku || product.name).toLowerCase());
    }
  }
  return names.size;
}

/** ------------------------------------------------------------------ planning */

/** One pack of an existing product, so a sheet line can be attached to it. */
export interface ExistingPack {
  variantId: string;
  unitName: string;
  conversionFactor: number;
}

/** A variant of an existing product, so a pack line can be aimed at it. */
export interface ExistingVariant {
  id: string;
  sku: string | null;
  /** `variantKey(attributes)` of the stored row, "" for a plain product. */
  attributeKey: string;
  /**
   * The stored combination. A pack added to a variant that already exists is
   * addressed by this (or by `sku`), because the sheet's own spelling is not the
   * product's axis list — without either, the planner cannot name the row it
   * would have to write and reports the line instead.
   */
  attributes?: VariantAttributes;
}

/** A product the database already has. */
export interface ExistingProduct {
  id: string;
  sku: string | null;
  name: string;
  packs: ExistingPack[];
  /**
   * Omitted for a product the caller knows has exactly one variant — which is
   * every file written before `Kode Varian` existed, and every universe built
   * without the variant query.
   */
  variants?: ExistingVariant[];
}

/** A vendor the database already has. */
export interface ExistingVendor {
  id: string;
  name: string;
  code: string | null;
  ppnEnabled?: boolean | number | null;
}

/** Everything the planner needs, read by the caller in one pass. */
export interface ImportUniverse {
  vendors: ExistingVendor[];
  products: ExistingProduct[];
  /** `vendor_products` pairs, so "already in this vendor's catalogue" is known. */
  links: Array<{ vendorId: string; productId: string; isPreferred: boolean }>;
  /** `vendor_price_list` rows, so the summary can say "diperbarui" vs "diisi". */
  prices: Array<{ vendorId: string; variantId: string; unitName: string }>;
}

/**
 * What happens to one pack line.
 *
 * `skip` is a decision, not an oversight: a sheet that quotes a pack the stored
 * product does not sell would otherwise invent a unit on someone else's product
 * template, and changing a template is `manage_variants` work done on the
 * product screen, not a side effect of a price sheet. `create` is that same work
 * ALLOWED: the operator holds `manage_variants`, so the row is planned and the
 * variant writer owns it — see `VariantSeed`.
 */
export type PackAction = "create" | "overwrite" | "fill" | "skip";

export interface PackPlan {
  unitName: string;
  conversionFactor: number;
  buyPrice: number;
  sellPrice: number;
  /** Resolved `product_variants.id`; null when the variant is still being made. */
  variantId: string | null;
  action: PackAction;
  /** The vendor's own article number for this pack, when a line carries one. */
  vendorSku?: string | null;
  /** This vendor's minimum order for this pack. */
  minOrderQty?: number | null;
}

/**
 * One variant a sheet asks the app to write, as the product writer wants it.
 *
 * It carries everything `appendImportedVariants()` / `insertImportedProduct()`
 * need for one `product_variants` row and its packs, and nothing the writer
 * should invent: `stock` is 0 for a variant added to a product that exists
 * (opening stock is a stock-take, not a price sheet), and the prices are the
 * ones the lines carried.
 */
export interface VariantSeed {
  attributes: VariantAttributes;
  /** `variantKey(attributes)`; "" when the product has no axes at all. */
  attributeKey: string;
  /** `Kode Varian` as written; null lets the writer derive it from the model. */
  variantSku: string | null;
  barcode: string | null;
  /** Opening stock in base units, for a variant created with its product. */
  stock: number;
  /**
   * Set when the stored product already has this variant and the sheet only
   * brings packs it lacks. The writer addresses the row through it, so a
   * combination is never duplicated.
   */
  matchedVariantId: string | null;
  minOrderQty: number | null;
  vendorSku: string | null;
  packs: PackPlan[];
}

/** The pack rows of a variant write, in the shape `product-write` reads. */
export interface VariantWriteRow {
  attributes: VariantAttributes;
  sku: string | null;
  barcode: string | null;
  unitName: string;
  cost: number;
  price: number;
  packs: Array<{ unitName: string; conversionFactor: number; cost: number; price: number }>;
  stock: number;
  minOrderQty: number | null;
  vendorSku: string | null;
}

/**
 * The shape `product-write` wants for one variant: its factor-1 line lifted onto
 * the variant itself, every other line a pack.
 *
 * A variant with no factor-1 line keeps neutral numbers rather than promoting a
 * carton to "the price of one", because a sheet that quotes only cartons has
 * never stated a single-unit price — the writer then makes the base pack it must
 * have at 0, which is what the product importer does for the same file.
 */
export function variantWriteRow(seed: VariantSeed): VariantWriteRow {
  const base = seed.packs.find((pack) => pack.conversionFactor === 1) ?? null;
  return {
    attributes: seed.attributes,
    sku: seed.variantSku,
    barcode: seed.barcode,
    unitName: base?.unitName ?? "Pcs",
    cost: base?.buyPrice ?? 0,
    price: base?.sellPrice ?? 0,
    packs: seed.packs
      .filter((pack) => pack !== base)
      .map((pack) => ({
        unitName: pack.unitName,
        conversionFactor: pack.conversionFactor,
        cost: pack.buyPrice,
        price: pack.sellPrice,
      })),
    stock: seed.stock,
    minOrderQty: seed.minOrderQty,
    vendorSku: seed.vendorSku,
  };
}

/**
 * `create` inserts a product; `catalogue` only extends this vendor's offer of it;
 * `unknown-code` is a multi-code line whose `SKU` matches nothing — attaching a
 * price to a product nobody has typed correctly would invent one, so it is
 * reported instead.
 */
export type ProductAction = "create" | "catalogue" | "unknown-code";

export interface ProductPlan {
  seed: ProductSeed;
  action: ProductAction;
  productId: string | null;
  /** The vendor already listed this product, so the line only refreshes prices. */
  alreadyLinked: boolean;
  /** True when nothing prefers a vendor for this product yet. */
  claimPreference: boolean;
  packs: PackPlan[];
  /** Pack names the sheet quoted but the stored product does not sell. */
  skippedPacks: string[];
  /**
   * Pack names the sheet quoted without saying which variant they belong to, on
   * a product that has more than one. Guessing would reprice an arbitrary
   * flavour, so the line is reported and the price is not written.
   */
  ambiguousVariants: string[];
  /**
   * Unit names the PERMISSION blocked: the line names a variant or a pack the
   * stored product lacks, which `manage_variants` would have written. Those lines
   * are still reported under `ambiguousVariants` / `skippedPacks` — nothing that
   * used to be silent becomes quiet now — the preview just gains the reason WHY
   * the app could not simply make them.
   */
  blockedVariantWrites: string[];
  /**
   * Variants (and the packs of variants that do exist) the sheet brings to a
   * product the database ALREADY has. Empty unless the caller allowed variant
   * creation, which is what turns today's "the price is dropped" into a write.
   */
  newVariants: VariantSeed[];
  /**
   * Every variant the lines describe, for a product that does not exist yet:
   * one with no axes when the sheet names none, one per named flavour otherwise.
   */
  variants: VariantSeed[];
  /** `products.variant_attributes` the sheet's named variants imply. */
  variantGroups: VariantAttributeGroup[];
}

export interface VendorPlan {
  vendor: VendorSeed;
  /** Null when the vendor has to be created; the writer then mints the code. */
  vendorId: string | null;
  isNew: boolean;
  /** Stored master value; imports never replace it for an existing vendor. */
  existingPpnEnabled: boolean | null;
  products: ProductPlan[];
}

export interface ImportPlanSummary {
  newVendors: number;
  existingVendors: number;
  newProducts: number;
  linkedProducts: number;
  /** Buy prices that replace an agreement (needs `manage_vendor_prices`). */
  priceOverwrites: number;
  /** Buy prices written where none existed. */
  priceFills: number;
  skippedPacks: number;
  vendorOnlyRows: number;
  /** Lines that name a variant on a product that has several. */
  ambiguousVariants: number;
  /** Multi-code lines whose code is not in the catalogue. */
  unknownCodes: number;
  /**
   * Variants that do not exist yet and the permission allows — on products that
   * exist (`newVariants` of each plan) and only those, because the variants of a
   * brand-new product are part of its `newProducts` count.
   */
  newVariants: number;
  /** `product_units` rows that will be inserted for the variants above. */
  newPacks: number;
}

export interface ImportPlan {
  vendors: VendorPlan[];
  summary: ImportPlanSummary;
}

function keyOf(value: string | null | undefined): string {
  return normalizeVendorName(value).toLowerCase();
}

/**
 * Which stored variant a pack line is quoting.
 *
 * `Kode Varian` wins over `Atribut Varian` because a code is what the operator
 * can read off the physical carton. Null means "the line does not name one",
 * which is only safe when the product has exactly one variant — then there is a
 * single answer. An empty `variants` list is the legacy universe (a caller that
 * has not read variant rows at all); falling back to the product's packs keeps
 * those files importing exactly as they did before.
 */
function resolveTargetVariant(
  variants: ExistingVariant[],
  pack: PackSeed
): ExistingVariant | null {
  if (variants.length === 0) return null;
  if (pack.variantSku) {
    const wanted = pack.variantSku.toUpperCase();
    return variants.find((variant) => variant.sku?.toUpperCase() === wanted) ?? null;
  }
  if (pack.variantKey) {
    return variants.find((variant) => variant.attributeKey === pack.variantKey) ?? null;
  }
  return variants.length === 1 ? variants[0] : null;
}

/**
 * Group a product's lines into the variants they describe, in the order they
 * arrived, so the writer makes one `product_variants` row per named combination.
 *
 * A line that names no variant joins the axis-less variant — the `Default` row a
 * flat product has always owned — so a file written before the variant columns
 * still produces exactly one variant and exactly the packs it always produced.
 * The sheet states opening stock once, for the product; it lands on the first
 * line's variant, because a carton is a pack and not a quantity.
 */
function variantSeedsOf(packs: PackSeed[], stock: number): VariantSeed[] {
  const seeds: VariantSeed[] = [];
  const pending = new Map<string, VariantSeed>();
  for (const pack of packs) {
    const identity = variantIdentityOf(pack);
    const held = pending.get(identity);
    if (held) {
      planVariantPack(held, pack);
      continue;
    }
    const seed: VariantSeed = {
      attributes: pack.attributes,
      attributeKey: pack.variantKey,
      variantSku: pack.variantSku,
      barcode: pack.barcode,
      stock: seeds.length === 0 ? stock : 0,
      matchedVariantId: null,
      minOrderQty: pack.minOrderQty,
      vendorSku: pack.vendorSku,
      packs: [],
    };
    pending.set(identity, seed);
    seeds.push(seed);
    planVariantPack(seed, pack);
  }
  return seeds;
}

/**
 * Add one quoted line to a planned variant write, keeping the first answer each
 * field got. A later line of the same variant that carries the barcode, the
 * vendor's article number or its minimum order fills the gap the first left —
 * those describe the same row, so there is nothing to disagree about.
 */
function planVariantPack(seed: VariantSeed, pack: PackSeed): void {
  if (!seed.barcode && pack.barcode) seed.barcode = pack.barcode;
  if (!seed.matchedVariantId && !seed.variantSku && pack.variantSku) {
    seed.variantSku = pack.variantSku;
  }
  if (seed.minOrderQty == null && pack.minOrderQty != null) seed.minOrderQty = pack.minOrderQty;
  if (!seed.vendorSku && pack.vendorSku) seed.vendorSku = pack.vendorSku;
  seed.packs.push({
    unitName: pack.unitName,
    conversionFactor: pack.conversionFactor,
    buyPrice: pack.buyPrice,
    sellPrice: pack.sellPrice,
    variantId: seed.matchedVariantId,
    action: "create",
  });
}

/**
 * Note one line as "blocked by the permission", once. The preview reads this to
 * explain itself; it changes no count and no write, so a sheet reports exactly
 * what it reported before this option existed.
 */
function blockVariantWrite(plan: ProductPlan, unitName: string): void {
  if (!plan.blockedVariantWrites.includes(unitName)) plan.blockedVariantWrites.push(unitName);
}

/**
 * Decide, without touching the database, what the sheet would change.
 *
 * Policy (agreed with the owner):
 *  * masters are additive — an existing vendor or product is never renamed,
 *    and an existing product is linked rather than duplicated;
 *  * prices follow the sheet: `overwrite` for someone holding
 *    `manage_vendor_prices`, `fill` (gap-only) for everyone else, so a buyer can
 *    propose a price but cannot step on a negotiated one;
 *  * a product the sheet only mentions under a second vendor keeps the vendor it
 *    already prefers — preference is moved on the screens, never by an import;
 *  * variant/pack creation is opt-in: `mayCreateVariants` is the caller's
 *    `manage_variants` permission, and without it a line naming something the
 *    stored product lacks is reported exactly as it always was.
 */
export function planVendorProductImport(
  groups: VendorProductGroup[],
  universe: ImportUniverse,
  options: { priceMode: "overwrite" | "gap-only"; mayCreateVariants?: boolean }
): ImportPlan {
  const vendorByName = new Map<string, ExistingVendor>();
  const vendorByCode = new Map<string, ExistingVendor>();
  for (const vendor of universe.vendors) {
    if (!vendorByName.has(keyOf(vendor.name))) vendorByName.set(keyOf(vendor.name), vendor);
    if (vendor.code) vendorByCode.set(keyOf(vendor.code), vendor);
  }

  const productBySku = new Map<string, ExistingProduct>();
  const productByName = new Map<string, ExistingProduct>();
  for (const product of universe.products) {
    if (product.sku) productBySku.set(keyOf(product.sku), product);
    if (!productByName.has(keyOf(product.name))) productByName.set(keyOf(product.name), product);
  }

  const linkKeys = new Set(universe.links.map((l) => `${l.vendorId}\u0000${l.productId}`));
  const priceKeys = new Set(
    universe.prices.map((p) => `${p.vendorId}\u0000${p.variantId}\u0000${keyOf(p.unitName)}`)
  );

  const summary: ImportPlanSummary = {
    newVendors: 0,
    existingVendors: 0,
    newProducts: 0,
    linkedProducts: 0,
    priceOverwrites: 0,
    priceFills: 0,
    skippedPacks: 0,
    vendorOnlyRows: 0,
    ambiguousVariants: 0,
    unknownCodes: 0,
    newVariants: 0,
    newPacks: 0,
  };

  const plans: VendorPlan[] = [];

  for (const group of groups) {
    const seed = group.vendor;
    const known =
      (seed.code ? vendorByCode.get(keyOf(seed.code)) : undefined) ??
      vendorByName.get(keyOf(seed.name)) ??
      null;

    const plan: VendorPlan = {
      vendor: seed,
      vendorId: known?.id ?? null,
      isNew: !known,
      existingPpnEnabled: known ? Number(known.ppnEnabled ?? 0) === 1 : null,
      products: [],
    };
    if (known) summary.existingVendors += 1;
    else summary.newVendors += 1;

    for (const seed2 of group.products) {
      const existing =
        (seed2.sku ? productBySku.get(keyOf(seed2.sku)) : undefined) ??
        (seed2.sku ? null : productByName.get(keyOf(seed2.name))) ??
        null;

      const productPlan: ProductPlan = {
        seed: seed2,
        action: existing ? "catalogue" : "create",
        productId: existing?.id ?? null,
        alreadyLinked: Boolean(existing) && linkKeys.has(`${plan.vendorId}\u0000${existing?.id}`),
        claimPreference: false,
        packs: [],
        skippedPacks: [],
        ambiguousVariants: [],
        blockedVariantWrites: [],
        newVariants: [],
        variants: [],
        variantGroups: [],
      };

      if (existing) {
        summary.linkedProducts += 1;
        const variants = existing.variants ?? [];
        /** Lines the variant writer will make, keyed by the variant they mean. */
        const pending = new Map<string, VariantSeed>();
        for (const pack of seed2.packs) {
          // A synthesised base pack carries the quoted carton's number. Writing
          // that as the single-unit buy price of a product that already exists
          // would be an invented figure, so the line is dropped here — the carton
          // itself is still matched, or reported as skipped below.
          if (pack.synthesized) continue;
          // A line that carries no price and names no variant only asserts that
          // this vendor supplies this product. Nothing has to be placed, so it
          // can neither lose a price nor be ambiguous about a flavour: counting
          // it would promise a repair the sheet never asked for.
          if (
            pack.buyPrice <= 0 &&
            pack.sellPrice <= 0 &&
            !pack.variantSku &&
            !pack.variantKey
          ) {
            continue;
          }
          // A product with more than one variant cannot be priced by unit name
          // alone: `Pcs` exists once per flavour, and the first match used to
          // reprice whichever row the query happened to return first.
          const target = resolveTargetVariant(variants, pack);
          const named = Boolean(pack.variantSku || pack.variantKey);
          if (!target && named && variants.length > 0 && options.mayCreateVariants) {
            // The line names a combination this product does not have. With the
            // template permission that is a variant to MAKE rather than a price
            // to lose, so the buy price rides along on the new row.
            const identity = variantIdentityOf(pack);
            let seed = pending.get(identity);
            if (!seed) {
              seed = {
                attributes: pack.attributes,
                attributeKey: pack.variantKey,
                variantSku: pack.variantSku,
                barcode: pack.barcode,
                // Opening stock is a stock-take, never a side effect of a price
                // sheet: a variant added to a product that exists starts empty.
                stock: 0,
                matchedVariantId: null,
                minOrderQty: pack.minOrderQty,
                vendorSku: pack.vendorSku,
                packs: [],
              };
              pending.set(identity, seed);
              summary.newVariants += 1;
            }
            planVariantPack(seed, pack);
            summary.newPacks += 1;
            continue;
          }
          if (!target && (variants.length > 1 || named)) {
            const hint = pack.variantSku || pack.variantKey || "";
            // A line that DID name a combination only failed because the product
            // has not got it yet, so the permission is what stopped the write. A
            // line naming nothing could not have been written either way.
            if (named && variants.length > 0 && !options.mayCreateVariants) {
              blockVariantWrite(productPlan, pack.unitName);
            }
            // Two different mistakes, one counter: a code the product does not
            // have, and a price that could land on any of several flavours.
            productPlan.ambiguousVariants.push(
              hint && variants.length > 0
                ? `${pack.unitName} · Kode Varian "${hint}" tidak ada di produk ini`
                : hint
                  ? `${pack.unitName} · varian "${hint}" tidak dikenal`
                  : `${pack.unitName} · produk ini punya ${variants.length} varian, sebutkan Kode Varian`
            );
            summary.ambiguousVariants += 1;
            continue;
          }
          const candidates = target
            ? existing.packs.filter((row) => row.variantId === target.id)
            : existing.packs;
          const match =
            candidates.find((row) => keyOf(row.unitName) === keyOf(pack.unitName)) ??
            candidates.find((row) => row.conversionFactor === pack.conversionFactor) ??
            null;
          if (!match) {
            // A pack the stored variant does not sell. The same permission makes
            // it writable, and only when the planner can name the variant it
            // belongs to: a line may add a carton, never invent which flavour.
            const addressable = Boolean(target && (target.sku || target.attributes));
            if (addressable && !options.mayCreateVariants) {
              blockVariantWrite(productPlan, pack.unitName);
            }
            if (options.mayCreateVariants && target && addressable) {
              const identity = `stored:${target.id}`;
              let seed = pending.get(identity);
              if (!seed) {
                seed = {
                  attributes: { ...(target.attributes ?? {}) },
                  attributeKey: target.attributeKey,
                  variantSku: target.sku ?? null,
                  barcode: pack.barcode,
                  stock: 0,
                  matchedVariantId: target.id,
                  minOrderQty: pack.minOrderQty,
                  vendorSku: pack.vendorSku,
                  packs: [],
                };
                pending.set(identity, seed);
              }
              planVariantPack(seed, pack);
              summary.newPacks += 1;
              continue;
            }
            productPlan.skippedPacks.push(pack.unitName);
            summary.skippedPacks += 1;
            continue;
          }
          const action: PackAction =
            pack.buyPrice <= 0
              ? "skip"
              : priceKeys.has(`${plan.vendorId}\u0000${match.variantId}\u0000${keyOf(match.unitName)}`)
                ? options.priceMode === "overwrite"
                  ? "overwrite"
                  : "skip"
                : "fill";
          if (action === "overwrite") summary.priceOverwrites += 1;
          if (action === "fill") summary.priceFills += 1;
          productPlan.packs.push({
            unitName: match.unitName,
            conversionFactor: match.conversionFactor,
            buyPrice: pack.buyPrice,
            sellPrice: pack.sellPrice,
            variantId: match.variantId,
            action,
          });
        }
        // Nothing prefers a vendor yet, and this sheet names one: take it, so a
        // catalogue built by import still feeds the PO auto-fill. A product that
        // already has a preferred vendor keeps it — moving preference is a screen
        // decision, never a side effect of a price sheet.
        productPlan.claimPreference = !universe.links.some(
          (link) => link.productId === existing.id && link.isPreferred
        );
        productPlan.newVariants = Array.from(pending.values());
        // Only a variant the product lacks brings a new axis: the stored list is
        // appended to by the writer, never rewritten, and a pack added to a
        // variant that exists cannot change it.
        productPlan.variantGroups = groupsFromAttributes(
          productPlan.newVariants
            .filter((seed) => !seed.matchedVariantId)
            .map((seed) => seed.attributes)
        );
      } else if (!normalizeVendorName(seed2.name)) {
        // A multi-code line carries no product name on purpose (see
        // `expandProductCodes`), so a code that resolves to nothing is a typo or
        // a missing product — never a licence to mass-create look-alikes.
        productPlan.action = "unknown-code";
        summary.unknownCodes += 1;
      } else {
        summary.newProducts += 1;
        for (const pack of seed2.packs) {
          const action: PackAction =
            pack.buyPrice > 0
              ? options.priceMode === "overwrite"
                ? "overwrite"
                : "fill"
              : "skip";
          if (action === "overwrite") summary.priceOverwrites += 1;
          if (action === "fill") summary.priceFills += 1;
          productPlan.packs.push({
            unitName: pack.unitName,
            conversionFactor: pack.conversionFactor,
            buyPrice: pack.buyPrice,
            sellPrice: pack.sellPrice,
            variantId: null,
            action,
          });
        }
        productPlan.claimPreference = true;
        // A product being made gets one variant row per combination its lines
        // name — the flat file's single axis-less variant included — so the sheet
        // can bring a variant template, not only a price.
        productPlan.variants = variantSeedsOf(seed2.packs, seed2.stock);
        productPlan.variantGroups = groupsFromAttributes(
          productPlan.variants.map((seed) => seed.attributes)
        );
      }

      plan.products.push(productPlan);
    }

    if (group.products.length === 0) summary.vendorOnlyRows += 1;
    plans.push(plan);
  }

  return { vendors: plans, summary };
}
