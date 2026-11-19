/**
 * Resolve a scanned or typed code to a sellable line.
 *
 * The MS3580 (and every USB HID "keyboard-wedge" scanner) hands us a bare
 * string; deciding what it sells is kept here as a pure function so the till's
 * scan handler and its unit test agree on the rules. Barcodes are unique in
 * practice, so the first exact hit wins; a code that matches nothing returns
 * null and the caller warns the cashier instead of guessing a product.
 */
export interface BarcodeUnit {
  name: string;
  conversion_factor: number;
  barcode?: string | null;
  price?: number;
}

export interface BarcodeProduct {
  sku: string;
  units?: BarcodeUnit[];
  variants?: Array<{ id: string; sku: string; barcode?: string | null; units: BarcodeUnit[] }>;
}

export type ScanMatchKind = "unit-barcode" | "variant-barcode" | "variant-sku" | "product-sku";

export interface ScanMatch<T extends BarcodeProduct = BarcodeProduct> {
  product: T;
  /** The variant the code belongs to; null for a flat (legacy) product line. */
  variant: NonNullable<T["variants"]>[number] | null;
  /** The pack to sell: the matched barcode's pack, or the base pack for a SKU hit. */
  unit: BarcodeUnit | null;
  kind: ScanMatchKind;
}

const clean = (value: string | null | undefined) => (value ?? "").trim();

/** The factor-1 pack of a set of packs, if one exists. */
const basePack = (units: BarcodeUnit[] | undefined): BarcodeUnit | null =>
  units?.find((unit) => Number(unit.conversion_factor) === 1) ?? null;

export function findScanMatch<T extends BarcodeProduct>(products: T[], rawCode: string): ScanMatch<T> | null {
  const code = clean(rawCode);
  if (!code) return null;

  // 1. An exact pack barcode wins: it names the very SKU and pack to charge.
  for (const product of products) {
    for (const variant of product.variants ?? []) {
      const unit = variant.units?.find((u) => clean(u.barcode) === code);
      if (unit) return { product, variant, unit, kind: "unit-barcode" };
    }
    const unit = product.units?.find((u) => clean(u.barcode) === code);
    if (unit) return { product, variant: null, unit, kind: "unit-barcode" };
  }

  for (const product of products) {
    const variant = product.variants?.find((v) => clean(v.barcode) === code);
    if (variant) return { product, variant, unit: basePack(variant.units), kind: "variant-barcode" };
  }

  // 2. A variant SKU identifies the flavour but not the pack: sell its base unit.
  for (const product of products) {
    const variant = product.variants?.find((v) => clean(v.sku) === code);
    if (variant) {
      return { product, variant, unit: basePack(variant.units), kind: "variant-sku" };
    }
  }

  // 3. The product's own SKU: sell its base pack when there is one.
  for (const product of products) {
    if (clean(product.sku) === code) {
      return { product, variant: null, unit: basePack(product.units), kind: "product-sku" };
    }
  }

  return null;
}
