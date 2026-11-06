/**
 * Satuan (unit) domain helpers.
 *
 * Indonesian retail buys and sells in nested packs: the smallest sellable unit
 * ("Pcs", "Sachet", "Botol"), a mid pack ("Renceng", "Lusin"), and a case
 * ("Karton", "Dus") whose size is written on it ("Isi 40 pcs"). The canonical
 * list below is only a *suggestion* the forms offer through a `<datalist>`;
 * the stored `product_units.name` stays free text so legacy rows and a
 * `vendor_price_list.unit_name` that matches by string never break.
 *
 * Pure and dependency-free, like `vendor.ts`, so it is unit tested without a DB.
 */

export type UnitCategory = "hitung" | "berat" | "volume" | "panjang";

export interface CanonicalUnit {
  /** Display label as offered to the tenant, e.g. "Karton". */
  name: string;
  category: UnitCategory;
  /**
   * Common pack sizes for this unit when it holds more than one base unit,
   * e.g. Karton -> [6, 12, 24, 40, 48, 200]. Empty for the base units.
   */
  typicalFactors: number[];
}

/**
 * Units common in Indonesian retail. Count units first (the usual base), then
 * the bulk packs, then weight/volume/length for goods sold by measure.
 */
export const CANONICAL_UNITS: CanonicalUnit[] = [
  // Base count units — usually the factor-1 pack.
  { name: "Pcs", category: "hitung", typicalFactors: [] },
  { name: "Butir", category: "hitung", typicalFactors: [] },
  { name: "Buah", category: "hitung", typicalFactors: [] },
  { name: "Sachet", category: "hitung", typicalFactors: [] },
  { name: "Stick", category: "hitung", typicalFactors: [] },
  { name: "Bungkus", category: "hitung", typicalFactors: [] },
  { name: "Kaleng", category: "hitung", typicalFactors: [] },
  { name: "Botol", category: "hitung", typicalFactors: [] },
  { name: "Toples", category: "hitung", typicalFactors: [] },
  { name: "Tube", category: "hitung", typicalFactors: [] },
  { name: "Jerigen", category: "hitung", typicalFactors: [] },
  { name: "Karung", category: "hitung", typicalFactors: [] },
  { name: "Kotak", category: "hitung", typicalFactors: [] },
  // Mid packs.
  { name: "Renceng", category: "hitung", typicalFactors: [6, 10, 12] },
  { name: "Lusin", category: "hitung", typicalFactors: [12] },
  { name: "Pack", category: "hitung", typicalFactors: [2, 4, 6, 10, 12] },
  { name: "Sleeve", category: "hitung", typicalFactors: [6, 12] },
  { name: "Isi", category: "hitung", typicalFactors: [6, 10, 12] },
  // Bulk cases.
  { name: "Dus", category: "hitung", typicalFactors: [6, 12, 24, 40, 48] },
  { name: "Karton", category: "hitung", typicalFactors: [6, 12, 24, 40, 48, 200] },
  { name: "Kardus", category: "hitung", typicalFactors: [6, 12, 24, 40, 48] },
  { name: "Loyang", category: "hitung", typicalFactors: [12, 24, 48] },
  { name: "Gross", category: "hitung", typicalFactors: [144] },
  { name: "Rim", category: "hitung", typicalFactors: [500] },
  // Weight, volume, length.
  { name: "Kg", category: "berat", typicalFactors: [] },
  { name: "Gram", category: "berat", typicalFactors: [] },
  { name: "Ons", category: "berat", typicalFactors: [] },
  { name: "Liter", category: "volume", typicalFactors: [] },
  { name: "mL", category: "volume", typicalFactors: [] },
  { name: "Meter", category: "panjang", typicalFactors: [] },
  { name: "Cm", category: "panjang", typicalFactors: [] },
];

/** Options for a `<datalist>` on a pack-name input. */
export function unitNameOptions(): string[] {
  return CANONICAL_UNITS.map((unit) => unit.name);
}

/** Suggested pack sizes for a chosen bulk unit, e.g. "Karton" -> [6,12,24,40,48,200]. */
export function typicalFactorsFor(name: string | null | undefined): number[] {
  const match = CANONICAL_UNITS.find(
    (unit) => unit.name.toLowerCase() === (name ?? "").trim().toLowerCase()
  );
  return match ? match.typicalFactors : [];
}

/** Whole-number friendly: 40 -> "40", 12.5 -> "12,5" (Indonesian decimal comma). */
function formatQty(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value).replace(".", ",");
}

/**
 * Human label for a pack's contents, e.g. `unitLabel("Karton", 40, "Pcs")` ->
 * "Isi 40 Pcs". Returns "" for the base unit itself (factor <= 1) so a "Pcs"
 * row is not cluttered with "Isi 1 Pcs".
 */
export function unitLabel(
  name: string | null | undefined,
  factor: number,
  baseName: string | null | undefined
): string {
  const numeric = Number(factor);
  if (!Number.isFinite(numeric) || numeric <= 1) return "";
  const base = (baseName ?? "").trim();
  if (!base) return `Isi ${formatQty(numeric)}`;
  return `Isi ${formatQty(numeric)} ${base}`;
}
