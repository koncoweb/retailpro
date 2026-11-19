import { query, runTransaction, type Transaction } from '@/lib/db';
import { logAuditTx } from '@/lib/audit';
import type { PermissionCheck } from '@/lib/permission-matrix';

export interface ShiftExpense {
  id: string;
  amount: number;
  description: string;
  created_at: string;
}

export interface ShiftCashReport {
  startTime: string;
  initialCash: number;
  cashSales: number;
  totalSales: number;
  txCount: number;
  feeTotal: number;
  voidCount: number;
  voidAmount: number;
  expenseTotal: number;
  expenses: ShiftExpense[];
  expectedCash: number;
}

export function expectedShiftCash(initialCash: number, cashSales: number, expenses: number): number {
  return initialCash + cashSales - expenses;
}

export async function readShiftExpenses(shiftId: string, executor: Pick<Transaction, 'query'> = { query }): Promise<ShiftExpense[]> {
  const result = await executor.query<ShiftExpense>(
    `SELECT id, amount, description, created_at FROM expenses
      WHERE shift_id = $1 ORDER BY created_at, id`, [shiftId],
  );
  return result.rows.map((row) => ({ ...row, amount: Number(row.amount) }));
}

/** A single persisted source for the close preview and the atomic close write. */
export async function readShiftCashReport(shiftId: string, executor: Pick<Transaction, 'query'> = { query }): Promise<ShiftCashReport> {
  const shift = await executor.query<{ initial_cash: number; start_time: string }>(
    'SELECT initial_cash, start_time FROM shifts WHERE id = $1', [shiftId],
  );
  if (!shift.rows[0]) throw new Error('Shift tidak ditemukan. Muat ulang halaman.');
  const sales = await executor.query<Record<string, number>>(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'completed' THEN total_amount ELSE 0 END), 0) AS total,
       COALESCE(SUM(CASE WHEN status = 'completed' AND payment_method = 'cash' THEN total_amount ELSE 0 END), 0) AS cash,
       COALESCE(SUM(CASE WHEN status = 'completed' THEN fee_amount ELSE 0 END), 0) AS fee,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS count,
       SUM(CASE WHEN status = 'void' THEN 1 ELSE 0 END) AS void_count,
       COALESCE(SUM(CASE WHEN status = 'void' THEN total_amount ELSE 0 END), 0) AS void_amount
     FROM transactions WHERE shift_id = $1`, [shiftId],
  );
  const expenses = await readShiftExpenses(shiftId, executor);
  const row = sales.rows[0];
  const initialCash = Number(shift.rows[0].initial_cash);
  const cashSales = Number(row.cash);
  const expenseTotal = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  return {
    startTime: shift.rows[0].start_time, initialCash, cashSales,
    totalSales: Number(row.total), feeTotal: Number(row.fee), txCount: Number(row.count),
    voidCount: Number(row.void_count), voidAmount: Number(row.void_amount),
    expenseTotal, expenses, expectedCash: expectedShiftCash(initialCash, cashSales, expenseTotal),
  };
}

async function requireOwnOpenShift(tx: Transaction, shiftId: string, branchId: string, userId: string) {
  const shift = await tx.query<{ id: string }>(
    `SELECT id FROM shifts WHERE id = $1 AND branch_id = $2 AND user_id = $3 AND status = 'open'`,
    [shiftId, branchId, userId],
  );
  if (!shift.rows.length) throw new Error('Shift tidak aktif atau bukan milik Anda. Muat ulang halaman.');
}

export interface RecordShiftExpenseInput {
  id: string;
  shiftId: string;
  branchId: string;
  userId: string;
  amount: number;
  description: string;
}

export async function recordShiftExpense(input: RecordShiftExpenseInput, can: PermissionCheck): Promise<void> {
  if (!can('access_pos') || !can('record_pos_expense')) throw new Error('Anda tidak memiliki izin mencatat pengeluaran POS.');
  if (!input.id || !input.userId || !input.branchId || !input.shiftId) throw new Error('Sesi atau shift belum tersedia.');
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error('Nominal harus berupa rupiah bulat lebih dari 0.');
  const description = input.description.trim();
  if (!description || description.length > 500) throw new Error('Keterangan wajib diisi (maksimal 500 karakter).');
  await runTransaction(async (tx) => {
    // Keep the same request id on retry so a lost commit response cannot post twice.
    const existing = await tx.query<{ shift_id: string; created_by: string; branch_id: string; amount: number; description: string }>(
      'SELECT shift_id, created_by, branch_id, amount, description FROM expenses WHERE id = $1', [input.id],
    );
    if (existing.rows[0]) {
      const row = existing.rows[0];
      if (row.shift_id === input.shiftId && row.created_by === input.userId && row.branch_id === input.branchId
        && Number(row.amount) === input.amount && row.description === description) return;
      throw new Error('Permintaan pengeluaran sudah digunakan. Muat ulang halaman.');
    }
    await requireOwnOpenShift(tx, input.shiftId, input.branchId, input.userId);
    const report = await readShiftCashReport(input.shiftId, tx);
    if (input.amount > report.expectedCash) throw new Error('Saldo kas laci tidak mencukupi untuk pengeluaran ini.');
    await tx.query(
      `INSERT INTO expenses (id, branch_id, shift_id, created_by, category, amount, amount_paid, status, description, date)
       VALUES ($1, $2, $3, $4, 'Pengeluaran non transaksi', $5, $5, 'paid', $6, date('now', '+7 hours'))`,
      [input.id, input.branchId, input.shiftId, input.userId, input.amount, description],
    );
    await logAuditTx(tx, {
      action: 'create_expense', entity: 'expenses', entityId: input.id, userId: input.userId,
      details: { shift_id: input.shiftId, branch_id: input.branchId, amount: input.amount, description, source: 'pos_cash_drawer' },
    });
  });
}

/** Serialize closing against expenses/sales; never persist a stale preview balance. */
export async function closeCashShift(input: { shiftId: string; branchId: string; userId: string; actualCash: number; notes?: string }): Promise<ShiftCashReport> {
  if (!Number.isSafeInteger(input.actualCash) || input.actualCash < 0) throw new Error('Uang fisik harus berupa rupiah bulat, minimal 0.');
  return runTransaction(async (tx) => {
    await requireOwnOpenShift(tx, input.shiftId, input.branchId, input.userId);
    const report = await readShiftCashReport(input.shiftId, tx);
    await tx.query(
      `UPDATE shifts SET end_time = strftime('%Y-%m-%dT%H:%M:%fZ','now'), final_cash = $1,
         expected_cash = $2, difference = $3, notes = $4, status = 'closed'
       WHERE id = $5 AND status = 'open'`,
      [input.actualCash, report.expectedCash, input.actualCash - report.expectedCash, input.notes ?? null, input.shiftId],
    );
    return report;
  });
}
