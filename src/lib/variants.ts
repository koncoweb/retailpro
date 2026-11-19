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
 * The axis list a set of combinations implies, in the order they were written.
 *
 * Both rich importers need this: a sheet never declares its axes as a list, it
 * declares one variant per line, and the product's `variant_attributes` has to
 * say which axes those lines used. First-seen name and value order is kept, so
 * a file that lists `Rasa` before `Ukuran` shows them in that order on the
 * product screen too.
 */
export function groupsFromAttributes(
  attributes: readonly VariantAttributes[]
): VariantAttributeGroup[] {
  const groups: VariantAttributeGroup[] = [];
  for (const combination of attributes) {
    for (const [name, value] of Object.entries(combination ?? {})) {
      const trimmed = String(value ?? "").trim();
      if (!trimmed) continue;
      const existing = groups.find((group) => group.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        if (!existing.values.some((held) => held.toLowerCase() === trimmed.toLowerCase())) {
          existing.values.push(trimmed);
        }
        continue;
      }
      groups.push({ name, values: [trimmed] });
    }
  }
  return sanitizeGroups(groups);
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

/**
 * Append-only union of two axis lists, used when an import extends a product
 * that already exists.
 *
 * Order is what the operator sees on the product screen, so the stored list
 * keeps its shape and the incoming one may only ADD: a group in the same
 * position, an extra value at the end of a group, or a new group at the end. A
 * value is never removed — variants that are still selling or holding stock
 * reference it, and an import has no licence to break them.
 */
export function mergeGroups(
  stored: readonly VariantAttributeGroup[],
  incoming: readonly VariantAttributeGroup[]
): VariantAttributeGroup[] {
  const merged = sanitizeGroups(stored).map((group) => ({
    name: group.name,
    values: [...group.values],
  }));

  for (const group of sanitizeGroups(incoming)) {
    const existing = merged.find(
      (candidate) => candidate.name.toLowerCase() === group.name.toLowerCase()
    );
    if (!existing) {
      merged.push({ name: group.name, values: [...group.values] });
      continue;
    }
    for (const value of group.values) {
      if (!existing.values.some((held) => held.toLowerCase() === value.toLowerCase())) {
        existing.values.push(value);
      }
    }
  }
  return merged;
}

/**
 * Parse a sheet's attribute cell — `Rasa=Susu;Ukuran=250ml` — into
 * `{ Rasa: "Susu", Ukuran: "250ml" }`.
 *
 * Someone writing a file by hand reaches for `;`, `|` or a newline as separator
 * and `=` or `:` between name and value, so all four are accepted. A bare value
 * with no name at all becomes its own numbered axis, which is what a
 * "just list the flavours" column produces. Blank, `-` or `Default` means the
 * product has no axes.
 */
export function parseAttributeCell(raw: string | null | undefined): VariantAttributes {
  const text = String(raw ?? "").trim();
  if (!text || text.toLowerCase() === "default" || text === "-") return {};

  const attributes: VariantAttributes = {};
  for (const chunk of text.split(/[;|\r\n]+/)) {
    const piece = chunk.trim();
    if (!piece) continue;
    const separator = piece.search(/[=:]/);
    if (separator > 0) {
      const name = piece.slice(0, separator).trim();
      const value = piece.slice(separator + 1).trim();
      if (name && value) {
        attributes[name] = value;
        continue;
      }
    }
    attributes[`Varian ${Object.keys(attributes).length + 1}`] = piece;
  }
  return attributes;
}

/**
 * The inverse of `parseAttributeCell`: render attributes back into the sheet's
 * `Rasa=Susu;Ukuran=250ml` form, in the order the product's axes were authored.
 *
 * Export has to write what import can read, in both screen's column sets, so the
 * formatter lives here rather than next to one caller.
 */
export function formatAttributeCell(
  attributes: VariantAttributes,
  groups: readonly VariantAttributeGroup[] = []
): string {
  const names = new Set<string>();
  const parts: string[] = [];
  for (const group of groups) {
    const value = attributes[group.name];
    if (!value) continue;
    parts.push(`${group.name}=${value}`);
    names.add(group.name);
  }
  // An axis that survived a group rename must still round-trip.
  for (const [name, value] of Object.entries(attributes)) {
    if (names.has(name) || !value) continue;
    parts.push(`${name}=${value}`);
  }
  return parts.join(";");
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
