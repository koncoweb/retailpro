/**
 * Catalogue shapes shared by the storefront routes.
 *
 * This module holds no data. Goods, selling units, prices and stock all come
 * from `/api/storefront/catalog` (see `lib/catalog.ts`), which reads the Thalia
 * tenant database. Keeping only types and derived helpers here is what makes
 * the shop a channel of the back office instead of a second, hand-maintained
 * product list that drifts the moment the catalogue changes.
 */

export type Unit = {
  /** How the customer buys it: `kg`, `karung`, `pack`. */
  name: string;
  /** Base units inside one of these — a 25 kg sack is 25. */
  factor: number;
  price: number;
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
  /** Base units on hand in the warehouse that fulfils web orders. */
  stock: number;
  /** At or below the tenant's minimum stock level in that warehouse. */
  lowStock: boolean;
  units: Unit[];
};

const factorFormat = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });

/**
 * The unit stock is counted in. Every product carries a factor-1 unit, so this
 * is normally the plain kilogram or piece.
 */
export function baseUnit(product: Product): Unit {
  return product.units.find((unit) => unit.factor === 1) ?? product.units[0];
}

export function fromPrice(product: Product): number {
  return Math.min(...product.units.map((unit) => unit.price));
}

/** Units the gudang can fill right now — one sack needs 25 kg on hand. */
export function sellableUnits(product: Product): Unit[] {
  return product.units.filter((unit) => product.stock >= unit.factor);
}

export function isSoldOut(product: Product): boolean {
  return sellableUnits(product).length === 0;
}

/** Largest quantity of `unit` the current stock can honour. */
export function maxQuantity(product: Product, unit: Unit): number {
  return Math.max(1, Math.floor(product.stock / unit.factor));
}

/** "per kg" for the base unit, "25 kg per karung" for a bundling unit. */
export function unitDetail(product: Product, unit: Unit): string {
  const base = baseUnit(product);
  if (unit.factor === 1) return `per ${unit.name}`;
  return `${factorFormat.format(unit.factor)} ${base.name} per ${unit.name}`;
}

/** Compact basket label: `kg` or `karung · 25 kg`. */
export function unitLabel(product: Product, unit: Unit): string {
  if (unit.factor === 1) return unit.name;
  return `${unit.name} · ${factorFormat.format(unit.factor)} ${baseUnit(product).name}`;
}

/** "70 kg" — stock rendered in the unit shoppers understand. */
export function stockLabel(product: Product): string {
  return `${factorFormat.format(product.stock)} ${baseUnit(product).name}`;
}
