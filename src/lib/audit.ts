import { query } from "./db";

export type AuditAction = 
  | "create" 
  | "update" 
  | "delete" 
  | "approve" 
  | "reject" 
  | "stock_adjustment" 
  | "transfer_approval"
  | "create_product"
  | "update_product"
  | "create_transfer"
  | "approve_transfer"
  | "dispatch_transfer"
  | "receive_transfer"
  | "cancel_transfer"
  | "create_stock_request"
  | "submit_stock_request"
  | "approve_stock_request"
  | "reject_stock_request"
  | "dispatch_stock_request"
  | "receive_stock_request"
  | "cancel_stock_request"
  | "create_po"
  | "submit_po"
  | "approve_po"
  | "reject_po"
  | "receive_po"
  | "cancel_po"
  | "checkout"
  | "refund"
  // A void is its own auditable event, not a generic "update": who cancelled a
  // paid bon (or one line of it), why, and how much came back is what the owner
  // traces in the audit log, so it gets a dedicated action.
  | "void_transaction"
  | "create_employee"
  | "update_employee"
  // Identity changes made through `/api/admin/users/[id]` are auditable events
  // of their own: a reset password is not "update_employee", and the audit log
  // is how an owner traces who could sign in as whom.
  | "reset_employee_password"
  // Per-employee permission exceptions are a rights change of their own: an
  // owner taking a permission back from one person is not "update_employee",
  // and the before/after map is what makes the narrowing auditable.
  | "update_employee_permissions"
  | "create_expense"
  // Internal team chat lifecycle. Only the durable, owner-relevant events are
  // audited — a channel being created/archived or a message being deleted —
  // never the individual messages, which are far too many to log.
  | "create_channel"
  | "archive_channel"
  | "delete_message"
  | "create_payment";

/** Minimal shape of `runTransaction`'s client, so an entry can be written atomically. */
export interface AuditExecutor {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: T[]; rowCount: number }>;
}

export interface AuditLogParams {
  action: AuditAction;
  entity: string;
  entityId?: string;
  details?: Record<string, unknown>;
  userId?: string; // Optional, if not provided will try to infer or leave null
}

export const logAudit = async ({ action, entity, entityId, details, userId }: AuditLogParams) => {
  try {
    // The tenant database is per company, so `user_id` is the only scoping
    // needed — there is no RLS session variable to fall back on any more.
    await query(
      `INSERT INTO audit_logs (action, entity, entity_id, details, user_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [action, entity, entityId || null, JSON.stringify(details || {}), userId || null]
    );
  } catch (error) {
    console.error("Failed to write audit log:", error);
    // We generally don't want to fail the main operation if logging fails, 
    // but in strict compliance environments we might. 
    // For now, we just log the error.
  }
};

/**
 * Write an audit entry on an already-open transaction.
 *
 * Money-moving operations (checkout, expense, employee changes) must not be
 * able to commit without their audit trail, so those paths pass the
 * transaction client in and let the write roll back together with the change.
 */
export const logAuditTx = async (
  executor: AuditExecutor,
  { action, entity, entityId, details, userId }: AuditLogParams
): Promise<void> => {
  await executor.query(
    `INSERT INTO audit_logs (action, entity, entity_id, details, user_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [action, entity, entityId || null, JSON.stringify(details || {}), userId || null]
  );
};
