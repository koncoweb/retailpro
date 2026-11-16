/**
 * Turning a flat "vendor + product" sheet into the rows the writers need.
 *
 * The sheet has one line per (vendor, product, pack) with the vendor columns
 * repeated on every line — the shape a purchasing person actually keeps, and the
 * shape the vendor catalogue export writes, so a file can be exported, edited in
 * Excel and imported back.
 *
 * Deliberately pure: no SQL, no React, so the grouping rules can be unit tested.
 * What the database already holds is read by the caller and handed to
 * `planVendorProductImport()` as plain rows, so the decision of what a sheet will
 * change — and what it will leave alone — is testable without a connection. The
 * caller still owns the writes and therefore what is atomic.
 *
 * Design notes: `docs/spec-vendor-produk-terintegrasi.md`.
 */
import { parseIdNumber, type BulkRow } from "./bulk-io";
import { normalizeVendorName } from "./vendor-catalog";

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
  /** How many sheet lines produced this vendor; used for the summary counts. */
  rowCount: number;
}

/** One pack (pecahan) of a product, priced the way the vendor quoted it. */
export interface PackSeed {
  unitName: string;
  conversionFactor: number;
  /** Buy price per pack. 0 = the sheet carried no price for this pack. */
  buyPrice: number;
  /** Sell price per pack. 0 = not given. */
  sellPrice: number;
  minOrderQty: number | null;
  vendorSku: string | null;
}

/**
 * A product as the sheet describes it.
 *
 * `sku` empty means "the operator did not type one" — the caller then either
 * links by name or lets the app mint a SKU. Variants and attribute axes are not
 * importable: a flat sheet cannot express them, and inventing a column set for
 * them would only produce half-filled templates.
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
  return {
    unitName,
    conversionFactor,
    buyPrice: Math.max(0, Math.round(parseIdNumber(row.buyPrice ?? ""))),
    sellPrice: Math.max(0, Math.round(parseIdNumber(row.price ?? ""))),
    minOrderQty: firstNumber([row.minOrder]),
    vendorSku: firstText([row.vendorSku]),
  };
}

/** Merge a repeated pack: the first non-zero value for each field wins. */
function mergePack(existing: PackSeed, incoming: PackSeed): void {
  if (!existing.buyPrice && incoming.buyPrice) existing.buyPrice = incoming.buyPrice;
  if (!existing.sellPrice && incoming.sellPrice) existing.sellPrice = incoming.sellPrice;
  if (existing.minOrderQty == null && incoming.minOrderQty != null) {
    existing.minOrderQty = incoming.minOrderQty;
  }
  if (!existing.vendorSku && incoming.vendorSku) existing.vendorSku = incoming.vendorSku;
  // A factor typed on a later line is the correction, not a duplicate.
  if (incoming.conversionFactor > 1 && existing.conversionFactor === 1) {
    existing.conversionFactor = incoming.conversionFactor;
  }
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
 *  * one line is one pack; the base pack (`Faktor` 1) is mandatory and is
 *    synthesised from any line carrying a buy price when the sheet forgot it;
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
    const packKey = pack.unitName.toLowerCase();
    const existing = packMap.get(packKey);
    if (existing) {
      mergePack(existing, pack);
      continue;
    }
    packMap.set(packKey, pack);
    product.packs.push(pack);
  }

  // Every product needs a factor-1 pack: it is where the POS buys and sells a
  // single unit. A sheet that only listed cartons gets one made from the first
  // line that carries a price.
  for (const group of groups.values()) {
    for (const product of group.products) {
      const base =
        product.packs.find((pack) => pack.conversionFactor === 1) ??
        product.packs.find((pack) => pack.buyPrice > 0 || pack.sellPrice > 0) ??
        product.packs[0];
      if (!base) continue;

      if (base.conversionFactor !== 1) {
        product.packs.unshift({
          unitName: "Pcs",
          conversionFactor: 1,
          buyPrice: base.buyPrice,
          sellPrice: base.sellPrice,
          minOrderQty: base.minOrderQty,
          vendorSku: null,
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

/** A product the database already has. */
export interface ExistingProduct {
  id: string;
  sku: string | null;
  name: string;
  packs: ExistingPack[];
}

/** A vendor the database already has. */
export interface ExistingVendor {
  id: string;
  name: string;
  code: string | null;
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
 * product screen, not a side effect of a price sheet.
 */
export type PackAction = "create" | "overwrite" | "fill" | "skip";

export interface PackPlan {
  unitName: string;
  conversionFactor: number;
  buyPrice: number;
  sellPrice: number;
  /** Resolved `product_variants.id`; null when the product is still being made. */
  variantId: string | null;
  action: PackAction;
}

/** `create` inserts a product; `catalogue` only extends this vendor's offer of it. */
export type ProductAction = "create" | "catalogue";

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
}

export interface VendorPlan {
  vendor: VendorSeed;
  /** Null when the vendor has to be created; the writer then mints the code. */
  vendorId: string | null;
  isNew: boolean;
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
}

export interface ImportPlan {
  vendors: VendorPlan[];
  summary: ImportPlanSummary;
}

function keyOf(value: string | null | undefined): string {
  return normalizeVendorName(value).toLowerCase();
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
 *    already prefers — preference is moved on the screens, never by an import.
 */
export function planVendorProductImport(
  groups: VendorProductGroup[],
  universe: ImportUniverse,
  options: { priceMode: "overwrite" | "gap-only" }
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
      };

      if (existing) {
        summary.linkedProducts += 1;
        for (const pack of seed2.packs) {
          const match =
            existing.packs.find((row) => keyOf(row.unitName) === keyOf(pack.unitName)) ??
            existing.packs.find((row) => row.conversionFactor === pack.conversionFactor) ??
            null;
          if (!match) {
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
      }

      plan.products.push(productPlan);
    }

    if (group.products.length === 0) summary.vendorOnlyRows += 1;
    plans.push(plan);
  }

  return { vendors: plans, summary };
}
