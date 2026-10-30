/**
 * The one implementation of moving stock between warehouses.
 *
 * It used to live twice — once in `pages/BranchTransfers.tsx` and once in
 * `pages/Inventory.tsx` — and the copies had already drifted (different batch
 * numbering, and only one preserved expiry/cost). Every screen that moves stock
 * now calls this module inside its own `runTransaction`, so approval semantics
 * cannot diverge again.
 *
 * Lifecycle: `pending` (queued) -> `in_transit` (batches left the source) ->
 * `completed` (the receiving side confirmed). Stock moves at dispatch, which is
 * what the ledger has always done; receipt only records confirmation.
 */
import type { Transaction } from "@/lib/db";
import { sortBatchesForIssue, type StockIssueMethod } from "@/lib/stock-issue";

export class StockMovementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StockMovementError";
  }
}

export type TransferStatus = "pending" | "in_transit" | "completed" | "cancelled";

/**
 * One set of labels for every screen that lists a movement, so the transfer
 * page and the Inventory tab cannot name the same status differently.
 */
export const TRANSFER_STATUS_LABEL: Record<TransferStatus, string> = {
  pending: "Menunggu Dikirim",
  in_transit: "Dikirim",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};

export function transferStatusLabel(status: string): string {
  return TRANSFER_STATUS_LABEL[status as TransferStatus] ?? status;
}

export interface TransferItemInput {
  productId: string;
  /** Quantity in the chosen selling unit, not base units. */
  quantity: number;
  unitName?: string;
  conversionFactor?: number;
  notes?: string | null;
}

export interface CreateTransferParams {
  referenceNumber: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  notes?: string | null;
  requestedBy?: string | null;
  /** Set when a branch request asked for this movement. */
  requestId?: string | null;
  items: TransferItemInput[];
}

export interface DispatchResult {
  referenceNumber: string;
  itemCount: number;
}

/** Stock physically on hand in one warehouse, in base units. */
export async function stockOnHand(
  tx: Transaction,
  warehouseId: string,
  productId: string
): Promise<number> {
  const res = await tx.query<{ available: number }>(
    `SELECT COALESCE(SUM(quantity_current), 0) AS available
       FROM product_batches
      WHERE product_id = $1 AND warehouse_id = $2 AND quantity_current > 0`,
    [productId, warehouseId]
  );
  return Number(res.rows[0]?.available ?? 0);
}

/**
 * Queues a movement. The stock pre-flight is repeated against the ledger
 * because the modal validated a snapshot taken minutes earlier.
 */
export async function createTransfer(
  tx: Transaction,
  params: CreateTransferParams
): Promise<string> {
  if (params.sourceWarehouseId === params.destinationWarehouseId) {
    throw new StockMovementError("Gudang asal dan tujuan tidak boleh sama");
  }
  if (params.items.length === 0) {
    throw new StockMovementError("Transfer belum punya baris produk");
  }

  const header = await tx.query<{ id: string }>(
    `INSERT INTO stock_transfers
       (reference_number, source_warehouse_id, destination_warehouse_id, status,
        notes, requested_by, request_id, created_at)
     VALUES ($1, $2, $3, 'pending', $4, $5, $6, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     RETURNING id`,
    [
      params.referenceNumber,
      params.sourceWarehouseId,
      params.destinationWarehouseId,
      params.notes ?? null,
      params.requestedBy ?? null,
      params.requestId ?? null,
    ]
  );
  const transferId = header.rows[0].id;

  for (const item of params.items) {
    const conversionFactor = Number(item.conversionFactor || 1);
    const baseQty = Number(item.quantity) * conversionFactor;
    if (!(baseQty > 0)) {
      throw new StockMovementError("Jumlah transfer harus lebih dari nol");
    }

    const available = await stockOnHand(tx, params.sourceWarehouseId, item.productId);
    if (baseQty > available + 1e-9) {
      throw new StockMovementError(
        `Stok gudang asal tidak mencukupi (tersedia ${available}, diminta ${baseQty})`
      );
    }

    // `cost_price` stays 0 here and is stamped at dispatch with the real
    // per-batch cost of whatever legs actually left the shelf.
    await tx.query(
      `INSERT INTO transfer_items (transfer_id, product_id, quantity_sent, notes, unit_name, conversion_factor)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        transferId,
        item.productId,
        item.quantity,
        item.notes ?? null,
        item.unitName || "Pcs",
        conversionFactor,
      ]
    );
  }

  return transferId;
}

/** One batch consumed by a movement, with the cost and expiry it carried. */
interface ConsumedLeg {
  batchId: string;
  take: number;
  cost: number;
  expiryDate: string | null;
  supplierId: string | null;
}

/**
 * Deducts `quantity` (base units) from one product's batches in one warehouse,
 * in the tenant's issue order, and reports the legs that were consumed.
 *
 * Every stock-out path funnels through here: a transfer re-creates the legs at
 * the destination, while goods that leave the building simply drop them. The
 * deduction is a guarded UPDATE, so a concurrent sale cannot drive a batch
 * negative between the read and the write.
 */
async function drainBatches(
  tx: Transaction,
  {
    warehouseId,
    productId,
    quantity,
    issueMethod,
  }: {
    warehouseId: string;
    productId: string;
    quantity: number;
    issueMethod: StockIssueMethod;
  }
): Promise<ConsumedLeg[]> {
  if (!(quantity > 0)) {
    throw new StockMovementError("Jumlah yang dipindahkan harus lebih dari nol");
  }

  const batchesRes = await tx.query<{
    id: string;
    quantity_current: number;
    cost_price: number;
    expiry_date: string | null;
    received_at: string | null;
    supplier_id: string | null;
  }>(
    `SELECT id, quantity_current, cost_price, expiry_date, received_at, supplier_id
       FROM product_batches
      WHERE product_id = $1 AND warehouse_id = $2 AND quantity_current > 0`,
    [productId, warehouseId]
  );

  const available = batchesRes.rows.reduce((sum, batch) => sum + Number(batch.quantity_current), 0);
  if (available + 1e-9 < quantity) {
    throw new StockMovementError(
      `Stok gudang asal tidak mencukupi (tersedia ${available}, diminta ${quantity})`
    );
  }

  let remaining = quantity;
  const consumed: ConsumedLeg[] = [];

  for (const batch of sortBatchesForIssue(batchesRes.rows, issueMethod)) {
    if (remaining <= 1e-9) break;
    const take = Math.min(Number(batch.quantity_current), remaining);

    // Guarded update: refuses to drive the batch negative.
    const deducted = await tx.query(
      `UPDATE product_batches SET quantity_current = quantity_current - $1
        WHERE id = $2 AND quantity_current >= $1`,
      [take, batch.id]
    );
    if (deducted.rowCount !== 1) {
      throw new StockMovementError("Stok berubah selama transfer, silakan ulangi");
    }

    consumed.push({
      batchId: batch.id,
      take,
      cost: Number(batch.cost_price),
      expiryDate: batch.expiry_date,
      supplierId: batch.supplier_id,
    });
    remaining -= take;
  }

  if (remaining > 1e-6) {
    throw new StockMovementError(
      `Stok sumber tidak cukup untuk dipindahkan (kurang ${remaining} unit dasar)`
    );
  }

  return consumed;
}

/**
 * Ships a queued transfer: drains the source batches in the tenant's issue
 * order and creates one destination batch per source leg, so cost and expiry
 * survive the move.
 */
export async function dispatchTransfer(
  tx: Transaction,
  {
    transferId,
    userId,
    issueMethod,
  }: { transferId: string; userId?: string | null; issueMethod: StockIssueMethod }
): Promise<DispatchResult> {
  // `status = 'pending'` doubles as the lock: a second click finds no row.
  const transferRes = await tx.query<{
    id: string;
    reference_number: string;
    source_warehouse_id: string;
    destination_warehouse_id: string;
  }>(
    `SELECT id, reference_number, source_warehouse_id, destination_warehouse_id
       FROM stock_transfers WHERE id = $1 AND status = 'pending'`,
    [transferId]
  );
  const transfer = transferRes.rows[0];
  if (!transfer) throw new StockMovementError("Transfer sudah diproses atau tidak ditemukan");
  if (transfer.source_warehouse_id === transfer.destination_warehouse_id) {
    throw new StockMovementError("Gudang asal dan tujuan sama, tidak ada yang dipindahkan");
  }

  const itemsRes = await tx.query<{
    id: string;
    product_id: string;
    quantity_sent: number;
    conversion_factor: number;
  }>(`SELECT id, product_id, quantity_sent, conversion_factor FROM transfer_items WHERE transfer_id = $1`, [
    transferId,
  ]);

  for (const item of itemsRes.rows) {
    const conversionFactor = Number(item.conversion_factor || 1);
    const legs = await drainBatches(tx, {
      warehouseId: transfer.source_warehouse_id,
      productId: item.product_id,
      quantity: Number(item.quantity_sent) * conversionFactor,
      issueMethod,
    });

    let leg = 0;
    for (const consumed of legs) {
      leg += 1;
      await tx.query(
        `INSERT INTO product_batches
           (warehouse_id, product_id, batch_number, expiry_date,
            quantity_initial, quantity_current, cost_price, supplier_id)
         VALUES ($1, $2, $3, $4, $5, $5, $6, $7)`,
        [
          transfer.destination_warehouse_id,
          item.product_id,
          `TRF-${transfer.reference_number}-${leg}`,
          consumed.expiryDate,
          consumed.take,
          consumed.cost,
          consumed.supplierId,
        ]
      );
    }

    const totalMoved = legs.reduce((sum, entry) => sum + entry.take, 0);
    const totalCost = legs.reduce((sum, entry) => sum + entry.take * entry.cost, 0);

    await tx.query(
      `UPDATE transfer_items
          SET quantity_received = $1, cost_price = $2, source_batch_id = $3
        WHERE id = $4`,
      [
        totalMoved,
        legs.length > 0 ? Math.round(totalCost / Math.max(totalMoved, 1e-9)) : 0,
        // Only unambiguous when the whole line came from one batch.
        legs.length === 1 ? legs[0].batchId : null,
        item.id,
      ]
    );
  }

  await tx.query(
    `UPDATE stock_transfers
        SET status = 'in_transit', approved_by = $1,
            sent_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = $2`,
    [userId ?? null, transferId]
  );

  return { referenceNumber: transfer.reference_number, itemCount: itemsRes.rows.length };
}

export interface ShipOutLine {
  productId: string;
  /** Base units. */
  quantity: number;
}

/**
 * Goods that leave the building instead of another warehouse.
 *
 * The online channel has no rack to receive into, so its order is picked from
 * the central gudang and the stock simply goes away — the same batch order and
 * the same guarded deduction as a transfer, without a destination row. The
 * request document itself is the record, so the caller must write the audit
 * entry in the same transaction.
 */
export async function shipOutOfStock(
  tx: Transaction,
  {
    warehouseId,
    items,
    issueMethod,
  }: { warehouseId: string; items: ShipOutLine[]; issueMethod: StockIssueMethod }
): Promise<{ moved: { productId: string; quantity: number; cost: number }[] }> {
  if (items.length === 0) throw new StockMovementError("Pesanan belum punya baris produk");

  const moved: { productId: string; quantity: number; cost: number }[] = [];
  for (const item of items) {
    const legs = await drainBatches(tx, {
      warehouseId,
      productId: item.productId,
      quantity: Number(item.quantity),
      issueMethod,
    });
    moved.push({
      productId: item.productId,
      quantity: legs.reduce((sum, leg) => sum + leg.take, 0),
      cost: legs.reduce((sum, leg) => sum + leg.take * leg.cost, 0),
    });
  }

  return { moved };
}

/**
 * Confirms that the goods arrived. Stock already moved at dispatch, so this
 * only closes the document and records who received it.
 */
export async function receiveTransfer(
  tx: Transaction,
  { transferId, userId }: { transferId: string; userId?: string | null }
): Promise<{ referenceNumber: string }> {
  const transferRes = await tx.query<{ reference_number: string }>(
    `SELECT reference_number FROM stock_transfers WHERE id = $1 AND status = 'in_transit'`,
    [transferId]
  );
  const transfer = transferRes.rows[0];
  if (!transfer) throw new StockMovementError("Transfer belum dikirim atau sudah diterima");

  await tx.query(
    `UPDATE stock_transfers
        SET status = 'completed', received_by = $1,
            received_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = $2`,
    [userId ?? null, transferId]
  );

  return { referenceNumber: transfer.reference_number };
}

/** Cancels a queued movement. Dispatched goods can no longer be cancelled. */
export async function cancelTransfer(
  tx: Transaction,
  transferId: string
): Promise<void> {
  const res = await tx.query(
    `UPDATE stock_transfers SET status = 'cancelled' WHERE id = $1 AND status = 'pending'`,
    [transferId]
  );
  if (res.rowCount !== 1) {
    throw new StockMovementError("Hanya transfer yang belum dikirim bisa dibatalkan");
  }
}

/**
 * Stock a warehouse has already promised but not yet shipped, per product.
 * Used by the dispatch guard so two requests cannot claim the same units.
 */
export async function committedQuantities(
  tx: Transaction,
  warehouseId: string,
  productIds: string[],
  excludeRequestId?: string | null
): Promise<Record<string, number>> {
  if (productIds.length === 0) return {};
  const placeholders = productIds.map((_, index) => `$${index + 2}`).join(", ");
  const res = await tx.query<{ product_id: string; committed: number }>(
    `SELECT i.product_id, SUM(i.quantity_approved) AS committed
       FROM stock_request_items i
       JOIN stock_requests r ON r.id = i.request_id
      WHERE r.warehouse_id = $1
        AND r.status IN ('approved', 'in_transit')
        AND ($${productIds.length + 2} IS NULL OR r.id <> $${productIds.length + 2})
        AND i.product_id IN (${placeholders})
      GROUP BY i.product_id`,
    [warehouseId, ...productIds, excludeRequestId ?? null]
  );

  return Object.fromEntries(res.rows.map((row) => [row.product_id, Number(row.committed)]));
}
