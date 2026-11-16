/**
 * Grouping rules of the flat "vendor + product" sheet.
 *
 * These rules decide what the importer will write, and they are the part a
 * person gets wrong in Excel: a vendor repeated with different casing, a product
 * spanning several pack rows, a sheet that lists only cartons. Each case below
 * is a file shape that has actually been handed over.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { BulkRow } from './bulk-io';
import { VENDOR_PRODUCT_COLUMNS, keepValid, normalizeRows, readRows } from './bulk-io';
import {
  distinctProductCount,
  groupVendorProductRows,
  planVendorProductImport,
  type ImportUniverse,
} from './vendor-import';

/** A sheet line, written as the column keys so a test reads like the sheet. */
function row(partial: Partial<BulkRow>): BulkRow {
  const blank: BulkRow = {};
  for (const column of VENDOR_PRODUCT_COLUMNS) blank[column.key] = '';
  return { ...blank, ...partial };
}

describe('groupVendorProductRows', () => {
  it('groups several lines of one vendor and one product into packs', () => {
    const groups = groupVendorProductRows([
      row({
        vendorCode: 'VND-0001',
        vendorName: 'PT Sumber Makmur',
        sku: 'KOP-001',
        productName: 'Kopi Sachet',
        productCategory: 'Minuman',
        price: '1000',
        unit: 'Pcs',
        factor: '1',
        buyPrice: '700',
        minOrder: '10',
        vendorSku: 'KS-1',
      }),
      row({
        vendorCode: 'VND-0001',
        vendorName: 'PT Sumber Makmur',
        sku: 'KOP-001',
        productName: 'Kopi Sachet',
        price: '15000',
        unit: 'Karton',
        factor: '24',
        buyPrice: '15000',
        minOrder: '1',
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].vendor.name).toBe('PT Sumber Makmur');
    expect(groups[0].vendor.rowCount).toBe(2);
    expect(groups[0].products).toHaveLength(1);
    const product = groups[0].products[0];
    expect(product.packs.map((pack) => pack.unitName)).toEqual(['Pcs', 'Karton']);
    expect(product.packs[1].conversionFactor).toBe(24);
    // The base pack is the product summary the table and the catalogue row use.
    expect(product.cost).toBe(700);
    expect(product.price).toBe(1000);
    expect(product.packs[0].minOrderQty).toBe(10);
    expect(product.packs[0].vendorSku).toBe('KS-1');
  });

  it('matches a vendor by code first, and by name case-insensitively', () => {
    const groups = groupVendorProductRows([
      row({ vendorCode: 'vnd-0002', vendorName: 'PT A', productName: 'Teh' }),
      row({ vendorCode: 'VND-0002', vendorName: 'pt a', productName: 'Jeruk' }),
      row({ vendorName: ' PT   B ', productName: 'Gula' }),
      row({ vendorName: 'pt b', productName: 'Garam' }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].vendor.key).toBe('code:VND-0002');
    expect(groups[0].vendor.code).toBe('VND-0002');
    expect(groups[0].products.map((product) => product.name)).toEqual(['Teh', 'Jeruk']);
    expect(groups[1].vendor.name).toBe('PT B');
    expect(groups[1].products).toHaveLength(2);
  });

  it('keeps the same SKU under two vendors as two pieces of work', () => {
    const groups = groupVendorProductRows([
      row({ vendorName: 'PT Satu', sku: 'S-1', productName: 'Kopi' }),
      row({ vendorName: 'PT Dua', sku: 'S-1', productName: 'Kopi' }),
    ]);
    expect(groups).toHaveLength(2);
    // One product exists in the catalogue, but two vendor rows have to be
    // written, so the counts answer different questions.
    expect(distinctProductCount(groups)).toBe(1);
    expect(groups.reduce((sum, group) => sum + group.products.length, 0)).toBe(2);
  });

  it('treats a line without product fields as a vendor on its own', () => {
    const [group] = groupVendorProductRows([
      row({ vendorCode: 'VND-0003', vendorName: 'CV Baru Saja', terms: '14', category: '' }),
    ]);
    expect(group.products).toHaveLength(0);
    expect(group.vendor.paymentTermsDays).toBe(14);
  });

  it('links by product name when the SKU column is left blank', () => {
    const groups = groupVendorProductRows([
      row({ vendorName: 'PT A', productName: 'Susu Kotak', unit: 'Pcs', buyPrice: '5000' }),
      row({ vendorName: 'PT A', productName: 'susu kotak', unit: 'Lusin', factor: '12', buyPrice: '55000' }),
    ]);
    expect(groups[0].products).toHaveLength(1);
    expect(groups[0].products[0].sku).toBeNull();
    expect(groups[0].products[0].packs).toHaveLength(2);
  });

  it('drops lines with no vendor identity at all', () => {
    expect(groupVendorProductRows([row({ productName: 'Tanpa Vendor' })])).toHaveLength(0);
  });

  it('requires a factor-1 pack, synthesising it from a carton-only sheet', () => {
    const [group] = groupVendorProductRows([
      row({
        vendorName: 'PT A',
        sku: 'K-1',
        productName: 'Kopi',
        unit: 'Karton',
        factor: '24',
        buyPrice: '168000',
        price: '200000',
      }),
    ]);
    const product = group.products[0];
    expect(product.packs.map((pack) => pack.conversionFactor)).toEqual([1, 24]);
    expect(product.packs[0].unitName).toBe('Pcs');
    expect(product.packs[0].buyPrice).toBe(168000);
    expect(product.cost).toBe(168000);
  });

  it('does not duplicate a pack repeated on two lines, and merges its blanks', () => {
    const [group] = groupVendorProductRows([
      row({ vendorName: 'PT A', sku: 'K-1', productName: 'Kopi', unit: 'Pcs', buyPrice: '700' }),
      row({ vendorName: 'PT A', sku: 'K-1', productName: 'Kopi', unit: 'pcs', minOrder: '5', vendorSku: 'V-9' }),
    ]);
    const product = group.products[0];
    expect(product.packs).toHaveLength(1);
    expect(product.packs[0].buyPrice).toBe(700);
    expect(product.packs[0].minOrderQty).toBe(5);
    expect(product.packs[0].vendorSku).toBe('V-9');
  });

  it('reads Indonesian money and blank numeric cells', () => {
    const [group] = groupVendorProductRows([
      row({
        vendorName: 'PT A',
        sku: 'K-1',
        productName: 'Kopi',
        price: 'Rp 1.000',
        buyPrice: 'Rp 700',
        stock: '1.000',
        minStock: '',
        factor: '-',
      }),
    ]);
    const product = group.products[0];
    expect(product.price).toBe(1000);
    expect(product.cost).toBe(700);
    expect(product.stock).toBe(1000);
    expect(product.minStock).toBe(0);
    expect(product.packs[0].conversionFactor).toBe(1);
  });

  it('takes vendor blanks from the first line that fills them', () => {
    const [group] = groupVendorProductRows([
      row({ vendorName: 'PT A', phone: '', productName: 'Kopi' }),
      row({ vendorName: 'PT A', phone: '0812', contactPerson: 'Budi', productName: 'Teh' }),
    ]);
    expect(group.vendor.phone).toBe('0812');
    expect(group.vendor.contactPerson).toBe('Budi');
  });
});

describe('VENDOR_PRODUCT_COLUMNS', () => {
  it('is the single header source for template, export and import', () => {
    const headers = normalizeRows(
      [Object.fromEntries(VENDOR_PRODUCT_COLUMNS.map((column) => [column.label, 'x']))],
      VENDOR_PRODUCT_COLUMNS
    )[0];
    for (const column of VENDOR_PRODUCT_COLUMNS) {
      expect(headers[column.key]).toBe('x');
    }
    expect(VENDOR_PRODUCT_COLUMNS.map((column) => column.label)).toEqual([
      'Kode Vendor',
      'Nama Vendor',
      'Kategori Vendor',
      'Kontak',
      'Telepon',
      'Email',
      'Termin (hari)',
      'SKU',
      'Nama Produk',
      'Kategori Produk',
      'Harga Jual',
      'Stok Awal',
      'Stok Minimum',
      'Satuan',
      'Faktor',
      'Harga Beli',
      'Min Order',
      'Vendor SKU',
    ]);
  });

  it('normalises a header row written in lower case with stray spaces', () => {
    const [normalized] = normalizeRows(
      [{ 'nama  vendor': 'PT A', 'harga  beli': '700', 'satuan': 'Pcs' }],
      VENDOR_PRODUCT_COLUMNS
    );
    expect(normalized.vendorName).toBe('PT A');
    expect(normalized.buyPrice).toBe('700');
    expect(normalized.unit).toBe('Pcs');
  });
});

/**
 * What a sheet is allowed to change.
 *
 * The planner decides this before anything is written, so the preview a person
 * confirms and the transaction that follows cannot disagree. Every case below
 * is one of the two policies the owner locked: masters are additive, prices
 * follow the sheet.
 */
describe('planVendorProductImport', () => {
  /** A database holding one vendor, one product with a Pcs + Karton pack. */
  function universe(overrides: Partial<ImportUniverse> = {}): ImportUniverse {
    return {
      vendors: [{ id: 'v1', name: 'PT Sumber Makmur', code: 'VND-0001' }],
      products: [
        {
          id: 'p1',
          sku: 'KOP-001',
          name: 'Kopi Sachet',
          packs: [
            { variantId: 'var1', unitName: 'Pcs', conversionFactor: 1 },
            { variantId: 'var1', unitName: 'Karton', conversionFactor: 24 },
          ],
        },
      ],
      links: [{ vendorId: 'v1', productId: 'p1', isPreferred: true }],
      prices: [{ vendorId: 'v1', variantId: 'var1', unitName: 'Pcs' }],
      ...overrides,
    };
  };

  it('plans a new vendor and a new product, claiming the preference', () => {
    const plan = planVendorProductImport(
      groupVendorProductRows([
        row({
          vendorCode: 'VND-0009',
          vendorName: 'CV Baru',
          sku: 'GUL-010',
          productName: 'Gula Pasir 1kg',
          unit: 'Pcs',
          factor: '1',
          buyPrice: '14000',
        }),
      ]),
      universe(),
      { priceMode: 'overwrite' }
    );

    expect(plan.vendors[0].isNew).toBe(true);
    expect(plan.vendors[0].vendorId).toBeNull();
    const product = plan.vendors[0].products[0];
    expect(product.action).toBe('create');
    expect(product.productId).toBeNull();
    expect(product.claimPreference).toBe(true);
    expect(product.packs[0].action).toBe('overwrite');
    expect(plan.summary).toMatchObject({ newVendors: 1, newProducts: 1, priceOverwrites: 1 });
  });

  it('resolves an existing vendor by code even when the sheet spells the name differently', () => {
    const plan = planVendorProductImport(
      groupVendorProductRows([
        row({ vendorCode: 'vnd-0001', vendorName: 'pt sumber   makmur', productName: 'Kopi Sachet' }),
      ]),
      universe(),
      { priceMode: 'overwrite' }
    );
    expect(plan.vendors[0].isNew).toBe(false);
    expect(plan.vendors[0].vendorId).toBe('v1');
    expect(plan.summary.existingVendors).toBe(1);
  });

  it('links a product by SKU instead of duplicating it, and still writes its price rows', () => {
    const plan = planVendorProductImport(
      groupVendorProductRows([
        row({
          vendorCode: 'VND-0001',
          vendorName: 'PT Sumber Makmur',
          sku: 'kop-001',
          productName: 'Kopi Sachet',
          unit: 'Pcs',
          factor: '1',
          buyPrice: '750',
        }),
        row({
          vendorCode: 'VND-0001',
          vendorName: 'PT Sumber Makmur',
          sku: 'kop-001',
          productName: 'Kopi Sachet',
          unit: 'Karton',
          factor: '24',
          buyPrice: '16000',
        }),
      ]),
      universe(),
      { priceMode: 'overwrite' }
    );

    const product = plan.vendors[0].products[0];
    expect(product.action).toBe('catalogue');
    expect(product.productId).toBe('p1');
    expect(product.alreadyLinked).toBe(true);
    // Each quoted pack lands on the variant/pack the product really has.
    expect(product.packs.map((pack) => [pack.unitName, pack.variantId, pack.action])).toEqual([
      ['Pcs', 'var1', 'overwrite'],
      ['Karton', 'var1', 'fill'],
    ]);
    expect(plan.summary).toMatchObject({
      newProducts: 0,
      linkedProducts: 1,
      priceOverwrites: 1,
      priceFills: 1,
    });
  });

  it('reuses a product by name when the SKU column was left blank', () => {
    const plan = planVendorProductImport(
      groupVendorProductRows([
        row({
          vendorCode: 'VND-0002',
          vendorName: 'PT Kedua',
          productName: '  kopi sachet ',
          unit: 'Pcs',
          buyPrice: '800',
        }),
      ]),
      universe(),
      { priceMode: 'gap-only' }
    );
    const product = plan.vendors[0].products[0];
    expect(product.action).toBe('catalogue');
    expect(product.productId).toBe('p1');
    expect(product.packs[0].action).toBe('fill');
  });

  it('never proposes to replace a negotiated price without the key', () => {
    // `v1 / var1 / Pcs` already has an agreement in the universe above.
    const rows = [
      row({
        vendorCode: 'VND-0001',
        vendorName: 'PT Sumber Makmur',
        sku: 'KOP-001',
        productName: 'Kopi Sachet',
        unit: 'Pcs',
        factor: '1',
        buyPrice: '99999',
      }),
    ];
    const groups = groupVendorProductRows(rows);

    const gapOnly = planVendorProductImport(groups, universe(), { priceMode: 'gap-only' });
    expect(gapOnly.vendors[0].products[0].packs[0].action).toBe('skip');
    expect(gapOnly.summary.priceOverwrites).toBe(0);

    const overwrite = planVendorProductImport(groups, universe(), { priceMode: 'overwrite' });
    expect(overwrite.vendors[0].products[0].packs[0].action).toBe('overwrite');
    expect(overwrite.summary.priceOverwrites).toBe(1);
    // Same sheet, same intent: the number the buyer may not step on is the
    // difference the permission makes.
    expect(overwrite.vendors[0].products[0].packs[0].buyPrice).toBe(
      gapOnly.vendors[0].products[0].packs[0].buyPrice
    );
  });

  it('marks a re-import of an existing catalogue row as already linked', () => {
    const plan = planVendorProductImport(
      groupVendorProductRows([
        row({
          vendorCode: 'VND-0001',
          vendorName: 'PT Sumber Makmur',
          sku: 'KOP-001',
          productName: 'Kopi Sachet',
          unit: 'Pcs',
          buyPrice: '750',
        }),
      ]),
      universe(),
      { priceMode: 'overwrite' }
    );
    expect(plan.vendors[0].products[0].alreadyLinked).toBe(true);

    // The same line under a vendor that has never listed it is new work.
    const other = planVendorProductImport(
      groupVendorProductRows([
        row({
          vendorCode: 'VND-0002',
          vendorName: 'PT Kedua',
          sku: 'KOP-001',
          productName: 'Kopi Sachet',
          unit: 'Pcs',
          buyPrice: '750',
        }),
      ]),
      universe(),
      { priceMode: 'overwrite' }
    );
    expect(other.vendors[0].products[0].alreadyLinked).toBe(false);
  });

  it('leaves an existing preference alone: an import never moves is_preferred', () => {
    const groups = groupVendorProductRows([
      row({ vendorCode: 'VND-0003', vendorName: 'PT Ketiga', sku: 'KOP-001', productName: 'Kopi Sachet' }),
    ]);
    const preferredElsewhere = planVendorProductImport(groups, universe(), {
      priceMode: 'overwrite',
    });
    expect(preferredElsewhere.vendors[0].products[0].claimPreference).toBe(false);

    const nobodyPrefers = planVendorProductImport(
      groups,
      universe({ links: [] }),
      { priceMode: 'overwrite' }
    );
    expect(nobodyPrefers.vendors[0].products[0].claimPreference).toBe(true);
  });

  it('skips a pack the stored product does not sell rather than editing its template', () => {
    const plan = planVendorProductImport(
      groupVendorProductRows([
        row({
          vendorCode: 'VND-0001',
          vendorName: 'PT Sumber Makmur',
          sku: 'KOP-001',
          productName: 'Kopi Sachet',
          unit: 'Pcs',
          factor: '1',
          buyPrice: '750',
        }),
        row({
          vendorCode: 'VND-0001',
          vendorName: 'PT Sumber Makmur',
          sku: 'KOP-001',
          productName: 'Kopi Sachet',
          unit: 'Drum',
          factor: '200',
          buyPrice: '100000',
        }),
      ]),
      universe(),
      { priceMode: 'overwrite' }
    );
    const product = plan.vendors[0].products[0];
    // Adding "Drum" to someone else's product template is `manage_variants` work
    // on the product screen, never a side effect of a price sheet.
    expect(product.packs.map((pack) => pack.unitName)).toEqual(['Pcs']);
    expect(product.skippedPacks).toEqual(['Drum']);
    expect(plan.summary.skippedPacks).toBe(1);
  });

  it('counts a vendor-only line, and ignores a price the sheet left blank', () => {
    const plan = planVendorProductImport(
      groupVendorProductRows([
        row({ vendorCode: 'VND-0001', vendorName: 'PT Sumber Makmur' }),
        row({
          vendorCode: 'VND-0004',
          vendorName: 'PT Empang',
          sku: 'TEH-001',
          productName: 'Teh Celup',
          unit: 'Pcs',
        }),
      ]),
      universe(),
      { priceMode: 'overwrite' }
    );
    expect(plan.summary.vendorOnlyRows).toBe(1);
    const created = plan.vendors[1].products[0];
    expect(created.action).toBe('create');
    expect(created.packs[0].action).toBe('skip');
    expect(plan.summary.priceOverwrites).toBe(0);
  });
});

/**
 * The end-to-end fixture, checked as data rather than as a screen flow: the
 * browser case in `tests/vendor-catalog.e2e.ts` only works while this sheet
 * still parses into the two vendors, three products and four buy prices it
 * asserts. A column renamed or a vendor name left blank on a continuation row
 * breaks the browser run silently, so it breaks here first.
 */
describe('the vendor + product e2e fixture', () => {
  const FIXTURE = fileURLToPath(
    new URL('../../tests/fixtures/fixture_vendor_produk.csv', import.meta.url)
  );

  async function sheet() {
    const buffer = new Uint8Array(readFileSync(FIXTURE));
    // `readRows` only needs `arrayBuffer()`; the browser's File is not available
    // here, so the real reader is handed the same bytes.
    const raw = await readRows({ arrayBuffer: async () => buffer } as unknown as File);
    return normalizeRows(raw, VENDOR_PRODUCT_COLUMNS);
  }

  it('reads every flat column by its Indonesian label', async () => {
    const rows = await sheet();

    expect(rows).toHaveLength(4);
    for (const line of rows) {
      expect(Object.keys(line).sort()).toEqual(VENDOR_PRODUCT_COLUMNS.map((c) => c.key).sort());
      // The flat shape repeats the vendor on every line: a continuation row
      // without it is dropped by `keepValid` instead of extending the vendor.
      expect(line.vendorName).not.toBe('');
    }
    expect(rows[0].vendorCode).toBe('');
    expect(rows[0].productName).toBe('Tepung Terigu E2E');
    expect(rows[1].unit).toBe('Karton');
    expect(rows[1].factor).toBe('24');
    expect(rows[2].sku).toBe('GUL-E2E01');
    expect(rows[3].vendorName).toBe('CV E2E Distribusi');
  });

  it('groups into two vendors, one of them with a two-pack product', async () => {
    const { valid, invalid } = keepValid(await sheet(), ['vendorName']);
    expect(invalid).toHaveLength(0);

    const groups = groupVendorProductRows(valid);
    expect(groups.map((group) => group.vendor.name)).toEqual([
      'PT E2E Katalog Sumber',
      'CV E2E Distribusi',
    ]);
    // No code in the sheet: the writer mints one, so the plan has nothing to
    // match against and the import cannot silently reuse another vendor.
    expect(groups[0].vendor.code).toBeNull();
    expect(groups[0].products.map((product) => product.name)).toEqual([
      'Tepung Terigu E2E',
      'Gula Pasir E2E',
    ]);
    expect(groups[0].products[0].packs.map((pack) => `${pack.unitName}x${pack.conversionFactor}`)).toEqual(
      ['Pcsx1', 'Kartonx24']
    );
    expect(groups[0].products[0].cost).toBe(9000);
    expect(groups[1].products[0].packs).toHaveLength(1);
    expect(distinctProductCount(groups)).toBe(3);
  });

  it('plans three new products and one buy price per pack on an empty tenant', async () => {
    const groups = groupVendorProductRows(await sheet());
    const empty: ImportUniverse = { vendors: [], products: [], links: [], prices: [] };

    const plan = planVendorProductImport(groups, empty, { priceMode: 'overwrite' });
    expect(plan.summary.newVendors).toBe(2);
    expect(plan.summary.newProducts).toBe(3);
    expect(plan.summary.linkedProducts).toBe(0);
    expect(plan.summary.priceOverwrites).toBe(4);
    expect(plan.summary.priceFills).toBe(0);
    expect(plan.summary.skippedPacks).toBe(0);
    expect(plan.vendors[0].products[0].claimPreference).toBe(true);
  });
});
