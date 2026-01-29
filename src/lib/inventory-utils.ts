
/**
 * Generates a new SKU based on the category, date, and the last known SKU sequence.
 * Format: KAT-YYMMDD-XXX
 * 
 * @param categoryName - The name of the category (e.g., "Electronics")
 * @param date - The date object to use for generation
 * @param lastSku - The last SKU found in the database for this pattern (or null/undefined if none)
 * @returns The generated SKU string
 */
export function generateNextSku(categoryName: string, date: Date, lastSku?: string | null): string {
  if (!categoryName) throw new Error("Category name is required");

  // Generate prefix: First 3 chars of category, uppercase, replace non-alphanumeric with CAT
  let prefix = categoryName.substring(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, "CAT");
  if (prefix.length < 3) {
      prefix = prefix.padEnd(3, 'X');
  }

  // Generate date part: YYYYMMDD
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");

  const baseSku = `${prefix}-${dateStr}-`;

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
