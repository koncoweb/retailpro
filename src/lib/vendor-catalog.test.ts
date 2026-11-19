/**
 * The vendor↔product catalogue writer, tested against a real database built
 * from `db/schema/tenant.sql`.
 *
 * These helpers are the only path that may write `suppliers`, `vendor_products`
 * and `vendor_price_list`, and they are what the PO auto-fill depends on. A
 * wrong `is_preferred`, a duplicated vendor name or a price-list row written on
 * top of a negotiated one is invisible in a mock but expensive in the field, so
 * the assertions run on real SQL.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { translate } from '@/lib/db/translate';
import type { Transaction } from '@/lib/db';
import {
  defaultVendorFor,
  findVendorByCode,
  findVendorByName,
  latestVendorCode,
  markPreferredVendor,
  normalizeVendorName,
  recordVendorLastCost,
  resolveOrCreateVendor,
  upsertVendorCatalogLink,
  upsertVendorPrice,
} from './vendor-catalog';
import { nextVendorCode } from './vendor';

const root = process.cwd();
// A unique file per run: libSQL keeps a handle open, so a shared path would
// collide between runs on Windows.
const dbPath = path.join(os.tmpdir(), `rp-vendor-catalog-test-${process.pid}-${Date.now()}.db`);

let client: Client;

/** The `SqlExecutor` shape the helpers expect, over the raw test client. */
const exec = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async query<T = any>(sql: string, params: unknown[] = []) {
    const rows = await run<T>(sql, params);
    return { rows, rowCount: rows.length };
  },
};

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
      return { rows: res.rows as unknown as R[], rowCount: res.rowsAffected ?? res.rows.length };
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

let seq = 0;

/** A product with one Default variant and one base pack — the shape every writer expects. */
async function seedProduct(name = `Produk ${++seq}`): Promise<string> {
  seq += 1;
  const productId = `prod-${seq}`;
  await run(
    `INSERT INTO products (id, sku, name, category) VALUES ($1, $2, $3, 'Umum')`,
    [productId, `SKU-${seq}`, name]
  );
  await run(
    `INSERT INTO product_variants (id, product_id, sku, name, attributes, cost_price, price)
     VALUES ($1, $2, $3, 'Default', '{}', 0, 0)`,
    [`var-${seq}`, productId, `SKU-${seq}`]
  );
  return productId;
}

async function seedVariant(productId: string): Promise<string> {
  seq += 1;
  const variantId = `var-${seq}`;
  await run(
    `INSERT INTO product_variants (id, product_id, sku, name, attributes, cost_price, price)
     VALUES ($1, $2, $3, 'Default', '{}', 0, 0)`,
    [variantId, productId, `VAR-${seq}`]
  );
  return variantId;
}

async function vendorRow(id: string): Promise<{
  name: string;
  code: string | null;
  category: string | null;
  ppn_enabled: number;
}> {
  const rows = await run<{
    name: string;
    code: string | null;
    category: string | null;
    ppn_enabled: number;
  }>(
    `SELECT name, code, category, ppn_enabled FROM suppliers WHERE id = $1`,
    [id]
  );
  return rows[0];
}

async function linkRow(
  vendorId: string,
  productId: string
): Promise<{ last_cost: number; min_order_qty: number; is_preferred: number; vendor_sku: string | null }> {
  const rows = await run<Record<string, never>>(
    `SELECT last_cost, min_order_qty, is_preferred, vendor_sku
       FROM vendor_products WHERE vendor_id = $1 AND product_id = $2`,
    [vendorId, productId]
  );
  return rows[0] as never;
}

async function priceRow(
  vendorId: string,
  variantId: string,
  unitName: string
): Promise<{ buy_price: number; notes: string | null; min_qty: number } | undefined> {
  const rows = await run<{ buy_price: number; notes: string | null; min_qty: number }>(
    `SELECT buy_price, notes, min_qty FROM vendor_price_list
      WHERE vendor_id = $1 AND variant_id = $2 AND unit_name = $3`,
    [vendorId, variantId, unitName]
  );
  return rows[0];
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

describe('normalizeVendorName', () => {
  it('trims and collapses inner runs of spaces', () => {
    expect(normalizeVendorName('  PT   Sumber   Makmur ')).toBe('PT Sumber Makmur');
  });

  it('tolerates null and undefined', () => {
    expect(normalizeVendorName(null)).toBe('');
    expect(normalizeVendorName(undefined)).toBe('');
  });
});

describe('resolveOrCreateVendor', () => {
  it('returns null for a blank name instead of writing a stub vendor', async () => {
    expect(await resolveOrCreateVendor(exec, '   ')).toBeNull();
    expect(await resolveOrCreateVendor(exec, { name: '' })).toBeNull();
    const rows = await run<{ n: number }>(`SELECT COUNT(*) AS n FROM suppliers`);
    expect(Number(rows[0].n)).toBe(0);
  });

  it('creates a proper master row: generated code and a default category', async () => {
    const id = await resolveOrCreateVendor(exec, { name: 'PT Sumber Makmur' });
    expect(id).toBeTruthy();
    const row = await vendorRow(id as string);
    expect(row.name).toBe('PT Sumber Makmur');
    expect(row.code).toBe('VND-0001');
    expect(row.category).toBe('supplier');
  });

  it('stores imported PPN only when it creates a new vendor', async () => {
    const id = await resolveOrCreateVendor(exec, {
      name: 'PT PPN Baru',
      ppnEnabled: true,
    });
    expect((await vendorRow(id as string)).ppn_enabled).toBe(1);

    await resolveOrCreateVendor(exec, {
      name: 'pt ppn baru',
      ppnEnabled: false,
    });
    expect((await vendorRow(id as string)).ppn_enabled).toBe(1);
  });

  it('matches case- and space-insensitively rather than duplicating', async () => {
    const first = await resolveOrCreateVendor(exec, { name: 'PT Sumber Makmur' });
    const again = await resolveOrCreateVendor(exec, { name: 'pt   sumber makmur' });
    expect(again).toBe(first);
    expect(await findVendorByName(exec, 'PT Tidak Pernah Ada')).toBeNull();
    const rows = await run<{ n: number }>(
      `SELECT COUNT(*) AS n FROM suppliers WHERE name = 'PT Sumber Makmur'`
    );
    expect(Number(rows[0].n)).toBe(1);
  });

  it('never renames an existing master: masters are additive', async () => {
    const id = await resolveOrCreateVendor(exec, { name: 'CV Lama' });
    await resolveOrCreateVendor(exec, {
      name: 'cv lama',
      category: 'distributor',
      phone: '08111',
    });
    const row = await vendorRow(id as string);
    expect(row.category).toBe('supplier');
    const withPhone = await run<{ phone: string | null }>(
      `SELECT phone FROM suppliers WHERE id = $1`,
      [id as string]
    );
    expect(withPhone[0].phone).toBeNull();
  });

  it('honours a code given in the sheet and continues the sequence', async () => {
    const id = await resolveOrCreateVendor(exec, { name: 'PT Kode Mandiri', code: 'vnd-0500' });
    expect((await vendorRow(id as string)).code).toBe('VND-0500');
    const next = await resolveOrCreateVendor(exec, { name: 'PT Kode Lanjutan' });
    expect((await vendorRow(next as string)).code).toBe('VND-0501');
  });

  it('matches by code before name, so a re-typed name extends the same master', async () => {
    const first = await resolveOrCreateVendor(exec, { name: 'PT Kode Mandiri' });
    // The sheet repeated the code with a different spelling of the name: one
    // vendor, one master row. A second row would split its catalogue.
    const again = await resolveOrCreateVendor(exec, {
      name: 'PT KODE MANDIRI TBK',
      code: 'VND-0500',
    });
    expect(again).toBe(first);
    const rows = await run<{ n: number }>(
      `SELECT COUNT(*) AS n FROM suppliers WHERE code = 'VND-0500'`
    );
    expect(Number(rows[0].n)).toBe(1);
  });

  it('findVendorByCode() is case-insensitive and blank-safe', async () => {
    const id = await resolveOrCreateVendor(exec, { name: 'PT Cari Kode', code: 'VND-0600' });
    expect(await findVendorByCode(exec, 'vnd-0600')).toMatchObject({ id: id as string });
    expect(await findVendorByCode(exec, 'VND-9999')).toBeNull();
    expect(await findVendorByCode(exec, '   ')).toBeNull();
  });

  it('reads the highest code through latestVendorCode()', async () => {
    await resolveOrCreateVendor(exec, { name: 'PT Urut', code: 'VND-0777' });
    expect(await latestVendorCode(exec)).toBe('VND-0777');
  });

  it('runs inside a caller transaction', async () => {
    const id = await inTransaction((tx) =>
      resolveOrCreateVendor(tx, { name: 'PT Dalam Transaksi', category: 'trader' })
    );
    expect((await vendorRow(id as string)).category).toBe('trader');
  });

  it('keeps a hand-written code out of the generated sequence', async () => {
    // `VND-SURIYA` is a legal code and sorts above `VND-9999` lexically. Ranking
    // codes as text therefore made the next vendor `VND-0001` — a number that was
    // already taken — and the import died on `idx_suppliers_code` instead of
    // creating the vendor.
    const before = await latestVendorCode(exec);
    await resolveOrCreateVendor(exec, { name: 'PT Kode Tulisan Tangan', code: 'VND-SURIYA' });
    expect(await latestVendorCode(exec)).toBe(before);

    const next = await resolveOrCreateVendor(exec, { name: 'PT Setelah Kode Tangan' });
    expect((await vendorRow(next as string)).code).toBe(nextVendorCode(before));
  });
});

describe('upsertVendorCatalogLink', () => {
  it('writes a link row and keeps last_cost following the caller', async () => {
    const vendorId = (await resolveOrCreateVendor(exec, { name: 'PT Katalog Satu' })) as string;
    const productId = await seedProduct();
    await upsertVendorCatalogLink(exec, {
      vendorId,
      productId,
      lastCost: 8000,
      minOrderQty: 12,
      vendorSku: 'KM-1',
      isPreferred: true,
    });
    let row = await linkRow(vendorId, productId);
    expect(row.last_cost).toBe(8000);
    expect(row.min_order_qty).toBe(12);
    expect(row.vendor_sku).toBe('KM-1');
    expect(row.is_preferred).toBe(1);

    await upsertVendorCatalogLink(exec, { vendorId, productId, lastCost: 9250 });
    row = await linkRow(vendorId, productId);
    expect(row.last_cost).toBe(9250);
    // A repeat write without the optional fields must not blank them out.
    expect(row.vendor_sku).toBe('KM-1');
    expect(row.min_order_qty).toBe(12);
    expect(row.is_preferred).toBe(1);
  });

  it('never downgrades an existing preferred row', async () => {
    const vendorId = (await resolveOrCreateVendor(exec, { name: 'PT Prioritas' })) as string;
    const productId = await seedProduct();
    await upsertVendorCatalogLink(exec, { vendorId, productId, lastCost: 1000, isPreferred: true });
    await upsertVendorCatalogLink(exec, { vendorId, productId, lastCost: 1100, isPreferred: false });
    expect((await linkRow(vendorId, productId)).is_preferred).toBe(1);
  });

  it('recordVendorLastCost() updates only the cost, so min_order_qty survives a delivery', async () => {
    const vendorId = (await resolveOrCreateVendor(exec, { name: 'PT Terima Barang' })) as string;
    const productId = await seedProduct();
    await upsertVendorCatalogLink(exec, {
      vendorId,
      productId,
      lastCost: 5000,
      minOrderQty: 24,
      leadTimeDays: 7,
    });
    await recordVendorLastCost(exec, { vendorId, productId, lastCost: 5400 });
    const row = await linkRow(vendorId, productId);
    expect(row.last_cost).toBe(5400);
    expect(row.min_order_qty).toBe(24);
    // A receipt creating the row for the first time still satisfies NOT NULL.
    const other = await seedProduct();
    await recordVendorLastCost(exec, { vendorId, productId: other, lastCost: 100 });
    expect((await linkRow(vendorId, other)).min_order_qty).toBe(1);
  });

  it('markPreferredVendor() keeps exactly one preferred row per product', async () => {
    const a = (await resolveOrCreateVendor(exec, { name: 'PT Unggul A' })) as string;
    const b = (await resolveOrCreateVendor(exec, { name: 'PT Unggul B' })) as string;
    const productId = await seedProduct();
    await upsertVendorCatalogLink(exec, { vendorId: a, productId, lastCost: 100, isPreferred: true });
    await upsertVendorCatalogLink(exec, { vendorId: b, productId, lastCost: 110 });
    await markPreferredVendor(exec, { vendorId: b, productId });

    const rows = await run<{ vendor_id: string; is_preferred: number }>(
      `SELECT vendor_id, is_preferred FROM vendor_products WHERE product_id = $1`,
      [productId]
    );
    expect(rows.find((r) => r.vendor_id === a)?.is_preferred).toBe(0);
    expect(rows.find((r) => r.vendor_id === b)?.is_preferred).toBe(1);
    // Moving it back does not leave a second preferred row behind.
    await markPreferredVendor(exec, { vendorId: a, productId });
    const preferred = await run<{ n: number }>(
      `SELECT COUNT(*) AS n FROM vendor_products WHERE product_id = $1 AND is_preferred = 1`,
      [productId]
    );
    expect(Number(preferred[0].n)).toBe(1);
  });
});

describe('upsertVendorPrice', () => {
  async function seeded(): Promise<{ vendorId: string; variantId: string }> {
    const vendorId = (await resolveOrCreateVendor(exec, {
      name: `PT Harga ${++seq}`,
    })) as string;
    const productId = await seedProduct();
    const variantId = await seedVariant(productId);
    return { vendorId, variantId };
  }

  it('writes the agreed price with its source in notes', async () => {
    const { vendorId, variantId } = await seeded();
    await upsertVendorPrice(exec, {
      vendorId,
      variantId,
      unitName: 'Pcs',
      conversionFactor: 1,
      buyPrice: 7500,
      mode: 'overwrite',
      source: 'form produk',
    });
    const row = await priceRow(vendorId, variantId, 'Pcs');
    expect(row?.buy_price).toBe(7500);
    expect(row?.notes).toBe('form produk');
  });

  it('overwrite replaces the negotiated number', async () => {
    const { vendorId, variantId } = await seeded();
    await upsertVendorPrice(exec, {
      vendorId,
      variantId,
      unitName: 'Karton',
      conversionFactor: 24,
      buyPrice: 180000,
      mode: 'overwrite',
      source: 'katalog vendor',
    });
    await upsertVendorPrice(exec, {
      vendorId,
      variantId,
      unitName: 'Karton',
      conversionFactor: 24,
      buyPrice: 192000,
      minQty: 2,
      mode: 'overwrite',
      source: 'import',
    });
    const row = await priceRow(vendorId, variantId, 'Karton');
    expect(row?.buy_price).toBe(192000);
    expect(row?.min_qty).toBe(2);
    expect(row?.notes).toBe('import');
  });

  it('gap-only keeps an existing agreement and fills only the empty slot', async () => {
    const { vendorId, variantId } = await seeded();
    await upsertVendorPrice(exec, {
      vendorId,
      variantId,
      unitName: 'Pcs',
      conversionFactor: 1,
      buyPrice: 8000,
      mode: 'overwrite',
      source: 'katalog vendor',
    });
    await upsertVendorPrice(exec, {
      vendorId,
      variantId,
      unitName: 'Pcs',
      conversionFactor: 1,
      buyPrice: 6500,
      mode: 'gap-only',
      source: 'penerimaan barang',
    });
    expect((await priceRow(vendorId, variantId, 'Pcs'))?.buy_price).toBe(8000);
    await upsertVendorPrice(exec, {
      vendorId,
      variantId,
      unitName: 'Lusin',
      conversionFactor: 12,
      buyPrice: 90000,
      mode: 'gap-only',
      source: 'penerimaan barang',
    });
    expect((await priceRow(vendorId, variantId, 'Lusin'))?.buy_price).toBe(90000);
  });

  it('skips a zero or blank price instead of writing a free-goods agreement', async () => {
    const { vendorId, variantId } = await seeded();
    await upsertVendorPrice(exec, {
      vendorId,
      variantId,
      unitName: 'Pcs',
      conversionFactor: 1,
      buyPrice: 0,
      mode: 'overwrite',
      source: 'form produk',
    });
    await upsertVendorPrice(exec, {
      vendorId,
      variantId,
      unitName: '  ',
      conversionFactor: 1,
      buyPrice: 5000,
      mode: 'overwrite',
      source: 'form produk',
    });
    const rows = await run<{ n: number }>(
      `SELECT COUNT(*) AS n FROM vendor_price_list WHERE vendor_id = $1`,
      [vendorId]
    );
    expect(Number(rows[0].n)).toBe(0);
  });
});

describe('defaultVendorFor', () => {
  const vendors = [
    { id: 'v-1', status: 'active' },
    { id: 'v-2', status: 'active' },
    { id: 'v-tutup', status: 'blacklisted' },
  ];

  it('prefers the preferred vendor over the product main vendor', () => {
    expect(
      defaultVendorFor({ preferredVendorId: 'v-2', supplierId: 'v-1', vendorIds: ['v-1', 'v-2'] }, vendors)
    ).toBe('v-2');
  });

  it('falls back to the main vendor, then to a sole catalogue link', () => {
    expect(defaultVendorFor({ supplierId: 'v-1', vendorIds: ['v-1', 'v-2'] }, vendors)).toBe('v-1');
    expect(defaultVendorFor({ vendorIds: ['v-2'] }, vendors)).toBe('v-2');
  });

  it('refuses to guess between several vendors without a preference', () => {
    expect(defaultVendorFor({ vendorIds: ['v-1', 'v-2'] }, vendors)).toBeNull();
  });

  it('skips a vendor that is not active', () => {
    expect(defaultVendorFor({ preferredVendorId: 'v-tutup', supplierId: 'v-1' }, vendors)).toBe('v-1');
    expect(defaultVendorFor({ preferredVendorId: 'v-tutup' }, vendors)).toBeNull();
  });

  it('keeps an id that is not in the list rather than losing the answer', () => {
    expect(defaultVendorFor({ supplierId: 'v-lain' }, vendors)).toBe('v-lain');
  });

  it('is null for a product without any vendor reference', () => {
    expect(defaultVendorFor({}, vendors)).toBeNull();
    expect(defaultVendorFor(null, vendors)).toBeNull();
    expect(defaultVendorFor({ supplierId: 'v-1' }, null)).toBe('v-1');
  });
});
