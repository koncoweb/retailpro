import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createClient, type Client, type Transaction as LibsqlTransaction } from '@libsql/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { translate } from '../translate';
import { closeCashShift, readShiftCashReport, recordShiftExpense } from '../../shift-cash';
import { buildZReportDoc } from '../../print/receipt-printer';
import type { Transaction } from '../index';
import type { PrintContext } from '../../print/print-service';
import { buildGrants, effectivePermissions, grantForRole } from '../../permission-matrix';

const state = vi.hoisted(() => ({ client: null as Client | null, failAudit: false }));

async function execute(connection: Client | LibsqlTransaction, sql: string, params: unknown[] = []) {
  if (state.failAudit && sql.includes('INSERT INTO audit_logs')) throw new Error('audit unavailable');
  const compiled = translate(sql, params);
  const result = await connection.execute({ sql: compiled.sql, args: compiled.args as never });
  return { rows: result.rows, rowCount: result.rowsAffected || result.rows.length };
}

vi.mock('@/lib/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('../index')>(),
  query: (sql: string, params?: unknown[]) => execute(state.client!, sql, params),
  batchQuery: (statements: { sql: string; params?: unknown[] }[]) =>
    Promise.all(statements.map((statement) => execute(state.client!, statement.sql, statement.params))),
  runTransaction: async (fn: (tx: Transaction) => Promise<unknown>) => {
    const tx = await state.client!.transaction('write');
    const run = (sql: string, params?: unknown[]) => execute(tx, sql, params);
    try {
      const result = await fn({ query: run, execute: run } as unknown as Transaction);
      await tx.commit();
      return result;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  },
}));

const root = process.cwd();
const schema = readFileSync(path.join(root, 'db/schema/tenant.sql'), 'utf8');
const migration = readFileSync(path.join(root, 'db/migrations/015_pos_shift_expenses.sql'), 'utf8');
const allow = () => true;
const input = { id: 'outflow-1', shiftId: 'shift-1', branchId: 'branch-1', userId: 'cashier-1', amount: 10000, description: 'Sumbangan lingkungan' };
const ctx = {
  storeName: 'Expense test', receipt: { footer: '', showLogo: false }, printer: { paperWidthMm: 58 },
} as PrintContext;

beforeEach(async () => {
  state.failAudit = false;
  state.client = createClient({ url: 'file::memory:' });
  await state.client.executeMultiple(schema);
  await state.client.executeMultiple(`
    INSERT INTO branches (id, name) VALUES ('branch-1', 'Outlet 1'), ('branch-2', 'Outlet 2');
    INSERT INTO users (id, name, email, role) VALUES ('cashier-1', 'Kasir', 'cashier@test.invalid', 'cashier'), ('cashier-2', 'Kasir 2', 'cashier2@test.invalid', 'cashier');
    INSERT INTO shifts (id, branch_id, user_id, initial_cash, status) VALUES ('shift-1', 'branch-1', 'cashier-1', 50000, 'open'), ('shift-2', 'branch-2', 'cashier-2', 100000, 'open');
    INSERT INTO transactions (id, branch_id, shift_id, invoice_number, total_amount, payment_method, status)
      VALUES ('sale-cash', 'branch-1', 'shift-1', 'CASH1', 100000, 'cash', 'completed'),
        ('sale-card', 'branch-1', 'shift-1', 'CARD1', 200000, 'card', 'completed'),
        ('sale-void', 'branch-1', 'shift-1', 'VOID1', 80000, 'cash', 'void');
    INSERT INTO expenses (id, branch_id, category, amount, amount_paid, description)
      VALUES ('ordinary-expense', 'branch-1', 'Sewa', 2000000, 1000000, 'Backoffice bill');
  `);
});
afterEach(() => state.client?.close());

async function row(sql: string) { return (await state.client!.execute(sql)).rows[0]; }

describe('shift cash ledger', () => {
  it('records a paid finance expense, actor, branch, shift and audit atomically', async () => {
    await recordShiftExpense({ ...input, description: '  Sumbangan lingkungan  ' }, allow);
    expect(await row(`SELECT branch_id, shift_id, created_by, amount, amount_paid, status, description FROM expenses WHERE id = 'outflow-1'`))
      .toEqual({ branch_id: 'branch-1', shift_id: 'shift-1', created_by: 'cashier-1', amount: 10000, amount_paid: 10000, status: 'paid', description: 'Sumbangan lingkungan' });
    expect(await row(`SELECT action, entity, entity_id, user_id FROM audit_logs`))
      .toEqual({ action: 'create_expense', entity: 'expenses', entity_id: 'outflow-1', user_id: 'cashier-1' });
    expect(await readShiftCashReport('shift-1')).toMatchObject({ totalSales: 300000, cashSales: 100000, txCount: 2, voidCount: 1, expenseTotal: 10000, expectedCash: 140000 });
    expect(await readShiftCashReport('shift-2')).toMatchObject({ expenseTotal: 0, expectedCash: 100000 });
  });

  it.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid amount %s', async (amount) => {
    await expect(recordShiftExpense({ ...input, amount }, allow)).rejects.toThrow('Nominal');
    expect((await row(`SELECT COUNT(*) AS n FROM audit_logs`)).n).toBe(0);
  });
  it.each(['', ' \n\t ', 'x'.repeat(501)])('rejects empty/overlong descriptions', async (description) => {
    await expect(recordShiftExpense({ ...input, description }, allow)).rejects.toThrow('Keterangan');
  });
  it('honors permission revocations while granting cashier defaults', async () => {
    const grants = buildGrants(null);
    expect(effectivePermissions(grantForRole(grants, 'cashier')).record_pos_expense).toBe(true);
    await expect(recordShiftExpense(input, (permission) => permission !== 'record_pos_expense')).rejects.toThrow('izin');
    await expect(recordShiftExpense(input, (permission) => permission !== 'access_pos')).rejects.toThrow('izin');
  });
  it('rejects another cashier, branch, or closed shift', async () => {
    await expect(recordShiftExpense({ ...input, userId: 'cashier-2' }, allow)).rejects.toThrow('bukan milik');
    await expect(recordShiftExpense({ ...input, branchId: 'branch-2' }, allow)).rejects.toThrow('bukan milik');
    await closeCashShift({ ...input, actualCash: 150000 });
    await expect(recordShiftExpense(input, allow)).rejects.toThrow('tidak aktif');
  });
  it('allows emptying the drawer, then rejects an overdraft and excludes card/void sales', async () => {
    await expect(recordShiftExpense({ ...input, amount: 150001 }, allow)).rejects.toThrow('tidak mencukupi');
    await recordShiftExpense({ ...input, amount: 150000 }, allow);
    await expect(recordShiftExpense({ ...input, id: 'second', amount: 1 }, allow)).rejects.toThrow('tidak mencukupi');
    expect((await readShiftCashReport('shift-1')).expectedCash).toBe(0);
  });
  it('retries the same posting without duplicating money or its audit entry', async () => {
    await recordShiftExpense(input, allow);
    await recordShiftExpense(input, allow);
    expect((await row(`SELECT COUNT(*) AS n FROM expenses WHERE shift_id = 'shift-1'`)).n).toBe(1);
    expect((await row('SELECT COUNT(*) AS n FROM audit_logs')).n).toBe(1);
    await expect(recordShiftExpense({ ...input, amount: 9999 }, allow)).rejects.toThrow('sudah digunakan');
  });
  it('rolls back the expense if the audit entry fails', async () => {
    state.failAudit = true;
    await expect(recordShiftExpense(input, allow)).rejects.toThrow('audit unavailable');
    expect((await readShiftCashReport('shift-1')).expenseTotal).toBe(0);
  });
  it('recomputes close from persisted expenses and prints the same totals on reprint', async () => {
    await readShiftCashReport('shift-1'); // Deliberately obsolete preview.
    await recordShiftExpense(input, allow);
    await recordShiftExpense({ ...input, id: 'second', amount: 5000, description: 'Parkir' }, allow);
    await closeCashShift({ ...input, actualCash: 135000, notes: 'Kas sesuai' });
    expect(await row(`SELECT status, final_cash, expected_cash, difference, notes FROM shifts WHERE id = 'shift-1'`))
      .toEqual({ status: 'closed', final_cash: 135000, expected_cash: 135000, difference: 0, notes: 'Kas sesuai' });
    const doc = await buildZReportDoc('shift-1', ctx);
    expect(doc!.body.find((line) => line.cols?.[0] === 'TOTAL PENGELUARAN')?.cols?.[1]).toBe('Rp 15.000');
    expect(doc!.body.find((line) => line.cols?.[0] === 'TOTAL PENJUALAN')?.cols?.[1]).toBe('Rp 300.000');
    expect(doc!.body.find((line) => line.cols?.[0] === 'Saldo Seharusnya')?.cols?.[1]).toBe('Rp 135.000');
    expect(doc!.body.some((line) => line.text?.includes('Sumbangan lingkungan'))).toBe(true);
    await expect(closeCashShift({ ...input, actualCash: 135000 })).rejects.toThrow('tidak aktif');
  });
  it('also subtracts expenses in reports without a stored expected_cash', async () => {
    await recordShiftExpense(input, allow);
    const doc = await buildZReportDoc('shift-1', ctx);
    expect(doc!.body.find((line) => line.cols?.[0] === 'Saldo Seharusnya')?.cols?.[1]).toBe('Rp 140.000');
  });
  it.each([-1, 1.5, NaN, Infinity])('rejects invalid closing cash %s', async (actualCash) => {
    await expect(closeCashShift({ ...input, actualCash })).rejects.toThrow('Uang fisik');
  });
  it('database guards prevent malformed outflows and changing historical cash', async () => {
    const insert = (amount: number, branch = 'branch-1') => state.client!.execute({
      sql: `INSERT INTO expenses (branch_id, shift_id, created_by, category, amount, amount_paid, description) VALUES (?, 'shift-1', 'cashier-1', 'POS', ?, ?, 'Test')`,
      args: [branch, amount, amount],
    });
    await expect(insert(1.5)).rejects.toThrow('Invalid shift expense');
    await expect(insert(-1)).rejects.toThrow('Invalid shift expense');
    await expect(insert(150001)).rejects.toThrow('Insufficient cash');
    await expect(insert(1, 'branch-2')).rejects.toThrow('open shift');
    await recordShiftExpense(input, allow);
    await expect(state.client!.execute(`UPDATE expenses SET amount = 1 WHERE id = 'outflow-1'`)).rejects.toThrow('cannot be edited');
    await expect(state.client!.execute(`DELETE FROM expenses WHERE id = 'outflow-1'`)).rejects.toThrow('cannot be deleted');
    await state.client!.execute(`UPDATE expenses SET description = 'Ordinary bill still editable' WHERE id = 'ordinary-expense'`);
  });
});

describe('migration 015', () => {
  it('upgrades v14 preserving finance/AP balances and matches fresh-schema triggers', async () => {
    const old = createClient({ url: 'file::memory:' });
    try {
      await old.executeMultiple(`
        CREATE TABLE schema_version (id INTEGER PRIMARY KEY, version INTEGER); INSERT INTO schema_version VALUES (1,14);
        CREATE TABLE users (id TEXT PRIMARY KEY);
        CREATE TABLE shifts (id TEXT PRIMARY KEY, branch_id TEXT, user_id TEXT, initial_cash INTEGER, status TEXT);
        CREATE TABLE transactions (shift_id TEXT, total_amount INTEGER, status TEXT, payment_method TEXT);
        CREATE TABLE expenses (id TEXT PRIMARY KEY, branch_id TEXT, category TEXT, amount INTEGER, amount_paid INTEGER, status TEXT, description TEXT);
        INSERT INTO expenses VALUES ('legacy', 'branch-1', 'PO', 100000, 30000, 'partial', 'Legacy payable');
      `);
      await old.executeMultiple(migration);
      expect((await old.execute('SELECT * FROM expenses')).rows[0]).toMatchObject({ id: 'legacy', amount: 100000, amount_paid: 30000, shift_id: null, created_by: null });
      expect((await old.execute('SELECT version FROM schema_version')).rows[0].version).toBe(15);
      const triggers = `SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name LIKE '%shift_expense%' ORDER BY name`;
      expect((await old.execute(triggers)).rows).toEqual((await state.client!.execute(triggers)).rows);
    } finally { old.close(); }
  });
});
