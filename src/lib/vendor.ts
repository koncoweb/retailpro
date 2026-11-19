/**
 * Vendor (supplier) domain helpers.
 *
 * Pure functions only: the pages keep their SQL so the audit script can replay
 * it, while the labels, code generation and debt maths live here and are unit
 * tested without a database.
 */

/** `trader` = buys and resells stock without producing it (e.g. a shop). */
export type VendorCategory =
  | "supplier"
  | "distributor"
  | "trader"
  | "manufacturer"
  | "service"
  | "other";
export type VendorStatus = "active" | "inactive" | "blacklisted";
export type VendorPaymentMethod = "cash" | "transfer" | "qris" | "check" | "other";

export const VENDOR_CATEGORIES: Array<{ value: VendorCategory; label: string }> = [
  { value: "supplier", label: "Supplier" },
  { value: "distributor", label: "Distributor" },
  { value: "trader", label: "Trader" },
  { value: "manufacturer", label: "Pabrikan" },
  { value: "service", label: "Penyedia Jasa" },
  { value: "other", label: "Lainnya" },
];

export const VENDOR_STATUSES: Array<{ value: VendorStatus; label: string }> = [
  { value: "active", label: "Aktif" },
  { value: "inactive", label: "Nonaktif" },
  { value: "blacklisted", label: "Blacklist" },
];

export const VENDOR_PAYMENT_METHODS: Array<{ value: VendorPaymentMethod; label: string }> = [
  { value: "transfer", label: "Transfer Bank" },
  { value: "qris", label: "QRIS" },
  { value: "cash", label: "Tunai" },
  { value: "check", label: "Cek / Giro" },
  { value: "other", label: "Lainnya" },
];

export const VENDOR_CODE_PREFIX = "VND";

/** Payment terms in days, offered as quick picks in the vendor form. */
export const PAYMENT_TERM_OPTIONS = [0, 7, 14, 30, 45, 60, 90];

export function vendorCategoryLabel(value: string | null | undefined): string {
  return VENDOR_CATEGORIES.find((item) => item.value === value)?.label ?? "Supplier";
}

export function vendorStatusLabel(value: string | null | undefined): string {
  return VENDOR_STATUSES.find((item) => item.value === value)?.label ?? "Aktif";
}

export function vendorPaymentMethodLabel(value: string | null | undefined): string {
  return VENDOR_PAYMENT_METHODS.find((item) => item.value === value)?.label ?? "Transfer Bank";
}

/**
 * Badge classes per lifecycle status. Blacklisted has to read as an alarm, not
 * as another grey chip, because it is the only status that blocks purchasing.
 */
export function vendorStatusBadgeClass(value: string | null | undefined): string {
  if (value === "blacklisted") return "bg-destructive/15 text-destructive hover:bg-destructive/25";
  if (value === "inactive") return "bg-muted text-muted-foreground hover:bg-muted";
  return "bg-success/20 text-success hover:bg-success/30";
}

/** The sequence number inside a generated code: `VND-0042` -> 42, anything else -> null. */
export function vendorCodeSequence(code: string | null | undefined): number | null {
  const match = code?.trim().match(/^[A-Z]+-(\d+)$/);
  return match ? Number(match[1]) : null;
}

/**
 * The highest sequence number among already-used codes, as `VND-####`.
 *
 * Only numeric codes count. An operator is free to name a vendor `VND-SURIYA`;
 * that code is valid, it just is not part of the generated sequence — and a
 * lexical sort would rank every letter above every digit, so such a code would
 * look like the "latest" vendor and restart the counter on a value that already
 * exists.
 */
export function highestVendorCode(
  codes: Iterable<string | null | undefined>
): string | null {
  let top: number | null = null;
  for (const code of codes) {
    const seq = vendorCodeSequence(code);
    if (seq !== null && (top === null || seq > top)) top = seq;
  }
  return top === null ? null : `${VENDOR_CODE_PREFIX}-${String(top).padStart(4, "0")}`;
}

/** `VND-0001` -> `VND-0002`. Null or malformed input restarts at 0001. */
export function nextVendorCode(latestCode: string | null | undefined): string {
  const seq = vendorCodeSequence(latestCode);
  const next = seq === null ? 1 : seq + 1;
  return `${VENDOR_CODE_PREFIX}-${String(next).padStart(4, "0")}`;
}

export function outstandingAmount(amount: number, amountPaid: number): number {
  return Math.max(0, Number(amount || 0) - Number(amountPaid || 0));
}

/** ISO date (UTC), matching SQLite's `date('now')`. */
export function isoDate(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Due date implied by the vendor's payment terms. */
export function dueDateFromTerms(termsDays: number, from: Date = new Date()): string {
  const days = Number.isFinite(termsDays) ? Math.max(0, Math.trunc(termsDays)) : 0;
  return isoDate(new Date(from.getTime() + days * 86_400_000));
}

/**
 * Overdue means the due date has already passed. A bill due today is not late.
 * Accepts both `YYYY-MM-DD` and full ISO timestamps.
 */
export function isOverdue(dueDate: string | null | undefined, today: string = isoDate()): boolean {
  if (!dueDate) return false;
  return dueDate.slice(0, 10) < today;
}

/** Two-letter monogram used by the vendor list avatars. */
export function vendorInitials(name: string): string {
  return name
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}
