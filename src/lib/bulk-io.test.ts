import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_COLUMNS,
  PRODUCT_COLUMNS,
  keepValid,
  normalizeRows,
  parseIdNumber,
  resolveCollisions,
  toCsv,
} from './bulk-io';

describe('normalizeRows', () => {
  it('maps Indonesian labels and aliases onto canonical keys', () => {
    const [row] = normalizeRows(
      [{ 'Nama Produk': 'Kopi', 'Harga Jual': '10000', 'unknown': 'x' }],
      PRODUCT_COLUMNS
    );
    expect(row.name).toBe('Kopi');
    expect(row.price).toBe('10000');
    expect(row).not.toHaveProperty('unknown');
  });

  it('accepts English aliases and ignores header casing/spacing', () => {
    const [row] = normalizeRows([{ '  nama ': 'Tepung', SKU: 'T-1' }], PRODUCT_COLUMNS);
    expect(row.name).toBe('Tepung');
    expect(row.sku).toBe('T-1');
  });

  it('fills every configured column, even when absent in the sheet', () => {
    const [row] = normalizeRows([{ Nama: 'A' }], CUSTOMER_COLUMNS);
    expect(row).toEqual({ name: 'A', phone: '', email: '', address: '', notes: '' });
  });
});

describe('parseIdNumber', () => {
  it('reads a plain integer', () => {
    expect(parseIdNumber('10000')).toBe(10000);
  });

  it('reads Indonesian money with Rp, a thousands dot and a comma decimal', () => {
    expect(parseIdNumber('Rp 1.000,5')).toBe(1000.5);
    expect(parseIdNumber('1.234.567')).toBe(1234567);
  });

  it('returns 0 for empty or non-numeric cells', () => {
    expect(parseIdNumber('')).toBe(0);
    expect(parseIdNumber('-')).toBe(0);
  });

  it('passes numbers through', () => {
    expect(parseIdNumber(42)).toBe(42);
  });
});

describe('toCsv', () => {
  it('prepends a UTF-8 BOM so Excel opens Indonesian text correctly', () => {
    const csv = toCsv([{ code: 'VND-1', name: 'A' }], PRODUCT_COLUMNS.slice(0, 0));
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('quotes cells containing commas, quotes or newlines', () => {
    const columns = [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B' },
    ];
    const csv = toCsv([{ a: 'x,y', b: 'say "hi"' }], columns);
    expect(csv).toContain('"x,y"');
    expect(csv).toContain('"say ""hi"""');
  });
});

describe('resolveCollisions', () => {
  const rows = [
    { sku: 'AAA' },
    { sku: '' },
    { sku: 'bbb' },
    { sku: 'AAA' },
    { sku: 'CCC' },
  ];
  const call = () =>
    resolveCollisions({
      incoming: rows,
      keysOf: (r) => [r.sku],
      existingKeys: new Set(['bbb']),
    });

  it('keeps blank-identity rows so the screen can auto-generate an id', () => {
    const { fresh } = call();
    expect(fresh.map((r) => r.sku)).toContain('');
  });

  it('flags a key that already exists in the database', () => {
    const { conflicts } = call();
    expect(conflicts.find((c) => c.row.sku === 'bbb')?.reason).toBe('existing');
  });

  it('is case-insensitive against the database', () => {
    const { conflicts } = resolveCollisions({
      incoming: [{ name: 'Toko' }],
      keysOf: (r) => [r.name],
      existingKeys: new Set(['toko']),
    });
    expect(conflicts[0]?.reason).toBe('existing');
  });

  it('flags a repeat inside the same file', () => {
    const { conflicts } = call();
    expect(conflicts.find((c) => c.row.sku === 'AAA' && c.reason === 'duplicate_in_file')).toBeTruthy();
  });

  it('treats any matching key of a multi-key row as a conflict', () => {
    const { conflicts } = resolveCollisions({
      incoming: [{ code: 'VND-1', name: 'Lama' }],
      keysOf: (r) => [r.code, r.name],
      existingKeys: new Set(['lama']),
    });
    expect(conflicts[0]?.reason).toBe('existing');
  });
});

describe('keepValid', () => {
  it('splits rows missing a required field', () => {
    const { valid, invalid } = keepValid(
      [{ name: 'A', phone: '' }, { name: '', phone: '1' }],
      ['name']
    );
    expect(valid).toHaveLength(1);
    expect(invalid).toHaveLength(1);
  });
});
