/**
 * Receipt write path against a real database built from `db/schema/tenant.sql`.
 *
 * The receipt is the one place where stock, the delivery document, the received
 * quantities, the vendor bill and the audit trail have to move together, so it
 * is tested on real SQL rather than on a mocked transaction: a missing column or
 * a wrong join would pass a mock and fail the first real delivery.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { translate } from '@/lib/db/translate';
import type { Transaction } from '@/lib/db';
import { GoodsReceiptError, receivePurchaseOrder } from './goods-receipt';
import { procurementAmounts, type ProcurementPpnRate, type ProcurementDiscount } from './procurement';

const root = process.cwd();
// A unique file per run: libSQL keeps a handle open, so a shared path would
// collide between runs on Windows.
const dbPath = path.join(os.tmpdir(), `rp-receipt-test-${process.pid}-${Date.now()}.db`);

let client: Client;

async function run<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const translated = translate(sql, params);
  const res = await client.execute({ sql: translated.sql, args: translated.args as never });
  return res.rows as unknown as T[];
}

/** `runTransaction()` from `@/lib/db` without its token dance. */
async function inTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  const transaction = await client.transaction('write');
  const tx: Transaction = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async query<R = any>(sql: string, params: unknown[] = []) {
      const translated = translate(sql, params);
      const res = await transaction.execute({
        sql: translated.sql,
        args: translated.args as never,
      });
      return {
        rows: res.rows as unknown as R[],
        rowCount: res.rowsAffected ?? res.rows.length,
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async execute<R = any>(sql: string, params: unknown[] = []) {
      return tx.query<R>(sql, params);
    },
  };

  try {
    const result = await fn(tx);
    await transaction.commit();
    return result;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

const BRANCH = 'branch-1';
const WAREHOUSE = 'wh-1';
const VENDOR = 'sup-1';

let orderSeq = 0;

interface OrderLine {
  id: string;
  productId: string;
  quantity: number;
  unit: string;
  factor: number;
  cost: number;
}

/** An order in the state a delivery can (or cannot) be posted against. */
async function makeOrder(options: {
  status: string;
  termsDays: number;
  lines: OrderLine[];
  ppnRate?: ProcurementPpnRate;
  discount?: ProcurementDiscount;
}): Promise<string> {
  orderSeq += 1;
  const orderId = `po-${orderSeq}`;
  const amounts = procurementAmounts(
    options.lines.map((line) => ({ quantity: line.quantity, unitCost: line.cost })),
    options.ppnRate ?? 0, options.discount
  );

  await run(
    `INSERT INTO purchase_orders
       (id, po_number, supplier_id, supplier_name, branch_id, warehouse_id, status,
        subtotal_amount, ppn_rate, ppn_amount, total_amount, payment_terms_days,
        discount_type, discount_value, discount_amount)
     VALUES ($1, $2, $3, 'PT Sumber Makmur', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      orderId,
      `PO-TEST-${orderSeq}`,
      VENDOR,
      BRANCH,
      WAREHOUSE,
      options.status,
      amounts.subtotal,
      amounts.ppnRate,
      amounts.ppnAmount,
      amounts.total,
      options.termsDays,
      amounts.discountType, amounts.discountValue, amounts.discountAmount,
    ]
  );

  for (const line of options.lines) {
    await run(
      `INSERT INTO purchase_order_items
         (id, purchase_order_id, product_id, quantity, unit_name, conversion_factor,
          unit_cost, subtotal)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        line.id,
        orderId,
        line.productId,
        line.quantity,
        line.unit,
        line.factor,
        line.cost,
        line.quantity * line.cost,
      ]
    );
  }

  return orderId;
}

beforeAll(async () => {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  client = createClient({ url: `file:${dbPath}` });
  const schema = readFileSync(path.join(root, 'db', 'schema', 'tenant.sql'), 'utf8');
  await client.executeMultiple(schema);

  await run(`INSERT INTO branches (id, name, code, status) VALUES ($1, 'Outlet Pusat', 'PST', 'active')`, [
    BRANCH,
  ]);
  await run(
    `INSERT INTO warehouses (id, name, code, type, branch_id, status, is_default)
     VALUES ($1, 'Gudang Pusat', 'PST-GD', 'store', $2, 'active', 1)`,
    [WAREHOUSE, BRANCH]
  );
  await run(
    `INSERT INTO suppliers (id, name, code, payment_terms_days) VALUES ($1, 'PT Sumber Makmur', 'VND-0001', 14)`,
    [VENDOR]
  );
  await run(
    `INSERT INTO products (id, sku, name, cost_price) VALUES ('prod-1', 'SKU-1', 'Kopi Susu', 5000)`
  );
  await run(
    `INSERT INTO products (id, sku, name, cost_price) VALUES ('prod-lead', 'SKU-2', 'Teh Botol', 4000), ('prod-discount', 'SKU-DISC', 'Discount fixture', 100000)`
  );
  await run(`INSERT INTO users (id, email, name, role, is_active) VALUES ('user-1', 'gudang@contoh.id', 'Gudang', 'warehouse', 1)`);
});

afterAll(() => {
  client.close();
});

describe('receivePurchaseOrder', () => {
  it('books stock, the delivery document and one bill in a single commit', async () => {
    const orderId = await makeOrder({
      status: 'approved',
      termsDays: 14,
      lines: [
        { id: 'full-1', productId: 'prod-1', quantity: 10, unit: 'Pcs', factor: 1, cost: 5_000 },
        { id: 'full-2', productId: 'prod-1', quantity: 2, unit: 'Dus', factor: 12, cost: 120_000 },
      ],
    });

    const result = await inTransaction((tx) =>
      receivePurchaseOrder(tx, {
        purchaseOrderId: orderId,
        lines: [
          { purchaseOrderItemId: 'full-1', quantity: 10 },
          { purchaseOrderItemId: 'full-2', quantity: 2 },
        ],
        receivedOn: '2026-10-30',
        supplierDocument: 'SJ-0099',
        requireExpiry: false,
        userId: 'user-1',
      })
    );

    expect(result.status).toBe('received');
    expect(result.grnNumber).toMatch(/^GRN-\d{8}-\d{4}$/);
    expect(result.totalAmount).toBe(290_000);
    expect(result.linesReceived).toBe(2);

    const order = await run<{ status: string; received_at: string | null }>(
      `SELECT status, received_at FROM purchase_orders WHERE id = $1`,
      [orderId]
    );
    expect(order[0].status).toBe('received');
    expect(order[0].received_at).not.toBeNull();

    const lines = await run<{ id: string; quantity_received: number }>(
      `SELECT id, quantity_received FROM purchase_order_items
        WHERE purchase_order_id = $1 ORDER BY id`,
      [orderId]
    );
    expect(lines.map((line) => Number(line.quantity_received))).toEqual([10, 2]);

    // A case became twelve pieces at a twelfth of the price — the shelf and the
    // ledger must agree on that.
    const batches = await run<{
      batch_number: string;
      quantity_current: number;
      cost_price: number;
      goods_receipt_id: string | null;
      purchase_order_id: string | null;
    }>(
      `SELECT batch_number, quantity_current, cost_price, goods_receipt_id, purchase_order_id
         FROM product_batches WHERE purchase_order_id = $1 ORDER BY quantity_current DESC`,
      [orderId]
    );
    expect(batches).toHaveLength(2);
    expect(batches.map((batch) => Number(batch.quantity_current))).toEqual([24, 10]);
    expect(batches.map((batch) => Number(batch.cost_price))).toEqual([10_000, 5_000]);
    // No lot number supplied: the GRN doubles as the lot, as the old flow did.
    expect(batches.every((batch) => batch.batch_number === result.grnNumber)).toBe(true);
    expect(batches.every((batch) => batch.goods_receipt_id === result.receiptId)).toBe(true);

    const receipt = await run<{ grn_number: string; total_amount: number; supplier_document: string }>(
      `SELECT grn_number, total_amount, supplier_document FROM goods_receipts WHERE id = $1`,
      [result.receiptId]
    );
    expect(receipt[0].grn_number).toBe(result.grnNumber);
    expect(Number(receipt[0].total_amount)).toBe(290_000);
    expect(receipt[0].supplier_document).toBe('SJ-0099');

    const items = await run<{ quantity: number; subtotal: number; batch_id: string | null }>(
      `SELECT quantity, subtotal, batch_id FROM goods_receipt_items
        WHERE goods_receipt_id = $1 ORDER BY subtotal DESC`,
      [result.receiptId]
    );
    expect(items.map((item) => Number(item.subtotal))).toEqual([240_000, 50_000]);
    expect(items.every((item) => item.batch_id !== null)).toBe(true);

    const bill = await run<{
      amount: number;
      amount_paid: number;
      status: string;
      due_date: string;
      purchase_order_id: string;
      goods_receipt_id: string;
      description: string;
      supplier_id: string;
      branch_id: string;
    }>(
      `SELECT amount, amount_paid, status, due_date, purchase_order_id, goods_receipt_id,
              description, supplier_id, branch_id
         FROM expenses WHERE goods_receipt_id = $1`,
      [result.receiptId]
    );
    expect(bill).toHaveLength(1);
    expect(Number(bill[0].amount)).toBe(290_000);
    // Fourteen-day terms: the bill is due a fortnight after the delivery date,
    // not on the day the order was raised.
    expect(bill[0].due_date).toBe('2026-11-13');
    expect(bill[0].status).toBe('unpaid');
    expect(Number(bill[0].amount_paid)).toBe(0);
    expect(bill[0].purchase_order_id).toBe(orderId);
    expect(bill[0].supplier_id).toBe(VENDOR);
    expect(bill[0].branch_id).toBe(BRANCH);
    expect(bill[0].description).toContain(result.grnNumber);
    expect(bill[0].description).toContain('PO-TEST-1');

    const audit = await run<{ entity_id: string; user_id: string; details: string }>(
      `SELECT entity_id, user_id, details FROM audit_logs WHERE action = 'receive_po'`
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].entity_id).toBe(result.receiptId);
    expect(audit[0].user_id).toBe('user-1');
    expect(audit[0].details).toContain(result.grnNumber);
  });

  it('leaves the order open until the remainder arrives, one bill per delivery', async () => {
    const orderId = await makeOrder({
      status: 'approved',
      termsDays: 30,
      lines: [{ id: 'split-1', productId: 'prod-1', quantity: 10, unit: 'Pcs', factor: 1, cost: 4_000 }],
    });

    const first = await inTransaction((tx) =>
      receivePurchaseOrder(tx, {
        purchaseOrderId: orderId,
        lines: [{ purchaseOrderItemId: 'split-1', quantity: 4 }],
        receivedOn: '2026-10-30',
        requireExpiry: false,
      })
    );
    expect(first.status).toBe('partially_received');
    expect(first.totalAmount).toBe(16_000);

    const second = await inTransaction((tx) =>
      receivePurchaseOrder(tx, {
        purchaseOrderId: orderId,
        lines: [{ purchaseOrderItemId: 'split-1', quantity: 6 }],
        receivedOn: '2026-11-02',
        requireExpiry: false,
      })
    );
    expect(second.status).toBe('received');

    const order = await run<{ status: string }>(
      `SELECT status FROM purchase_orders WHERE id = $1`,
      [orderId]
    );
    expect(order[0].status).toBe('received');

    const line = await run<{ quantity_received: number }>(
      `SELECT quantity_received FROM purchase_order_items WHERE id = 'split-1'`
    );
    expect(Number(line[0].quantity_received)).toBe(10);

    const stock = await run<{ total: number }>(
      `SELECT COALESCE(SUM(quantity_current), 0) AS total FROM product_batches
        WHERE purchase_order_id = $1`,
      [orderId]
    );
    expect(Number(stock[0].total)).toBe(10);

    const bills = await run<{ amount: number; due_date: string }>(
      `SELECT amount, due_date FROM expenses WHERE purchase_order_id = $1 ORDER BY date`,
      [orderId]
    );
    expect(bills.map((bill) => Number(bill.amount))).toEqual([16_000, 24_000]);
    expect(bills.map((bill) => bill.due_date)).toEqual(['2026-11-29', '2026-12-02']);
  });

  it('snapshots PO PPN on each partial receipt and books gross bills from actual prices', async () => {
    const orderId = await makeOrder({
      status: 'approved',
      termsDays: 0,
      ppnRate: 11,
      lines: [{ id: 'ppn-split-1', productId: 'prod-1', quantity: 3, unit: 'Pcs', factor: 1, cost: 1_000 }],
    });

    const first = await inTransaction((tx) =>
      receivePurchaseOrder(tx, {
        purchaseOrderId: orderId,
        lines: [{ purchaseOrderItemId: 'ppn-split-1', quantity: 1, unitCost: 1_005 }],
        receivedOn: '2026-10-30',
        requireExpiry: false,
      })
    );
    const second = await inTransaction((tx) =>
      receivePurchaseOrder(tx, {
        purchaseOrderId: orderId,
        lines: [{ purchaseOrderItemId: 'ppn-split-1', quantity: 2, unitCost: 999 }],
        receivedOn: '2026-10-31',
        requireExpiry: false,
      })
    );

    expect(first).toMatchObject({
      subtotalAmount: 1_005,
      ppnRate: 11,
      ppnAmount: 111,
      totalAmount: 1_116,
      status: 'partially_received',
    });
    expect(second).toMatchObject({
      subtotalAmount: 1_998,
      ppnRate: 11,
      ppnAmount: 219,
      totalAmount: 2_217,
      status: 'received',
    });

    const receipts = await run<{
      subtotal_amount: number;
      ppn_rate: number;
      ppn_amount: number;
      total_amount: number;
    }>(
      `SELECT subtotal_amount, ppn_rate, ppn_amount, total_amount
         FROM goods_receipts WHERE purchase_order_id = $1 ORDER BY received_at`,
      [orderId]
    );
    expect(receipts).toEqual([
      { subtotal_amount: 1_005, ppn_rate: 11, ppn_amount: 111, total_amount: 1_116 },
      { subtotal_amount: 1_998, ppn_rate: 11, ppn_amount: 219, total_amount: 2_217 }
    ]);

    const bills = await run<{ amount: number; amount_paid: number; status: string }>(
      `SELECT amount, amount_paid, status FROM expenses
        WHERE purchase_order_id = $1 ORDER BY date`,
      [orderId]
    );
    expect(bills).toEqual([
      { amount: 1_116, amount_paid: 1_116, status: 'paid' },
      { amount: 2_217, amount_paid: 2_217, status: 'paid' }
    ]);

    const costs = await run<{ cost_price: number }>(
      `SELECT cost_price FROM product_batches
        WHERE purchase_order_id = $1 ORDER BY received_at`,
      [orderId]
    );
    expect(costs.map((row) => Number(row.cost_price))).toEqual([1_005, 999]);
  });

  it('reconciles fractional receipts, discount and AP exactly to the PO snapshot', async () => {
    const orderId = await makeOrder({ status: 'approved', termsDays: 14, ppnRate: 11,
      discount: { type: 'amount', value: 1 },
      lines: [{ id: 'disc-fraction', productId: 'prod-1', quantity: 1, unit: 'Kg', factor: 1, cost: 5 }],
    });
    const results = [];
    for (const quantity of [0.333, 0.333, 0.334]) {
      results.push(await inTransaction((tx) => receivePurchaseOrder(tx, {
        purchaseOrderId: orderId, lines: [{ purchaseOrderItemId: 'disc-fraction', quantity }], requireExpiry: false,
      })));
    }
    expect(results.map((row) => row.subtotalAmount)).toEqual([2, 1, 2]);
    expect(results.map((row) => row.discountAmount)).toEqual([0, 1, 0]);
    expect(results[results.length - 1]?.status).toBe('received');
    expect(results.reduce((sum, row) => sum + row.totalAmount, 0)).toBe(4);
    const totals = await run<{ gross: number; discount: number; tax: number; total: number }>(
      `SELECT SUM(subtotal_amount) AS gross, SUM(discount_amount) AS discount,
              SUM(ppn_amount) AS tax, SUM(total_amount) AS total FROM goods_receipts WHERE purchase_order_id = $1`, [orderId]);
    expect(totals[0]).toEqual({ gross: 5, discount: 1, tax: 0, total: 4 });
    const bills = await run<{ total: number; count: number }>(
      `SELECT SUM(amount) AS total, COUNT(*) AS count FROM expenses WHERE purchase_order_id = $1`, [orderId]);
    expect(bills[0]).toEqual({ total: 4, count: 3 });
    const items = await run<{ subtotal: number }>(
      `SELECT SUM(i.subtotal) AS subtotal FROM goods_receipt_items i
       JOIN goods_receipts gr ON gr.id = i.goods_receipt_id WHERE gr.purchase_order_id = $1`, [orderId]);
    expect(items[0].subtotal).toBe(5);
  });

  it('allocates document discount to net batch cost, without adding tax to stock cost', async () => {
    const orderId = await makeOrder({ status: 'approved', termsDays: 14, ppnRate: 11,
      discount: { type: 'percent', value: 10 },
      lines: [
        { id: 'disc-cost-a', productId: 'prod-1', quantity: 2, unit: 'Dus', factor: 10, cost: 100_000 },
        { id: 'disc-cost-b', productId: 'prod-discount', quantity: 1, unit: 'Pcs', factor: 1, cost: 100_000 }
      ],
    });
    const result = await inTransaction((tx) => receivePurchaseOrder(tx, { purchaseOrderId: orderId,
      lines: [{ purchaseOrderItemId: 'disc-cost-a', quantity: 2 }, { purchaseOrderItemId: 'disc-cost-b', quantity: 1 }], requireExpiry: false,
    }));
    expect(result).toMatchObject({ subtotalAmount: 300_000, discountAmount: 30_000, ppnAmount: 29_700, totalAmount: 299_700 });
    const batches = await run<{ product_id: string; cost_price: number }>(
      `SELECT product_id, cost_price FROM product_batches WHERE purchase_order_id = $1 ORDER BY product_id`, [orderId]);
    expect(batches).toEqual([{ product_id: 'prod-1', cost_price: 9_000 }, { product_id: 'prod-discount', cost_price: 90_000 }]);
  });

  it('uses quantity-weighted PO discount allocation when invoice prices change', async () => {
    const orderId = await makeOrder({ status: 'approved', termsDays: 0, ppnRate: 11,
      discount: { type: 'amount', value: 20 },
      lines: [{ id: 'disc-override', productId: 'prod-1', quantity: 2, unit: 'Pcs', factor: 1, cost: 100 }],
    });
    const first = await inTransaction((tx) => receivePurchaseOrder(tx, { purchaseOrderId: orderId,
      lines: [{ purchaseOrderItemId: 'disc-override', quantity: 1 }], requireExpiry: false,
    }));
    const second = await inTransaction((tx) => receivePurchaseOrder(tx, { purchaseOrderId: orderId,
      lines: [{ purchaseOrderItemId: 'disc-override', quantity: 1, unitCost: 150 }], requireExpiry: false,
    }));
    expect([first.discountAmount, second.discountAmount]).toEqual([10, 10]);
    expect(first.totalAmount + second.totalAmount).toBe(255);
    const bills = await run<{ total: number; paid: number }>(
      `SELECT SUM(amount) AS total, SUM(amount_paid) AS paid FROM expenses WHERE purchase_order_id = $1`, [orderId]);
    expect(bills[0]).toEqual({ total: 255, paid: 255 });
  });

  it('rolls back a final receipt that cannot absorb its remaining discount', async () => {
    const orderId = await makeOrder({ status: 'approved', termsDays: 14, ppnRate: 11,
      discount: { type: 'amount', value: 90 },
      lines: [{ id: 'disc-invalid', productId: 'prod-1', quantity: 1, unit: 'Pcs', factor: 1, cost: 100 }],
    });
    await expect(inTransaction((tx) => receivePurchaseOrder(tx, { purchaseOrderId: orderId,
      lines: [{ purchaseOrderItemId: 'disc-invalid', quantity: 1, unitCost: 5 }], requireExpiry: false,
    }))).rejects.toThrow(/Sisa diskon PO/);
    const state = await run<{ status: string; received: number; bills: number; batches: number }>(
      `SELECT po.status, (SELECT quantity_received FROM purchase_order_items WHERE id = 'disc-invalid') AS received,
        (SELECT COUNT(*) FROM expenses WHERE purchase_order_id = $1) AS bills,
        (SELECT COUNT(*) FROM product_batches WHERE purchase_order_id = $1) AS batches
       FROM purchase_orders po WHERE po.id = $1`, [orderId]);
    expect(state[0]).toEqual({ status: 'approved', received: 0, bills: 0, batches: 0 });
  });

  it('refuses an over-delivery and rolls the whole receipt back', async () => {
    const orderId = await makeOrder({
      status: 'approved',
      termsDays: 30,
      lines: [{ id: 'over-1', productId: 'prod-1', quantity: 5, unit: 'Pcs', factor: 1, cost: 3_000 }],
    });

    await expect(
      inTransaction((tx) =>
        receivePurchaseOrder(tx, {
          purchaseOrderId: orderId,
          lines: [
            { purchaseOrderItemId: 'over-1', quantity: 4 },
            { purchaseOrderItemId: 'over-1', quantity: 1 },
          ],
          receivedOn: '2026-10-30',
          requireExpiry: false,
        })
      )
    ).rejects.toBeInstanceOf(GoodsReceiptError);

    await expect(
      inTransaction((tx) =>
        receivePurchaseOrder(tx, {
          purchaseOrderId: orderId,
          lines: [{ purchaseOrderItemId: 'over-1', quantity: 6 }],
          receivedOn: '2026-10-30',
          requireExpiry: false,
        })
      )
    ).rejects.toThrow(/melebihi sisa pesanan/);

    const state = await run<{ status: string; received: number; batches: number; bills: number }>(
      `SELECT po.status,
              (SELECT COALESCE(quantity_received, 0) FROM purchase_order_items WHERE id = 'over-1') AS received,
              (SELECT COUNT(*) FROM product_batches WHERE purchase_order_id = $1) AS batches,
              (SELECT COUNT(*) FROM expenses WHERE purchase_order_id = $1) AS bills
         FROM purchase_orders po WHERE po.id = $1`,
      [orderId]
    );
    expect(state[0].status).toBe('approved');
    expect(Number(state[0].received)).toBe(0);
    expect(Number(state[0].batches)).toBe(0);
    expect(Number(state[0].bills)).toBe(0);
  });

  it('refuses an order that has not been approved', async () => {
    const orderId = await makeOrder({
      status: 'draft',
      termsDays: 30,
      lines: [{ id: 'draft-1', productId: 'prod-1', quantity: 1, unit: 'Pcs', factor: 1, cost: 1_000 }],
    });

    await expect(
      inTransaction((tx) =>
        receivePurchaseOrder(tx, {
          purchaseOrderId: orderId,
          lines: [{ purchaseOrderItemId: 'draft-1', quantity: 1 }],
          receivedOn: '2026-10-30',
          requireExpiry: false,
        })
      )
    ).rejects.toThrow(/sudah disetujui/);
  });

  it('demands an expiry date when the tenant picks FEFO', async () => {
    const orderId = await makeOrder({
      status: 'approved',
      termsDays: 30,
      lines: [{ id: 'fefo-1', productId: 'prod-1', quantity: 3, unit: 'Pcs', factor: 1, cost: 2_000 }],
    });

    await expect(
      inTransaction((tx) =>
        receivePurchaseOrder(tx, {
          purchaseOrderId: orderId,
          lines: [{ purchaseOrderItemId: 'fefo-1', quantity: 3 }],
          receivedOn: '2026-10-30',
          requireExpiry: true,
        })
      )
    ).rejects.toThrow(/kedaluwarsa/);

    await expect(
      inTransaction((tx) =>
        receivePurchaseOrder(tx, {
          purchaseOrderId: orderId,
          lines: [{ purchaseOrderItemId: 'fefo-1', quantity: 3, expiryDate: '2026-10-30' }],
          receivedOn: '2026-10-30',
          requireExpiry: true,
        })
      )
    ).rejects.toThrow(/harus setelah/);

    const posted = await inTransaction((tx) =>
      receivePurchaseOrder(tx, {
        purchaseOrderId: orderId,
        lines: [{ purchaseOrderItemId: 'fefo-1', quantity: 3, expiryDate: '2027-01-31' }],
        receivedOn: '2026-10-30',
        requireExpiry: true,
      })
    );

    const batch = await run<{ expiry_date: string }>(
      `SELECT expiry_date FROM product_batches WHERE goods_receipt_id = $1`,
      [posted.receiptId]
    );
    expect(batch[0].expiry_date).toBe('2027-01-31');
  });

  it('refreshes the last cost without touching the vendor lead time', async () => {
    await run(
      `INSERT INTO vendor_products (vendor_id, product_id, last_cost, lead_time_days, min_order_qty)
       VALUES ($1, 'prod-lead', 1, 7, 1)`,
      [VENDOR]
    );

    const orderId = await makeOrder({
      status: 'approved',
      termsDays: 30,
      lines: [{ id: 'cost-1', productId: 'prod-lead', quantity: 4, unit: 'Pcs', factor: 1, cost: 6_000 }],
    });

    await inTransaction((tx) =>
      receivePurchaseOrder(tx, {
        purchaseOrderId: orderId,
        lines: [{ purchaseOrderItemId: 'cost-1', quantity: 4 }],
        receivedOn: '2026-10-30',
        requireExpiry: false,
      })
    );

    const catalogue = await run<{ last_cost: number; lead_time_days: number }>(
      `SELECT last_cost, lead_time_days FROM vendor_products
        WHERE vendor_id = $1 AND product_id = 'prod-lead'`,
      [VENDOR]
    );
    expect(Number(catalogue[0].last_cost)).toBe(6_000);
    // The receipt has no opinion about lead time; resetting it here was a real
    // defect of the old flow.
    expect(Number(catalogue[0].lead_time_days)).toBe(7);
  });

  it('posts a cash purchase as already paid', async () => {
    const orderId = await makeOrder({
      status: 'approved',
      termsDays: 0,
      lines: [{ id: 'cash-1', productId: 'prod-1', quantity: 2, unit: 'Pcs', factor: 1, cost: 7_500 }],
    });

    const result = await inTransaction((tx) =>
      receivePurchaseOrder(tx, {
        purchaseOrderId: orderId,
        lines: [{ purchaseOrderItemId: 'cash-1', quantity: 2 }],
        receivedOn: '2026-10-30',
        requireExpiry: false,
      })
    );

    const bill = await run<{ status: string; amount_paid: number; due_date: string }>(
      `SELECT status, amount_paid, due_date FROM expenses WHERE goods_receipt_id = $1`,
      [result.receiptId]
    );
    expect(bill[0].status).toBe('paid');
    expect(Number(bill[0].amount_paid)).toBe(15_000);
    expect(bill[0].due_date).toBe('2026-10-30');
  });
});
