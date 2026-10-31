/**
 * Product variants: the difference between a MODEL and a SKU on the shelf.
 *
 * A product ("Kopi Sachet ABC") is the model. A variant ("Rasa=Susu,
 * Ukuran=250ml") is what is sold, stocked, barcoded and priced. Keeping the two
 * apart is what lets one vendor catalogue hold one product with six variants
 * instead of six look-alike products.
 *
 * Attribute groups are authored per product on `products.variant_attributes`
 * and expanded into the cartesian product here. Deliberately pure: no SQL, no
 * React, so the expansion and the SKU rule can be unit tested.
 */

export interface VariantAttributeGroup {
  /** Group label, e.g. "Rasa". */
  name: string;
  /** Allowed values, e.g. ["Susu", "Hitam"]. */
  values: string[];
}

/** One combination, keyed by group name: { Rasa: "Susu", Ukuran: "250ml" }. */
export type VariantAttributes = Record<string, string>;

/** Trim, drop blank groups and blank/duplicate values, keep the typed order. */
export function sanitizeGroups(groups: readonly VariantAttributeGroup[]): VariantAttributeGroup[] {
  const cleaned: VariantAttributeGroup[] = [];
  for (const group of groups) {
    const name = String(group.name ?? "").trim();
    if (!name) continue;
    const values: string[] = [];
    for (const raw of group.values ?? []) {
      const value = String(raw ?? "").trim();
      if (!value) continue;
      if (values.some((existing) => existing.toLowerCase() === value.toLowerCase())) continue;
      values.push(value);
    }
    if (values.length === 0) continue;
    cleaned.push({ name, values });
  }
  return cleaned;
}

/**
 * Every combination of the groups, in a stable order (first group varies
 * slowest, like an odometer). A product with no groups yields `[]` — the caller
 * then creates the single `Default` variant.
 */
export function expandCombinations(
  groups: readonly VariantAttributeGroup[]
): VariantAttributes[] {
  const usable = sanitizeGroups(groups);
  if (usable.length === 0) return [];

  let combinations: VariantAttributes[] = [{}];
  for (const group of usable) {
    const next: VariantAttributes[] = [];
    for (const combination of combinations) {
      for (const value of group.values) {
        next.push({ ...combination, [group.name]: value });
      }
    }
    combinations = next;
  }
  return combinations;
}

/** Values in the order the groups were authored, so labels read naturally. */
export function orderedValues(
  attributes: VariantAttributes,
  groups: readonly VariantAttributeGroup[] = []
): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const group of groups) {
    const value = attributes[group.name];
    if (value) {
      values.push(value);
      seen.add(group.name);
    }
  }
  // Attributes that survived a group rename must not vanish from the label.
  for (const [name, value] of Object.entries(attributes)) {
    if (!seen.has(name) && value) values.push(value);
  }
  return values;
}

/** "Susu 250ml", or "Default" for a product without variants. */
export function variantLabel(
  attributes: VariantAttributes,
  groups: readonly VariantAttributeGroup[] = []
): string {
  const values = orderedValues(attributes, groups);
  return values.length > 0 ? values.join(" ") : "Default";
}

/** ASCII slug for a SKU fragment: "250ml" -> "250ML". */
function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 12);
}

/**
 * Sellable SKU for a combination: `KOP-20261031-001-SUSU-250ML`.
 *
 * A product without attributes keeps the model SKU unchanged, which is exactly
 * what migration 006 backfills, so legacy rows and new rows agree.
 */
export function variantSku(baseSku: string, attributes: VariantAttributes): string {
  const parts = orderedValues(attributes).map(slug).filter(Boolean);
  const base = String(baseSku ?? "").trim();
  if (parts.length === 0) return base;
  return `${base}-${parts.join("-")}`;
}

/** Case-insensitive identity of a combination, used to match rows on edit. */
export function variantKey(attributes: VariantAttributes): string {
  return Object.entries(attributes)
    .filter(([, value]) => String(value ?? "").trim() !== "")
    .map(([name, value]) => `${name.trim().toLowerCase()}=${String(value).trim().toLowerCase()}`)
    .sort()
    .join("|");
}

/**
 * Fill in the groups a stored variant predates, so the matrix keeps rendering
 * after the owner adds a group instead of silently dropping the old row.
 */
export function alignToGroups(
  attributes: VariantAttributes,
  groups: readonly VariantAttributeGroup[]
): VariantAttributes {
  const aligned: VariantAttributes = {};
  for (const group of groups) {
    aligned[group.name] = attributes[group.name] ?? "";
  }
  for (const [name, value] of Object.entries(attributes)) {
    if (!(name in aligned)) aligned[name] = value;
  }
  return aligned;
}

/** Parse `product_variants.attributes` without trusting its contents. */
export function parseVariantAttributes(raw: unknown): VariantAttributes {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const result: VariantAttributes = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === "string" || typeof value === "number") {
        result[key] = String(value);
      }
    }
    return result;
  }
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    return parseVariantAttributes(JSON.parse(raw));
  } catch {
    return {};
  }
}

/** Parse `products.variant_attributes`, dropping anything malformed. */
export function parseVariantGroups(raw: unknown): VariantAttributeGroup[] {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];

  const groups: VariantAttributeGroup[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : "";
    const values = Array.isArray(record.values)
      ? record.values.filter((value): value is string => typeof value === "string")
      : [];
    groups.push({ name, values });
  }
  return sanitizeGroups(groups);
}
