/**
 * DB-backed print helpers.
 *
 * The two things a till actually prints — a customer struk and a shift
 * Z-report — resolved from the database in one place, so the checkout auto-print,
 * the reprint button in Riwayat, and the shift desk all read identical columns.
 * Duplicating this SQL per page is how a reprint and a live receipt drift apart.
 *
 * Each helper returns the same `PrintResult` as `printDocument`; the caller only
 * turns it into a toast. They never throw for a missing printer.
 */
import { batchQuery } from '@/lib/db';
import { buildSaleReceipt, type SaleReceiptInput, type SaleReceiptItem } from '@/lib/print/receipt-doc';
import { buildShiftZReport, type ZReportInput } from '@/lib/print/zreport-doc';
import { columnsForPaper, type PrintDoc } from '@/lib/print/document';
import { expectedShiftCash, type ShiftExpense } from '@/lib/shift-cash';
import { printDocument, type PrintContext, type PrintResult } from '@/lib/print/print-service';

/** Build the struk document for one committed transaction. */
export async function buildSaleReceiptDoc(
  transactionId: string,
  ctx: PrintContext
): Promise<PrintDoc | null> {
  // One batch: the transaction (+ joined display names) and its items, keyed by
  // variant so a flavour line prints its own label.
  const [trxRes, itemRes] = await batchQuery([
    {
      sql: `
        SELECT
          t.id, t.invoice_number, t.total_amount, t.amount_paid,
          t.payment_method, t.status, t.void_reason, t.created_at,
          u.name  AS cashier_name,
          b.name  AS branch_name,
          c.name  AS customer_name
        FROM transactions t
        LEFT JOIN users     u ON t.cashier_id  = u.id
        LEFT JOIN branches  b ON t.branch_id   = b.id
        LEFT JOIN customers c ON t.customer_id = c.id
        WHERE t.id = $1
        LIMIT 1
      `,
      params: [transactionId],
    },
    {
      sql: `
        SELECT
          COALESCE(p.name, 'Item') AS name,
          v.name AS variant_name,
          ti.quantity, ti.unit_name, ti.unit_price, ti.subtotal, ti.voided, ti.void_reason
        FROM transaction_items ti
        LEFT JOIN products         p ON ti.product_id = p.id
        LEFT JOIN product_variants v ON ti.variant_id = v.id
        WHERE ti.transaction_id = $1
        ORDER BY ti.rowid ASC
      `,
      params: [transactionId],
    },
  ]);

  const head = trxRes.rows[0] as
    | {
        invoice_number: string;
        total_amount: number;
        amount_paid: number;
        payment_method: string;
        status: string;
        void_reason: string | null;
        created_at: string;
        cashier_name: string | null;
        branch_name: string | null;
        customer_name: string | null;
      }
    | undefined;
  if (!head) return null;

  const items: SaleReceiptItem[] = (itemRes.rows as Record<string, unknown>[]).map((row) => ({
    name: String(row.name ?? 'Item'),
    variantLabel: (row.variant_name as string | null) ?? null,
    quantity: Number(row.quantity ?? 0),
    unitName: (row.unit_name as string | null) ?? null,
    unitPrice: Number(row.unit_price ?? 0),
    subtotal: Number(row.subtotal ?? 0),
    voided: Number(row.voided ?? 0) === 1,
    voidReason: (row.void_reason as string | null) ?? null,
  }));

  const input: SaleReceiptInput = {
    invoiceNumber: head.invoice_number,
    createdAt: head.created_at,
    total: Number(head.total_amount),
    amountPaid: Number(head.amount_paid ?? head.total_amount),
    paymentMethod: head.payment_method ?? 'cash',
    cashierName: head.cashier_name,
    branchName: head.branch_name,
    customerName: head.customer_name,
    items,
    status: head.status === 'void' ? 'void' : 'completed',
    voidReason: head.void_reason,
  };

  return buildSaleReceipt(input, {
    storeName: ctx.storeName,
    footer: ctx.receipt.footer,
    paperWidthMm: ctx.printer.paperWidthMm,
    showLogo: ctx.receipt.showLogo,
  });
}

/** Print the struk for a transaction by id. */
export async function printSaleReceipt(
  transactionId: string,
  ctx: PrintContext
): Promise<PrintResult> {
  const doc = await buildSaleReceiptDoc(transactionId, ctx);
  if (!doc) return { ok: false, via: 'driver', error: 'Transaksi tidak ditemukan' };
  return printDocument(doc, ctx, {
    // A voided bon is money going *back*; never auto-kick the drawer for it.
    isCashSale: docColumnsIsCash(doc) && !docIsVoided(doc),
  });
}

/** Cheap read of the built doc's payment line to decide the drawer kick. */
function docColumnsIsCash(doc: PrintDoc): boolean {
  return doc.body.some((line) => line.cols?.[0]?.startsWith('Bayar Tunai'));
}

/** True for a whole-bon void (the banner is its first line). */
function docIsVoided(doc: PrintDoc): boolean {
  return doc.body.some((line) => line.text === 'TRANSAKSI DIBATALKAN');
}

/** Build + print the Z-report for a closed shift. */
export async function printZReport(shiftId: string, ctx: PrintContext): Promise<PrintResult> {
  const doc = await buildZReportDoc(shiftId, ctx);
  if (!doc) return { ok: false, via: 'driver', error: 'Shift tidak ditemukan' };
  return printDocument(doc, ctx);
}

export async function buildZReportDoc(
  shiftId: string,
  ctx: PrintContext
): Promise<PrintDoc | null> {
  const [shiftRes, methodRes, voidRes, expenseRes] = await batchQuery([
    {
      sql: `
        SELECT
          s.id, s.start_time, s.end_time, s.initial_cash, s.final_cash,
          s.expected_cash, s.difference, s.notes,
          u.name AS cashier_name,
          b.name AS branch_name
        FROM shifts s
        LEFT JOIN users    u ON s.user_id   = u.id
        LEFT JOIN branches b ON s.branch_id = b.id
        WHERE s.id = $1
        LIMIT 1
      `,
      params: [shiftId],
    },
    {
      sql: `
        SELECT
          COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total_amount ELSE 0 END), 0) AS cash,
          COALESCE(SUM(CASE WHEN payment_method = 'transfer' THEN total_amount ELSE 0 END), 0) AS transfer,
          COALESCE(SUM(CASE WHEN payment_method IN ('card','debit','credit')
                            THEN total_amount ELSE 0 END), 0) AS card,
          COALESCE(SUM(CASE WHEN payment_method IN ('ewallet','e-wallet','ovo','gopay','dana','shopeepay')
                            THEN total_amount ELSE 0 END), 0) AS ewallet,
          COALESCE(SUM(CASE WHEN payment_method = 'qris' THEN total_amount ELSE 0 END), 0) AS qris,
          COALESCE(SUM(total_amount), 0) AS total,
          COALESCE(SUM(fee_amount), 0) AS fee_total,
          COUNT(*) AS txn_count
        FROM transactions
        WHERE shift_id = $1 AND status = 'completed'
      `,
      params: [shiftId],
    },
    {
      // Voids stay out of the sales figures above but belong on the report so
      // the drawer reconciles: how many bons were cancelled, and for how much.
      sql: `
        SELECT COUNT(*) AS void_count,
               COALESCE(SUM(total_amount), 0) AS void_amount
          FROM transactions
         WHERE shift_id = $1 AND status = 'void'
      `,
      params: [shiftId],
    },
    {
      sql: `SELECT id, amount, description, created_at FROM expenses WHERE shift_id = $1 ORDER BY created_at, id`,
      params: [shiftId],
    },
  ]);

  const shift = shiftRes.rows[0] as
    | {
        id: string;
        start_time: string;
        end_time: string | null;
        initial_cash: number | string;
        final_cash: number | string | null;
        expected_cash: number | string | null;
        difference: number | string | null;
        notes: string | null;
        cashier_name: string | null;
        branch_name: string | null;
      }
    | undefined;
  if (!shift) return null;

  const methods = (methodRes.rows[0] ?? {}) as Record<string, number | string>;
  const voidRow = (voidRes.rows[0] ?? {}) as Record<string, number | string>;
  const voidCount = Number(voidRow.void_count ?? 0);
  const voidAmount = Number(voidRow.void_amount ?? 0);
  const byMethod = {
    cash: Number(methods.cash ?? 0),
    transfer: Number(methods.transfer ?? 0),
    card: Number(methods.card ?? 0),
    ewallet: Number(methods.ewallet ?? 0),
    qris: Number(methods.qris ?? 0),
    // Anything outside the named buckets, so the printed breakdown always
    // sums to TOTAL PENJUALAN even if a new payment method is introduced.
    other: Math.max(
      0,
      Number(methods.total ?? 0) -
        (Number(methods.cash ?? 0) +
          Number(methods.transfer ?? 0) +
          Number(methods.card ?? 0) +
          Number(methods.ewallet ?? 0) +
          Number(methods.qris ?? 0)),
    ),
  };
  const totalSales = Number(methods.total ?? 0);
  const initialCash = Number(shift.initial_cash ?? 0);
  const expenses = expenseRes.rows.map((row) => ({ ...row, amount: Number(row.amount) })) as unknown as ShiftExpense[];
  const expenseTotal = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const expectedCash = Number(shift.expected_cash ?? expectedShiftCash(initialCash, byMethod.cash, expenseTotal));
  const finalCash = Number(shift.final_cash ?? 0);
  const difference = Number(shift.difference ?? finalCash - expectedCash);

  const input: ZReportInput = {
    shiftId: shift.id,
    startTime: shift.start_time,
    endTime: shift.end_time ?? new Date().toISOString(),
    cashierName: shift.cashier_name,
    branchName: shift.branch_name,
    transactionCount: Number(methods.txn_count ?? 0),
    byMethod,
    totalSales,
    feeTotal: Number(methods.fee_total ?? 0),
    voidCount,
    voidAmount,
    expenses,
    expenseTotal,
    initialCash,
    expectedCash,
    finalCash,
    difference,
    notes: shift.notes,
  };

  return buildShiftZReport(input, {
    storeName: ctx.storeName,
    footer: ctx.receipt.footer,
    paperWidthMm: ctx.printer.paperWidthMm,
    showLogo: ctx.receipt.showLogo,
  });
}

/** Re-export so pages can size a preview without importing several modules. */
export { columnsForPaper };
