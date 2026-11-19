import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { describe, expect, it } from 'vitest';

describe('purchase order discount migration 014', () => {
  it('replays 013 and 014 without changing historical receipts or AP balances', async () => {
    const client = createClient({ url: 'file::memory:' });
    try {
      await client.executeMultiple(`
        CREATE TABLE schema_version (id INTEGER PRIMARY KEY, version INTEGER NOT NULL);
        INSERT INTO schema_version VALUES (1, 12);
        CREATE TABLE suppliers (id TEXT PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE purchase_orders (id TEXT PRIMARY KEY, total_amount INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE goods_receipts (id TEXT PRIMARY KEY, total_amount INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE expenses (id TEXT PRIMARY KEY, amount INTEGER NOT NULL, amount_paid INTEGER NOT NULL DEFAULT 0);
        INSERT INTO purchase_orders VALUES ('po-old', 1000000);
        INSERT INTO goods_receipts VALUES ('gr-old', 450000);
        INSERT INTO expenses VALUES ('exp-old', 450000, 125000);
      `);
      for (const migration of ['013_vendor_ppn.sql', '014_purchase_order_discount.sql']) {
        await client.executeMultiple(readFileSync(path.join(process.cwd(), 'db', 'migrations', migration), 'utf8'));
      }
      expect((await client.execute('SELECT version FROM schema_version')).rows[0].version).toBe(14);
      expect((await client.execute(`SELECT subtotal_amount, discount_type, discount_value, discount_amount, ppn_rate, ppn_amount, total_amount FROM purchase_orders`)).rows[0])
        .toEqual({ subtotal_amount: 1000000, discount_type: 'none', discount_value: 0, discount_amount: 0, ppn_rate: 0, ppn_amount: 0, total_amount: 1000000 });
      expect((await client.execute(`SELECT subtotal_amount, discount_amount, ppn_rate, ppn_amount, total_amount FROM goods_receipts`)).rows[0])
        .toEqual({ subtotal_amount: 450000, discount_amount: 0, ppn_rate: 0, ppn_amount: 0, total_amount: 450000 });
      expect((await client.execute('SELECT amount, amount_paid FROM expenses')).rows[0])
        .toEqual({ amount: 450000, amount_paid: 125000 });
      await client.execute(`UPDATE purchase_orders SET discount_type = 'percent', discount_value = 10, discount_amount = 100000, ppn_rate = 11, ppn_amount = 99000, total_amount = 999000 WHERE id = 'po-old'`);
      expect((await client.execute(`SELECT discount_amount, total_amount FROM purchase_orders`)).rows[0])
        .toEqual({ discount_amount: 100000, total_amount: 999000 });
      for (const sql of [
        `UPDATE purchase_orders SET discount_type = 'invalid'`,
        `UPDATE purchase_orders SET discount_value = 101`,
        `UPDATE purchase_orders SET discount_amount = -1`,
        `UPDATE purchase_orders SET discount_amount = 1000001`,
        `UPDATE goods_receipts SET discount_amount = 450001`,
      ]) {
        await expect(client.execute(sql)).rejects.toThrow(/CHECK constraint failed/);
      }
    } finally {
      client.close();
    }
  });
});
