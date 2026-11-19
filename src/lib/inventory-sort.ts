/**
 * Product-list sorting for the Inventory screen.
 *
 * The products table used to render in whatever order the query returned, so
 * finding the lowest stock or the priciest SKU meant scanning every row. The
 * comparator lives here as a pure function — no React, no query — so the header
 * toggle and its unit test can never disagree about what "sorted by stock" means.
 */

/** Columns the operator may sort by; each maps to a field on `Product`. */
export type InventorySortKey = "name" | "category" | "price" | "cost" | "stock" | "supplier";

export type SortDirection = "asc" | "desc";

/** The fields the comparator reads. `Product` satisfies this structurally. */
export interface InventorySortableRow {
  name: string;
  category: string;
  price: number;
  cost: number;
  stock: number;
  supplier: string;
}

/** Numeric columns compare by value; the rest by locale-aware text. */
const NUMERIC_KEYS = new Set<InventorySortKey>(["price", "cost", "stock"]);

/**
 * Order rows by `key` in `dir`, returning a new array. A null key returns the
 * input untouched so the default query order still shows until someone clicks a
 * header. Strings use a case-insensitive Indonesian collation; numbers compare
 * numerically (never as text, so "9" does not outrank "50").
 */
export function sortInventoryRows<T extends InventorySortableRow>(
  rows: T[],
  key: InventorySortKey | null,
  dir: SortDirection
): T[] {
  if (!key) return rows;
  const factor = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (NUMERIC_KEYS.has(key)) {
      return (Number(a[key]) - Number(b[key])) * factor;
    }
    return (
      String(a[key] ?? "")
        .localeCompare(String(b[key] ?? ""), "id", { sensitivity: "base" }) * factor
    );
  });
}

/**
 * The direction a column starts in when first clicked. Money and stock are most
 * useful high-first; names and categories read naturally A→Z.
 */
export function defaultSortDirection(key: InventorySortKey): SortDirection {
  return NUMERIC_KEYS.has(key) ? "desc" : "asc";
}
