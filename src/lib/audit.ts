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
  | "create_po"
  | "checkout"
  | "refund"
  | "create_employee"
  | "update_employee"
  | "create_expense"
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
