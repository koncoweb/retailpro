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
  | "create_transfer"
  | "approve_transfer";

export interface AuditLogParams {
  action: AuditAction;
  entity: string;
  entityId?: string;
  details?: Record<string, any>;
  userId?: string; // Optional, if not provided will try to infer or leave null
}

export const logAudit = async ({ action, entity, entityId, details, userId }: AuditLogParams) => {
  try {
    // Note: userId might be automatically handled by the database default if we set app.current_user_id
    // But since audit_logs has a user_id column, we can explicitly set it if we have it.
    // If called from frontend component where we have useAuth(), we can pass userId.
    // If called from backend-ish logic where we might not have it easily, we might rely on session.

    const queryText = `
      INSERT INTO audit_logs (action, entity, entity_id, details, user_id)
      VALUES ($1, $2, $3, $4, $5)
    `;

    // If userId is not provided, we might want to let the DB handle it or pass null.
    // However, our table schema has user_id as UUID NULL.
    // We should try to pass it if possible.
    
    await query(queryText, [
      action,
      entity,
      entityId || null,
      JSON.stringify(details || {}),
      userId || null
    ]);
  } catch (error) {
    console.error("Failed to write audit log:", error);
    // We generally don't want to fail the main operation if logging fails, 
    // but in strict compliance environments we might. 
    // For now, we just log the error.
  }
};
