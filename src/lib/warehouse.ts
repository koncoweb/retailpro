import { query } from "@/lib/db";

/**
 * Warehouses are stocking locations; branches are selling locations. A till
 * belongs to a branch, but it deducts stock from a warehouse, and the two are
 * linked through `branch_warehouses` so that one warehouse can serve many
 * branches (a central DC) or one branch can draw on several (backroom + DC).
 */
export interface WarehouseOption {
  id: string;
  name: string;
  code: string | null;
  type: string;
  /** Owning branch. NULL means a shared, company-wide warehouse. */
  branch_id: string | null;
  status: string;
  is_default: number;
}

export const WAREHOUSES_SQL = `
  SELECT id, name, code, type, branch_id, status, is_default
  FROM warehouses
  ORDER BY is_default DESC, name ASC
`;

/**
 * The warehouse a branch sells from.
 *
 * Order of preference: the branch's default mapping, then the mapping with the
 * lowest priority number, then the company default warehouse. Returns null only
 * when the tenant has no active warehouse at all.
 */
export async function resolveBranchWarehouse(branchId: string | null | undefined): Promise<string | null> {
  if (branchId) {
    const mapped = await query<{ id: string }>(
      `SELECT w.id
         FROM branch_warehouses bw
         JOIN warehouses w ON w.id = bw.warehouse_id
        WHERE bw.branch_id = $1 AND w.status = 'active'
        ORDER BY bw.is_default DESC, bw.priority ASC, w.name ASC
        LIMIT 1`,
      [branchId]
    );
    if (mapped.rows[0]?.id) return mapped.rows[0].id;
  }

  const fallback = await query<{ id: string }>(
    `SELECT id
       FROM warehouses
      WHERE status = 'active'
      ORDER BY is_default DESC, name ASC
      LIMIT 1`
  );
  return fallback.rows[0]?.id ?? null;
}

/**
 * Branch that owns a warehouse, used wherever a stock movement has to be
 * booked against a branch (expenses, purchase orders). Shared warehouses have
 * no owner, so the caller's own branch is the next best answer.
 */
export async function resolveWarehouseBranch(
  warehouseId: string,
  fallbackBranchId?: string | null
): Promise<string | null> {
  const res = await query<{ branch_id: string | null }>(
    `SELECT branch_id FROM warehouses WHERE id = $1`,
    [warehouseId]
  );
  return res.rows[0]?.branch_id ?? fallbackBranchId ?? null;
}

/** Short label used in selects: "Thalia Pusat — Gudang (toko)". */
export function warehouseLabel(warehouse: WarehouseOption): string {
  return warehouse.branch_id ? warehouse.name : `${warehouse.name} · bersama`;
}
