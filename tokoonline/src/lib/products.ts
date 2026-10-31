/**
 * Catalogue shapes shared by the marketplace routes.
 *
 * This module holds no data. Goods, selling units, prices and stock all come
 * from `/api/storefront/marketplace` (see `lib/catalog.ts`), which walks every
 * active tenant and reads each one's database. Keeping only types and derived
 * helpers here is what makes the shop a channel of the back offices instead of
 * a second, hand-maintained product list that drifts the moment a catalogue
 * changes.
 */

export type Unit = {
  /** How the customer buys it: `kg`, `karung`, `pack`. */
  name: string;
  /** Base units inside one of these — a 25 kg sack is 25. */
  factor: number;
  price: number;
};

/**
 * One sellable SKU: the flavour or pack size that is actually stocked.
 *
 * The back office models a product (the thing on the shelf label) separately
 * from its variants (what is counted, priced and sold). A shop that sells only
 * one version of a good has a single variant, so this list is never empty.
 */
export type Variant = {
  id: string;
  sku: string;
  /** Ready to render: "Cokelat" or "Susu 250ml". */
  label: string;
  /** `{ Rasa: "Cokelat" }` — the attributes this variant was built from. */
  attributes: Record<string, string>;
  /** Base units of THIS variant in the warehouse that ships web orders. */
  stock: number;
  units: Unit[];
};

export type Product = {
  id: string;
  /** URL handle, derived from the SKU by the catalogue API. */
  slug: string;
  sku: string;
  name: string;
  description: string | null;
  /** Category name, e.g. "Tepung & Bahan Kering". */
  category: string | null;
  /** Base units on hand in the warehouse that fulfils web orders, all variants. */
  stock: number;
  /** At or below the tenant's minimum stock level in that warehouse. */
  lowStock: boolean;
  /** Packs of the default variant; the list that matters is per shelf. */
  units: Unit[];
  /** Every sellable SKU, each with its own stock and packs. */
  variants?: Variant[];
};

/**
 * What a shopper is actually choosing from: one SKU's packs and its stock.
 *
 * A product sold in a single version has exactly one shelf built from its own
 * `units`/`stock`, so the product page renders one screen either way instead of
 * branching on "does this have variants" in every derived helper.
 */
export type Shelf = {
  /** Variant id, or `null` when the product is sold as a single SKU. */
  id: string | null;
  /** "Cokelat", or `null` when there is nothing to choose between. */
  label: string | null;
  stock: number;
  units: Unit[];
};

/** The shelves to offer, at least one. Variants without a price are skipped. */
export function shelves(product: Product): Shelf[] {
  const variants = (product.variants ?? []).filter((variant) => variant.units.length > 0);
  if (variants.length > 0) {
    return variants.map((variant) => ({
      id: variant.id,
      // Every product carries at least one variant row; the one with no
      // attributes is the product itself (the API labels it "Default"), so it
      // must not turn up next to the product name in the basket.
      label: Object.keys(variant.attributes ?? {}).length > 0 ? variant.label : null,
      stock: variant.stock,
      units: variant.units,
    }));
  }
  return [{ id: null, label: null, stock: product.stock, units: product.units }];
}

const factorFormat = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });

/**
 * The unit stock is counted in. Every product carries a factor-1 unit, so this
 * is normally the plain kilogram or piece.
 */
export function baseUnit(shelf: Pick<Shelf, "units">): Unit {
  return shelf.units.find((unit) => unit.factor === 1) ?? shelf.units[0];
}

/** Cheapest pack across every shelf — the "from Rp …" figure on a tile. */
export function fromPrice(product: Product): number {
  const prices = shelves(product).flatMap((shelf) => shelf.units.map((unit) => unit.price));
  return prices.length > 0 ? Math.min(...prices) : 0;
}

/** Units the gudang can fill right now — one sack needs 25 kg on hand. */
export function sellableUnits(shelf: Shelf): Unit[] {
  return shelf.units.filter((unit) => shelf.stock >= unit.factor);
}

export function isSoldOut(shelf: Shelf): boolean {
  return sellableUnits(shelf).length === 0;
}

/** True only when nothing on any shelf can be shipped. */
export function isProductSoldOut(product: Product): boolean {
  return shelves(product).every(isSoldOut);
}

/** Largest quantity of `unit` the current stock can honour. */
export function maxQuantity(shelf: Shelf, unit: Unit): number {
  return Math.max(1, Math.floor(shelf.stock / unit.factor));
}

/** "per kg" for the base unit, "25 kg per karung" for a bundling unit. */
export function unitDetail(shelf: Shelf, unit: Unit): string {
  const base = baseUnit(shelf);
  if (unit.factor === 1) return `per ${unit.name}`;
  return `${factorFormat.format(unit.factor)} ${base.name} per ${unit.name}`;
}

/** Compact basket label: `kg` or `karung · 25 kg`. */
export function unitLabel(shelf: Shelf, unit: Unit): string {
  if (unit.factor === 1) return unit.name;
  return `${unit.name} · ${factorFormat.format(unit.factor)} ${baseUnit(shelf).name}`;
}

/** "70 kg" — stock rendered in the unit shoppers understand. */
export function stockLabel(shelf: Shelf): string {
  return `${factorFormat.format(shelf.stock)} ${baseUnit(shelf).name}`;
}
