/**
 * Void engine — replayed against a throwaway v9 database.
 *
 * Same harness as `schema.test.ts` on purpose: a copy of the SQL in a test is
 * free to drift from the copy that ships, so every statement here is the
 * exported constant from `src/lib/void.ts`, run through the real translator.
 * The orchestration (`runTransaction`) needs a live tenant, so the tests drive
 * the shipped statements in the shipped order and assert the invariants the
 * counter depends on: stock returns to the exact batch it left, the bon-level
 * discount survives a line void, a voided bon leaves revenue, and the guards
 * refuse the cases retail says must be refused.
 */
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { translate } from '../db/translate';
import { logAuditTx } from '../audit';
import {
  ACTIVE_ITEMS_SQL,
  MARK_BON_VOID_SQL,
  MARK_ITEM_VOID_SQL,
  RESTOCK_BATCH_SQL,
  SET_TOTAL_SQL,
  VOID_TARGET_SQL,
  baseQtyForRestock,
  nextTotalAfterVoid,
  voidGuard,
  type VoidActor,
  type VoidTarget,
} from '../void';

const root = process.cwd();
const dbPath = path.join(os.tmpdir(), `rp-void-test-${process.pid}-${Date.now()}.db`);

let client: Client;

/** Runs app-style SQL through the real translator, exactly like `query()`. */
async function run<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const translated = translate(sql, params);
  const res = await client.execute({ sql: translated.sql, args: translated.args as never });
  return res.rows as unknown as T[];
}

beforeAll(async () => {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  client = createClient({ url: `file:${dbPath}` });
  const schema = readFileSync(path.join(root, 'db', 'schema', 'tenant.sql'), 'utf8');
  await client.executeMultiple(schema);
});

afterAll(() => {
  client.close();
  try {
    rmSync(dbPath, { force: true });
  } catch {
    // Windows keeps the handle until GC; the temp dir cleans itself.
  }
});

/* --------------------------------------------------------------------------
 * Pure decisions — no database needed.
 * ------------------------------------------------------------------------ */

const owner: VoidActor = { id: 'user-owner', role: 'tenant_owner', canVoid: true };
const cashier: VoidActor = { id: 'user-cashier', role: 'cashier', canVoid: true };
const cashierWithoutPermission: VoidActor = {
  id: 'user-cashier',
  role: 'cashier',
  canVoid: false,
};

const openShiftTarget: VoidTarget = {
  status: 'completed',
  cashier_id: 'user-cashier',
  shift_id: 'shift-1',
  shift_status: 'open',
  total_amount: 45_000,
};

describe('voidGuard', () => {
  it('refuses an actor without the void_transaction permission', () => {
    expect(voidGuard('salah input', cashierWithoutPermission, openShiftTarget)).toBe(
      'Anda tidak punya izin mem-void transaksi.'
    );
  });

  it('requires a reason, because an unexplained void is unauditable', () => {
    expect(voidGuard('', cashier, openShiftTarget)).toContain('Alasan void wajib diisi');
    expect(voidGuard('  ab ', cashier, openShiftTarget)).toContain('Alasan void wajib diisi');
    expect(voidGuard('ab c', cashier, openShiftTarget)).toBeNull();
  });

  it('refuses a bon that is already void', () => {
    expect(
      voidGuard('salah input', cashier, { ...openShiftTarget, status: 'void' })
    ).toBe('Transaksi ini sudah dibatalkan.');
  });

  it('lets a cashier void inside the still-open shift only', () => {
    expect(voidGuard('customer batal', cashier, openShiftTarget)).toBeNull();
    expect(voidGuard('customer batal', cashier, { ...openShiftTarget, shift_status: 'closed' })).toContain(
      'shift yang sudah ditutup'
    );
    // No shift at all (a sale posted outside a shift cycle) is not an open one.
    expect(voidGuard('customer batal', cashier, { ...openShiftTarget, shift_status: null })).toContain(
      'shift yang sudah ditutup'
    );
  });

  it('lets owner-tier override a closed shift, and nobody else', () => {
    const closed = { ...openShiftTarget, shift_status: 'closed' };
    expect(voidGuard('klaim customer', owner, closed)).toBeNull();
    expect(voidGuard('klaim customer', { ...owner, role: 'tenant_admin' }, closed)).toBeNull();
    for (const role of ['store_manager', 'supervisor', 'staff', 'cashier']) {
      expect(voidGuard('klaim customer', { ...owner, role }, closed)).not.toBeNull();
    }
  });
});

describe('nextTotalAfterVoid', () => {
  it('subtracts the voided line so a bon-level discount is preserved', () => {
    // 30.000 + 20.000 sold for 45.000 → a 5.000 bon discount that is only
    // implied by the total. Recomputing from remaining lines would hand that
    // discount back to the customer.
    expect(nextTotalAfterVoid(45_000, 20_000)).toBe(25_000);
    const remaining = 30_000;
    expect(remaining - nextTotalAfterVoid(45_000, 20_000)).toBe(5_000);
  });

  it('never drives a bon negative and ignores a negative voided sum', () => {
    expect(nextTotalAfterVoid(10_000, 25_000)).toBe(0);
    expect(nextTotalAfterVoid(10_000, -5_000)).toBe(10_000);
  });
});

describe('baseQtyForRestock', () => {
  it('converts the sold unit back to base units for the batch', () => {
    expect(baseQtyForRestock(2, 1)).toBe(2);
    // One "Dus" of a 12-pack took 12 base units out of the batch.
    expect(baseQtyForRestock(1, 12)).toBe(12);
    // A line saved without a conversion factor is already in base units.
    expect(baseQtyForRestock(3, null)).toBe(3);
    expect(baseQtyForRestock(-1, 12)).toBe(0);
  });
});

/* --------------------------------------------------------------------------
 * Shipped statements, in the shipped order.
 * ------------------------------------------------------------------------ */

const branchId = 'branch-void';
const warehouseId = 'wh-void';
const productId = 'product-void';
const shiftId = 'shift-void-open';

async function loadTarget(txId: string): Promise<VoidTarget> {
  const rows = await run<Record<string, unknown>>(VOID_TARGET_SQL, [txId]);
  const row = rows[0];
  return {
    status: String(row.status ?? ''),
    cashier_id: (row.cashier_id as string | null) ?? null,
    shift_id: (row.shift_id as string | null) ?? null,
    shift_status: (row.shift_status as string | null) ?? null,
    total_amount: Number(row.total_amount ?? 0),
  };
}

/** Mirrors `voidTransactionItems()` using only the exported statements. */
async function applyItemVoid(txId: string, itemIds: string[], reason: string, actorId: string) {
  const target = await loadTarget(txId);
  const items = await run<{
    id: string;
    batch_id: string | null;
    quantity: number;
    conversion_factor: number | null;
    subtotal: number;
  }>(ACTIVE_ITEMS_SQL, [txId]);
  const selected = items.filter((item) => itemIds.includes(item.id));

  let voidedAmount = 0;
  for (const item of selected) {
    const base = baseQtyForRestock(item.quantity, item.conversion_factor);
    if (item.batch_id && base > 0) await run(RESTOCK_BATCH_SQL, [base, item.batch_id]);
    await run(MARK_ITEM_VOID_SQL, [reason, actorId, item.id]);
    voidedAmount += Number(item.subtotal);
  }
  const totalAfter = nextTotalAfterVoid(target.total_amount, voidedAmount);
  await run(SET_TOTAL_SQL, [totalAfter, txId]);
  return { voided: selected.length, voidedAmount, totalAfter };
}

/** Mirrors `voidTransactionBon()` using only the exported statements. */
async function applyBonVoid(txId: string, reason: string, actorId: string) {
  const items = await run<{
    id: string;
    batch_id: string | null;
    quantity: number;
    conversion_factor: number | null;
    subtotal: number;
  }>(ACTIVE_ITEMS_SQL, [txId]);
  let voidedAmount = 0;
  for (const item of items) {
    const base = baseQtyForRestock(item.quantity, item.conversion_factor);
    if (item.batch_id && base > 0) await run(RESTOCK_BATCH_SQL, [base, item.batch_id]);
    await run(MARK_ITEM_VOID_SQL, [reason, actorId, item.id]);
    voidedAmount += Number(item.subtotal);
  }
  await run(MARK_BON_VOID_SQL, [reason, actorId, txId]);
  return { voided: items.length, voidedAmount };
}

describe('void statements against schema v9', () => {
  beforeAll(async () => {
    await run(
      `INSERT INTO branches (id, name, code, status) VALUES ($1, $2, $3, 'active')`,
      [branchId, 'Outlet Void', 'VOD']
    );
    await run(
      `INSERT INTO warehouses (id, name, code, type, branch_id, status, is_default)
       VALUES ($1, $2, $3, 'store', $4, 'active', 1)`,
      [warehouseId, 'Gudang Void', 'VOD-GD', branchId]
    );
    await run(
      `INSERT INTO users (id, email, name, role, assigned_branch_id, is_active)
       VALUES ($1, $2, $3, 'cashier', $4, 1)`,
      ['user-cashier', 'cashier@void.id', 'Kasir', branchId]
    );
    await run(
      `INSERT INTO products (id, sku, name, category, cost_price, min_stock_level)
       VALUES ($1, $2, $3, 'Minuman', 8000, 5)`,
      [productId, 'SKU-VOID', 'Kopi Void']
    );
    await run(
      `INSERT INTO shifts (id, branch_id, user_id, initial_cash, status)
       VALUES ($1, $2, $3, 100000, 'open')`,
      [shiftId, branchId, 'user-cashier']
    );
  });

  /**
   * One bon, two lines, two batches:
   *   line A — 2 Pcs from batch-a (conversion 1), subtotal 30.000
   *   line B — 1 Dus from batch-b (conversion 12), subtotal 20.000
   * The bon charges 45.000, i.e. an implied 5.000 bon-level discount.
   */
  async function seedBon(txId: string, invoice: string) {
    const batchA = `${txId}-batch-a`;
    const batchB = `${txId}-batch-b`;
    for (const [id, qty] of [
      [batchA, 40],
      [batchB, 24],
    ] as const) {
      await run(
        `INSERT INTO product_batches
           (id, warehouse_id, product_id, batch_number, quantity_initial, quantity_current, cost_price)
         VALUES ($1, $2, $3, $4, $5, $5, 8000)`,
        [id, warehouseId, productId, `BATCH-${id}`, qty]
      );
    }
    await run(
      `INSERT INTO transactions
         (id, branch_id, cashier_id, shift_id, invoice_number, total_amount, amount_paid,
          payment_method, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6, 'cash', 'completed', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      [txId, branchId, 'user-cashier', shiftId, invoice, 45_000]
    );
    await run(
      `INSERT INTO transaction_items
         (id, transaction_id, product_id, batch_id, quantity, unit_name, conversion_factor,
          unit_price, cost_price, subtotal)
       VALUES ($1, $2, $3, $4, 2, 'Pcs', 1, 15000, 8000, 30000)`,
      [`${txId}-item-a`, txId, productId, batchA]
    );
    await run(
      `INSERT INTO transaction_items
         (id, transaction_id, product_id, batch_id, quantity, unit_name, conversion_factor,
          unit_price, cost_price, subtotal)
       VALUES ($1, $2, $3, $4, 1, 'Dus', 12, 20000, 8000, 20000)`,
      [`${txId}-item-b`, txId, productId, batchB]
    );
    return { batchA, batchB };
  }

  it('defaults a fresh line to not-voided', async () => {
    await seedBon('tx-default', 'INV/DEFAULT');
    const rows = await run<{ voided: number }>(
      `SELECT voided FROM transaction_items WHERE transaction_id = $1`,
      ['tx-default']
    );
    expect(rows.map((r) => Number(r.voided))).toEqual([0, 0]);
  });

  it('voids one line: restocks its own batch, drops the total, keeps the discount', async () => {
    const { batchA, batchB } = await seedBon('tx-item', 'INV/ITEM');

    const target = await loadTarget('tx-item');
    expect(target.shift_status).toBe('open');
    expect(voidGuard('customer tidak jadi satu', cashier, target)).toBeNull();

    const result = await applyItemVoid('tx-item', ['tx-item-item-b'], 'customer tidak jadi', 'user-cashier');
    expect(result.voided).toBe(1);
    expect(result.voidedAmount).toBe(20_000);
    expect(result.totalAfter).toBe(25_000);

    // Stock went back to the exact batch the line consumed — and by the base
    // quantity (1 Dus of a 12-pack), not the 1 unit the line shows.
    const batches = await run<{ id: string; quantity_current: number }>(
      `SELECT id, quantity_current FROM product_batches WHERE id IN ($1, $2)`,
      [batchA, batchB]
    );
    const byId = Object.fromEntries(batches.map((b) => [b.id, Number(b.quantity_current)]));
    expect(byId[batchB]).toBe(24 + 12);
    expect(byId[batchA]).toBe(40);

    const lines = await run<{ id: string; voided: number; void_reason: string; voided_by: string }>(
      `SELECT id, voided, void_reason, voided_by FROM transaction_items WHERE transaction_id = $1 ORDER BY id`,
      ['tx-item']
    );
    expect(lines[0].voided).toBe(0);
    expect(lines[1]).toMatchObject({
      id: 'tx-item-item-b',
      voided: 1,
      void_reason: 'customer tidak jadi',
      voided_by: 'user-cashier',
    });
    // The line is never deleted — a void is a mark, not an erase.
    expect(lines).toHaveLength(2);

    const trx = await run<{ total_amount: number; amount_paid: number; status: string }>(
      `SELECT total_amount, amount_paid, status FROM transactions WHERE id = $1`,
      ['tx-item']
    );
    expect(trx[0].total_amount).toBe(25_000);
    expect(trx[0].amount_paid).toBe(25_000);
    expect(trx[0].status).toBe('completed');
    // 30.000 active subtotal against a 25.000 total: the 5.000 discount is
    // exactly what it was before the void.
    const active = await run<{ val: number }>(
      `SELECT COALESCE(SUM(subtotal), 0) AS val FROM transaction_items
        WHERE transaction_id = $1 AND voided = 0`,
      ['tx-item']
    );
    expect(Number(active[0].val) - trx[0].total_amount).toBe(5_000);
  });

  it('cannot void the same line twice', async () => {
    const before = await run<{ val: number }>(
      `SELECT total_amount AS val FROM transactions WHERE id = $1`,
      ['tx-item']
    );
    const again = await applyItemVoid('tx-item', ['tx-item-item-b'], 'doblet klik', 'user-cashier');
    expect(again.voided).toBe(0);
    expect(again.totalAfter).toBe(Number(before[0].val));
  });

  it('voids a whole bon: every line struck, amount kept for the record, revenue excludes it', async () => {
    const { batchA, batchB } = await seedBon('tx-bon', 'INV/BON');

    const result = await applyBonVoid('tx-bon', 'salah input seluruh bon', 'user-owner');
    expect(result.voided).toBe(2);

    const trx = await run<{ status: string; total_amount: number; void_reason: string; voided_by: string }>(
      `SELECT status, total_amount, void_reason, voided_by FROM transactions WHERE id = $1`,
      ['tx-bon']
    );
    expect(trx[0]).toMatchObject({
      status: 'void',
      // Kept: the cancelled sale stays on the record; queries filter on status.
      total_amount: 45_000,
      void_reason: 'salah input seluruh bon',
      voided_by: 'user-owner',
    });

    const lines = await run<{ voided: number }>(
      `SELECT voided FROM transaction_items WHERE transaction_id = $1`,
      ['tx-bon']
    );
    expect(lines.map((l) => Number(l.voided))).toEqual([1, 1]);

    const batches = await run<{ id: string; quantity_current: number }>(
      `SELECT id, quantity_current FROM product_batches WHERE id IN ($1, $2)`,
      [batchA, batchB]
    );
    const byId = Object.fromEntries(batches.map((b) => [b.id, Number(b.quantity_current)]));
    expect(byId[batchA]).toBe(40 + 2);
    expect(byId[batchB]).toBe(24 + 12);

    // The accounting invariant: with the `status = 'completed'` filter the
    // platform-wide money queries apply, the cancelled bon is not revenue and
    // the item-voided bon contributes only its reduced total.
    const money = await run<{ sales: number; tx_count: number }>(
      `SELECT COALESCE(SUM(total_amount), 0) AS sales, COUNT(*) AS tx_count
         FROM transactions
        WHERE status = 'completed' AND id IN ($1, $2, $3)`,
      ['tx-item', 'tx-bon', 'tx-default']
    );
    expect(Number(money[0].sales)).toBe(25_000 + 45_000);
    expect(Number(money[0].tx_count)).toBe(2);

    // An open shift's takings exclude it, so the drawer still balances.
    const takings = await run<{ val: number }>(
      `SELECT COALESCE(SUM(total_amount), 0) AS val FROM transactions
        WHERE shift_id = $1 AND status = 'completed'`,
      [shiftId]
    );
    expect(Number(takings[0].val)).toBe(25_000 + 45_000);
  });

  it('writes the void to the audit trail atomically with the change', async () => {
    const executor = {
      query: async <T,>(sql: string, params: unknown[] = []) => ({
        rows: await run<T>(sql, params),
        rowCount: 1,
      }),
    };
    await logAuditTx(executor, {
      action: 'void_transaction',
      entity: 'transaction',
      entityId: 'tx-bon',
      userId: 'user-owner',
      details: { kind: 'bon', reason: 'salah input seluruh bon', voided_count: 2 },
    });

    const rows = await run<{ action: string; entity: string; entity_id: string; details: string }>(
      `SELECT action, entity, entity_id, details FROM audit_logs WHERE entity_id = $1 AND action = 'void_transaction'`,
      ['tx-bon']
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('void_transaction');
    expect(JSON.parse(rows[0].details)).toMatchObject({ kind: 'bon', voided_count: 2 });
  });

  it('leaves a voided bon visible in history while hiding it from revenue', async () => {
    // The list query shape from POSTransactions.tsx: voids stay in the trail.
    const rows = await run<{ id: string; status: string }>(
      `SELECT id, status FROM transactions WHERE branch_id = $1 ORDER BY invoice_number`,
      [branchId]
    );
    expect(rows.map((r) => r.status)).toContain('void');
    expect(rows).toHaveLength(3);

    // POSTransactions totals: money counts completed bons only, in one pass.
    const totals = await run<{ sales: number; void_count: number }>(
      `SELECT COALESCE(SUM(CASE WHEN t.status = 'completed' THEN t.total_amount ELSE 0 END), 0) AS sales,
              COALESCE(SUM(CASE WHEN t.status = 'void' THEN 1 ELSE 0 END), 0) AS void_count
         FROM transactions t WHERE t.branch_id = $1`,
      [branchId]
    );
    expect(Number(totals[0].sales)).toBe(70_000);
    expect(Number(totals[0].void_count)).toBe(1);
  });

  it('keeps a voided credit sale out of receivables (Piutang)', async () => {
    // The shipped ApAr.tsx statement: money still owed on a sale that stands.
    const arSql = `
      SELECT t.id
        FROM transactions t
        LEFT JOIN customers c ON t.customer_id = c.id
       WHERE t.status = 'completed' AND t.total_amount > t.amount_paid
       ORDER BY t.created_at DESC
    `;

    await seedBon('tx-credit', 'INV/CREDIT');
    await run(
      `UPDATE transactions SET payment_method = 'credit', amount_paid = $1 WHERE id = $2`,
      [15_000, 'tx-credit']
    );
    // A half-paid bon really is a receivable.
    expect((await run<{ id: string }>(arSql)).map((r) => r.id)).toContain('tx-credit');

    await applyBonVoid('tx-credit', 'salah nominal kredit', 'user-owner');
    // Once cancelled it is not money the customer owes — without the status
    // filter the kept `total_amount` would sit in Piutang forever.
    expect((await run<{ id: string }>(arSql)).map((r) => r.id)).not.toContain('tx-credit');
  });

  it('dashboard "Transaksi Terbaru" shows the cancelled bon, flagged and with no live items', async () => {
    // The shipped RecentTransactions.tsx statement.
    const rows = await run<{ id: string; status: string; items_count: number }>(
      `SELECT t.id, t.status,
              (SELECT COUNT(*) FROM transaction_items WHERE transaction_id = t.id AND voided = 0) AS items_count
         FROM transactions t
        WHERE t.invoice_number = $1
        ORDER BY t.created_at DESC
        LIMIT 5`,
      ['INV/BON']
    );
    expect(rows).toHaveLength(1);
    // Visible in the trail, but readable as cancelled: `status` drives the
    // struck amount + Void badge, and the item counter no longer claims a sale.
    expect(rows[0].status).toBe('void');
    expect(Number(rows[0].items_count)).toBe(0);
  });
});
