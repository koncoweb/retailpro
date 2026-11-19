/**
 * Turning a rich product sheet into the rows the writers need.
 *
 * The sheet has one line per (variant x pack): a product with two axes and a
 * carton pack is four lines carrying the same `SKU`. That shape is the only one
 * a flat file can hold — attribute axes are open-ended, so they go in a cell
 * (`Rasa=Susu;Ukuran=250ml`) instead of into a fixed set of columns, and the
 * number of variants a file describes is bounded by rows, not by columns.
 *
 * Deliberately pure: no SQL, no React, so the grouping and matching rules can be
 * unit tested. What the database already holds is read by the caller and handed
 * to `planProductImport()` as plain rows, so the decision of what a sheet will
 * change — and what it will leave alone — is testable without a connection. The
 * caller still owns the writes and therefore what is atomic.
 *
 * Policy (agreed with the owner, see `docs/spec-impor-varian-kaya.md`): masters
 * are additive. A line that lands on an existing product or variant never
 * renames it and never clears a price; it only adds the variant, pack or gap the
 * file actually brings. Codes win over names, everywhere.
 *
 * Design notes: `docs/spec-impor-varian-kaya.md`.
 */
import { parseIdNumber, type BulkRow } from "./bulk-io";
import { normalizeVendorName } from "./vendor-catalog";
import {
  parseAttributeCell,
  groupsFromAttributes,
  variantKey,
  variantLabel,
  variantSku,
  type VariantAttributeGroup,
  type VariantAttributes,
} from "./variants";
import type { PackAction } from "./vendor-import";

/** ---------------------------------------------------------------- sheet → seeds */

/** One pack (pecahan) of one variant, priced per pack as the file quotes it. */
export interface ImportedPackSeed {
  unitName: string;
  conversionFactor: number;
  /** Buy price PER PACK. 0 = the sheet carried no price for this pack. */
  buyPrice: number;
  /** Sell price PER PACK. 0 = not given. */
  sellPrice: number;
  minOrderQty: number | null;
  vendorSku: string | null;
}

/**
 * One sellable variant as the sheet describes it.
 *
 * `sku` is what the operator typed in `Kode Varian`; `derivedSku` is what the
 * app's own rule would make of the attributes. They can legitimately differ —
 * a variant renamed on the product screen keeps its label — so the declared code
 * wins for matching and the plan only records the difference as a note.
 *
 * `key` is `variantKey(attributes)`; the empty string means "this product has no
 * axes", which is stored as the single `Default` variant.
 */
export interface ImportedVariantSeed {
  attributes: VariantAttributes;
  key: string;
  label: string;
  sku: string | null;
  derivedSku: string;
  barcode: string | null;
  /** Opening stock in BASE units; only the variant's own line sets it. */
  stock: number;
  packs: ImportedPackSeed[];
}

/** One product: the model, its axes, and every variant its lines mention. */
export interface ImportedProductSeed {
  sku: string | null;
  name: string;
  category: string | null;
  /** `products.variant_attributes` built from the lines that arrived. */
  variantGroups: VariantAttributeGroup[];
  variants: ImportedVariantSeed[];
  /** Model-level minimum stock; the database has no per-variant column for it. */
  minStock: number;
  vendorCode: string | null;
  vendorName: string | null;
  minOrderQty: number | null;
  vendorSku: string | null;
  /** How many sheet lines produced this product; used for the summary. */
  rowCount: number;
  /**
   * Human-readable oddities the preview must show instead of guessing over:
   * two lines of one product disagreeing about a code, a variant code repeated
   * across the file, a pack line that contradicts the price line.
   */
  notes: string[];
}

/** First value written wins: the sheet repeats a product on several lines. */
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
  const name = normalizeVendorName(row.name).toLowerCase();
  return name ? `name:${name}` : null;
}

/** A line with no `Satuan` is the base pack; a named pack needs no factor guess. */
function packOf(row: BulkRow): ImportedPackSeed {
  const unitName = normalizeVendorName(row.unit) || "Pcs";
  const givenFactor = parseIdNumber(row.factor ?? "");
  const conversionFactor = normalizeVendorName(row.unit)
    ? givenFactor > 0
      ? givenFactor
      : 1
    : 1;
  return {
    unitName,
    conversionFactor,
    buyPrice: Math.max(0, Math.round(parseIdNumber(row.cost ?? ""))),
    sellPrice: Math.max(0, Math.round(parseIdNumber(row.price ?? ""))),
    minOrderQty: firstNumber([row.minOrder]),
    vendorSku: firstText([row.vendorSku]),
  };
}

/** Merge a repeated pack: the first non-zero value for each field wins. */
function mergePack(existing: ImportedPackSeed, incoming: ImportedPackSeed): void {
  if (!existing.buyPrice && incoming.buyPrice) existing.buyPrice = incoming.buyPrice;
  if (!existing.sellPrice && incoming.sellPrice) existing.sellPrice = incoming.sellPrice;
  if (existing.minOrderQty == null && incoming.minOrderQty != null) {
    existing.minOrderQty = incoming.minOrderQty;
  }
  if (!existing.vendorSku && incoming.vendorSku) existing.vendorSku = incoming.vendorSku;
  if (incoming.conversionFactor > 1 && existing.conversionFactor === 1) {
    existing.conversionFactor = incoming.conversionFactor;
  }
}

/** Identity of a variant line: the typed code when there is no attribute cell. */
function variantIdentityOf(row: BulkRow, attributes: VariantAttributes): string {
  const key = variantKey(attributes);
  if (key) return `attrs:${key}`;
  const declared = normalizeVendorName(row.variantSku).toUpperCase();
  return declared ? `sku:${declared}` : "default";
}

/**
 * Group sheet lines into products, each holding its variants and their packs.
 *
 * Rules:
 *  * product identity = `SKU` (uppercase) when present, else the normalised
 *    name — the same contract the vendor sheet already keeps;
 *  * variant identity = the attribute cell, falling back to `Kode Varian` for a
 *    product whose operator prefers to type codes;
 *  * a line is one pack of one variant; the factor-1 pack is mandatory and is
 *    synthesised from the first priced line when the file forgot it;
 *  * model fields take the first line that carries them, so a repeated `Kategori`
 *    is a no-op rather than a fight.
 *
 * Lines with neither a SKU nor a name are dropped — the caller counts them
 * through `keepValid` before it ever gets here.
 */
export function groupProductRows(rows: BulkRow[]): ImportedProductSeed[] {
  const products = new Map<string, ImportedProductSeed>();
  const variantsByProduct = new Map<string, Map<string, ImportedVariantSeed>>();
  const packsByVariant = new Map<string, Map<string, ImportedPackSeed>>();

  for (const row of rows) {
    const productKey = productKeyOf(row);
    if (!productKey) continue;

    let product = products.get(productKey);
    if (!product) {
      product = {
        sku: normalizeVendorName(row.sku).toUpperCase() || null,
        name: firstText([row.name]) ?? "",
        category: firstText([row.category]),
        variantGroups: [],
        variants: [],
        minStock: Math.max(0, parseIdNumber(row.minStock ?? "")),
        vendorCode: null,
        vendorName: null,
        minOrderQty: null,
        vendorSku: null,
        rowCount: 0,
        notes: [],
      };
      products.set(productKey, product);
      variantsByProduct.set(productKey, new Map());
    } else {
      if (!product.name) product.name = firstText([row.name]) ?? "";
      if (!product.category) product.category = firstText([row.category]);
      if (!product.sku) product.sku = normalizeVendorName(row.sku).toUpperCase() || null;
      if (!product.minStock) product.minStock = Math.max(0, parseIdNumber(row.minStock ?? ""));
    }

    product.rowCount += 1;

    // The vendor intent is per product: the sheet repeats it on every line of
    // that product, and a second, different vendor on the same product is the
    // kind of mistake that has to be shown, not silently merged.
    const lineVendor = normalizeVendorName(row.vendorCode).toUpperCase();
    const lineVendorName = firstText([row.supplier]);
    if (lineVendor && product.vendorCode && lineVendor !== product.vendorCode) {
      product.notes.push(
        `Baris "${product.name}" menyebut dua kode vendor (${product.vendorCode} dan ${lineVendor}); yang dipakai ${product.vendorCode}.`
      );
    } else if (lineVendor) {
      product.vendorCode = lineVendor;
    }
    if (!product.vendorName && lineVendorName) product.vendorName = lineVendorName;
    if (product.minOrderQty == null) product.minOrderQty = firstNumber([row.minOrder]);
    if (!product.vendorSku) product.vendorSku = firstText([row.vendorSku]);

    const attributes = parseAttributeCell(row.variantAttrs);
    const variantKeyOfLine = variantIdentityOf(row, attributes);
    const variantMap = variantsByProduct.get(productKey) as Map<string, ImportedVariantSeed>;

    let variant = variantMap.get(variantKeyOfLine);
    const declaredSku = normalizeVendorName(row.variantSku) || null;
    if (!variant) {
      variant = {
        attributes,
        key: variantKeyOfLine === "default" ? "" : variantKey(attributes),
        label: variantLabel(attributes),
        sku: declaredSku,
        derivedSku: product.sku ? variantSku(product.sku, attributes) : "",
        barcode: firstText([row.barcode]),
        stock: Math.max(0, parseIdNumber(row.stock ?? "")),
        packs: [],
      };
      variantMap.set(variantKeyOfLine, variant);
      product.variants.push(variant);
      packsByVariant.set(`${productKey}\u0000${variantKeyOfLine}`, new Map());
    } else {
      if (!variant.sku && declaredSku) variant.sku = declaredSku;
      else if (declaredSku && variant.sku && declaredSku !== variant.sku) {
        product.notes.push(
          `Varian "${variant.label}" punya dua Kode Varian (${variant.sku} dan ${declaredSku}); yang dipakai ${variant.sku}.`
        );
      }
      if (!variant.barcode) variant.barcode = firstText([row.barcode]);
      if (!variant.stock) variant.stock = Math.max(0, parseIdNumber(row.stock ?? ""));
      if (!variant.derivedSku && product.sku) {
        variant.derivedSku = variantSku(product.sku, variant.attributes);
      }
    }

    const packMap = packsByVariant.get(`${productKey}\u0000${variantKeyOfLine}`) as Map<
      string,
      ImportedPackSeed
    >;
    const pack = packOf(row);
    const packKey = pack.unitName.toLowerCase();
    const existingPack = packMap.get(packKey);
    if (existingPack) {
      mergePack(existingPack, pack);
      continue;
    }
    packMap.set(packKey, pack);
    variant.packs.push(pack);
  }

  const result = Array.from(products.values());
  finishSeeds(result);
  return result;
}

/**
 * Second pass over the grouped seeds: a base pack for every variant, the axis
 * list for every product, and a note when the typed code and the attribute-
 * derived code disagree.
 */
function finishSeeds(seeds: ImportedProductSeed[]): void {
  for (const product of seeds) {
    for (const variant of product.variants) {
      const base =
        variant.packs.find((pack) => pack.conversionFactor === 1) ??
        variant.packs.find((pack) => pack.buyPrice > 0 || pack.sellPrice > 0) ??
        variant.packs[0];
      if (base && base.conversionFactor !== 1) {
        variant.packs.unshift({
          unitName: "Pcs",
          conversionFactor: 1,
          buyPrice: base.buyPrice,
          sellPrice: base.sellPrice,
          minOrderQty: base.minOrderQty,
          vendorSku: null,
        });
      }

      const derived = product.sku ? variantSku(product.sku, variant.attributes) : "";
      variant.derivedSku = derived;
      if (variant.sku && derived && variant.sku !== derived) {
        product.notes.push(
          `Kode Varian "${variant.sku}" beda dari turunan atribut "${derived}" — kode dari file yang dipakai.`
        );
      }
    }

    // Axis order comes from the lines as they were written, so a sheet that
    // lists Rasa before Ukuran keeps that order on the product screen too.
    product.variantGroups = groupsFromAttributes(product.variants.map((v) => v.attributes));
    // The label is derived from the axis order the product ended up with, so two
    // lines written in different orders still read the same way as the form.
    for (const variant of product.variants) {
      variant.label = variantLabel(variant.attributes, product.variantGroups);
    }
  }
}

/** ------------------------------------------------------------------- planning */

/** A variant the database already holds, enough to match a sheet line to it. */
export interface ExistingImportVariant {
  id: string;
  sku: string | null;
  /** `variantKey(attributes)` of the stored row. */
  attributeKey: string;
}

/** Where a variant SKU lives, so a code claimed by another product is caught. */
export type VariantHolder = { productId: string; variant: ExistingImportVariant };

/** A product the database already holds, with its variants and their packs. */
export interface ExistingImportProduct {
  id: string;
  sku: string | null;
  name: string;
  variants: ExistingImportVariant[];
  packs: Array<{ variantId: string; unitName: string; conversionFactor: number }>;
}

/** Everything the planner needs, read by the caller in one pass. */
export interface ProductImportUniverse {
  products: ExistingImportProduct[];
  vendors: Array<{ id: string; name: string; code: string | null }>;
  links: Array<{ vendorId: string; productId: string; isPreferred: boolean }>;
  prices: Array<{ vendorId: string; variantId: string; unitName: string }>;
}

/**
 * `create` inserts a product; `extend` adds variants or packs to one that exists,
 * or only the buy price that is still missing; `nochange` means the file repeats
 * what the database already holds.
 */
export type ImportProductAction = "create" | "extend" | "nochange";

/** `conflict` is a code that belongs to another product: never rewritten. */
export type ImportVariantAction = "create" | "match" | "conflict";

export interface ImportPackPlan {
  unitName: string;
  conversionFactor: number;
  buyPrice: number;
  sellPrice: number;
  /** Resolved `product_variants.id`; null when the variant is still being made. */
  variantId: string | null;
  action: PackAction;
  /** True when this pack row does not exist yet on the matched variant. */
  isNewPack: boolean;
}

export interface ImportVariantPlan {
  seed: ImportedVariantSeed;
  action: ImportVariantAction;
  variantId: string | null;
  /** The SKU the writer will store: typed code, else the derived one. */
  sku: string;
  reason: string;
  packs: ImportPackPlan[];
}

export interface ImportProductPlan {
  seed: ImportedProductSeed;
  action: ImportProductAction;
  productId: string | null;
  /** Sheet left `SKU` empty on a new product: the writer mints the next number. */
  mintSku: boolean;
  /** How the product was found, for the preview to be honest about it. */
  reason: string;
  vendorId: string | null;
  newVendor: boolean;
  claimPreference: boolean;
  variants: ImportVariantPlan[];
  /** Variants/packs the file adds; `nochange` plans have neither. */
  adds: number;
  /**
   * Buy-price rows the file would write, including on a pack that already
   * exists. A line can therefore be worth importing even when it adds no row.
   */
  priceWrites: number;
}

export interface ProductImportSummary {
  newProducts: number;
  extendedProducts: number;
  unchangedProducts: number;
  newVariants: number;
  matchedVariants: number;
  newPacks: number;
  priceFills: number;
  priceOverwrites: number;
  conflicts: number;
  autoSkuProducts: number;
  /** Lines the file has but nothing in them is new — reported, not hidden. */
  noteLines: number;
}

export interface ProductImportPlan {
  products: ImportProductPlan[];
  summary: ProductImportSummary;
}

function keyOf(value: string | null | undefined): string {
  return normalizeVendorName(value).toLowerCase();
}

/**
 * Decide, without touching the database, what the sheet would change.
 *
 * Codes are tried before names at every level, and a miss never creates a second
 * row beside an existing one on the strength of a spelling: a sheet naming a
 * product nobody has typed correctly creates exactly one product, which is what
 * the additive policy allows and what the preview states out loud.
 */
export function planProductImport(
  seeds: ImportedProductSeed[],
  universe: ProductImportUniverse,
  options: { priceMode: "overwrite" | "gap-only" }
): ProductImportPlan {
  const productBySku = new Map<string, ExistingImportProduct>();
  const productByName = new Map<string, ExistingImportProduct>();
  for (const product of universe.products) {
    if (product.sku && !productBySku.has(keyOf(product.sku))) {
      productBySku.set(keyOf(product.sku), product);
    }
    if (!productByName.has(keyOf(product.name))) productByName.set(keyOf(product.name), product);
  }
  const variantBySku = new Map<string, VariantHolder>();
  for (const product of universe.products) {
    for (const variant of product.variants) {
      if (variant.sku && !variantBySku.has(keyOf(variant.sku))) {
        variantBySku.set(keyOf(variant.sku), { productId: product.id, variant });
      }
    }
  }

  const vendorByCode = new Map<string, string>();
  const vendorByName = new Map<string, string>();
  for (const vendor of universe.vendors) {
    if (vendor.code) vendorByCode.set(keyOf(vendor.code), vendor.id);
    if (!vendorByName.has(keyOf(vendor.name))) vendorByName.set(keyOf(vendor.name), vendor.id);
  }

  const priceKeys = new Set(
    universe.prices.map((p) => `${p.vendorId}\u0000${p.variantId}\u0000${keyOf(p.unitName)}`)
  );

  const summary: ProductImportSummary = {
    newProducts: 0,
    extendedProducts: 0,
    unchangedProducts: 0,
    newVariants: 0,
    matchedVariants: 0,
    newPacks: 0,
    priceFills: 0,
    priceOverwrites: 0,
    conflicts: 0,
    autoSkuProducts: 0,
    noteLines: 0,
  };

  const plans: ImportProductPlan[] = [];

  for (const seed of seeds) {
    const existing =
      (seed.sku ? productBySku.get(keyOf(seed.sku)) : undefined) ??
      (seed.sku ? null : productByName.get(keyOf(seed.name))) ??
      null;
    const vendorId =
      (seed.vendorCode ? vendorByCode.get(keyOf(seed.vendorCode)) : undefined) ??
      (seed.vendorName ? vendorByName.get(keyOf(seed.vendorName)) : undefined) ??
      null;

    const plan: ImportProductPlan = {
      seed,
      action: existing ? "extend" : "create",
      productId: existing?.id ?? null,
      mintSku: !existing && !seed.sku,
      reason: existing
        ? seed.sku && keyOf(seed.sku) === keyOf(existing.sku)
          ? "SKU sudah ada"
          : "dijodohkan lewat nama produk"
        : seed.sku
          ? "produk baru"
          : "produk baru, SKU dibuat otomatis",
      vendorId,
      newVendor: Boolean(seed.vendorCode || seed.vendorName) && !vendorId,
      claimPreference: false,
      variants: [],
      adds: 0,
      priceWrites: 0,
    };
    if (plan.mintSku) summary.autoSkuProducts += 1;

    // A buy price has to belong to a vendor. The sheet may name one the tenant
    // does not have yet: the writer creates that master row first, so the price
    // is still planned. Naming nobody at all means no price row can be promised.
    const hasVendor = vendorId !== null || plan.newVendor;

    for (const variant of seed.variants) {
      const variantPlan = planVariant(
        variant,
        existing,
        plan,
        variantBySku,
        priceKeys,
        options,
        vendorId,
        hasVendor
      );
      plan.variants.push(variantPlan);
      if (variantPlan.action === "create") {
        summary.newVariants += 1;
        plan.adds += 1;
      } else {
        summary.matchedVariants += 1;
      }
      if (variantPlan.action === "conflict") summary.conflicts += 1;
      for (const pack of variantPlan.packs) {
        if (pack.isNewPack) {
          summary.newPacks += 1;
          plan.adds += 1;
        }
        if (pack.action === "fill") summary.priceFills += 1;
        if (pack.action === "overwrite") summary.priceOverwrites += 1;
        if (pack.action === "fill" || pack.action === "overwrite") plan.priceWrites += 1;
      }
    }

    if (!existing) summary.newProducts += 1;
    else if (plan.adds === 0 && plan.priceWrites === 0) {
      plan.action = "nochange";
      plan.reason = "sudah ada, tidak ada yang baru";
      summary.unchangedProducts += 1;
    } else summary.extendedProducts += 1;

    summary.noteLines += seed.notes.length;
    plans.push(plan);
  }

  // Preference is a screen decision, never a side effect of a file: an existing
  // product keeps the vendor it already prefers.
  for (const plan of plans) {
    if (!plan.productId) {
      plan.claimPreference = true;
      continue;
    }
    plan.claimPreference = !universe.links.some(
      (link) => link.productId === plan.productId && link.isPreferred
    );
  }

  return { products: plans, summary };
}

/** Match or make one variant, then decide what its packs are allowed to write. */
function planVariant(
  variant: ImportedVariantSeed,
  existing: ExistingImportProduct | null,
  plan: ImportProductPlan,
  variantBySku: Map<string, VariantHolder>,
  priceKeys: Set<string>,
  options: { priceMode: "overwrite" | "gap-only" },
  vendorId: string | null,
  hasVendor: boolean
): ImportVariantPlan {
  const modelSku = existing?.sku ?? plan.seed.sku;
  const sku = variant.sku ?? (modelSku ? variantSku(modelSku, variant.attributes) : "");

  let matched: ExistingImportVariant | null = null;
  if (variant.sku && existing) {
    const bySku = existing.variants.find((row) => keyOf(row.sku) === keyOf(variant.sku));
    if (bySku) matched = bySku;
  }
  if (!matched && existing) {
    // The attribute cell is the real identity: a variant whose SKU was retyped
    // on the product screen is still the same flavour.
    matched =
      existing.variants.find((row) => row.attributeKey === variant.key && variant.key !== "") ??
      (variant.key === ""
        ? (existing.variants.find((row) => row.attributeKey === "") ??
          (existing.variants.length === 1 ? existing.variants[0] : null))
        : null) ??
      null;
  }
  if (!matched && variant.sku) {
    // A code can only be matched, never reused: if another product owns it, this
    // line contradicts the catalogue and has to be reported.
    const holder = variantBySku.get(keyOf(variant.sku));
    if (holder && holder.productId !== existing?.id) {
      return {
        seed: variant,
        action: "conflict",
        variantId: null,
        sku: variant.sku,
        reason: `Kode Varian ${variant.sku} sudah dipakai produk lain`,
        packs: [],
      };
    }
  }
  if (!matched && existing && !variant.key) {
    const byDerived = existing.variants.find(
      (row) => keyOf(row.sku) === keyOf(sku)
    );
    if (byDerived) matched = byDerived;
  }

  if (!existing || !matched) {
    return {
      seed: variant,
      action: "create",
      variantId: null,
      sku,
      reason: existing ? `varian baru untuk produk ini` : "varian baru",
      packs: variant.packs.map((pack) => ({
        unitName: pack.unitName,
        conversionFactor: pack.conversionFactor,
        buyPrice: pack.buyPrice,
        sellPrice: pack.sellPrice,
        variantId: null,
        action: priceActionForNew(pack.buyPrice, options.priceMode, hasVendor),
        isNewPack: true,
      })),
    };
  }

  const packs: ImportPackPlan[] = [];
  for (const pack of variant.packs) {
    const stored =
      existing.packs.find(
        (row) => row.variantId === matched?.id && keyOf(row.unitName) === keyOf(pack.unitName)
      ) ??
      existing.packs.find(
        (row) => row.variantId === matched?.id && row.conversionFactor === pack.conversionFactor
      ) ??
      null;
    if (!stored) {
      packs.push({
        unitName: pack.unitName,
        conversionFactor: pack.conversionFactor,
        buyPrice: pack.buyPrice,
        sellPrice: pack.sellPrice,
        variantId: matched.id,
        action: priceActionForNew(pack.buyPrice, options.priceMode, hasVendor),
        isNewPack: true,
      });
      continue;
    }
    const hasPrice =
      vendorId !== null && priceKeys.has(`${vendorId}\u0000${matched.id}\u0000${keyOf(stored.unitName)}`);
    const action: PackAction =
      pack.buyPrice <= 0 || !hasVendor
        ? "skip"
        : hasPrice
          ? options.priceMode === "overwrite"
            ? "overwrite"
            : "skip"
          : "fill";
    packs.push({
      unitName: stored.unitName,
      conversionFactor: stored.conversionFactor,
      buyPrice: pack.buyPrice,
      sellPrice: pack.sellPrice,
      variantId: matched.id,
      action,
      isNewPack: false,
    });
  }

  return {
    seed: variant,
    action: "match",
    variantId: matched.id,
    sku: matched.sku ?? sku,
    reason: variant.sku && keyOf(variant.sku) === keyOf(matched.sku) ? "kode varian" : "atribut",
    packs,
  };
}

/** A brand-new pack sets its price; without a buy price, or without any vendor
 *  for the price to belong to, it writes no price row. */
function priceActionForNew(
  buyPrice: number,
  mode: "overwrite" | "gap-only",
  hasVendor: boolean
): PackAction {
  if (buyPrice <= 0 || !hasVendor) return "skip";
  return mode === "overwrite" ? "overwrite" : "fill";
}
