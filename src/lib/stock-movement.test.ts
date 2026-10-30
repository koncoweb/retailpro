/**
 * Stock movement tests.
 *
 * These run against a real libSQL database built from `db/schema/tenant.sql`
 * rather than a hand-written fake, because the module is mostly SQL: guarded
 * batch deductions, per-leg destination rows and the committed-quantity join
 * can only be trusted if the statements are executed.
 *
 * Each test mints its own warehouse/product ids, so tests stay independent
 * without truncating shared tables.
 */
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Transaction } from '@/lib/db';
import { translate } from '@/lib/db/translate';
import {
  StockMovementError,
  cancelTransfer,
  committedQuantities,
  createTransfer,
  dispatchTransfer,
  receiveTransfer,
  shipOutOfStock,
  stockOnHand,
} from './stock-movement';

const dbPath = path.join(os.tmpdir(), `rp-stock-movement-${process.pid}-${Date.now()}.db`);
let client: Client;
let sequence = 0;

const unique = (prefix: string) => `${prefix}-${(sequence += 1)}`;

beforeAll(async () => {
  client = createClient({ url: `file:${dbPath}` });
  await client.executeMultiple(readFileSync(path.join(process.cwd(), 'db', 'schema', 'tenant.sql'), 'utf8'));
});

afterAll(() => {
  client.close();
});

/** Same contract as `runTransaction`, against the test client. */
async function withTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  const transaction = await client.transaction('write');
  const tx: Transaction = {
    async query<R = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const { sql: translated, args } = translate(sql, params);
      const result = await transaction.execute({ sql: translated, args: args as never });
      return {
        rows: result.rows as unknown as R[],
        rowCount: result.rowsAffected ?? result.rows.length,
      };
    },
    async execute<R = Record<string, unknown>>(sql: string, params: unknown[] = []) {
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

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  const { sql: translated, args } = translate(sql, params);
  const result = await client.execute({ sql: translated, args: args as never });
  return result.rows[0] as unknown as T | undefined;
}

interface BatchInput {
  warehouseId: string;
  productId: string;
  batchNumber: string;
  quantity: number;
  cost?: number;
  expiry?: string | null;
  receivedAt: string;
}

async function addBatch(input: BatchInput): Promise<void> {
  await client.execute({
    sql: `INSERT INTO product_batches
            (warehouse_id, product_id, batch_number, expiry_date, quantity_initial,
             quantity_current, cost_price, received_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      input.warehouseId,
      input.productId,
      input.batchNumber,
      input.expiry ?? null,
      input.quantity,
      input.quantity,
      input.cost ?? 0,
      input.receivedAt,
    ],
  });
}

/** Batches still holding stock, in a stable order. */
async function batchesAt(warehouseId: string, productId: string) {
  const { sql, args } = translate(
    `SELECT batch_number, expiry_date, quantity_current, cost_price
       FROM product_batches
      WHERE warehouse_id = $1 AND product_id = $2 AND quantity_current > 0
      ORDER BY batch_number`,
    [warehouseId, productId]
  );
  const result = await client.execute({ sql, args: args as never });
  return result.rows.map((row) => ({
    batchNumber: String(row.batch_number),
    expiry: row.expiry_date === null ? null : String(row.expiry_date),
    quantity: Number(row.quantity_current),
    cost: Number(row.cost_price),
  }));
}

async function queueTransfer(sourceWarehouseId: string, destinationWarehouseId: string, productId: string, quantity: number) {
  return withTx((tx) =>
    createTransfer(tx, {
      referenceNumber: unique('TRF-T'),
      sourceWarehouseId,
      destinationWarehouseId,
      items: [{ productId, quantity }],
    })
  );
}

/** Stock on hand, read through the module's own helper. */
async function onHand(warehouseId: string, productId: string): Promise<number> {
  return withTx((tx) => stockOnHand(tx, warehouseId, productId));
}

describe('stock movement: dispatch', () => {
  it('splits one line across source batches, keeping each leg cost and expiry', async () => {
    const source = unique('wh-src');
    const destination = unique('wh-dst');
    const product = unique('prd');
    await addBatch({
      warehouseId: source, productId: product, batchNumber: 'A',
      quantity: 5, cost: 1000, expiry: '2027-01-31', receivedAt: '2026-01-01T00:00:00.000Z',
    });
    await addBatch({
      warehouseId: source, productId: product, batchNumber: 'B',
      quantity: 10, cost: 2000, expiry: '2027-06-30', receivedAt: '2026-02-01T00:00:00.000Z',
    });

    const transferId = await queueTransfer(source, destination, product, 12);
    expect(await onHand(source, product)).toBe(15);

    const result = await withTx((tx) =>
      dispatchTransfer(tx, { transferId, userId: 'user-gudang', issueMethod: 'fifo' })
    );
    expect(result.itemCount).toBe(1);

    // FIFO: the oldest batch is exhausted first, the newer one is left short.
    expect(await batchesAt(source, product)).toEqual([
      { batchNumber: 'B', expiry: '2027-06-30', quantity: 3, cost: 2000 },
    ]);

    // One destination batch per source leg: expiry and cost survive the move.
    expect(await batchesAt(destination, product)).toEqual([
      { batchNumber: `TRF-${result.referenceNumber}-1`, expiry: '2027-01-31', quantity: 5, cost: 1000 },
      { batchNumber: `TRF-${result.referenceNumber}-2`, expiry: '2027-06-30', quantity: 7, cost: 2000 },
    ]);

    const header = await one<{ status: string; approved_by: string; sent_at: string | null }>(
      'SELECT status, approved_by, sent_at FROM stock_transfers WHERE id = $1',
      [transferId]
    );
    expect(header?.status).toBe('in_transit');
    expect(header?.approved_by).toBe('user-gudang');
    expect(header?.sent_at).toBeTruthy();
  });

  it('drains the newest batch first under LIFO', async () => {
    const source = unique('wh-src');
    const destination = unique('wh-dst');
    const product = unique('prd');
    await addBatch({
      warehouseId: source, productId: product, batchNumber: 'old',
      quantity: 4, cost: 1000, receivedAt: '2026-01-01T00:00:00.000Z',
    });
    await addBatch({
      warehouseId: source, productId: product, batchNumber: 'new',
      quantity: 4, cost: 1500, receivedAt: '2026-03-01T00:00:00.000Z',
    });

    const transferId = await queueTransfer(source, destination, product, 3);
    await withTx((tx) => dispatchTransfer(tx, { transferId, issueMethod: 'lifo' }));

    expect(await batchesAt(source, product)).toEqual([
      { batchNumber: 'new', expiry: null, quantity: 1, cost: 1500 },
      { batchNumber: 'old', expiry: null, quantity: 4, cost: 1000 },
    ]);
    const arrived = await batchesAt(destination, product);
    expect(arrived).toHaveLength(1);
    expect(arrived[0]).toMatchObject({ quantity: 3, cost: 1500 });
  });

  it('follows the expiring batch first under FEFO even when it arrived later', async () => {
    const source = unique('wh-src');
    const destination = unique('wh-dst');
    const product = unique('prd');
    await addBatch({
      warehouseId: source, productId: product, batchNumber: 'long-life',
      quantity: 4, cost: 1000, expiry: '2027-12-31', receivedAt: '2026-01-01T00:00:00.000Z',
    });
    await addBatch({
      warehouseId: source, productId: product, batchNumber: 'short-life',
      quantity: 4, cost: 1200, expiry: '2026-11-30', receivedAt: '2026-02-01T00:00:00.000Z',
    });

    const transferId = await queueTransfer(source, destination, product, 2);
    await withTx((tx) => dispatchTransfer(tx, { transferId, issueMethod: 'fefo' }));

    const arrived = await batchesAt(destination, product);
    expect(arrived).toHaveLength(1);
    expect(arrived[0]).toMatchObject({ quantity: 2, cost: 1200, expiry: '2026-11-30' });
    const sourceLeft = await batchesAt(source, product);
    expect(sourceLeft.find((batch) => batch.batchNumber === 'short-life')?.quantity).toBe(2);
    expect(sourceLeft.find((batch) => batch.batchNumber === 'long-life')?.quantity).toBe(4);
  });

  it('refuses to ship the same transfer twice', async () => {
    const source = unique('wh-src');
    const product = unique('prd');
    await addBatch({
      warehouseId: source, productId: product, batchNumber: 'A',
      quantity: 5, receivedAt: '2026-01-01T00:00:00.000Z',
    });
    const transferId = await queueTransfer(source, unique('wh-dst'), product, 1);
    await withTx((tx) => dispatchTransfer(tx, { transferId, issueMethod: 'fifo' }));

    await expect(
      withTx((tx) => dispatchTransfer(tx, { transferId, issueMethod: 'fifo' }))
    ).rejects.toThrow(StockMovementError);
  });
});

describe('stock movement: guards', () => {
  it('rejects a transfer whose source and destination are the same', async () => {
    const warehouse = unique('wh');
    const product = unique('prd');
    await addBatch({
      warehouseId: warehouse, productId: product, batchNumber: 'A',
      quantity: 5, receivedAt: '2026-01-01T00:00:00.000Z',
    });

    await expect(queueTransfer(warehouse, warehouse, product, 1)).rejects.toThrow(
      /tidak boleh sama/
    );
  });

  it('rejects a queue beyond the shelf, counting the conversion factor', async () => {
    const source = unique('wh-src');
    const destination = unique('wh-dst');
    const product = unique('prd');
    await addBatch({
      warehouseId: source, productId: product, batchNumber: 'A',
      quantity: 10, receivedAt: '2026-01-01T00:00:00.000Z',
    });

    // 2 dus of 12 = 24 base units against 10 on hand.
    await expect(
      withTx((tx) =>
        createTransfer(tx, {
          referenceNumber: unique('TRF-T'),
          sourceWarehouseId: source,
          destinationWarehouseId: destination,
          items: [{ productId: product, quantity: 2, unitName: 'Dus', conversionFactor: 12 }],
        })
      )
    ).rejects.toThrow(/tidak mencukupi/);

    expect(await onHand(source, product)).toBe(10);
  });

  it('rejects an empty transfer', async () => {
    await expect(
      withTx((tx) =>
        createTransfer(tx, {
          referenceNumber: unique('TRF-T'),
          sourceWarehouseId: 'wh-a',
          destinationWarehouseId: 'wh-b',
          items: [],
        })
      )
    ).rejects.toThrow(/belum punya baris/);
  });
});

describe('stock movement: receipt and cancellation', () => {
  it('only receives goods that were dispatched', async () => {
    const source = unique('wh-src');
    const product = unique('prd');
    await addBatch({
      warehouseId: source, productId: product, batchNumber: 'A',
      quantity: 5, receivedAt: '2026-01-01T00:00:00.000Z',
    });
    const transferId = await queueTransfer(source, unique('wh-dst'), product, 2);

    await expect(
      withTx((tx) => receiveTransfer(tx, { transferId, userId: 'user-toko' }))
    ).rejects.toThrow(/belum dikirim/);

    await withTx((tx) => dispatchTransfer(tx, { transferId, issueMethod: 'fifo' }));
    await withTx((tx) => receiveTransfer(tx, { transferId, userId: 'user-toko' }));

    const header = await one<{ status: string; received_by: string; received_at: string | null }>(
      'SELECT status, received_by, received_at FROM stock_transfers WHERE id = $1',
      [transferId]
    );
    expect(header?.status).toBe('completed');
    expect(header?.received_by).toBe('user-toko');
    expect(header?.received_at).toBeTruthy();

    // Receipt records confirmation only: stock already moved at dispatch.
    expect(await onHand(source, product)).toBe(3);
  });

  it('cancels a queued transfer but never a dispatched one', async () => {
    const source = unique('wh-src');
    const product = unique('prd');
    await addBatch({
      warehouseId: source, productId: product, batchNumber: 'A',
      quantity: 5, receivedAt: '2026-01-01T00:00:00.000Z',
    });

    const cancelledId = await queueTransfer(source, unique('wh-dst'), product, 1);
    await withTx((tx) => cancelTransfer(tx, cancelledId));
    await expect(withTx((tx) => cancelTransfer(tx, cancelledId))).rejects.toThrow(
      StockMovementError
    );

    const shippedId = await queueTransfer(source, unique('wh-dst'), product, 1);
    await withTx((tx) => dispatchTransfer(tx, { transferId: shippedId, issueMethod: 'fifo' }));
    await expect(withTx((tx) => cancelTransfer(tx, shippedId))).rejects.toThrow(/belum dikirim/);
  });
});

describe('stock movement: goods leaving the building', () => {
  it('drops the batches without crediting any other warehouse', async () => {
    const warehouse = unique('wh-gudang');
    const product = unique('prd');
    await addBatch({
      warehouseId: warehouse, productId: product, batchNumber: 'A',
      quantity: 6, cost: 800, receivedAt: '2026-01-01T00:00:00.000Z',
    });
    await addBatch({
      warehouseId: warehouse, productId: product, batchNumber: 'B',
      quantity: 6, cost: 900, receivedAt: '2026-02-01T00:00:00.000Z',
    });

    const result = await withTx((tx) =>
      shipOutOfStock(tx, {
        warehouseId: warehouse,
        items: [{ productId: product, quantity: 9 }],
        issueMethod: 'fifo',
      })
    );

    // 6 × 800 from the first batch + 3 × 900 from the second.
    expect(result.moved).toEqual([{ productId: product, quantity: 9, cost: 7500 }]);
    // FIFO consumed the whole first batch and half of the second.
    expect(await batchesAt(warehouse, product)).toEqual([
      { batchNumber: 'B', expiry: null, quantity: 3, cost: 900 },
    ]);
    expect(await onHand(warehouse, product)).toBe(3);
  });

  it('refuses an empty shipment or more than the shelf holds', async () => {
    const warehouse = unique('wh-gudang');
    const product = unique('prd');
    await addBatch({
      warehouseId: warehouse, productId: product, batchNumber: 'A',
      quantity: 2, receivedAt: '2026-01-01T00:00:00.000Z',
    });

    await expect(
      withTx((tx) => shipOutOfStock(tx, { warehouseId: warehouse, items: [], issueMethod: 'fifo' }))
    ).rejects.toThrow(/belum punya baris/);
    await expect(
      withTx((tx) =>
        shipOutOfStock(tx, {
          warehouseId: warehouse,
          items: [{ productId: product, quantity: 5 }],
          issueMethod: 'fifo',
        })
      )
    ).rejects.toThrow(/tidak mencukupi/);
  });
});

describe('stock movement: committed quantities', () => {
  async function addRequest(input: {
    id: string;
    warehouseId: string;
    status: string;
    lines: { productId: string; approved: number }[];
  }) {
    await client.execute({
      sql: `INSERT INTO stock_requests (id, request_number, branch_id, warehouse_id, status)
            VALUES (?, ?, ?, ?, ?)`,
      args: [input.id, unique('REQ-T'), 'branch-test', input.warehouseId, input.status],
    });
    for (const line of input.lines) {
      await client.execute({
        sql: `INSERT INTO stock_request_items
                (request_id, product_id, quantity_requested, quantity_approved)
              VALUES (?, ?, ?, ?)`,
        args: [input.id, line.productId, line.approved, line.approved],
      });
    }
  }

  it('counts only approved and in-transit requests of that gudang', async () => {
    const warehouse = unique('wh-gudang');
    const otherWarehouse = unique('wh-other');
    const flour = unique('prd');
    const sugar = unique('prd');
    const approved = unique('req');
    const shipping = unique('req');
    await addRequest({ id: approved, warehouseId: warehouse, status: 'approved', lines: [{ productId: flour, approved: 6 }] });
    await addRequest({ id: shipping, warehouseId: warehouse, status: 'in_transit', lines: [{ productId: flour, approved: 2 }, { productId: sugar, approved: 4 }] });
    // Neither a draft nor another gudang may claim capacity.
    await addRequest({ id: unique('req'), warehouseId: warehouse, status: 'draft', lines: [{ productId: flour, approved: 99 }] });
    await addRequest({ id: unique('req'), warehouseId: otherWarehouse, status: 'approved', lines: [{ productId: flour, approved: 50 }] });

    const committed = await withTx((tx) => committedQuantities(tx, warehouse, [flour, sugar]));
    expect(committed).toEqual({ [flour]: 8, [sugar]: 4 });
  });

  it('excludes the request being dispatched', async () => {
    const warehouse = unique('wh-gudang');
    const product = unique('prd');
    const first = unique('req');
    const second = unique('req');
    await addRequest({ id: first, warehouseId: warehouse, status: 'approved', lines: [{ productId: product, approved: 5 }] });
    await addRequest({ id: second, warehouseId: warehouse, status: 'approved', lines: [{ productId: product, approved: 3 }] });

    const committed = await withTx((tx) => committedQuantities(tx, warehouse, [product], second));
    expect(committed).toEqual({ [product]: 5 });
  });

  it('returns nothing when there is nothing to ask about', async () => {
    expect(await withTx((tx) => committedQuantities(tx, 'wh-any', []))).toEqual({});
  });
});


