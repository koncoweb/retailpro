import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_COLUMNS,
  PRODUCT_COLUMNS,
  PRODUCT_TEMPLATE_ROWS,
  VENDOR_COLUMNS,
  VENDOR_PRODUCT_COLUMNS,
  VENDOR_PRODUCT_TEMPLATE_ROWS,
  VENDOR_SHEET_KEYS,
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

describe('VENDOR_PRODUCT_COLUMNS', () => {
  it('writes a header row that reads back as the same keys', () => {
    const csv = toCsv(VENDOR_PRODUCT_TEMPLATE_ROWS, VENDOR_PRODUCT_COLUMNS);
    const header = csv.replace(/^\uFEFF/, '').split('\r\n')[0];
    expect(header).toBe(VENDOR_PRODUCT_COLUMNS.map((c) => c.label).join(','));
  });

  it('round-trips a template row through its header labels', () => {
    for (const template of VENDOR_PRODUCT_TEMPLATE_ROWS) {
      // A sheet is header-keyed, the screen code is key-keyed: the template has
      // to survive that translation unchanged, or an exported catalogue could
      // never be imported back.
      const byLabel: Record<string, string> = {};
      for (const column of VENDOR_PRODUCT_COLUMNS) {
        byLabel[column.label] = template[column.key] ?? '';
      }
      const [read] = normalizeRows([byLabel], VENDOR_PRODUCT_COLUMNS);
      for (const column of VENDOR_PRODUCT_COLUMNS) {
        expect(read[column.key]).toBe(byLabel[column.label]);
      }
    }
  });

  it('keeps vendor identity apart from product identity', () => {
    // "Kode" alone is the vendor's, "SKU" is the product's: a sheet header must
    // never be ambiguous between the two masters on the same line.
    const [read] = normalizeRows(
      [{ Kode: 'VND-1', SKU: 'P-1', 'Nama Vendor': 'PT A', 'Nama Produk': 'Kopi' }],
      VENDOR_PRODUCT_COLUMNS
    );
    expect(read.vendorCode).toBe('VND-1');
    expect(read.sku).toBe('P-1');
    expect(read.vendorName).toBe('PT A');
    expect(read.productName).toBe('Kopi');
  });

  it('does not shadow the vendor-only columns', () => {
    const vendorKeys = VENDOR_COLUMNS.map((column) => column.key);
    expect(vendorKeys).toContain('code');
    expect(VENDOR_PRODUCT_COLUMNS.map((column) => column.key)).not.toContain('code');
  });

  it('appends the variant columns last, in order, after the seven vendor ones', () => {
    // Column order is only load-bearing for file stability: a sheet exported
    // before these columns existed still lines up with its own header, so new
    // columns may only ever be appended.
    expect(VENDOR_PRODUCT_COLUMNS).toHaveLength(21);
    expect(VENDOR_PRODUCT_COLUMNS.slice(0, 7).map((column) => column.key)).toEqual([
      ...VENDOR_SHEET_KEYS,
    ]);
    expect(VENDOR_PRODUCT_COLUMNS.slice(-3).map((column) => column.label)).toEqual([
      'Kode Varian',
      'Atribut Varian',
      'Barcode Varian',
    ]);
  });

  it('gives every template row all 21 keys', () => {
    // A missing key would make `toCsv` write an empty cell the importer reads
    // back as blank — and `carryVendorForward` cannot inherit a key that is not
    // there, so a row typed with holes silently loses its vendor.
    const keys = VENDOR_PRODUCT_COLUMNS.map((column) => column.key).sort();
    for (const template of VENDOR_PRODUCT_TEMPLATE_ROWS) {
      expect(Object.keys(template).sort()).toEqual(keys);
    }
  });

  it('reads a variant barcode by its label and its aliases', () => {
    const rows = normalizeRows(
      [{ 'Barcode Varian': '8993000000101' }, { 'Kode Batang': '8993000000118' }],
      VENDOR_PRODUCT_COLUMNS
    );
    expect(rows[0].barcode).toBe('8993000000101');
    // A barcode column is not an attribute column: a sheet may name the flavour
    // either way, and a number must never be read as `Rasa=...`.
    expect(rows[0].variantAttrs).toBe('');
    expect(rows[1].barcode).toBe('8993000000118');
  });
});

/**
 * The rich product sheet. Its column config is the single header source for the
 * template, the export and the import, so all three have to agree exactly.
 */
describe('PRODUCT_COLUMNS', () => {
  it('keeps the eight original columns first, so an old file still imports', () => {
    expect(PRODUCT_COLUMNS.slice(0, 8).map((column) => column.key)).toEqual([
      'sku',
      'name',
      'category',
      'price',
      'cost',
      'stock',
      'minStock',
      'supplier',
    ]);
  });

  it('writes a header row that reads back as the same keys', () => {
    const csv = toCsv(PRODUCT_TEMPLATE_ROWS, PRODUCT_COLUMNS);
    const header = csv.replace(/^\uFEFF/, '').split('\r\n')[0];
    expect(header).toBe(PRODUCT_COLUMNS.map((c) => c.label).join(','));
  });

  it('round-trips every template row through its header labels', () => {
    for (const template of PRODUCT_TEMPLATE_ROWS) {
      // Export writes labels, import reads keys: an exported sheet has to come
      // back byte-for-byte, or "export, edit in Excel, import" loses the matrix.
      const byLabel: Record<string, string> = {};
      for (const column of PRODUCT_COLUMNS) {
        byLabel[column.label] = template[column.key] ?? '';
      }
      const [read] = normalizeRows([byLabel], PRODUCT_COLUMNS);
      for (const column of PRODUCT_COLUMNS) {
        expect(read[column.key]).toBe(byLabel[column.label]);
      }
    }
  });

  it('reads the attribute cell as one column and the variant code as another', () => {
    const [read] = normalizeRows(
      [{ 'Kode Varian': 'KOP-001-SUSU', 'Atribut Varian': 'Rasa=Susu;Ukuran=250ml' }],
      PRODUCT_COLUMNS
    );
    expect(read.variantSku).toBe('KOP-001-SUSU');
    expect(read.variantAttrs).toBe('Rasa=Susu;Ukuran=250ml');
  });

  it('keeps "Kode" the product SKU, and gives the vendor only its own column', () => {
    // On this sheet a bare `Kode` has always meant the product. Aliasing it to
    // the vendor code too would silently re-point every old file's first column.
    const product = PRODUCT_COLUMNS.find((column) => column.key === 'sku');
    const vendor = PRODUCT_COLUMNS.find((column) => column.key === 'vendorCode');
    expect(product?.aliases).toContain('kode');
    expect(vendor?.aliases).not.toContain('kode');
    expect(vendor?.aliases).toContain('kode vendor');

    const [read] = normalizeRows([{ Kode: 'KOP-001', 'Kode Vendor': 'VND-1' }], PRODUCT_COLUMNS);
    expect(read.sku).toBe('KOP-001');
    expect(read.vendorCode).toBe('VND-1');
  });
});
