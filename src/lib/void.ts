/**
 * Void a paid transaction — one line or the whole bon.
 *
 * Retail rule this is built around: a sale is a financial record, so it is
 * never deleted. A void *marks* it, returns the goods to the exact batch they
 * left, keeps an explainable audit trail, and lets the printed note show the
 * struck-through line. Two shapes, matching what a cashier actually does at
 * the counter:
 *
 *   * void one or more lines   → the bon stays `completed`, its total drops by
 *     the voided lines' subtotal so the bon-level discount is preserved
 *     (subtracting the line, not recomputing from remaining lines, is the whole
 *     trick — see `nextTotalAfterVoid`);
 *   * void the whole bon       → every remaining line is voided and the bon's
 *     `status` flips to `void`; its original amount is left intact for the
 *     record, and revenue stays correct because every money query filters
 *     `status = 'completed'`.
 *
 * Gating mirrors the app's permission model (UI-resolved, see
 * `usePermissions`): the actor must hold `void_transaction`, and — unless they
 * are owner-tier — the bon must belong to a shift that is still `open`, so a
 * closed shift's Z-report is never quietly rewritten.
 *
 * The SQL is exported as constants and the decisions as pure functions so the
 * tests can replay the exact shipped statements against a throwaway v9
 * database (same harness as `schema.test.ts`) without a live tenant.
 */
import { runTransaction, type Transaction as DbTransaction } from "@/lib/db";
import { logAuditTx } from "@/lib/audit";

/** Roles allowed to void a bon whose shift has already been closed. */
export const OWNER_TIER_ROLES: readonly string[] = ["platform_owner", "tenant_owner", "tenant_admin"];

export interface VoidActor {
  id: string;
  role: string;
  /** Resolved from `usePermissions().can('void_transaction')` by the caller. */
  canVoid: boolean;
}

export interface VoidTarget {
  status: string;
  cashier_id: string | null;
  shift_id: string | null;
  /** `open` | `closed` | null when the transaction has no shift. */
  shift_status: string | null;
  total_amount: number;
}

export interface VoidResult {
  /** How many lines were newly voided. */
  voided: number;
  /** Sum of the subtotals that were voided. */
  voidedAmount: number;
  /** The bon's `total_amount` after the operation. */
  totalAfter: number;
}

interface ActiveItem {
  id: string;
  batch_id: string | null;
  quantity: number;
  conversion_factor: number | null;
  subtotal: number;
}

/* --------------------------------------------------------------------------
 * Pure decisions — unit-testable without a database.
 * ------------------------------------------------------------------------ */

/**
 * A bon-level discount is stored implicitly as `SUM(items) - total_amount`.
 * Removing a line must keep that discount intact, so we subtract the voided
 * lines' subtotal from the running total rather than recomputing the total as
 * the sum of the remaining lines (which would silently re-add the discount).
 */
export function nextTotalAfterVoid(currentTotal: number, voidedSubtotalSum: number): number {
  return Math.max(0, currentTotal - Math.max(0, voidedSubtotalSum));
}

/** Base units a line occupies: sold quantity × its pack conversion factor. */
export function baseQtyForRestock(quantity: number, conversionFactor: number | null): number {
  return Math.max(0, Number(quantity) * Number(conversionFactor ?? 1));
}

/**
 * Returns the reason the void is refused, or `null` when it may proceed.
 * Kept pure so the tests can drive every gate without touching the database.
 */
export function voidGuard(reason: string, actor: VoidActor, target: VoidTarget): string | null {
  if (!actor.canVoid) return "Anda tidak punya izin mem-void transaksi.";
  if (reason.trim().length < 3) return "Alasan void wajib diisi (minimal 3 karakter).";
  if (target.status !== "completed") return "Transaksi ini sudah dibatalkan.";
  const ownerTier = OWNER_TIER_ROLES.includes(actor.role);
  if (target.shift_status !== "open" && !ownerTier) {
    return "Transaksi ada di shift yang sudah ditutup; hanya owner/admin dapat mem-void.";
  }
  return null;
}

/* --------------------------------------------------------------------------
 * Shipped statements — replayed verbatim by the tests.
 * ------------------------------------------------------------------------ */

export const VOID_TARGET_SQL = `
  SELECT t.status, t.cashier_id, t.shift_id, t.total_amount,
         s.status AS shift_status
    FROM transactions t
    LEFT JOIN shifts s ON t.shift_id = s.id
   WHERE t.id = $1
`;

/** Lines still sellable (not yet voided) on a bon; carries what we need to restock and refund. */
export const ACTIVE_ITEMS_SQL = `
  SELECT id, batch_id, quantity, conversion_factor, subtotal
    FROM transaction_items
   WHERE transaction_id = $1 AND voided = 0
`;

export const RESTOCK_BATCH_SQL = `
  UPDATE product_batches
     SET quantity_current = quantity_current + $1
   WHERE id = $2
`;

export const MARK_ITEM_VOID_SQL = `
  UPDATE transaction_items
     SET voided = 1,
         void_reason = $1,
         voided_by = $2,
         voided_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   WHERE id = $3 AND voided = 0
`;

export const SET_TOTAL_SQL = `
  UPDATE transactions
     SET total_amount = $1,
         amount_paid = $1
   WHERE id = $2
`;

export const MARK_BON_VOID_SQL = `
  UPDATE transactions
     SET status = 'void',
         void_reason = $1,
         voided_by = $2,
         voided_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   WHERE id = $3
`;

/* --------------------------------------------------------------------------
 * Orchestration.
 * ------------------------------------------------------------------------ */

async function loadTarget(client: DbTransaction, txId: string): Promise<VoidTarget | null> {
  const res = await client.query<Record<string, unknown>>(VOID_TARGET_SQL, [txId]);
  const row = res.rows[0];
  if (!row) return null;
  return {
    status: String(row.status ?? ""),
    cashier_id: (row.cashier_id as string | null) ?? null,
    shift_id: (row.shift_id as string | null) ?? null,
    shift_status: (row.shift_status as string | null) ?? null,
    total_amount: Number(row.total_amount ?? 0),
  };
}

/**
 * Void the given lines of a bon. `itemIds` are validated against the bon's own
 * still-active lines, so a caller can only void lines that belong to this
 * transaction and have not already been voided.
 */
export async function voidTransactionItems(
  txId: string,
  itemIds: string[],
  reason: string,
  actor: VoidActor
): Promise<VoidResult> {
  return runTransaction(async (client) => {
    const target = await loadTarget(client, txId);
    if (!target) throw new Error("Transaksi tidak ditemukan.");
    const refusal = voidGuard(reason, actor, target);
    if (refusal) throw new Error(refusal);

    const wanted = new Set(itemIds);
    const itemsRes = await client.query<ActiveItem>(ACTIVE_ITEMS_SQL, [txId]);
    const selected = itemsRes.rows.filter((it) => wanted.has(it.id));
    if (selected.length === 0) {
      throw new Error("Tidak ada item yang bisa di-void (mungkin sudah dibatalkan).");
    }

    const trimmed = reason.trim();
    let voided = 0;
    let voidedAmount = 0;
    for (const item of selected) {
      const base = baseQtyForRestock(item.quantity, item.conversion_factor);
      if (item.batch_id && base > 0) {
        await client.query(RESTOCK_BATCH_SQL, [base, item.batch_id]);
      }
      await client.query(MARK_ITEM_VOID_SQL, [trimmed, actor.id, item.id]);
      voided += 1;
      voidedAmount += Number(item.subtotal) || 0;
    }

    const totalAfter = nextTotalAfterVoid(target.total_amount, voidedAmount);
    await client.query(SET_TOTAL_SQL, [totalAfter, txId]);

    await logAuditTx(client, {
      action: "void_transaction",
      entity: "transaction",
      entityId: txId,
      userId: actor.id,
      details: {
        kind: "items",
        reason: trimmed,
        voided_count: voided,
        voided_amount: voidedAmount,
        total_after: totalAfter,
      },
    });

    return { voided, voidedAmount, totalAfter };
  });
}

/** Void the whole bon: restocks and strikes every remaining line, then flags the bon `void`. */
export async function voidTransactionBon(
  txId: string,
  reason: string,
  actor: VoidActor
): Promise<VoidResult> {
  return runTransaction(async (client) => {
    const target = await loadTarget(client, txId);
    if (!target) throw new Error("Transaksi tidak ditemukan.");
    const refusal = voidGuard(reason, actor, target);
    if (refusal) throw new Error(refusal);

    const itemsRes = await client.query<ActiveItem>(ACTIVE_ITEMS_SQL, [txId]);
    const trimmed = reason.trim();
    let voided = 0;
    let voidedAmount = 0;
    for (const item of itemsRes.rows) {
      const base = baseQtyForRestock(item.quantity, item.conversion_factor);
      if (item.batch_id && base > 0) {
        await client.query(RESTOCK_BATCH_SQL, [base, item.batch_id]);
      }
      await client.query(MARK_ITEM_VOID_SQL, [trimmed, actor.id, item.id]);
      voided += 1;
      voidedAmount += Number(item.subtotal) || 0;
    }

    // The bon keeps its original `total_amount` as the record of the cancelled
    // sale; revenue stays correct because every money query filters
    // `status = 'completed'`, which now excludes this row.
    await client.query(MARK_BON_VOID_SQL, [trimmed, actor.id, txId]);

    await logAuditTx(client, {
      action: "void_transaction",
      entity: "transaction",
      entityId: txId,
      userId: actor.id,
      details: {
        kind: "bon",
        reason: trimmed,
        voided_count: voided,
        voided_amount: voidedAmount,
        original_total: target.total_amount,
      },
    });

    return { voided, voidedAmount, totalAfter: target.total_amount };
  });
}
