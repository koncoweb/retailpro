/**
 * Purchase orders — "pesanan pembelian ke vendor".
 *
 * A purchase order records intent; a goods receipt records reality. That split
 * is deliberate and mirrors the branch-replenishment pair next door
 * (`stock_requests` -> `stock_transfers`): the order says what was asked for and
 * who agreed to it, the receipt says what arrived, in which lot, at which price.
 *
 * Every rule lives here as a pure function so the list, the editor, the receipt
 * dialog and the demo seed cannot drift apart. No React, no SQL — only
 * statuses, guards and numbering. The one exception is `nextDocumentNumber`,
 * which reads existing numbers through an already-open transaction because the
 * sequence must be allocated inside the same write it belongs to.
 *
 * Design notes: `docs/spec-purchase-order.md`.
 */
import { DEFAULT_ROLE_PERMISSIONS, type RoleValue } from "@/config/roles";
import type { UserRole } from "@/types";
import type { Transaction } from "@/lib/db";

/** Floating-point slack for REAL quantities (`0.1 + 0.2 !== 0.3`). */
const EPS = 1e-9;

export type PurchaseOrderStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "partially_received"
  | "received"
  | "rejected"
  | "cancelled";

export type PurchaseOrderAction =
  | "view"
  | "edit"
  | "submit"
  | "approve"
  | "reject"
  | "receive"
  | "cancel"
  | "delete"
  | "duplicate";

/** The four permissions this module gates, declared in `src/config/roles.ts`. */
export type PurchaseOrderPermission =
  | "create_po"
  | "approve_po"
  | "receive_po"
  | "cancel_po";

export const PURCHASE_ORDER_STATUSES: PurchaseOrderStatus[] = [
  "draft",
  "submitted",
  "approved",
  "partially_received",
  "received",
  "rejected",
  "cancelled",
];

/** Statuses that still expect someone to act. The default list filter. */
export const OPEN_PO_STATUSES: PurchaseOrderStatus[] = [
  "submitted",
  "approved",
  "partially_received",
];

/** Statuses a goods receipt may be posted against. */
export const RECEIVABLE_STATUSES: PurchaseOrderStatus[] = ["approved", "partially_received"];

export const PO_STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  draft: "Draf",
  submitted: "Menunggu Persetujuan",
  approved: "Disetujui",
  partially_received: "Diterima Sebagian",
  received: "Diterima",
  rejected: "Ditolak",
  cancelled: "Dibatalkan",
};

/** Badge tone per status, so every screen colours them the same way. */
export const PO_STATUS_TONE: Record<PurchaseOrderStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-warning/15 text-warning border-warning/30",
  approved: "bg-primary/10 text-primary border-primary/30",
  partially_received: "bg-primary/10 text-primary border-primary/30",
  received: "bg-success/15 text-success border-success/30",
  rejected: "bg-destructive/10 text-destructive border-destructive/30",
  cancelled: "bg-muted text-muted-foreground line-through",
};

/**
 * Map a stored status onto the current vocabulary.
 *
 * `ordered` is retired: approving an order *is* committing to the vendor, and
 * nothing in the app can tell the two apart. Migration 005 rewrites existing
 * rows, but a row written by an older cached bundle must not break the screen.
 */
export function normalizePurchaseOrderStatus(
  value: string | null | undefined
): PurchaseOrderStatus {
  if (value === "ordered") return "approved";
  return PURCHASE_ORDER_STATUSES.includes(value as PurchaseOrderStatus)
    ? (value as PurchaseOrderStatus)
    : "draft";
}

export const PO_STATUS_LABEL_OF = (value: string | null | undefined): string =>
  PO_STATUS_LABEL[normalizePurchaseOrderStatus(value)];

/** One label per action, so the list, the detail sheet and the toasts agree. */
export const PO_ACTION_LABEL: Record<PurchaseOrderAction, string> = {
  view: "Lihat",
  edit: "Ubah",
  submit: "Ajukan",
  approve: "Setujui",
  reject: "Tolak",
  receive: "Terima Barang",
  cancel: "Batalkan",
  delete: "Hapus",
  duplicate: "Duplikat",
};

export interface PurchaseOrderActionRule {
  /** Statuses the action may be taken from. */
  from: PurchaseOrderStatus[];
  /** `null` for actions that only read. */
  permission: PurchaseOrderPermission | null;
}

export const PO_ACTIONS: Record<PurchaseOrderAction, PurchaseOrderActionRule> = {
  view: { from: PURCHASE_ORDER_STATUSES, permission: null },
  edit: { from: ["draft"], permission: "create_po" },
  submit: { from: ["draft"], permission: "create_po" },
  approve: { from: ["submitted"], permission: "approve_po" },
  reject: { from: ["submitted"], permission: "approve_po" },
  receive: { from: RECEIVABLE_STATUSES, permission: "receive_po" },
  cancel: { from: ["draft", "submitted", "approved"], permission: "cancel_po" },
  delete: { from: ["draft"], permission: "create_po" },
  duplicate: { from: ["rejected", "cancelled", "received"], permission: "create_po" },
};

/** Display order of the row buttons. */
const ACTION_ORDER: PurchaseOrderAction[] = [
  "edit",
  "submit",
  "approve",
  "reject",
  "receive",
  "cancel",
  "duplicate",
  "delete",
  "view",
];

/** The legacy `admin` role has no entry in the permission matrix. */
function permissionRole(role: UserRole | RoleValue | null | undefined): RoleValue | null {
  if (!role) return null;
  if (role === "admin") return "tenant_admin";
  return role as RoleValue;
}

/**
 * Whether a role holds a purchase permission by *default*. A tenant may
 * override this in Settings -> Role; `usePermissions()` layers that on top.
 */
export function roleHasPurchasePermission(
  role: UserRole | RoleValue | null | undefined,
  permission: PurchaseOrderPermission
): boolean {
  const key = permissionRole(role);
  if (!key) return false;
  return DEFAULT_ROLE_PERMISSIONS[key]?.[permission] === true;
}

/** Predicate the screens pass in, typically `usePermissions().can`. */
export type PermissionCheck = (permission: string) => boolean;

export function canPerformPurchaseAction(
  status: PurchaseOrderStatus,
  action: PurchaseOrderAction,
  can: PermissionCheck
): boolean {
  const rule = PO_ACTIONS[action];
  if (!rule.from.includes(status)) return false;
  if (rule.permission === null) return true;
  return can(rule.permission);
}

/** Buttons to render for a row, in display order. */
export function actionsForPurchaseOrder(
  status: PurchaseOrderStatus,
  can: PermissionCheck
): PurchaseOrderAction[] {
  return ACTION_ORDER.filter((action) => canPerformPurchaseAction(status, action, can));
}

/**
 * Who may approve a purchase order.
 *
 * Returns `null` when the approval is allowed, otherwise the message to show.
 * A solo owner has to be able to sign their own order or the feature is
 * unusable; staff may never do it.
 */
export function checkApprovalRights(params: {
  role: UserRole | RoleValue | null | undefined;
  actorId: string | null | undefined;
  createdBy: string | null | undefined;
}): string | null {
  const { role, actorId, createdBy } = params;
  if (!actorId) return "Sesi tidak dikenali, muat ulang halaman";
  if (!createdBy || createdBy === actorId) {
    const isOwner = role === "tenant_owner" || role === "platform_owner";
    if (!isOwner) {
      return "Purchase order ini Anda buat sendiri. Persetujuan harus dari atasan.";
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Quantities
// ---------------------------------------------------------------------------

export interface PurchaseOrderLineQuantities {
  quantity: number;
  quantity_received?: number | null;
}

/** How much of a line is still owed, never negative. */
export function remainingQuantity(line: PurchaseOrderLineQuantities): number {
  return Math.max(0, Number(line.quantity) - Number(line.quantity_received ?? 0));
}

/** Every line has arrived in full. False for an order with no lines. */
export function isFullyReceived(lines: PurchaseOrderLineQuantities[]): boolean {
  return (
    lines.length > 0 &&
    lines.every((line) => Number(line.quantity_received ?? 0) + EPS >= Number(line.quantity))
  );
}

/** At least one unit has arrived on some line. */
export function hasAnyReceipt(lines: PurchaseOrderLineQuantities[]): boolean {
  return lines.some((line) => Number(line.quantity_received ?? 0) > EPS);
}

/**
 * The status a receipt leaves the order in.
 *
 * Only a receipt may advance these, so anything else is returned untouched.
 * The result is monotone: receiving never moves an order backwards.
 */
export function derivePurchaseOrderStatus(
  lines: PurchaseOrderLineQuantities[],
  current: PurchaseOrderStatus
): PurchaseOrderStatus {
  if (!RECEIVABLE_STATUSES.includes(current) && current !== "received") return current;
  if (isFullyReceived(lines)) return "received";
  if (hasAnyReceipt(lines)) return "partially_received";
  return "approved";
}

/**
 * What to show in a "received" column.
 *
 * Orders the old single-step code marked received have no `goods_receipts`
 * rows, so their receipt sum is 0 even though the goods are on the shelf;
 * migration 005 could not invent documents for them. A fully received order
 * therefore falls back to its own total. Every other status shows the real
 * receipt sum, because that is what is still outstanding.
 */
export function effectiveReceivedAmount(order: {
  status: PurchaseOrderStatus | string;
  total_amount: number;
  received_amount: number;
}): number {
  const received = Number(order.received_amount) || 0;
  if (normalizePurchaseOrderStatus(order.status) === "received") {
    return received > 0 ? received : Number(order.total_amount) || 0;
  }
  return received;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

export interface PurchaseOrderLineInput {
  productId: string;
  quantity: number;
  unitName: string;
  conversionFactor: number;
  unitCost: number;
}

export interface PurchaseOrderInput {
  supplierId: string | null | undefined;
  destinationWarehouseId: string | null | undefined;
  expectedDate?: string | null;
  items: PurchaseOrderLineInput[];
}

/** `null` when the order may be saved, otherwise the message to show. */
export function validatePurchaseOrder(order: PurchaseOrderInput, today: string): string | null {
  if (!order.supplierId) return "Pilih vendor terlebih dahulu";
  if (!order.destinationWarehouseId) return "Pilih gudang tujuan";
  if (order.items.length === 0) return "Tambahkan minimal 1 produk";

  for (const item of order.items) {
    const qty = Number(item.quantity);
    if (!Number.isFinite(qty) || qty <= 0) return "Jumlah tiap baris harus lebih dari 0";
    if (Math.round(qty * 1000) !== qty * 1000) return "Jumlah maksimal 3 angka di belakang koma";
    const cost = Number(item.unitCost);
    if (!Number.isFinite(cost) || cost < 0) return "Harga satuan tidak valid";
    const factor = Number(item.conversionFactor);
    if (!Number.isFinite(factor) || factor <= 0) return "Konversi satuan tidak valid";
    if (!item.unitName) return "Satuan tiap baris harus dipilih";
  }

  if (order.expectedDate && order.expectedDate < today) {
    return "Tanggal diharapkan tidak boleh di masa lalu";
  }

  return null;
}

export interface ReceiptLineInput {
  purchaseOrderItemId: string;
  /** This delivery, in the PO line's unit. */
  quantity: number;
  ordered: number;
  alreadyReceived: number;
  unitCost: number;
  unitName: string;
  expiryDate?: string | null;
}

/**
 * `null` when the receipt may be posted, otherwise the message to show.
 *
 * `requireExpiry` is set when the tenant picks stock FEFO: a batch without an
 * expiry date silently corrupts the pick order, so the receipt must supply one.
 */
export function validateReceipt(
  lines: ReceiptLineInput[],
  options: { receivedOn: string; requireExpiry: boolean }
): string | null {
  // Sign first: a negative line would otherwise be filtered out below and
  // reported as "nothing delivered", which is the wrong thing to fix.
  for (const line of lines) {
    const qty = Number(line.quantity);
    if (!Number.isFinite(qty) || qty < 0) return "Jumlah diterima tidak valid";
  }

  const delivered = lines.filter((line) => Number(line.quantity) > EPS);
  if (delivered.length === 0) return "Isi jumlah yang diterima untuk minimal satu baris";

  for (const line of lines) {
    const qty = Number(line.quantity);

    const remaining = Math.max(0, Number(line.ordered) - Number(line.alreadyReceived));
    if (qty > remaining + EPS) {
      const label = line.unitName ? ` ${line.unitName}` : "";
      return `Jumlah diterima melebihi sisa pesanan (${qty}${label} > ${remaining}${label}). Terima kelebihan sebagai PO baru.`;
    }

    if (qty > 0) {
      const cost = Number(line.unitCost);
      if (!Number.isFinite(cost) || cost < 0) return "Harga satuan tidak valid";

      if (options.requireExpiry) {
        if (!line.expiryDate) {
          return "Metode stok FEFO aktif: isi tanggal kedaluwarsa tiap baris yang diterima";
        }
        if (line.expiryDate <= options.receivedOn) {
          return `Tanggal kedaluwarsa harus setelah ${options.receivedOn}`;
        }
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Numbering
// ---------------------------------------------------------------------------

export type DocumentPrefix = "PO" | "GRN";

/** Which table and column holds the number for each document type. */
const NUMBER_STORAGE: Record<DocumentPrefix, { table: string; column: string }> = {
  PO: { table: "purchase_orders", column: "po_number" },
  GRN: { table: "goods_receipts", column: "grn_number" },
};

/**
 * `PO-20261030-`. The day is UTC, matching `orderNumberPrefix` in
 * `branch-orders.ts` so both document families sort the same way.
 */
export function documentNumberPrefix(prefix: DocumentPrefix, date: Date): string {
  const day = date.toISOString().slice(0, 10).replace(/-/g, "");
  return `${prefix}-${day}-`;
}

export function formatDocumentNumber(
  prefix: DocumentPrefix,
  date: Date,
  sequence: number
): string {
  return `${documentNumberPrefix(prefix, date)}${String(sequence).padStart(4, "0")}`;
}

/**
 * Highest sequence already used for that prefix and day, plus one.
 *
 * Reads the numbers back instead of counting rows so a gap (a deleted draft)
 * cannot hand out a duplicate. Legacy `PO/2026/0015` numbers do not share this
 * prefix, so they can never collide with the new format.
 */
export function nextDocumentSequence(
  prefix: DocumentPrefix,
  date: Date,
  existingNumbers: (string | null | undefined)[]
): number {
  const head = documentNumberPrefix(prefix, date);
  const highest = existingNumbers
    .filter((value): value is string => typeof value === "string" && value.startsWith(head))
    .reduce((max, value) => {
      const sequence = Number(value.slice(head.length));
      return Number.isFinite(sequence) ? Math.max(max, sequence) : max;
    }, 0);
  return highest + 1;
}

/**
 * Allocate the next number inside the caller's write transaction.
 *
 * The unique index `idx_po_number` / `idx_grn_number` is the real arbiter; this
 * only keeps the numbers gap-free in practice. Deriving the number after the
 * transaction opens is what makes a retry reuse it instead of burning a second
 * one — the old code generated the number in the modal, before the write.
 */
export async function nextDocumentNumber(
  tx: Transaction,
  prefix: DocumentPrefix,
  date: Date = new Date()
): Promise<string> {
  // `table` and `column` come from a closed record above, never from input.
  const { table, column } = NUMBER_STORAGE[prefix];
  const head = documentNumberPrefix(prefix, date);
  const res = await tx.query<{ value: string | null }>(
    `SELECT ${column} AS value FROM ${table} WHERE ${column} LIKE $1`,
    [`${head}%`]
  );
  const sequence = nextDocumentSequence(
    prefix,
    date,
    res.rows.map((row) => row.value)
  );
  return formatDocumentNumber(prefix, date, sequence);
}

/** Today in `YYYY-MM-DD`, the shape every date column in this schema uses. */
export function isoToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
