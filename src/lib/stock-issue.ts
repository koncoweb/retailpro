/**
 * Stock issue policy: which batch leaves the shelf when goods are issued.
 *
 * The tenant picks one method in Settings → Inventori; every stock-out path
 * (POS checkout, stock reduction from the product form, stock opname shortage,
 * and both transfer-approval implementations) reads it from here, so the till,
 * the back office and the warehouse drain batches in the same order.
 *
 * Deliberately dependency-free: the comparator is pure so it can be unit
 * tested, and the constants are shared with the settings screen.
 *
 * Note on scope: FIFO/LIFO/FEFO decide the *order of issue*. Weighted average
 * cost (AVCO) is a valuation method, not an issue order — it would change how
 * COGS is computed, not which batch is picked, so it is not part of this list.
 */

export type StockIssueMethod = "fifo" | "lifo" | "fefo";

export const DEFAULT_STOCK_ISSUE_METHOD: StockIssueMethod = "fifo";

/** Top-level key in `tenants.settings` that holds the policy object. */
export const STOCK_ISSUE_SETTING_KEY = "inventory";

/** Field inside that object. */
export const STOCK_ISSUE_METHOD_FIELD = "stock_issue_method";

export interface StockIssueMethodMeta {
  value: StockIssueMethod;
  /** Full name shown on the settings card. */
  label: string;
  /** One-line summary for compact lists. */
  short: string;
  /** How the system picks the batch. */
  description: string;
  /** Typical retail use case. */
  bestFor: string;
  /** Trade-off the tenant should know before switching. */
  caveat: string;
}

export const STOCK_ISSUE_METHODS: StockIssueMethodMeta[] = [
  {
    value: "fifo",
    label: "FIFO — First In, First Out",
    short: "Barang paling awal masuk, keluar lebih dulu",
    description:
      "Batch dengan tanggal terima paling lama dikeluarkan lebih dulu, berapa pun tanggal kedaluwarsanya.",
    bestFor: "Sembako, elektronik, pakaian, dan barang tanpa masa simpan ketat.",
    caveat:
      "Barang berumur simpan pendek bisa tertinggal di gudang dan kedaluwarsa meski stoknya berputar.",
  },
  {
    value: "lifo",
    label: "LIFO — Last In, First Out",
    short: "Barang paling akhir masuk, keluar lebih dulu",
    description:
      "Batch terbaru dikeluarkan lebih dulu, sehingga harga pokok penjualan mengikuti harga beli terkini.",
    bestFor: "Barang curah dengan harga bergejolak, mis. bahan bangunan dan komoditas.",
    caveat:
      "Tidak diakui IFRS/PSAK dan menyulitkan audit persediaan; sebagian yurisdiksi pajak melarangnya.",
  },
  {
    value: "fefo",
    label: "FEFO — First Expired, First Out",
    short: "Kedaluwarsa terdekat, keluar lebih dulu",
    description:
      "Batch dengan tanggal kedaluwarsa paling dekat dikeluarkan lebih dulu; batch tanpa tanggal kedaluwarsa dipakai paling akhir.",
    bestFor: "Makanan, minuman, farmasi, kosmetik, dan barang bermasa simpan.",
    caveat:
      "Hanya efektif bila tanggal kedaluwarsa diisi saat penerimaan barang; batch lama tanpa tanggal akan selalu terpakai belakangan.",
  },
];

/** Anything that carries a batch identity plus the two ordering keys. */
export interface IssueBatch {
  id: string;
  received_at?: string | null;
  expiry_date?: string | null;
}

/** Coerce stored settings into a known method; anything else falls back to FIFO. */
export function normalizeStockIssueMethod(value: unknown): StockIssueMethod {
  const found = STOCK_ISSUE_METHODS.find((method) => method.value === value);
  return found ? found.value : DEFAULT_STOCK_ISSUE_METHOD;
}

export function stockIssueMethodMeta(method: StockIssueMethod): StockIssueMethodMeta {
  return (
    STOCK_ISSUE_METHODS.find((entry) => entry.value === method) ??
    STOCK_ISSUE_METHODS.find((entry) => entry.value === DEFAULT_STOCK_ISSUE_METHOD)!
  );
}

export function stockIssueMethodLabel(method: StockIssueMethod): string {
  return stockIssueMethodMeta(method).label;
}

/** ISO timestamps and `YYYY-MM-DD` dates both sort correctly as strings. */
const receivedKey = (batch: IssueBatch) => String(batch.received_at ?? "");

const expiryKey = (batch: IssueBatch) => String(batch.expiry_date ?? "");

/** Oldest received first; `id` breaks ties so the order is deterministic. */
function compareReceivedAsc(a: IssueBatch, b: IssueBatch): number {
  const byReceived = receivedKey(a).localeCompare(receivedKey(b));
  return byReceived !== 0 ? byReceived : a.id.localeCompare(b.id);
}

/**
 * Order two batches by issue policy. Negative means `a` leaves first.
 *
 * - FIFO: oldest `received_at` first.
 * - LIFO: newest `received_at` first.
 * - FEFO: nearest `expiry_date` first, batches without an expiry last, and
 *   FIFO within each group so equal dates still drain predictably.
 */
export function compareBatchesForIssue(
  a: IssueBatch,
  b: IssueBatch,
  method: StockIssueMethod
): number {
  if (method === "lifo") return compareReceivedAsc(b, a);

  if (method === "fefo") {
    const expiryA = expiryKey(a);
    const expiryB = expiryKey(b);
    // A batch that expires at all is more urgent than one that never does.
    if (expiryA && !expiryB) return -1;
    if (!expiryA && expiryB) return 1;
    if (expiryA && expiryB) {
      const byExpiry = expiryA.localeCompare(expiryB);
      if (byExpiry !== 0) return byExpiry;
    }
    return compareReceivedAsc(a, b);
  }

  return compareReceivedAsc(a, b);
}

/** Copy of `batches` in the order the policy says to consume them. */
export function sortBatchesForIssue<T extends IssueBatch>(
  batches: readonly T[],
  method: StockIssueMethod
): T[] {
  const normalized = normalizeStockIssueMethod(method);
  return [...batches].sort((a, b) => compareBatchesForIssue(a, b, normalized));
}
