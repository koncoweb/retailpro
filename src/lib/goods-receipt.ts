/**
 * Goods receipts — "tanda terima barang" for a purchase order.
 *
 * A purchase order says what was asked for; this is what the truck actually
 * brought. The split exists because the two disagree in practice: half a
 * delivery today, the rest next week, a case at yesterday's price, and a lot
 * that expires before the previous one. Collapsing both into a single row (what
 * the old `handlePO` did) loses all of it.
 *
 * The whole write is one transaction: stock, the receipt document, the received
 * quantities on the order, the vendor bill and the audit entry either all land
 * or none do. A half-posted receipt is worse than no receipt — the shelf and
 * the ledger would disagree with no way to tell which one is wrong.
 *
 * Rules and status arithmetic live in `src/lib/procurement.ts`; this module only
 * writes. Design notes: `docs/spec-purchase-order.md` §6.4 and §7.
 */
import type { Transaction } from "@/lib/db";
import { logAuditTx } from "@/lib/audit";
import { dueDateFromTerms } from "@/lib/vendor";
import {
  derivePurchaseOrderStatus,
  isoToday,
  nextDocumentNumber,
  RECEIVABLE_STATUSES,
  validateReceipt,
  type PurchaseOrderStatus,
  type ReceiptLineInput,
} from "@/lib/procurement";

/** Floating-point slack for REAL quantities, matching `procurement.ts`. */
const EPS = 1e-9;

/**
 * The expected failures of this module: a guard, not a database fault.
 *
 * Callers show `error.message` to the operator verbatim, which is why these are
 * separate from `DbQueryError` — an SQL message is not something to put in a
 * toast.
 */
export class GoodsReceiptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoodsReceiptError";
  }
}

export interface ReceiptLineEdit {
  /** The order line this delivery belongs to. */
  purchaseOrderItemId: string;
  /** Delivered now, in the order line's unit. `0` means "not this time". */
  quantity: number;
  /** Price actually paid; omitted or null keeps the agreed PO price. */
  unitCost?: number | null;
  /** Vendor lot number. Defaults to the GRN number, matching the old flow. */
  batchNumber?: string | null;
  expiryDate?: string | null;
}

export interface ReceivePurchaseOrderParams {
  purchaseOrderId: string;
  lines: ReceiptLineEdit[];
  /** Business date of the delivery, `YYYY-MM-DD`. Defaults to today (UTC). */
  receivedOn?: string;
  /** The vendor's own delivery note / invoice number. */
  supplierDocument?: string | null;
  notes?: string | null;
  /**
   * Set when the tenant picks stock FEFO: the caller reads
   * `getStockIssueMethod() === "fefo"` *before* the transaction opens. Reading
   * tenant settings inside the write would cost a second round-trip and a
   * second cursor on a connection that is mid-transaction.
   */
  requireExpiry: boolean;
  userId?: string | null;
}

export interface ReceivePurchaseOrderResult {
  receiptId: string;
  grnNumber: string;
  /** The order's status after this delivery. */
  status: PurchaseOrderStatus;
  /** Value of this delivery, in rupiah — what the bill is for. */
  totalAmount: number;
  /** How many order lines were touched. */
  linesReceived: number;
}

interface PurchaseOrderRow {
  id: string;
  po_number: string;
  status: string;
  warehouse_id: string | null;
  branch_id: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  payment_terms_days: number | null;
}

interface PurchaseOrderItemRow {
  id: string;
  product_id: string;
  quantity: number;
  quantity_received: number | null;
  unit_name: string | null;
  conversion_factor: number | null;
  unit_cost: number | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function money(value: number): number {
  return Math.round(Number.isFinite(value) ? value : 0);
}

/**
 * Post one delivery against an approved purchase order.
 *
 * Must be called with an open write transaction so the caller can add its own
 * statements (and so a failure rolls the whole receipt back).
 */
export async function receivePurchaseOrder(
  tx: Transaction,
  params: ReceivePurchaseOrderParams
): Promise<ReceivePurchaseOrderResult> {
  const receivedOn = params.receivedOn?.trim() || isoToday();
  if (!DATE_RE.test(receivedOn)) {
    throw new GoodsReceiptError("Tanggal terima tidak valid");
  }

  const headerRes = await tx.query<PurchaseOrderRow>(
    `SELECT id, po_number, status, warehouse_id, branch_id, supplier_id, supplier_name,
            payment_terms_days
       FROM purchase_orders
      WHERE id = $1`,
    [params.purchaseOrderId]
  );
  const header = headerRes.rows[0];
  if (!header) throw new GoodsReceiptError("Purchase order tidak ditemukan");

  const currentStatus = header.status as PurchaseOrderStatus;
  if (!RECEIVABLE_STATUSES.includes(currentStatus)) {
    throw new GoodsReceiptError(
      "Barang hanya bisa diterima untuk purchase order yang sudah disetujui"
    );
  }
  if (!header.warehouse_id) {
    throw new GoodsReceiptError("Purchase order ini belum punya gudang tujuan");
  }

  // Receiving into a location that has since been deactivated would hide stock
  // from every picker that filters on status.
  const warehouseRes = await tx.query<{ status: string | null }>(
    `SELECT status FROM warehouses WHERE id = $1`,
    [header.warehouse_id]
  );
  if (warehouseRes.rows.length > 0 && warehouseRes.rows[0].status !== "active") {
    throw new GoodsReceiptError("Gudang tujuan sudah tidak aktif, aktifkan dulu atau ubah tujuan PO");
  }

  const itemRes = await tx.query<PurchaseOrderItemRow>(
    `SELECT id, product_id, quantity, quantity_received, unit_name, conversion_factor, unit_cost
       FROM purchase_order_items
      WHERE purchase_order_id = $1`,
    [header.id]
  );
  if (itemRes.rows.length === 0) {
    throw new GoodsReceiptError("Purchase order ini tidak punya baris produk");
  }

  const itemById = new Map(itemRes.rows.map((row) => [row.id, row]));

  // ---- merge the editor's lines onto the order's lines ----------------------
  const seen = new Set<string>();
  const planned = params.lines.map((line) => {
    const row = itemById.get(line.purchaseOrderItemId);
    if (!row) throw new GoodsReceiptError("Baris pesanan tidak dikenali, muat ulang halaman");
    if (seen.has(row.id)) throw new GoodsReceiptError("Satu baris pesanan muncul dua kali");
    seen.add(row.id);

    const quantity = Number(line.quantity);
    const override = line.unitCost === null || line.unitCost === undefined ? null : Number(line.unitCost);
    return {
      row,
      quantity: Number.isFinite(quantity) ? quantity : 0,
      unitCost: override !== null && Number.isFinite(override) ? override : Number(row.unit_cost ?? 0),
      batchNumber: line.batchNumber?.trim() || null,
      expiryDate: line.expiryDate?.trim() || null,
    };
  });

  const receiptLines: ReceiptLineInput[] = planned.map((line) => ({
    purchaseOrderItemId: line.row.id,
    quantity: line.quantity,
    ordered: Number(line.row.quantity),
    alreadyReceived: Number(line.row.quantity_received ?? 0),
    unitCost: line.unitCost,
    unitName: line.row.unit_name ?? "",
    expiryDate: line.expiryDate,
  }));

  const invalid = validateReceipt(receiptLines, {
    receivedOn,
    requireExpiry: params.requireExpiry,
  });
  if (invalid) throw new GoodsReceiptError(invalid);

  const delivered = planned.filter((line) => line.quantity > EPS);

  // ---- write ----------------------------------------------------------------
  const grnNumber = await nextDocumentNumber(tx, "GRN");
  const totalAmount = delivered.reduce(
    (sum, line) => sum + money(line.quantity * line.unitCost),
    0
  );

  const receiptRes = await tx.query<{ id: string }>(
    `INSERT INTO goods_receipts
       (grn_number, purchase_order_id, warehouse_id, branch_id, supplier_id, supplier_name,
        supplier_document, total_amount, notes, received_by, received_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
             strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     RETURNING id`,
    [
      grnNumber,
      header.id,
      header.warehouse_id,
      header.branch_id ?? null,
      header.supplier_id ?? null,
      header.supplier_name ?? null,
      params.supplierDocument?.trim() || null,
      totalAmount,
      params.notes?.trim() || null,
      params.userId ?? null,
    ]
  );
  const receiptId = receiptRes.rows[0].id;

  for (const line of delivered) {
    const factor = Number(line.row.conversion_factor) || 1;
    // The order speaks in cases, the shelf speaks in pieces: the batch is
    // always in base units, with the cost divided back down.
    const baseQty = line.quantity * factor;
    const baseCost = money(line.unitCost / factor);
    const batchNumber = line.batchNumber ?? grnNumber;

    const batchRes = await tx.query<{ id: string }>(
      `INSERT INTO product_batches
         (warehouse_id, product_id, batch_number, expiry_date, quantity_initial,
          quantity_current, cost_price, received_at, supplier_id, purchase_order_id,
          goods_receipt_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7,
               strftime('%Y-%m-%dT%H:%M:%fZ','now'), $8, $9, $10)
       RETURNING id`,
      [
        header.warehouse_id,
        line.row.product_id,
        batchNumber,
        line.expiryDate,
        baseQty,
        baseQty,
        baseCost,
        header.supplier_id ?? null,
        header.id,
        receiptId,
      ]
    );

    await tx.query(
      `INSERT INTO goods_receipt_items
         (goods_receipt_id, purchase_order_item_id, product_id, quantity, unit_name,
          conversion_factor, unit_cost, subtotal, batch_id, batch_number, expiry_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        receiptId,
        line.row.id,
        line.row.product_id,
        line.quantity,
        line.row.unit_name ?? null,
        factor,
        line.unitCost,
        money(line.quantity * line.unitCost),
        batchRes.rows[0].id,
        batchNumber,
        line.expiryDate,
      ]
    );

    await tx.query(
      `UPDATE purchase_order_items
          SET quantity_received = quantity_received + $2
        WHERE id = $1`,
      [line.row.id, line.quantity]
    );

    // Only the cost is a receipt's business. `lead_time_days` belongs to the
    // vendor master: overwriting it here silently reset every product's lead
    // time on every delivery.
    if (header.supplier_id) {
      await tx.query(
        `INSERT INTO vendor_products (vendor_id, product_id, last_cost, min_order_qty)
         VALUES ($1, $2, $3, 1)
         ON CONFLICT (vendor_id, product_id) DO UPDATE SET last_cost = excluded.last_cost`,
        [header.supplier_id, line.row.product_id, baseCost]
      );
    }
  }

  // The order's status follows from the lines it now holds, never from the
  // receipt alone: a second delivery can arrive out of order.
  const receivedById = new Map(delivered.map((line) => [line.row.id, line.quantity]));
  const updatedLines = itemRes.rows.map((row) => ({
    quantity: Number(row.quantity),
    quantity_received: Number(row.quantity_received ?? 0) + (receivedById.get(row.id) ?? 0),
  }));
  const status = derivePurchaseOrderStatus(updatedLines, currentStatus);

  await tx.query(
    `UPDATE purchase_orders
        SET status = $2,
            received_at = CASE WHEN $2 = 'received'
                               THEN strftime('%Y-%m-%dT%H:%M:%fZ','now')
                               ELSE received_at END,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = $1`,
    [header.id, status]
  );

  // One bill per delivery, in `expenses` — the table AP, Cashflow and Journal
  // all read. The due date comes from the terms snapshotted on the order, so a
  // later edit to the vendor master cannot move an existing bill.
  const termsDays =
    header.payment_terms_days === null || header.payment_terms_days === undefined
      ? 30
      : Number(header.payment_terms_days);
  const isCash = !Number.isFinite(termsDays) || termsDays <= 0;
  const dueDate = dueDateFromTerms(isCash ? 0 : termsDays, new Date(`${receivedOn}T00:00:00Z`));
  const supplierLabel = header.supplier_name ? ` - ${header.supplier_name}` : "";

  await tx.query(
    `INSERT INTO expenses
       (branch_id, category, amount, date, due_date, description, status, amount_paid,
        supplier_id, purchase_order_id, goods_receipt_id, notes)
     VALUES ($1, 'Pembelian Stok', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      header.branch_id ?? null,
      totalAmount,
      receivedOn,
      dueDate,
      `Pembelian stok ${grnNumber} (PO ${header.po_number})${supplierLabel}`,
      isCash ? "paid" : "unpaid",
      isCash ? totalAmount : 0,
      header.supplier_id ?? null,
      header.id,
      receiptId,
      params.notes?.trim() || null,
    ]
  );

  // Inside the transaction on purpose: a receipt without its audit row is an
  // unexplained stock movement.
  await logAuditTx(tx, {
    action: "receive_po",
    entity: "goods_receipts",
    entityId: receiptId,
    details: {
      grnNumber,
      poNumber: header.po_number,
      status,
      totalAmount,
      linesReceived: delivered.length,
      fromStatus: currentStatus,
    },
    userId: params.userId ?? undefined,
  });

  return {
    receiptId,
    grnNumber,
    status,
    totalAmount,
    linesReceived: delivered.length,
  };
}
