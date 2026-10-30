/**
 * Branch replenishment orders — "pesanan cabang ke gudang".
 *
 * A shop asks the central warehouse for stock; the warehouse approves (often a
 * smaller quantity than asked), dispatches, and the shop confirms receipt.
 * Demand is deliberately not a transfer: the request records intent and
 * approval, `stock_transfers` records the batches that actually left the gudang.
 *
 * Every rule lives here as a pure function so the list page, the detail modal,
 * the checkout of an approval and the demo seed cannot drift apart. No SQL, no
 * React — only statuses, guards and numbering.
 */
import { DEFAULT_ROLE_PERMISSIONS, type RoleValue } from "@/config/roles";
import type { UserRole } from "@/types";

export type StockRequestStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "in_transit"
  | "received"
  | "cancelled";

export type StockRequestAction =
  | "submit"
  | "approve"
  | "reject"
  | "dispatch"
  | "receive"
  | "cancel";

/** The three permissions this module gates. */
export type StockRequestPermission =
  | "request_stock"
  | "approve_stock_request"
  | "dispatch_stock";

export const STOCK_REQUEST_STATUSES: StockRequestStatus[] = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "in_transit",
  "received",
  "cancelled",
];

/** Statuses that still need someone to act on them. */
export const OPEN_STATUSES: StockRequestStatus[] = ["draft", "submitted", "approved", "in_transit"];

export const STOCK_REQUEST_STATUS_LABEL: Record<StockRequestStatus, string> = {
  draft: "Draf",
  submitted: "Menunggu Persetujuan",
  approved: "Disetujui",
  rejected: "Ditolak",
  in_transit: "Dikirim",
  received: "Diterima",
  cancelled: "Dibatalkan",
};

export const STOCK_REQUEST_PRIORITY_LABEL: Record<string, string> = {
  normal: "Normal",
  urgent: "Mendesak",
};

export interface RequestActionRule {
  /** Statuses the action may be taken from. */
  from: StockRequestStatus[];
  to: StockRequestStatus;
  permission: StockRequestPermission;
}

export const REQUEST_ACTIONS: Record<StockRequestAction, RequestActionRule> = {
  submit: { from: ["draft"], to: "submitted", permission: "request_stock" },
  approve: { from: ["submitted"], to: "approved", permission: "approve_stock_request" },
  reject: { from: ["submitted"], to: "rejected", permission: "approve_stock_request" },
  dispatch: { from: ["approved"], to: "in_transit", permission: "dispatch_stock" },
  receive: { from: ["in_transit"], to: "received", permission: "request_stock" },
  cancel: {
    from: ["draft", "submitted", "approved"],
    to: "cancelled",
    permission: "request_stock",
  },
};

/** Statuses reachable from `status`, whatever the caller's role. */
export function nextStatuses(status: StockRequestStatus): StockRequestStatus[] {
  return Object.values(REQUEST_ACTIONS)
    .filter((rule) => rule.from.includes(status))
    .map((rule) => rule.to);
}

export function canTransition(from: StockRequestStatus, to: StockRequestStatus): boolean {
  return nextStatuses(from).includes(to);
}

/** Actions available at a status, in display order. */
export function actionsForStatus(status: StockRequestStatus): StockRequestAction[] {
  const order: StockRequestAction[] = ["submit", "approve", "reject", "dispatch", "receive", "cancel"];
  return order.filter((action) => REQUEST_ACTIONS[action].from.includes(status));
}

/** The legacy `admin` role has no entry in the permission matrix. */
function permissionRole(role: UserRole | RoleValue | null | undefined): RoleValue | null {
  if (!role) return null;
  if (role === "admin") return "tenant_admin";
  return role as RoleValue;
}

export function roleHasPermission(
  role: UserRole | RoleValue | null | undefined,
  permission: StockRequestPermission
): boolean {
  const key = permissionRole(role);
  if (!key) return false;
  return DEFAULT_ROLE_PERMISSIONS[key]?.[permission] === true;
}

/**
 * Whether this role may run `action` on a request in `status`.
 *
 * The branch matters: a store manager may confirm receipt for their own shop,
 * but the guard against acting on someone else's branch is applied by the page,
 * which knows the user's `assigned_branch_id`.
 */
export function canPerform(
  role: UserRole | RoleValue | null | undefined,
  status: StockRequestStatus,
  action: StockRequestAction
): boolean {
  const rule = REQUEST_ACTIONS[action];
  return rule.from.includes(status) && roleHasPermission(role, rule.permission);
}

/** `REQ/<yyyymmdd>-<branchCode>-`: what every number of that branch and day shares. */
export function orderNumberPrefix(date: Date, branchCode: string): string {
  const day = date.toISOString().slice(0, 10).replace(/-/g, "");
  return `REQ/${day}-${branchCode}-`;
}

/** A request number that sorts by day and reads like the invoice numbers. */
export function formatOrderNumber(date: Date, branchCode: string, sequence: number): string {
  return `${orderNumberPrefix(date, branchCode)}${String(sequence).padStart(4, "0")}`;
}

/**
 * Next free number for that branch and day.
 *
 * The unique index is the real guard, but deriving the sequence from what is
 * already stored keeps the numbers gap-free in practice — the same approach
 * the POS uses for invoices.
 */
export function nextOrderNumber(
  date: Date,
  branchCode: string,
  existingNumbers: string[]
): string {
  const prefix = orderNumberPrefix(date, branchCode);
  const highest = existingNumbers
    .filter((number) => number.startsWith(prefix))
    .reduce((max, number) => {
      const sequence = Number(number.slice(prefix.length));
      return Number.isFinite(sequence) ? Math.max(max, sequence) : max;
    }, 0);
  return formatOrderNumber(date, branchCode, highest + 1);
}

export interface OrderLineQuantities {
  quantity_requested: number;
  quantity_approved?: number | null;
  quantity_dispatched?: number | null;
  quantity_received?: number | null;
}

export interface OrderSummary {
  lineCount: number;
  requested: number;
  approved: number;
  dispatched: number;
  received: number;
  /** Approved but not yet dispatched: stock the gudang has promised. */
  committed: number;
  /** Dispatched but not yet confirmed by the shop. */
  inTransit: number;
}

/**
 * Base-unit totals for a request. Every column is a running total in the life
 * of one line, so `requested >= approved >= dispatched >= received` must hold
 * for each line and therefore for the document.
 */
export function summarizeOrder(lines: OrderLineQuantities[]): OrderSummary {
  const sum = (pick: (line: OrderLineQuantities) => number | null | undefined) =>
    lines.reduce((total, line) => total + Number(pick(line) ?? 0), 0);

  return {
    lineCount: lines.length,
    requested: sum((line) => line.quantity_requested),
    approved: sum((line) => line.quantity_approved),
    dispatched: sum((line) => line.quantity_dispatched),
    received: sum((line) => line.quantity_received),
    committed: lines.reduce(
      (total, line) =>
        total + Math.max(0, Number(line.quantity_approved ?? 0) - Number(line.quantity_dispatched ?? 0)),
      0
    ),
    inTransit: lines.reduce(
      (total, line) =>
        total + Math.max(0, Number(line.quantity_dispatched ?? 0) - Number(line.quantity_received ?? 0)),
      0
    ),
  };
}

/** `null` when the approval is valid, otherwise the message to show the user. */
export function validateApproval(lines: OrderLineQuantities[]): string | null {
  if (lines.length === 0) return "Pesanan belum punya baris produk";
  for (const line of lines) {
    const requested = Number(line.quantity_requested);
    const approved = Number(line.quantity_approved ?? requested);
    if (!Number.isFinite(approved) || approved < 0) return "Jumlah disetujui tidak valid";
    if (approved > requested + 1e-9) {
      return `Jumlah disetujui melebihi permintaan (${approved} > ${requested})`;
    }
  }
  return null;
}

/** `null` when the shop's receipt is valid. */
export function validateReceipt(lines: OrderLineQuantities[]): string | null {
  for (const line of lines) {
    const dispatched = Number(line.quantity_dispatched ?? 0);
    const received = Number(line.quantity_received ?? dispatched);
    if (!Number.isFinite(received) || received < 0) return "Jumlah diterima tidak valid";
    if (received > dispatched + 1e-9) {
      return `Jumlah diterima melebihi jumlah dikirim (${received} > ${dispatched})`;
    }
  }
  return null;
}

/**
 * Guard for the dispatch step: the gudang can only ship what it has not already
 * promised to another channel. `committed` is the part of that product already
 * approved-but-not-dispatched, excluding the request being shipped.
 */
export function validateDispatch(
  lines: { quantity_approved: number; onHand: number; committed: number }[]
): string | null {
  for (const line of lines) {
    const available = Number(line.onHand) - Number(line.committed);
    if (Number(line.quantity_approved) > available + 1e-9) {
      return `Stok gudang tidak cukup: disetujui ${line.quantity_approved}, tersedia ${available}`;
    }
  }
  return null;
}
