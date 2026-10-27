/**
 * Demo tenant integrity checks.
 *
 * `npm run demo:tenant` promises a coherent shop: stock that adds up, invoices
 * whose lines match their total, a cash drawer that reconciles, and a finance
 * view where payables actually exist. These tests seed the real dataset into a
 * throwaway database and assert exactly those promises, so the demo cannot
 * drift into "looks full but the numbers are nonsense".
 */
import os from 'node:os';
import path from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { THALIA } from '../../server/demo/catalog';
import { DemoSeedError, describeTenant, seedDemoTenant } from '../../server/demo/seed';

const dbPath = path.join(os.tmpdir(), `rp-demo-test-${process.pid}-${Date.now()}.db`);
const NOW = new Date();

let client: Client;

async function rows<T = Record<string, unknown>>(
  sql: string,
  params: (string | number)[] = []
): Promise<T[]> {
  const result = await client.execute({ sql, args: params });
  return result.rows as unknown as T[];
}

async function scalar(sql: string, params: (string | number)[] = []): Promise<number> {
  const result = await rows<{ value: number }>(sql, params);
  return Number(result[0]?.value ?? 0);
}

beforeAll(async () => {
  client = createClient({ url: `file:${dbPath}` });
  await seedDemoTenant(client, { now: NOW });
});

afterAll(() => {
  client.close();
});

describe('demo tenant: Thalia Toko Bahan Kue', () => {
  it('creates exactly one tenant and keeps the seeded role permissions', async () => {
    const tenant = await rows<{ name: string; slug: string; settings: string }>(
      `SELECT name, slug, settings FROM tenants`
    );
    expect(tenant).toHaveLength(1);
    expect(tenant[0].name).toBe('Thalia Toko Bahan Kue');
    expect(tenant[0].slug).toBe('thalia');

    const settings = JSON.parse(tenant[0].settings) as {
      role_permissions: Record<string, Record<string, boolean>>;
      receipt: { footer: string };
      bank: { name: string };
    };
    // json_patch personalised the receipt without dropping the permissions the
    // UI relies on.
    expect(settings.receipt.footer).toContain('memanggang');
    expect(settings.bank.name).toBe('BCA');
    expect(settings.role_permissions.cashier.access_pos).toBe(true);
    expect(settings.role_permissions.tenant_owner.manage_roles).toBe(true);
  });

  it('fills both branches with staff, shelves and suppliers', async () => {
    expect(await scalar(`SELECT count(*) AS value FROM branches`)).toBe(2);
    expect(await scalar(`SELECT count(*) AS value FROM users`)).toBe(THALIA.staff.length + 1);
    expect(await scalar(`SELECT count(*) AS value FROM suppliers`)).toBe(THALIA.suppliers.length);
    expect(await scalar(`SELECT count(*) AS value FROM customers`)).toBe(THALIA.customers.length);
    expect(await scalar(`SELECT count(*) AS value FROM products`)).toBe(THALIA.products.length);

    const categories = await rows<{ name: string }>(`SELECT name FROM categories ORDER BY name`);
    expect(categories.map((row) => row.name).sort()).toEqual([...THALIA.categories].sort());

    const owner = await rows<{ role: string; email: string }>(
      `SELECT role, email FROM users WHERE role = 'tenant_owner'`
    );
    expect(owner).toHaveLength(1);
    expect(owner[0].email).toBe(THALIA.owner.email);
  });

  it('gives every supplier vendor master data and a product catalogue', async () => {
    const vendors = await rows<{ code: string; status: string; terms: number }>(
      `SELECT code, status, payment_terms_days AS terms FROM suppliers ORDER BY code`
    );
    expect(vendors.map((row) => row.code)).toEqual(
      THALIA.suppliers.map((_, index) => `VND-${String(index + 1).padStart(4, '0')}`)
    );
    expect(vendors.every((row) => row.status === 'active')).toBe(true);
    expect(vendors.every((row) => Number(row.terms) > 0)).toBe(true);

    // Each product's main vendor is also its catalogue entry.
    expect(await scalar(`SELECT count(*) AS value FROM vendor_products`)).toBe(
      THALIA.products.length
    );
    expect(
      await rows(
        `SELECT p.id FROM products p
           JOIN vendor_products vp ON vp.product_id = p.id
          WHERE vp.vendor_id <> p.supplier_id`
      )
    ).toHaveLength(0);
  });

  it('records the part payment of PO-0013 in the vendor payment ledger', async () => {
    const payments = await rows<{ amount: number; method: string; amount_paid: number; total: number }>(
      `SELECT vp.amount, vp.method, e.amount_paid, e.amount AS total
         FROM vendor_payments vp
         JOIN expenses e ON e.id = vp.expense_id`
    );
    expect(payments).toHaveLength(1);
    expect(payments[0].method).toBe('transfer');
    // The ledger entry mirrors the payable balance, not a second liability.
    expect(Number(payments[0].amount)).toBe(Number(payments[0].amount_paid));
    expect(Number(payments[0].amount)).toBe(Math.round(Number(payments[0].total) * 0.5));
  });

  it('keeps stock consistent with the catalog and never over-issues a batch', async () => {
    const stock = await rows<{ sku: string; available: number }>(
      `SELECT p.sku, COALESCE(SUM(b.quantity_current), 0) AS available
         FROM products p
         LEFT JOIN product_batches b ON b.product_id = p.id
        GROUP BY p.id`
    );
    expect(stock).toHaveLength(THALIA.products.length);
    for (const row of stock) {
      const expected = THALIA.products.find((product) => product.sku === row.sku);
      expect(expected, `unknown sku ${row.sku}`).toBeTruthy();
      expect(Number(row.available)).toBeCloseTo(expected!.stock[0] + expected!.stock[1], 6);
    }

    const badBatches = await rows<{ id: string }>(
      `SELECT id FROM product_batches
        WHERE quantity_current < 0 OR quantity_current > quantity_initial`
    );
    expect(badBatches).toHaveLength(0);
  });

  it('books every sale so that lines and invoice totals agree', async () => {
    const sample = await rows<{ id: string; total_amount: number }>(
      `SELECT t.id, t.total_amount
         FROM transactions t
         JOIN transaction_items ti ON ti.transaction_id = t.id
        GROUP BY t.id
       HAVING count(ti.id) > 1
        LIMIT 25`
    );
    expect(sample.length).toBeGreaterThan(0);

    for (const sale of sample) {
      const lines = await rows<{ subtotal: number; unit_price: number; quantity: number; cost_price: number }>(
        `SELECT subtotal, unit_price, quantity, cost_price
           FROM transaction_items WHERE transaction_id = ?`,
        [sale.id]
      );
      const sum = lines.reduce((total, line) => total + Number(line.subtotal), 0);
      expect(sum).toBe(Number(sale.total_amount));
      for (const line of lines) {
        expect(Number(line.subtotal)).toBe(
          Math.round(Number(line.unit_price) * Number(line.quantity))
        );
        expect(Number(line.cost_price)).toBeGreaterThan(0);
      }
    }
  });

  it('never asks for more cash than the customer handed over', async () => {
    const shortfalls = await rows<{ id: string; total_amount: number; amount_paid: number }>(
      `SELECT id, total_amount, amount_paid FROM transactions
        WHERE payment_method <> 'credit' AND amount_paid < total_amount`
    );
    expect(shortfalls).toHaveLength(0);

    const credit = await rows<{ due_date: string | null }>(
      `SELECT due_date FROM transactions WHERE payment_method = 'credit'`
    );
    expect(credit).toHaveLength(5);
    expect(credit.every((row) => Boolean(row.due_date))).toBe(true);
  });

  it('reconciles every closed shift and leaves today open for trading', async () => {
    const shifts = await rows<{
      id: string;
      status: string;
      initial_cash: number;
      expected_cash: number | null;
      end_time: string | null;
    }>(`SELECT id, status, initial_cash, expected_cash, end_time FROM shifts`);

    const open = shifts.filter((shift) => shift.status === 'open');
    expect(open).toHaveLength(2);
    expect(open.every((shift) => shift.end_time === null && shift.expected_cash === null)).toBe(true);

    for (const shift of shifts.filter((entry) => entry.status === 'closed')) {
      const cash = await scalar(
        `SELECT COALESCE(SUM(total_amount), 0) AS value
           FROM transactions WHERE shift_id = ? AND payment_method = 'cash'`,
        [shift.id]
      );
      expect(Number(shift.expected_cash)).toBe(Number(shift.initial_cash) + cash);
    }
  });

  it('records transfers, receivables and supplier payables', async () => {
    const transfers = await rows<{ status: string; items: number }>(
      `SELECT s.status, count(i.id) AS items
         FROM stock_transfers s
         LEFT JOIN transfer_items i ON i.transfer_id = s.id
        GROUP BY s.id`
    );
    expect(transfers.filter((row) => row.status === 'completed')).toHaveLength(2);
    expect(transfers.filter((row) => row.status === 'pending')).toHaveLength(1);
    expect(transfers.every((row) => Number(row.items) > 0)).toBe(true);

    // Receivables are unpaid invoices; payables are unpaid purchase expenses.
    expect(await scalar(
      `SELECT count(*) AS value FROM transactions WHERE total_amount > amount_paid`
    )).toBe(5);
    expect(await scalar(
      `SELECT count(*) AS value FROM expenses WHERE amount > amount_paid`
    )).toBeGreaterThanOrEqual(2);
  });

  it('flags the four products that are genuinely below their minimum', async () => {
    const snapshot = await describeTenant(client, NOW);
    expect(snapshot.lowStock.map((row) => row.sku).sort()).toEqual([
      'CHC-003',
      'KMS-003',
      'LMK-003',
      'PGR-003',
    ]);
    expect(snapshot.stockValue).toBeGreaterThan(0);
    expect(snapshot.revenue30d).toBeGreaterThan(0);
    expect(snapshot.revenueAllTime).toBeGreaterThanOrEqual(snapshot.revenue30d);
    expect(snapshot.grossMargin30d).toBeGreaterThan(0);
  });

  it('refuses to merge into an existing tenant without --reset', async () => {
    await expect(seedDemoTenant(client, { now: NOW })).rejects.toBeInstanceOf(DemoSeedError);
  });

  it('rebuilds cleanly when reset is requested', async () => {
    await seedDemoTenant(client, { now: NOW, reset: true });
    expect(await scalar(`SELECT count(*) AS value FROM tenants`)).toBe(1);
    expect(await scalar(`SELECT count(*) AS value FROM products`)).toBe(THALIA.products.length);
    expect(await scalar(`SELECT count(*) AS value FROM branches`)).toBe(2);
  });
});
