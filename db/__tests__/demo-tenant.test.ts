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

  it('fills every branch with staff, shelves and suppliers', async () => {
    expect(await scalar(`SELECT count(*) AS value FROM branches`)).toBe(THALIA.branches.length);
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

    // One gudang plus a selling shelf in every walk-in shop; the online channel
    // keeps none and is served straight from the gudang.
    const warehouses = await rows<{
      id: string;
      name: string;
      type: string;
      branch_id: string | null;
      address: string | null;
    }>(`SELECT id, name, type, branch_id, address FROM warehouses`);

    const central = warehouses.filter((row) => row.type === 'central');
    expect(central).toHaveLength(1);
    expect(central[0].name).toBe(THALIA.centralWarehouse.name);
    expect(central[0].address).toContain('Arif Rahman Hakim');
    expect(central[0].branch_id).toBeNull();

    const shelfBranches = THALIA.branches.filter((branch) => branch.shelf);
    const shelves = warehouses.filter((row) => row.type === 'store');
    expect(shelves).toHaveLength(shelfBranches.length);
    expect(warehouses).toHaveLength(shelfBranches.length + 1);
    for (const shelf of shelves) {
      const branch = shelfBranches.find((entry) => entry.shelf?.name === shelf.name);
      expect(branch, `unknown shelf ${shelf.name}`).toBeTruthy();
      // A shelf belongs to its shop, the gudang belongs to everyone.
      expect(shelf.branch_id).not.toBeNull();
    }

    const mappings = await rows<{
      branch_id: string;
      warehouse_id: string;
      is_default: number;
      priority: number;
    }>(`SELECT branch_id, warehouse_id, is_default, priority FROM branch_warehouses`);
    // Two rows per walk-in shop (its shelf first, the gudang behind it as the
    // fallback) and one row for the online channel.
    expect(mappings).toHaveLength(
      THALIA.branches.reduce((count, branch) => count + (branch.shelf ? 2 : 1), 0)
    );
    // Every mapping points at a real branch.
    expect(mappings.every((mapping) => Boolean(mapping.branch_id))).toBe(true);
    const defaults = mappings.filter((mapping) => Number(mapping.is_default) === 1);
    expect(defaults).toHaveLength(THALIA.branches.length);
    // The till sells from the shelf; the gudang is only the fallback.
    for (const shelf of shelves) {
      expect(defaults.some((mapping) => mapping.warehouse_id === shelf.id)).toBe(true);
    }
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

  it('records the part payment of one purchase bill in the vendor ledger', async () => {
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

  it('seeds one order per reachable state, with receipts that agree', async () => {
    const orders = await rows<{
      id: string;
      po_number: string;
      status: string;
      received_qty: number;
      ordered_qty: number;
      receipts: number;
      bills: number;
    }>(
      `SELECT po.id, po.po_number, po.status,
              (SELECT COALESCE(SUM(poi.quantity_received), 0) FROM purchase_order_items poi
                WHERE poi.purchase_order_id = po.id) AS received_qty,
              (SELECT COALESCE(SUM(poi.quantity), 0) FROM purchase_order_items poi
                WHERE poi.purchase_order_id = po.id) AS ordered_qty,
              (SELECT COUNT(*) FROM goods_receipts gr WHERE gr.purchase_order_id = po.id) AS receipts,
              (SELECT COUNT(*) FROM expenses e WHERE e.purchase_order_id = po.id) AS bills
         FROM purchase_orders po`
    );

    // The lifecycle the PO screen filters on has to be visible in the demo,
    // otherwise every filter but "all" looks broken.
    expect(orders.map((order) => order.status).sort()).toEqual([
      'approved',
      'draft',
      'partially_received',
      'received',
      'received',
      'rejected',
      'submitted',
    ]);

    for (const order of orders) {
      // `received` means every line arrived; anything else must not claim it.
      const fullyReceived = Number(order.received_qty) >= Number(order.ordered_qty);
      expect(fullyReceived, order.po_number).toBe(order.status === 'received');
      // One bill per delivery, and never a bill without a receipt.
      expect(Number(order.bills), order.po_number).toBe(Number(order.receipts));
      expect(order.po_number).toMatch(/^PO-\d{8}-\d{4}$/);
    }

    // A purchase bill is worth its delivery, not the whole order, and it
    // carries the order it came from.
    const bills = await rows<{ amount: number; receipt_total: number | null }>(
      `SELECT e.amount, gr.total_amount AS receipt_total
         FROM expenses e
         LEFT JOIN goods_receipts gr ON gr.id = e.goods_receipt_id
        WHERE e.category = 'Pembelian Stok'`
    );
    expect(bills).toHaveLength(orders.reduce((sum, order) => sum + Number(order.receipts), 0));
    for (const bill of bills) {
      expect(Number(bill.amount)).toBe(Number(bill.receipt_total));
    }
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
      // The catalog authors stock per location (gudang + one shelf per shop),
      // so the business-wide figure is the sum of the split.
      const total =
        expected!.stock.central + expected!.stock.shelves.reduce((sum, qty) => sum + qty, 0);
      expect(Number(row.available)).toBeCloseTo(total, 6);
    }

    // Nothing is authored onto a shelf that the channel cannot reach.
    const shelfBatches = await rows<{ sku: string }>(
      `SELECT p.sku
         FROM product_batches b
         JOIN products p ON p.id = b.product_id
         JOIN warehouses w ON w.id = b.warehouse_id
        WHERE w.type <> 'central' AND w.branch_id IS NULL`
    );
    expect(shelfBatches).toHaveLength(0);

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
    expect(open).toHaveLength(THALIA.branches.length);
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

  it('seeds branch orders that agree with their movement and with stock', async () => {
    const requests = await rows<{
      id: string;
      request_number: string;
      branch_id: string;
      warehouse_id: string;
      status: string;
      priority: string;
      source: string;
      transfer_id: string | null;
      requested_by: string | null;
    }>(
      `SELECT id, request_number, branch_id, warehouse_id, status, priority, source,
              transfer_id, requested_by
         FROM stock_requests ORDER BY created_at ASC`
    );

    expect(requests.map((row) => row.status).sort()).toEqual([
      'draft',
      'in_transit',
      'received',
      'submitted',
    ]);
    expect(new Set(requests.map((row) => row.request_number)).size).toBe(requests.length);
    for (const request of requests) {
      expect(request.request_number).toMatch(/^REQ\/\d{8}-THL-\d{2}-\d{4}$/);
      // Demand always points at the gudang, never at a shop's own shelf.
      expect(request.branch_id).toBeTruthy();
      expect(request.requested_by).toBeTruthy();
      expect(request.warehouse_id).toBe(
        (
          await rows<{ id: string }>(`SELECT id FROM warehouses WHERE type = 'central'`)
        )[0].id
      );
    }

    // The online channel has no shelf, so its order ships out of the building
    // instead of producing a transfer between two shops.
    const online = requests.filter((request) => request.source === 'online');
    expect(online).toHaveLength(1);
    expect(online[0].status).toBe('received');
    expect(online[0].transfer_id).toBeNull();

    // Every transfer in the demo hangs off exactly one request.
    const transfers = await rows<{ id: string; status: string; request_id: string | null }>(
      `SELECT id, status, request_id FROM stock_transfers`
    );
    expect(transfers).toHaveLength(1);
    expect(transfers[0].status).toBe('in_transit');
    const linked = requests.find((request) => request.transfer_id === transfers[0].id);
    expect(linked?.status).toBe('in_transit');
    expect(transfers[0].request_id).toBe(linked?.id);

    // Quantities only ever shrink on the way through the workflow.
    const lines = await rows<{
      request_id: string;
      quantity_requested: number;
      quantity_approved: number;
      quantity_dispatched: number;
      quantity_received: number;
    }>(
      `SELECT request_id, quantity_requested, quantity_approved,
              quantity_dispatched, quantity_received
         FROM stock_request_items`
    );
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const status = requests.find((request) => request.id === line.request_id)?.status;
      if (status === 'draft' || status === 'submitted') {
        expect(Number(line.quantity_approved)).toBe(0);
        continue;
      }
      expect(Number(line.quantity_approved)).toBeLessThanOrEqual(Number(line.quantity_requested));
      expect(Number(line.quantity_dispatched)).toBeLessThanOrEqual(Number(line.quantity_approved));
      expect(Number(line.quantity_received)).toBeLessThanOrEqual(Number(line.quantity_dispatched));
    }

    // No order was picked for more than the gudang actually holds.
    const dispatched = await rows<{ product_id: string; quantity: number }>(
      `SELECT i.product_id, SUM(i.quantity_dispatched) AS quantity
         FROM stock_request_items i
         JOIN stock_requests r ON r.id = i.request_id
        WHERE r.status IN ('in_transit', 'received')
        GROUP BY i.product_id`
    );
    const centralId = (
      await rows<{ id: string }>(`SELECT id FROM warehouses WHERE type = 'central'`)
    )[0].id;
    for (const line of dispatched) {
      const onHand = await scalar(
        `SELECT COALESCE(SUM(quantity_current), 0) AS value
           FROM product_batches WHERE warehouse_id = ? AND product_id = ?`,
        [centralId, line.product_id]
      );
      expect(onHand).toBeGreaterThanOrEqual(Number(line.quantity));
    }

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

    // Scoped to the gudang the same four SKUs are short: that is the figure the
    // ordering screens measure, since a shelf is refilled from the gudang.
    const centralShort = await rows<{ sku: string }>(
      `SELECT p.sku
         FROM products p
         JOIN product_batches b ON b.product_id = p.id
         JOIN warehouses w ON w.id = b.warehouse_id
        WHERE w.type = 'central'
        GROUP BY p.id
       HAVING SUM(b.quantity_current) < p.min_stock_level`
    );
    expect(centralShort.map((row) => row.sku).sort()).toEqual([
      'CHC-003',
      'KMS-003',
      'LMK-003',
      'PGR-003',
    ]);
  });

  it('refuses to merge into an existing tenant without --reset', async () => {
    await expect(seedDemoTenant(client, { now: NOW })).rejects.toBeInstanceOf(DemoSeedError);
  });

  it('rebuilds cleanly when reset is requested', async () => {
    await seedDemoTenant(client, { now: NOW, reset: true });
    expect(await scalar(`SELECT count(*) AS value FROM tenants`)).toBe(1);
    expect(await scalar(`SELECT count(*) AS value FROM products`)).toBe(THALIA.products.length);
    expect(await scalar(`SELECT count(*) AS value FROM branches`)).toBe(THALIA.branches.length);
  });
});
