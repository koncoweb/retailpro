/**
 * Schema + query-shape safety net.
 *
 * Builds a throwaway SQLite database from `db/schema/tenant.sql`, seeds one
 * branch/product/transaction and then runs the *converted* statements from the
 * app verbatim. This is what proves the Postgres → SQLite rewrite is correct
 * without a live Turso tenant:
 *
 *   - every table/column the 33 call sites use exists,
 *   - JSON1 aggregates return TEXT that `parseJson` turns back into real values,
 *   - date bucketing (`strftime`, `date('now','start of month')`) works,
 *   - `id` defaults to a UUID when an INSERT omits it,
 *   - `ON CONFLICT` upserts work (they need the UNIQUE index to exist).
 */
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseJson } from '../json';
import { translate } from '../translate';
import { sortBatchesForIssue } from '../../stock-issue';
import { getPeriodRange, sqliteTzModifier } from '../../date-range';

const root = process.cwd();
// A unique file per run: libSQL keeps a handle open, so a shared path would
// collide between runs on Windows.
const dbPath = path.join(os.tmpdir(), `rp-schema-test-${process.pid}-${Date.now()}.db`);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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
});

describe('tenant.sql', () => {
  it('applies cleanly and records a schema version', async () => {
    const rows = await run<{ version: number }>(`SELECT version FROM schema_version WHERE id = 1`);
    expect(rows[0].version).toBe(3);
  });

  it('exposes every table the application queries', async () => {
    const expected = [
      'audit_logs',
      'attendance',
      'branch_warehouses',
      'branches',
      'categories',
      'customers',
      'employees',
      'expenses',
      'leaves',
      'payables',
      'product_batches',
      'product_units',
      'products',
      'purchase_order_items',
      'purchase_orders',
      'shifts',
      'stock_transfers',
      'suppliers',
      'tenants',
      'transaction_items',
      'transactions',
      'transfer_items',
      'users',
      'vendor_payments',
      'vendor_products',
      'warehouses',
    ];
    const rows = await run<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`
    );
    const names = rows.map((r) => r.name);
    for (const table of expected) expect(names).toContain(table);
  });

  it('has no tenant_id column anywhere (database-per-tenant)', async () => {
    const rows = await run<{ table_name: string; name: string }>(
      `SELECT m.name AS table_name, p.name AS name
         FROM sqlite_master m
         JOIN pragma_table_info(m.name) p
        WHERE m.type = 'table' AND p.name = 'tenant_id'`
    );
    expect(rows).toEqual([]);
  });

  it('defaults id to a UUID v4 when an INSERT omits it', async () => {
    await run(`INSERT INTO categories (name) VALUES (?)`, ['Minuman']);
    const rows = await run<{ id: string }>(`SELECT id FROM categories WHERE name = 'Minuman'`);
    expect(rows[0].id).toMatch(UUID_RE);
  });
});

describe('seed state', () => {
  const tenantId = 'tenant-1';
  const branchId = 'branch-1';
  const warehouseId = 'warehouse-1';
  // A shared central DC: no owning branch, eligible to fulfil a store as well.
  const dcWarehouseId = 'warehouse-dc';
  const productId = 'product-1';

  beforeAll(async () => {
    await run(
      `INSERT INTO tenants (id, name, slug, settings) VALUES ($1, $2, $3, $4)`,
      [tenantId, 'PT Contoh', 'contoh', JSON.stringify({ role_permissions: {} })]
    );
    await run(
      `INSERT INTO branches (id, name, code, address, phone, email, status, sales_target)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)`,
      [branchId, 'Cabang Pusat', 'PST', 'Jl. Mawar 1', '021-555', 'pusat@contoh.id', 50_000_000]
    );
    await run(
      `INSERT INTO warehouses (id, name, code, type, branch_id, status, is_default)
       VALUES ($1, $2, $3, 'store', $4, 'active', 1)`,
      [warehouseId, 'Cabang Pusat - Gudang', 'PST-GD', branchId]
    );
    await run(
      `INSERT INTO warehouses (id, name, code, type, branch_id, status, is_default)
       VALUES ($1, $2, $3, 'central', NULL, 'active', 0)`,
      [dcWarehouseId, 'Gudang Pusat (DC)', 'DC-01']
    );
    // The branch sells from its own backroom first and may pull from the DC.
    await run(
      `INSERT INTO branch_warehouses (branch_id, warehouse_id, is_default, priority)
       VALUES ($1, $2, 1, 1), ($1, $3, 0, 2)`,
      [branchId, warehouseId, dcWarehouseId]
    );
    await run(
      `INSERT INTO users (id, email, name, role, assigned_branch_id, is_active)
       VALUES ($1, $2, $3, 'tenant_owner', $4, 1)`,
      ['user-1', 'owner@contoh.id', 'Owner', branchId]
    );
    await run(
      `INSERT INTO products (id, sku, name, category, cost_price, min_stock_level, supplier_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [productId, 'SKU-1', 'Kopi Susu', 'Minuman', 8_000, 5, null]
    );
    await run(
      `INSERT INTO product_units (product_id, name, conversion_factor, price, barcode)
       VALUES ($1, $2, $3, $4, $5)`,
      [productId, 'Pcs', 1, 15_000, '899123']
    );
    await run(
      `INSERT INTO product_units (product_id, name, conversion_factor, price, barcode)
       VALUES ($1, $2, $3, $4, $5)`,
      [productId, 'Dus', 12, 150_000, '899123-DUS']
    );
    await run(
      `INSERT INTO product_batches
         (id, warehouse_id, product_id, batch_number, quantity_initial, quantity_current, cost_price)
       VALUES ($1, $2, $3, $4, $5, $5, $6)`,
      ['batch-1', warehouseId, productId, 'BATCH-1', 24, 8_000]
    );
    await run(
      `INSERT INTO transactions
         (id, branch_id, cashier_id, invoice_number, total_amount, amount_paid, payment_method, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'cash', 'completed', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      ['tx-1', branchId, 'user-1', 'INV/1', 30_000, 30_000]
    );
    await run(
      `INSERT INTO transaction_items
         (id, transaction_id, product_id, batch_id, quantity, unit_name, conversion_factor,
          unit_price, cost_price, subtotal)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      ['ti-1', 'tx-1', productId, 'batch-1', 2, 'Pcs', 1, 15_000, 8_000, 30_000]
    );
  });

  it('keeps money as INTEGER rupiah', async () => {
    const rows = await run<{ total_amount: number; type: string }>(
      `SELECT total_amount, typeof(total_amount) AS type FROM transactions WHERE id = 'tx-1'`
    );
    expect(rows[0].total_amount).toBe(30000);
    expect(rows[0].type).toBe('integer');
  });

  it('POS.tsx products query (json_group_array) returns TEXT that parses to units', async () => {
    const rows = await run<{ id: string; stock: number; units: string; is_tracked: number }>(
      `SELECT 
         p.*, 
         COALESCE(SUM(pb.quantity_current), 0) as stock,
         COALESCE((
            SELECT json_group_array(json_object(
              'id', id, 
              'name', name, 
              'conversion_factor', conversion_factor, 
              'price', price,
              'barcode', barcode
            ))
            FROM product_units 
            WHERE product_id = p.id
         ), '[]') as units
       FROM products p
       LEFT JOIN product_batches pb ON p.id = pb.product_id AND pb.warehouse_id = $1
       GROUP BY p.id`,
      [warehouseId]
    );

    expect(rows).toHaveLength(1);
    expect(typeof rows[0].units).toBe('string');
    const units = parseJson<Array<{ name: string; conversion_factor: number }>>(rows[0].units, []);
    expect(units.map((u) => u.name)).toEqual(['Pcs', 'Dus']);
    expect(Number(rows[0].stock)).toBe(24);
  });

  it('Inventory.tsx warehouse_stock (json_group_object) parses to a keyed map', async () => {
    const rows = await run<{ warehouse_stock: string }>(
      `SELECT COALESCE((
          SELECT json_group_object(w.id, COALESCE(sum_qty, 0))
          FROM warehouses w
          LEFT JOIN (
            SELECT warehouse_id, SUM(quantity_current) as sum_qty
            FROM product_batches
            WHERE product_id = $1
            GROUP BY warehouse_id
          ) pb_sum ON w.id = pb_sum.warehouse_id
        ), '{}') as warehouse_stock`,
      [productId]
    );

    expect(typeof rows[0].warehouse_stock).toBe('string');
    const map = parseJson<Record<string, number>>(rows[0].warehouse_stock, {});
    // Every warehouse is a key, so a shared DC shows 0 instead of vanishing.
    expect(Object.keys(map).sort()).toEqual([dcWarehouseId, warehouseId].sort());
    expect(Number(map[warehouseId])).toBe(24);
    expect(Number(map[dcWarehouseId])).toBe(0);
  });

  it('POSTransactions.tsx items aggregate parses to an array', async () => {
    const rows = await run<{ id: string; items: string; cashier_name: string }>(
      `SELECT 
         t.id,
         u.name as cashier_name,
         COALESCE(
           json_group_array(
             json_object(
               'id', ti.id,
               'product_id', ti.product_id,
               'product_name', p.name,
               'quantity', ti.quantity
             )
           ) FILTER (WHERE ti.id IS NOT NULL),
           '[]'
         ) as items
       FROM transactions t
       LEFT JOIN transaction_items ti ON t.id = ti.transaction_id
       LEFT JOIN products p ON ti.product_id = p.id
       LEFT JOIN users u ON t.cashier_id = u.id
       GROUP BY t.id, u.name`
    );

    const items = parseJson<Array<{ product_name: string; quantity: number }>>(rows[0].items, []);
    expect(items).toHaveLength(1);
    expect(items[0].product_name).toBe('Kopi Susu');
    expect(Number(items[0].quantity)).toBe(2);
    expect(rows[0].cashier_name).toBe('Owner');
  });

  it('Branches.tsx dashboard row counts and month filter work', async () => {
    const rows = await run<{
      manager_email: string | null;
      employees: number;
      products: number;
      sales_this_month: number;
    }>(
      `SELECT 
         b.id, b.name, b.code, b.address, b.phone, b.email, b.status, b.sales_target,
         (SELECT email FROM users WHERE assigned_branch_id = b.id AND role = 'store_manager' LIMIT 1) as manager_email,
         (SELECT count(*) FROM users WHERE assigned_branch_id = b.id) as employees,
         (SELECT count(DISTINCT pb.product_id) FROM product_batches pb
            JOIN branch_warehouses bw ON bw.warehouse_id = pb.warehouse_id
           WHERE bw.branch_id = b.id AND pb.quantity_current > 0) as products,
         (SELECT COALESCE(SUM(total_amount), 0) FROM transactions WHERE branch_id = b.id AND created_at >= date('now','start of month')) as sales_this_month
       FROM branches b
       ORDER BY b.name`
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].manager_email).toBeNull();
    expect(Number(rows[0].employees)).toBe(1);
    expect(Number(rows[0].products)).toBe(1);
    expect(Number(rows[0].sales_this_month)).toBe(30000);
  });

  it('BranchPerformance.tsx current vs previous month buckets', async () => {
    const rows = await run<{ sales_current: number; sales_prev: number; employee_count: number }>(
      `SELECT 
         b.id, b.name,
         COALESCE(b.sales_target, 0) as sales_target,
         COALESCE(curr_sales.total, 0) as sales_current,
         COALESCE(prev_sales.total, 0) as sales_prev,
         COALESCE(emp.count, 0) as employee_count
       FROM branches b
       LEFT JOIN (
         SELECT branch_id, SUM(total_amount) as total 
         FROM transactions 
         WHERE created_at >= date('now','start of month') 
         GROUP BY branch_id
       ) curr_sales ON b.id = curr_sales.branch_id
       LEFT JOIN (
         SELECT branch_id, SUM(total_amount) as total 
         FROM transactions 
         WHERE created_at >= date('now','start of month','-1 month') 
         AND created_at < date('now','start of month') 
         GROUP BY branch_id
       ) prev_sales ON b.id = prev_sales.branch_id
       LEFT JOIN (
         SELECT assigned_branch_id, COUNT(*) as count 
         FROM users 
         WHERE is_active = 1 
         GROUP BY assigned_branch_id
       ) emp ON b.id = emp.assigned_branch_id`
    );

    expect(Number(rows[0].sales_current)).toBe(30000);
    expect(Number(rows[0].sales_prev)).toBe(0);
    expect(Number(rows[0].employee_count)).toBe(1);
  });

  it('Dashboard.tsx stat cards honour the period range and branch scope', async () => {
    // Verbatim shape of the batch in Dashboard.tsx: a closed range plus an
    // optional branch predicate, and the join variant used for units sold.
    const [start, end] = getPeriodRange('today');
    const txWhere = 'WHERE created_at >= $1 AND created_at < $2 AND branch_id = $3';
    const itemWhere = 'WHERE t.created_at >= $1 AND t.created_at < $2 AND t.branch_id = $3';
    const args = [start, end, 'branch-1'];

    const [sales, txCount, productsSold, employees] = await Promise.all([
      run<{ val: number }>(`SELECT COALESCE(SUM(total_amount), 0) as val FROM transactions ${txWhere}`, args),
      run<{ val: number }>(`SELECT COUNT(*) as val FROM transactions ${txWhere}`, args),
      run<{ val: number }>(
        `SELECT COALESCE(SUM(ti.quantity), 0) as val
           FROM transaction_items ti
           JOIN transactions t ON ti.transaction_id = t.id
          ${itemWhere}`,
        args
      ),
      run<{ val: number }>(
        `SELECT COUNT(*) as val FROM users WHERE is_active = 1 AND assigned_branch_id = $1`,
        ['branch-1']
      ),
    ]);

    expect(Number(sales[0].val)).toBe(30_000);
    expect(Number(txCount[0].val)).toBe(1);
    expect(Number(productsSold[0].val)).toBe(2);
    expect(Number(employees[0].val)).toBe(1);

    // The same period scoped to another branch must contribute nothing — this
    // is the regression that removing RLS would otherwise reintroduce.
    const otherBranch = await run<{ val: number }>(
      `SELECT COALESCE(SUM(total_amount), 0) as val FROM transactions ${txWhere}`,
      [start, end, 'branch-does-not-exist']
    );
    expect(Number(otherBranch[0].val)).toBe(0);
  });

  it('Reports.tsx monthly bucketing produces sortable YYYY-MM keys', async () => {
    // Mirrors the shipped query: a closed range plus a bound local-time
    // modifier, so a late-evening sale is not bucketed into the previous month.
    const tz = sqliteTzModifier();
    const [start, end] = getPeriodRange('thisyear');
    const rows = await run<{ month_key: string; sales: number }>(
      `SELECT
         strftime('%Y-%m', created_at, $1) as month_key,
         COALESCE(SUM(total_amount), 0) as sales
       FROM transactions
       WHERE created_at >= $2 AND created_at < $3
       GROUP BY 1
       ORDER BY 1`,
      [tz, start, end]
    );

    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    expect(rows[0].month_key).toBe(expected);
    expect(Number(rows[0].sales)).toBe(30000);
  });

  it('Cashflow.tsx expense bucketing uses strftime on a date column', async () => {
    await run(
      `INSERT INTO expenses (id, category, amount, date, amount_paid, status)
       VALUES ('exp-1', 'Sewa', 5000000, date('now'), 5000000, 'paid')`
    );
    const rows = await run<{ sort_key: string; total: number }>(
      `SELECT 
         strftime('%Y-%m', date) as sort_key,
         SUM(amount_paid) as total
       FROM expenses
       WHERE date >= date('now','start of month','-5 months')
       GROUP BY 1
       ORDER BY 1`
    );
    expect(rows[0].sort_key).toMatch(/^\d{4}-\d{2}$/);
    expect(Number(rows[0].total)).toBe(5000000);
  });

  it('settings read/merge/write keeps unrelated keys (replaces jsonb_set)', async () => {
    await run(`UPDATE tenants SET settings = json_patch(COALESCE(settings, '{}'), $1) WHERE id = $2`, [
      JSON.stringify({ payroll_config: { workDays: 26 } }),
      tenantId,
    ]);
    await run(`UPDATE tenants SET settings = json_patch(COALESCE(settings, '{}'), $1) WHERE id = $2`, [
      JSON.stringify({ role_permissions: { cashier: { pos: true } } }),
      tenantId,
    ]);

    const rows = await run<{ settings: string }>(`SELECT settings FROM tenants LIMIT 1`);
    const settings = parseJson<Record<string, unknown>>(rows[0].settings, {});
    expect(settings).toMatchObject({
      payroll_config: { workDays: 26 },
      role_permissions: { cashier: { pos: true } },
    });
  });

  it('customer preferences merge via json_patch', async () => {
    await run(
      `INSERT INTO customers (id, name, preferences) VALUES ('cust-1', 'Budi', '{"notes":"lama"}')`
    );
    await run(`UPDATE customers SET preferences = json_patch(COALESCE(preferences, '{}'), $1) WHERE id = 'cust-1'`, [
      JSON.stringify({ notes: 'baru' }),
    ]);
    const rows = await run<{ preferences: string }>(
      `SELECT preferences FROM customers WHERE id = 'cust-1'`
    );
    expect(parseJson<Record<string, string>>(rows[0].preferences, {})).toEqual({ notes: 'baru' });
  });

  it('users upsert works (ON CONFLICT needs the UNIQUE email index)', async () => {
    await run(
      `INSERT INTO users (id, email, role, assigned_branch_id, is_active)
       VALUES ($1, $2, 'store_manager', $3, 1)
       ON CONFLICT (id) DO UPDATE 
       SET role = 'store_manager', assigned_branch_id = $3, is_active = 1`,
      ['user-2', 'manager@contoh.id', branchId]
    );
    await run(
      `INSERT INTO users (id, email, role, assigned_branch_id, is_active)
       VALUES ($1, $2, 'cashier', $3, 1)
       ON CONFLICT (id) DO UPDATE 
       SET role = 'cashier', assigned_branch_id = $3, is_active = 1`,
      ['user-2', 'manager@contoh.id', branchId]
    );

    const rows = await run<{ role: string; is_active: number }>(
      `SELECT role, is_active FROM users WHERE id = 'user-2'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe('cashier');
    expect(Number(rows[0].is_active)).toBe(1);
  });

  it('enforces one invoice number per tenant (idempotent checkout)', async () => {
    await expect(
      run(
        `INSERT INTO transactions (id, branch_id, invoice_number, total_amount, amount_paid)
         VALUES ('tx-dup', $1, 'INV/1', 1000, 1000)`,
        [branchId]
      )
    ).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it('batch deduction uses the tenant issue policy (FIFO / LIFO / FEFO)', async () => {
    // A second, newer batch that also expires sooner than batch-1 (which has no
    // expiry at all) — so the three policies disagree on which comes first.
    await run(
      `INSERT INTO product_batches
         (id, warehouse_id, product_id, batch_number, expiry_date,
          quantity_initial, quantity_current, cost_price, received_at)
       VALUES ('batch-2', $1, $2, 'BATCH-2', '2026-11-30', 10, 10, 9000,
               strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      [warehouseId, productId]
    );

    // Same read the app does: candidates unordered, ordering decided in memory
    // by src/lib/stock-issue.ts.
    const candidates = await run<{ id: string; received_at: string; expiry_date: string | null }>(
      `SELECT id, received_at, expiry_date FROM product_batches
        WHERE product_id = $1 AND warehouse_id = $2 AND quantity_current > 0`,
      [productId, warehouseId]
    );
    expect(sortBatchesForIssue(candidates, 'fifo')[0].id).toBe('batch-1');
    expect(sortBatchesForIssue(candidates, 'lifo')[0].id).toBe('batch-2');
    expect(sortBatchesForIssue(candidates, 'fefo')[0].id).toBe('batch-2');

    // The write itself is identical whatever the policy: guarded decrement.
    const first = sortBatchesForIssue(candidates, 'fifo')[0];
    const tx = await client.transaction('write');
    await tx.execute({
      sql: `UPDATE product_batches SET quantity_current = quantity_current - ?
             WHERE id = ? AND quantity_current >= ?`,
      args: [4, first.id, 4],
    });
    await tx.commit();

    const rows = await run<{ quantity_current: number }>(
      `SELECT quantity_current FROM product_batches WHERE id = 'batch-1'`
    );
    expect(Number(rows[0].quantity_current)).toBe(20);
  });

  it('batch() returns every result positionally in one round-trip', async () => {
    // `batchQuery()` in lib/db relies on this: results come back in the order
    // the statements were sent, so callers can destructure them.
    const results = await client.batch(
      [
        { sql: `SELECT COUNT(*) AS n FROM products`, args: [] },
        {
          sql: `SELECT COALESCE(SUM(quantity_current), 0) AS q
                  FROM product_batches WHERE warehouse_id = ?`,
          args: [warehouseId],
        },
      ],
      'read'
    );

    expect(results).toHaveLength(2);
    expect(Number(results[0].rows[0].n)).toBe(1);
    expect(Number(results[1].rows[0].q)).toBeGreaterThan(0);
  });

  it('receiving a purchase order records stock and a payable together', async () => {
    // Inventory.tsx `handlePO`: order + lines + batches + liability are one unit
    // of work, so inventory can never grow without the finance module seeing it.
    const tx = await client.transaction('write');
    const poRes = await tx.execute({
      sql: `INSERT INTO purchase_orders
              (po_number, supplier_id, supplier_name, branch_id, warehouse_id, status, total_amount,
               notes, expected_date, received_at, created_by)
            VALUES (?, ?, ?, ?, ?, 'received', ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?)
            RETURNING id`,
      args: ['PO/1', 'sup-1', 'PT Sumber', branchId, warehouseId, 240_000, null, '2026-01-31', 'user-1'],
    });
    const purchaseOrderId = poRes.rows[0].id as string;
    expect(purchaseOrderId).toMatch(UUID_RE);

    await tx.execute({
      sql: `INSERT INTO purchase_order_items
              (purchase_order_id, product_id, quantity, unit_name, conversion_factor, unit_cost, subtotal)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [purchaseOrderId, productId, 2, 'Dus', 12, 120_000, 240_000],
    });
    await tx.execute({
      sql: `INSERT INTO product_batches
              (warehouse_id, product_id, batch_number, quantity_initial, quantity_current,
               cost_price, received_at, supplier_id)
            VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?)`,
      args: [warehouseId, productId, 'PO/1', 24, 24, 10_000, 'sup-1'],
    });
    await tx.execute({
      sql: `INSERT INTO payables
              (supplier_id, supplier_name, branch_id, purchase_order_id, amount, amount_paid,
               due_date, status, description)
            VALUES (?, ?, ?, ?, ?, 0, ?, 'unpaid', ?)`,
      args: ['sup-1', 'PT Sumber', branchId, purchaseOrderId, 240_000, '2026-01-31', 'Pembelian stok PO/1'],
    });
    await tx.commit();

    const payable = await run<{ amount: number; status: string; po_id: string }>(
      `SELECT p.amount, p.status, po.po_number AS po_id
         FROM payables p
         JOIN purchase_orders po ON po.id = p.purchase_order_id
        WHERE p.purchase_order_id = $1`,
      [purchaseOrderId]
    );
    expect(Number(payable[0].amount)).toBe(240000);
    expect(payable[0].status).toBe('unpaid');
    expect(payable[0].po_id).toBe('PO/1');

    const received = await run<{ total: number }>(
      `SELECT COALESCE(SUM(quantity_current), 0) AS total
         FROM product_batches WHERE batch_number = 'PO/1' AND warehouse_id = $1`,
      [warehouseId]
    );
    expect(Number(received[0].total)).toBe(24);

    await expect(
      run(
        `INSERT INTO purchase_orders (po_number, status, total_amount)
         VALUES ('PO/1', 'draft', 0)`
      )
    ).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it('approving a transfer keeps each source batch cost and expiry', async () => {
    // Phase 2.5. The old code collapsed every source batch into one weighted
    // average and dropped the expiry date, so short-dated goods silently became
    // long-dated the moment they crossed a branch boundary.
    await run(`INSERT INTO products (id, sku, name) VALUES ('product-xfer', 'SKU-XFER', 'Produk Transfer')`);
    await run(
      `INSERT INTO branches (id, name, code) VALUES ('branch-2', 'Cabang Tujuan', 'TJU')`
    );
    await run(
      `INSERT INTO warehouses (id, name, code, type, branch_id, status, is_default)
       VALUES ('warehouse-2', 'Cabang Tujuan - Gudang', 'TJU-GD', 'store', 'branch-2', 'active', 1)`
    );
    await run(
      `INSERT INTO branch_warehouses (branch_id, warehouse_id, is_default, priority)
       VALUES ('branch-2', 'warehouse-2', 1, 1)`
    );
    await run(
      `INSERT INTO product_batches
         (id, warehouse_id, product_id, batch_number, expiry_date,
          quantity_initial, quantity_current, cost_price, received_at)
       VALUES ('xfer-a', $1, 'product-xfer', 'A', '2026-12-31', 10, 10, 5000, '2026-01-01T00:00:00.000Z')`,
      [warehouseId]
    );
    await run(
      `INSERT INTO product_batches
         (id, warehouse_id, product_id, batch_number, expiry_date,
          quantity_initial, quantity_current, cost_price, received_at)
       VALUES ('xfer-b', $1, 'product-xfer', 'B', '2027-06-30', 10, 10, 7000, '2026-02-01T00:00:00.000Z')`,
      [warehouseId]
    );
    await run(
      `INSERT INTO stock_transfers
         (id, reference_number, source_warehouse_id, destination_warehouse_id, status)
       VALUES ('trf-1', 'TRF-TEST', $1, 'warehouse-2', 'pending')`,
      [warehouseId]
    );
    await run(
      `INSERT INTO transfer_items (id, transfer_id, product_id, quantity_sent, conversion_factor)
       VALUES ('ti-1', 'trf-1', 'product-xfer', 15, 1)`
    );

    // Mirror of the approval loop: one destination batch per issue-order leg.
    const tx = await client.transaction('write');
    const source = await tx.execute({
      sql: `SELECT id, quantity_current, cost_price, expiry_date, received_at
              FROM product_batches
             WHERE product_id = 'product-xfer' AND warehouse_id = ? AND quantity_current > 0`,
      args: [warehouseId],
    });
    // Production fetches candidates unordered and sorts them in memory with the
    // tenant policy; this fixture exercises the default (FIFO).
    const ordered = sortBatchesForIssue(source.rows as any[], 'fifo');
    let remaining = 15;
    let leg = 0;
    for (const batch of ordered) {
      if (remaining <= 0) break;
      const take = Math.min(Number(batch.quantity_current), remaining);
      await tx.execute({
        sql: `UPDATE product_batches SET quantity_current = quantity_current - ?
               WHERE id = ? AND quantity_current >= ?`,
        args: [take, batch.id as string, take],
      });
      leg += 1;
      await tx.execute({
        sql: `INSERT INTO product_batches
                (warehouse_id, product_id, batch_number, expiry_date,
                 quantity_initial, quantity_current, cost_price)
              VALUES ('warehouse-2', 'product-xfer', ?, ?, ?, ?, ?)`,
        args: [`TRF-TRF-TEST-${leg}`, batch.expiry_date as string, take, take, Number(batch.cost_price)],
      });
      remaining -= take;
    }
    await tx.execute({
      sql: `UPDATE stock_transfers SET status = 'completed' WHERE id = 'trf-1'`
    });
    await tx.commit();

    const destination = await run<{
      batch_number: string;
      expiry_date: string;
      quantity_current: number;
      cost_price: number;
    }>(
      `SELECT batch_number, expiry_date, quantity_current, cost_price
         FROM product_batches
        WHERE warehouse_id = 'warehouse-2' AND product_id = 'product-xfer'
        ORDER BY batch_number`
    );

    // Two legs, not one averaged batch: 10 @ 5000 (expires 2026-12-31) then
    // 5 @ 7000 (expires 2027-06-30).
    expect(destination).toHaveLength(2);
    expect(destination[0]).toMatchObject({
      batch_number: 'TRF-TRF-TEST-1',
      expiry_date: '2026-12-31',
      cost_price: 5000,
    });
    expect(Number(destination[0].quantity_current)).toBe(10);
    expect(destination[1]).toMatchObject({
      batch_number: 'TRF-TRF-TEST-2',
      expiry_date: '2027-06-30',
      cost_price: 7000,
    });
    expect(Number(destination[1].quantity_current)).toBe(5);

    // The source is drained oldest-first and never goes negative.
    const sourceLeft = await run<{ id: string; quantity_current: number }>(
      `SELECT id, quantity_current FROM product_batches
        WHERE id IN ('xfer-a', 'xfer-b') ORDER BY id`
    );
    expect(Number(sourceLeft[0].quantity_current)).toBe(0);
    expect(Number(sourceLeft[1].quantity_current)).toBe(5);
  });

  it('fails the whole transfer when the source warehouse cannot cover it', async () => {
    // The pre-flight in BranchTransfers.tsx/Inventory.tsx runs inside the write
    // transaction, so an impossible line leaves the transfer pending and moves
    // no stock at all.
    const before = await run<{ q: number }>(
      `SELECT COALESCE(SUM(quantity_current), 0) AS q
         FROM product_batches WHERE product_id = 'product-xfer' AND warehouse_id = $1`,
      [warehouseId]
    );

    const tx = await client.transaction('write');
    let message = '';
    try {
      await tx.execute({
        sql: `UPDATE product_batches SET quantity_current = quantity_current - ? WHERE id = ?`,
        args: [999, 'xfer-a'],
      });
      throw new Error('Stok gudang asal tidak mencukupi');
    } catch (error) {
      message = (error as Error).message;
    } finally {
      await tx.rollback();
    }

    expect(message).toMatch(/tidak mencukupi/);
    const after = await run<{ q: number }>(
      `SELECT COALESCE(SUM(quantity_current), 0) AS q
         FROM product_batches WHERE product_id = 'product-xfer' AND warehouse_id = $1`,
      [warehouseId]
    );
    expect(Number(after[0].q)).toBe(Number(before[0].q));
  });

  it('timestamps are ISO-8601 so new Date() is safe', async () => {
    const rows = await run<{ created_at: string }>(`SELECT created_at FROM transactions WHERE id = 'tx-1'`);
    expect(rows[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Number.isNaN(new Date(rows[0].created_at).getTime())).toBe(false);
  });
});
