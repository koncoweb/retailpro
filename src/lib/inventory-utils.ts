
/**
 * The stable head of a generated SKU: `PREFIX-YYYYMMDD-`.
 *
 * Exported so a bulk import can look up the last SKU the app minted for a
 * category on a given day (a `LIKE prefix%` query) and continue that sequence,
 * instead of colliding with what already exists.
 */
export function skuPrefixForCategory(categoryName: string, date: Date): string {
  let prefix = categoryName.substring(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, "CAT");
  if (prefix.length < 3) {
    prefix = prefix.padEnd(3, 'X');
  }
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
  return `${prefix}-${dateStr}-`;
}

/**
 * Generates a new SKU based on the category, date, and the last known SKU sequence.
 * Format: PREFIX-YYYYMMDD-XXX
 *
 * @param categoryName - The name of the category (e.g., "Electronics")
 * @param date - The date object to use for generation
 * @param lastSku - The last SKU found in the database for this pattern (or null/undefined if none)
 * @returns The generated SKU string
 */
export function generateNextSku(categoryName: string, date: Date, lastSku?: string | null): string {
  if (!categoryName) throw new Error("Category name is required");

  const baseSku = skuPrefixForCategory(categoryName, date);

  let sequence = 1;
  if (lastSku) {
    const parts = lastSku.split('-');
    // Assuming the format is PREFIX-DATE-SEQ
    // We take the last part
    const lastSeqStr = parts[parts.length - 1];
    const lastSeq = parseInt(lastSeqStr, 10);
    
    if (!isNaN(lastSeq)) {
      sequence = lastSeq + 1;
    }
  }

  return `${baseSku}${String(sequence).padStart(3, '0')}`;
}

/**
 * Validates if a barcode is valid (simple check for length/content)
 * This is a placeholder for more complex validation logic (e.g. checksum)
 */
export function validateBarcode(barcode: string): boolean {
    if (!barcode) return false;
    // EAN-13 should be 13 digits, but we allow flexible lengths for now
    return /^[0-9A-Za-z-]+$/.test(barcode);
}

/**
 * The smallest slice of the database the SKU minter needs. A `Transaction` and
 * the standalone `query()` both satisfy it, so a caller can mint inside or
 * outside a transaction without a second copy of the rule.
 */
export interface SkuSequenceReader {
  query<T = { sku: string }>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/** The number a generated SKU ends with, 0 when it does not end with one. */
function skuSequence(sku: string | null | undefined): number {
  if (!sku) return 0;
  const parts = String(sku).split('-');
  const value = parseInt(parts[parts.length - 1] ?? '', 10);
  return Number.isFinite(value) ? value : 0;
}

/**
 * The next SKU the app owns for a category, continuing the database sequence and
 * skipping the numbers already handed out during this run.
 *
 * Every bulk importer used to re-type this loop, which let two lines of one file
 * claim the same number and let two screens disagree about what is next. `seen`
 * is the caller's memory of what it minted earlier — the database cannot answer
 * for rows a planned batch has not written yet.
 */
export async function mintSkuForCategory(
  reader: SkuSequenceReader,
  category: string | null | undefined,
  today: Date = new Date(),
  seen: Iterable<string> = []
): Promise<string> {
  const name = (category || 'Umum').trim() || 'Umum';
  const prefix = skuPrefixForCategory(name, today);
  const res = await reader.query<{ sku: string }>(
    `SELECT sku FROM products WHERE sku LIKE $1 ORDER BY sku DESC LIMIT 1`,
    [`${prefix}%`]
  );

  let highest = skuSequence(res.rows[0]?.sku);
  for (const sku of seen) {
    if (!sku.toUpperCase().startsWith(prefix)) continue;
    highest = Math.max(highest, skuSequence(sku));
  }

  const last = highest > 0 ? `${prefix}${String(highest).padStart(3, '0')}` : null;
  return generateNextSku(name, today, last);
}

