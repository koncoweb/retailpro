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
import {
  VENDOR_PRODUCT_COLUMNS,
  VENDOR_PRODUCT_TEMPLATE_ROWS,
  VENDOR_SHEET_KEYS,
  keepValid,
  normalizeRows,
  readRows,
} from './bulk-io';
import {
  carryVendorForward,
  distinctProductCount,
  expandProductCodes,
  groupVendorProductRows,
  planVendorProductImport,
  variantWriteRow,
  type ImportUniverse,
} from './vendor-import';

/** A sheet line, written as the column keys so a test reads like the sheet. */
function row(partial: Partial<BulkRow>): BulkRow {
  const blank: BulkRow = {};
  for (const column of VENDOR_PRODUCT_COLUMNS) blank[column.key] = '';
  return { ...blank, ...partial };
}

/** An empty tenant: everything the sheet names still has to be made. */
function emptyUniverse(): ImportUniverse {
  return { vendors: [], products: [], links: [], prices: [] };
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
      // Appended last so a file written before rich variants keeps its columns.
      'Kode Varian',
      'Atribut Varian',
      'Barcode Varian',
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

/**
 * The two pre-processors the dialog runs BEFORE `keepValid`, so a sheet can be
 * written the way a purchasing person writes one: the vendor stated once above a
 * block of products, and one price line applied to several codes at once.
 */
describe('carryVendorForward', () => {
  it('fills a product-only line from the vendor above it', () => {
    const [first, second] = carryVendorForward([
      row({
        vendorCode: 'VND-0001',
        vendorName: 'PT Sumber Makmur',
        phone: '0811',
        terms: '30',
        sku: 'KOP-001',
        productName: 'Kopi',
      }),
      row({ sku: 'GUL-002', productName: 'Gula', unit: 'Pcs', factor: '1', buyPrice: '14000' }),
    ]);

    expect(first.vendorName).toBe('PT Sumber Makmur');
    expect(second.vendorName).toBe('PT Sumber Makmur');
    expect(second.vendorCode).toBe('VND-0001');
    expect(second.phone).toBe('0811');
    expect(second.terms).toBe('30');
    // Only the vendor columns travel; a line's product columns are its own.
    expect(second.productName).toBe('Gula');
    expect(second.sku).toBe('GUL-002');
  });

  it('lets a continuation line survive keepValid and join one vendor block', () => {
    const rows = carryVendorForward([
      row({ vendorCode: 'VND-0001', vendorName: 'PT Sumber Makmur', sku: 'KOP-001' }),
      row({ sku: 'GUL-002' }),
      row({ sku: 'TER-003' }),
    ]);
    const { valid, invalid } = keepValid(rows, ['vendorName']);
    expect(invalid).toHaveLength(0);

    const groups = groupVendorProductRows(valid);
    expect(groups).toHaveLength(1);
    expect(groups[0].vendor.rowCount).toBe(3);
    expect(groups[0].products.map((product) => product.sku)).toEqual([
      'KOP-001',
      'GUL-002',
      'TER-003',
    ]);
  });

  it('keeps a line that names no product invalid, so a blank row cannot duplicate a vendor', () => {
    const rows = carryVendorForward([
      // The first line has nothing above it to inherit from.
      row({ sku: 'KOP-001' }),
      row({ vendorCode: 'VND-0001', vendorName: 'PT Sumber Makmur', sku: 'GUL-002' }),
      // A line with neither a vendor nor a product is left exactly as it is.
      row({}),
    ]);

    expect(rows[0].vendorName).toBe('');
    expect(rows[2].vendorName).toBe('');
    const { valid, invalid } = keepValid(rows, ['vendorName']);
    expect(valid).toHaveLength(1);
    expect(invalid).toHaveLength(2);
  });
});

describe('expandProductCodes', () => {
  it('splits one cell holding several codes into one line per code', () => {
    const rows = expandProductCodes([
      row({
        vendorCode: 'VND-0001',
        vendorName: 'PT Sumber Makmur',
        sku: 'KOP-001;GUL-002|TER-003',
        productName: 'Kopi Sachet',
        productCategory: 'Minuman',
        unit: 'Pcs',
        factor: '1',
        buyPrice: '700',
      }),
    ]);

    expect(rows.map((line) => line.sku)).toEqual(['KOP-001', 'GUL-002', 'TER-003']);
    // The name described ONE product. Copying it onto three would invent three
    // look-alikes, so a split line only ever links codes that already exist.
    expect(rows.every((line) => line.productName === '' && line.productCategory === '')).toBe(
      true
    );
    expect(rows[1].buyPrice).toBe('700');
    expect(rows[1].vendorCode).toBe('VND-0001');
  });

  it('leaves a single code, and everything about it, untouched', () => {
    const [only] = expandProductCodes([
      row({ sku: ' KOP-001 ', productName: 'Kopi Sachet', unit: 'Pcs' }),
    ]);
    expect(only.sku).toBe('KOP-001');
    expect(only.productName).toBe('Kopi Sachet');
  });

  it('does not split on a comma, which means a thousands separator here', () => {
    const rows = expandProductCodes([row({ sku: 'KOP-001,GUL-002' })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].sku).toBe('KOP-001,GUL-002');
  });

  it('reports an unknown code instead of creating a product for it', () => {
    const rows = expandProductCodes([
      row({
        vendorCode: 'VND-0009',
        vendorName: 'CV Baru',
        sku: 'KOP-001;XYZ-404',
        unit: 'Pcs',
        factor: '1',
        buyPrice: '900',
      }),
    ]);
    const known: ImportUniverse = {
      vendors: [{ id: 'v1', name: 'PT Sumber Makmur', code: 'VND-0001' }],
      products: [
        {
          id: 'p1',
          sku: 'KOP-001',
          name: 'Kopi Sachet',
          packs: [{ variantId: 'var1', unitName: 'Pcs', conversionFactor: 1 }],
        },
      ],
      links: [],
      prices: [],
    };
    const plan = planVendorProductImport(groupVendorProductRows(rows), known, {
      priceMode: 'overwrite',
    });

    expect(plan.summary.unknownCodes).toBe(1);
    expect(plan.summary.newProducts).toBe(0);
    expect(plan.vendors[0].products.map((product) => product.action).sort()).toEqual([
      'catalogue',
      'unknown-code',
    ]);
    const unknown = plan.vendors[0].products.find(
      (product) => product.seed.sku === 'XYZ-404'
    );
    expect(unknown?.packs).toHaveLength(0);
  });
});

/**
 * The defect the two new columns fix: `Pcs` exists once per flavour, so a price
 * sheet that only says `Pcs` used to reprice whichever variant the query
 * returned first.
 */
describe('variant-targeted pricing', () => {
  const multiUniverse = (): ImportUniverse => ({
    vendors: [{ id: 'v1', name: 'PT Sumber Makmur', code: 'VND-0001' }],
    products: [
      {
        id: 'p1',
        sku: 'KOP-001',
        name: 'Kopi Sachet',
        packs: [
          { variantId: 'var-susu', unitName: 'Pcs', conversionFactor: 1 },
          { variantId: 'var-hitam', unitName: 'Pcs', conversionFactor: 1 },
          { variantId: 'var-hitam', unitName: 'Karton', conversionFactor: 24 },
        ],
        variants: [
          { id: 'var-susu', sku: 'KOP-001-SUSU', attributeKey: 'rasa=susu' },
          { id: 'var-hitam', sku: 'KOP-001-HITAM', attributeKey: 'rasa=hitam' },
        ],
      },
    ],
    links: [],
    prices: [],
  });

  const line = (partial: Partial<BulkRow>) =>
    row({ vendorCode: 'VND-0001', vendorName: 'PT Sumber Makmur', sku: 'KOP-001', ...partial });

  it('prices the variant the line names, by code', () => {
    const plan = planVendorProductImport(
      groupVendorProductRows([line({ unit: 'Pcs', factor: '1', buyPrice: '900', variantSku: 'KOP-001-HITAM' })]),
      multiUniverse(),
      { priceMode: 'overwrite' }
    );
    const product = plan.vendors[0].products[0];
    expect(product.packs.map((pack) => [pack.unitName, pack.variantId, pack.action])).toEqual([
      ['Pcs', 'var-hitam', 'fill'],
    ]);
    expect(product.ambiguousVariants).toHaveLength(0);
  });

  it('prices the variant the line names, by attributes', () => {
    const plan = planVendorProductImport(
      groupVendorProductRows([
        line({ unit: 'Pcs', factor: '1', buyPrice: '900', variantAttrs: 'Rasa=Susu' }),
      ]),
      multiUniverse(),
      { priceMode: 'overwrite' }
    );
    expect(plan.vendors[0].products[0].packs[0].variantId).toBe('var-susu');
  });

  it('reports a line that names none of several variants, and writes no price', () => {
    const plan = planVendorProductImport(
      groupVendorProductRows([line({ unit: 'Pcs', factor: '1', buyPrice: '900' })]),
      multiUniverse(),
      { priceMode: 'overwrite' }
    );
    const product = plan.vendors[0].products[0];
    expect(product.packs).toHaveLength(0);
    expect(product.ambiguousVariants[0]).toContain('sebutkan Kode Varian');
    expect(plan.summary.ambiguousVariants).toBe(1);
    expect(plan.summary.priceFills).toBe(0);
  });

  it('treats a price-less line on a multi-variant product as a plain link', () => {
    const plan = planVendorProductImport(
      groupVendorProductRows([line({})]),
      multiUniverse(),
      { priceMode: 'overwrite' }
    );
    const product = plan.vendors[0].products[0];
    // Nothing on the sheet asks for a price, so nothing was dropped: reporting an
    // ambiguity here would tell the user to fill a column the row never needed.
    expect(product.packs).toHaveLength(0);
    expect(product.skippedPacks).toHaveLength(0);
    expect(product.ambiguousVariants).toHaveLength(0);
    expect(plan.summary.ambiguousVariants).toBe(0);
    expect(plan.summary.linkedProducts).toBe(1);
  });

  it('says so when the named code is not one of the product', () => {
    const plan = planVendorProductImport(
      groupVendorProductRows([
        line({ unit: 'Pcs', factor: '1', buyPrice: '900', variantSku: 'KOP-001-LEZAT' }),
      ]),
      multiUniverse(),
      { priceMode: 'overwrite' }
    );
    expect(plan.vendors[0].products[0].ambiguousVariants[0]).toContain(
      'tidak ada di produk ini'
    );
  });

  it('looks for the pack inside the named variant only', () => {
    const plan = planVendorProductImport(
      groupVendorProductRows([
        line({ unit: 'Karton', factor: '24', buyPrice: '20000', variantSku: 'KOP-001-HITAM' }),
      ]),
      multiUniverse(),
      { priceMode: 'overwrite' }
    );
    // `Karton` exists for Hitam, so the line lands on Hitam's own pack row.
    expect(plan.vendors[0].products[0].packs.map((pack) => pack.variantId)).toEqual([
      'var-hitam',
    ]);
  });

  it('refuses to attach a pack to a variant that does not sell it', () => {
    const plan = planVendorProductImport(
      groupVendorProductRows([
        line({ unit: 'Karton', factor: '24', buyPrice: '20000', variantSku: 'KOP-001-SUSU' }),
      ]),
      multiUniverse(),
      { priceMode: 'overwrite' }
    );
    const product = plan.vendors[0].products[0];
    // Hitam sells `Karton`; Susu does not. Copying the pack across would edit a
    // product template this sheet has no business touching.
    expect(product.skippedPacks).toEqual(['Karton']);
    expect(product.packs.map((pack) => pack.variantId)).not.toContain('var-hitam');
  });

  it('still matches by unit name for a product with exactly one variant', () => {
    const single = multiUniverse();
    single.products[0].variants = [
      { id: 'var-susu', sku: 'KOP-001-SUSU', attributeKey: 'rasa=susu' },
    ];
    const plan = planVendorProductImport(
      groupVendorProductRows([line({ unit: 'Pcs', factor: '1', buyPrice: '900' })]),
      single,
      { priceMode: 'overwrite' }
    );
    // One variant means no ambiguity: a sheet written before the two new columns
    // keeps pricing it exactly as it always did.
    expect(plan.vendors[0].products[0].packs.map((pack) => pack.variantId)).toEqual([
      'var-susu',
    ]);
  });

  it('never writes a synthesised base pack onto a product that already exists', () => {
    const plan = planVendorProductImport(
      groupVendorProductRows([
        line({ unit: 'Karton', factor: '24', buyPrice: '20000', variantSku: 'KOP-001-HITAM' }),
      ]),
      multiUniverse(),
      { priceMode: 'overwrite' }
    );
    const product = plan.vendors[0].products[0];
    // The grouper also invents a `Pcs` line, priced with the carton's number, so
    // a NEW product still has a base pack. `Pcs` of Hitam does exist, and writing
    // that figure would turn Rp 20.000/box into a single-unit buy price.
    expect(product.packs.map((pack) => pack.unitName)).toEqual(['Karton']);
    expect(plan.summary.priceFills).toBe(1);
  });
});

/**
 * The authoring rule of the sheet: ONE vendor per file, told once on its first
 * row. It binds what the app GENERATES — the template, and the one-vendor export
 * built from the same columns — and it rejects nothing: a file that repeats its
 * vendor on every line, or holds several vendors, still plans what it always
 * planned. That is what keeps `fixture_vendor_produk.csv` and the catalogue
 * export working untouched.
 */
describe('one vendor per file', () => {
  const empty: ImportUniverse = { vendors: [], products: [], links: [], prices: [] };

  it('templates one vendor, named on the first row only', () => {
    const stated = VENDOR_PRODUCT_TEMPLATE_ROWS.filter(
      (line) => line.vendorCode.trim() !== '' || line.vendorName.trim() !== ''
    );
    expect(stated).toHaveLength(1);
    expect(VENDOR_PRODUCT_TEMPLATE_ROWS.indexOf(stated[0])).toBe(0);
    expect(stated[0].vendorCode).toBe('VND-9999');
    expect(stated[0].vendorName).toBe('PT Contoh Vendor');
  });

  it('leaves the vendor row free of product columns', () => {
    const first = VENDOR_PRODUCT_TEMPLATE_ROWS[0];
    const productColumns = VENDOR_PRODUCT_COLUMNS.filter(
      (column) => !VENDOR_SHEET_KEYS.includes(column.key)
    );
    expect(productColumns.length).toBeGreaterThan(0);
    for (const column of productColumns) expect(first[column.key]).toBe('');
  });

  it('reads its own template back as one vendor block', () => {
    const rows = carryVendorForward(VENDOR_PRODUCT_TEMPLATE_ROWS);
    const { valid, invalid } = keepValid(rows, ['vendorName']);
    expect(invalid).toHaveLength(0);

    const groups = groupVendorProductRows(valid);
    expect(groups).toHaveLength(1);
    expect(groups[0].vendor.name).toBe('PT Contoh Vendor');
    expect(groups[0].vendor.rowCount).toBe(VENDOR_PRODUCT_TEMPLATE_ROWS.length);
    // Products and variants are unbounded because each costs a row, never a
    // column: two products, three variants, six quoted packs.
    expect(groups[0].products.map((product) => product.sku)).toEqual([
      'CONTOH-001',
      'CONTOH-002',
    ]);
    expect(distinctProductCount(groups)).toBe(2);

    const plan = planVendorProductImport(groups, empty, { priceMode: 'overwrite' });
    expect(plan.summary.newVendors).toBe(1);
    expect(plan.summary.existingVendors).toBe(0);
    expect(plan.summary.newProducts).toBe(2);
  });

  it('blanks exactly the columns the importer inherits', () => {
    // The one-vendor export clears `VENDOR_SHEET_KEYS` below its first row and
    // `carryVendorForward` refills precisely those. Two lists that drifted apart
    // would export a file whose product rows lose their vendor.
    expect(
      VENDOR_SHEET_KEYS.every((key) => VENDOR_PRODUCT_COLUMNS.some((c) => c.key === key))
    ).toBe(true);

    const rows = carryVendorForward([
      row({
        vendorCode: 'VND-0001',
        vendorName: 'PT Sumber Makmur',
        vendorCategory: 'supplier',
        contactPerson: 'Ibu Rina',
        phone: '0812',
        email: 'rina@sumber.id',
        terms: '14',
        sku: 'KOP-001',
        productName: 'Kopi Sachet',
      }),
      row({ sku: 'GUL-002', productName: 'Gula Pasir', unit: 'Pcs', factor: '1', buyPrice: '14000' }),
    ]);
    for (const key of VENDOR_SHEET_KEYS) expect(rows[1][key]).not.toBe('');
    // Nothing else travels down: a line's product columns are its own.
    expect(rows[1].sku).toBe('GUL-002');
    expect(rows[1].productName).toBe('Gula Pasir');
    expect(rows[1].buyPrice).toBe('14000');
  });

  it('still plans every vendor of an old file that repeats them', () => {
    const plan = planVendorProductImport(
      groupVendorProductRows([
        row({ vendorName: 'PT E2E Katalog Sumber', sku: 'KOP-001', productName: 'Kopi', unit: 'Pcs', factor: '1', buyPrice: '900' }),
        row({ vendorName: 'CV E2E Distribusi', sku: 'KOP-001', productName: 'Kopi', unit: 'Pcs', factor: '1', buyPrice: '800' }),
      ]),
      empty,
      { priceMode: 'overwrite' }
    );
    expect(plan.vendors).toHaveLength(2);
    expect(plan.summary.newVendors).toBe(2);
    // The same product under two vendors is two agreements, not one.
    expect(plan.summary.newProducts).toBe(2);
  });
});

/**
 * A vendor sheet may now bring a variant template, not only a price — but only
 * for a caller that grants it. Every expectation WITHOUT `mayCreateVariants` is
 * what the planner produced before the option existed: turning a lost price into
 * a write is the whole change, and it is opt-in.
 */
describe('creating the variants a vendor sheet names', () => {
  const variantUniverse = (): ImportUniverse => ({
    vendors: [{ id: 'v1', name: 'PT Sumber Makmur', code: 'VND-0001' }],
    products: [
      {
        id: 'p1',
        sku: 'KOP-001',
        name: 'Kopi Sachet',
        packs: [
          { variantId: 'var-susu', unitName: 'Pcs', conversionFactor: 1 },
          { variantId: 'var-hitam', unitName: 'Pcs', conversionFactor: 1 },
          { variantId: 'var-hitam', unitName: 'Karton', conversionFactor: 24 },
        ],
        variants: [
          { id: 'var-susu', sku: 'KOP-001-SUSU', attributeKey: 'rasa=susu', attributes: { Rasa: 'Susu' } },
          { id: 'var-hitam', sku: 'KOP-001-HITAM', attributeKey: 'rasa=hitam', attributes: { Rasa: 'Hitam' } },
        ],
      },
    ],
    links: [],
    prices: [],
  });

  const line = (partial: Partial<BulkRow>) =>
    row({
      vendorCode: 'VND-0001',
      sku: 'KOP-001',
      unit: 'Pcs',
      factor: '1',
      buyPrice: '1200',
      ...partial,
    });

  /** The same sheet line, planned with and without the permission. */
  const bothWays = (partial: Partial<BulkRow>) => ({
    allowed: planVendorProductImport(groupVendorProductRows([line(partial)]), variantUniverse(), {
      priceMode: 'overwrite',
      mayCreateVariants: true,
    }),
    denied: planVendorProductImport(groupVendorProductRows([line(partial)]), variantUniverse(), {
      priceMode: 'overwrite',
    }),
  });

  it('makes the variant a line names, and its price rides along', () => {
    const { allowed, denied } = bothWays({ variantAttrs: 'Rasa=Latte' });

    const product = allowed.vendors[0].products[0];
    expect(product.newVariants).toHaveLength(1);
    const seed = product.newVariants[0];
    expect(seed.attributeKey).toBe('rasa=latte');
    expect(seed.matchedVariantId).toBeNull();
    // The buy price is no longer dropped: it belongs to the row being created.
    expect(seed.packs.map((pack) => [pack.unitName, pack.variantId, pack.action, pack.buyPrice])).toEqual(
      [['Pcs', null, 'create', 1200]]
    );
    // A brand-new combination is a new value on an axis the product already has.
    expect(product.variantGroups).toEqual([{ name: 'Rasa', values: ['Latte'] }]);
    expect(product.ambiguousVariants).toHaveLength(0);
    expect(allowed.summary.newVariants).toBe(1);
    expect(allowed.summary.newPacks).toBe(1);
    expect(allowed.summary.ambiguousVariants).toBe(0);

    // Without the permission the file means exactly what it always meant.
    const before = denied.vendors[0].products[0];
    expect(before.newVariants).toHaveLength(0);
    expect(before.packs).toHaveLength(0);
    expect(before.ambiguousVariants[0]).toContain('tidak ada di produk ini');
    expect(denied.summary.newVariants).toBe(0);
    expect(denied.summary.newPacks).toBe(0);
    expect(denied.summary.ambiguousVariants).toBe(1);
    // The preview gains the reason why, and nothing else changes.
    expect(before.blockedVariantWrites).toEqual(['Pcs']);
    expect(denied.vendors[0].products[0].variantGroups).toEqual([]);
  });

  it('adds a pecahan to a variant that exists instead of skipping it', () => {
    const { allowed, denied } = bothWays({ variantSku: 'KOP-001-HITAM', unit: 'Slop', factor: '12', buyPrice: '14000' });

    const product = allowed.vendors[0].products[0];
    expect(product.newVariants).toHaveLength(1);
    const seed = product.newVariants[0];
    // An existing variant is addressed, not duplicated: the writer only appends.
    expect(seed.matchedVariantId).toBe('var-hitam');
    expect(seed.attributeKey).toBe('rasa=hitam');
    expect(seed.packs.map((pack) => [pack.unitName, pack.conversionFactor, pack.variantId])).toEqual([
      ['Slop', 12, 'var-hitam'],
    ]);
    expect(product.skippedPacks).toHaveLength(0);
    // A pack of a variant that exists is not a new variant.
    expect(allowed.summary.newVariants).toBe(0);
    expect(allowed.summary.newPacks).toBe(1);
    expect(product.variantGroups).toEqual([]);

    const before = denied.vendors[0].products[0];
    expect(before.skippedPacks).toEqual(['Slop']);
    expect(before.blockedVariantWrites).toEqual(['Slop']);
    expect(denied.summary.skippedPacks).toBe(1);
    expect(denied.summary.newPacks).toBe(0);
  });

  it('never guesses a variant a line does not name, permission or not', () => {
    const { allowed, denied } = bothWays({});
    for (const plan of [allowed, denied]) {
      const product = plan.vendors[0].products[0];
      // KS-55: `Pcs` exists once per flavour, and picking one would reprice a
      // flavour the sheet never mentioned. Permission cannot buy a guess.
      expect(product.newVariants).toHaveLength(0);
      expect(product.packs).toHaveLength(0);
      expect(product.ambiguousVariants[0]).toContain('sebutkan Kode Varian');
      expect(plan.summary.ambiguousVariants).toBe(1);
      expect(plan.summary.newVariants).toBe(0);
    }
    // A line that named nothing has no permission to blame.
    expect(allowed.vendors[0].products[0].blockedVariantWrites).toEqual([]);
  });

  it('carries the barcode of a variant down to the row being written', () => {
    const plan = planVendorProductImport(
      groupVendorProductRows([
        line({ variantAttrs: 'Rasa=Latte', unit: 'Karton', factor: '24', buyPrice: '28000', barcode: '8993000000200' }),
      ]),
      variantUniverse(),
      { priceMode: 'overwrite', mayCreateVariants: true }
    );
    const seed = plan.vendors[0].products[0].newVariants[0];
    expect(seed.barcode).toBe('8993000000200');
    // A carton-only line quotes no single-unit price, so the base stays neutral
    // rather than promoting Rp 28.000 to "the price of one".
    const write = variantWriteRow(seed);
    expect(write.barcode).toBe('8993000000200');
    expect(write.unitName).toBe('Pcs');
    expect(write.cost).toBe(0);
    expect(write.packs).toEqual([{ unitName: 'Karton', conversionFactor: 24, cost: 28000, price: 0 }]);
  });

  it('brings a variant template when it creates the product', () => {
    const plan = planVendorProductImport(
      groupVendorProductRows([
        row({ vendorCode: 'VND-0001', sku: 'BARU-001', productName: 'Kopi Latte Baru', unit: 'Pcs', factor: '1', buyPrice: '1000', variantAttrs: 'Rasa=Susu', barcode: '8991000000011', stock: '60' }),
        row({ vendorCode: 'VND-0001', sku: 'BARU-001', unit: 'Pcs', factor: '1', buyPrice: '1100', variantAttrs: 'Rasa=Hitam' }),
        row({ vendorCode: 'VND-0001', sku: 'BARU-001', unit: 'Karton', factor: '24', buyPrice: '24000', variantAttrs: 'Rasa=Hitam' }),
      ]),
      emptyUniverse(),
      { priceMode: 'overwrite', mayCreateVariants: true }
    );
    const product = plan.vendors[0].products[0];
    expect(product.action).toBe('create');
    // One variant row per combination the lines name, in the order they came.
    expect(product.variants.map((seed) => seed.attributeKey)).toEqual(['rasa=susu', 'rasa=hitam']);
    expect(product.variants[0].barcode).toBe('8991000000011');
    expect(product.variants[1].packs.map((pack) => pack.unitName)).toEqual(['Pcs', 'Karton']);
    // Opening stock is stated once, for the product, and lands on the first variant.
    expect(product.variants.map((seed) => seed.stock)).toEqual([60, 0]);
    expect(product.variantGroups).toEqual([{ name: 'Rasa', values: ['Susu', 'Hitam'] }]);
    // `newVariants` is only for products that already exist.
    expect(product.newVariants).toHaveLength(0);
  });

  it('still makes one flat variant for a sheet that names none', () => {
    const plan = planVendorProductImport(
      groupVendorProductRows([
        row({ vendorCode: 'VND-0001', sku: 'BARU-002', productName: 'Tepung Baru', unit: 'Pcs', factor: '1', buyPrice: '8000', stock: '10' }),
        row({ vendorCode: 'VND-0001', sku: 'BARU-002', unit: 'Karton', factor: '10', buyPrice: '76000' }),
      ]),
      emptyUniverse(),
      { priceMode: 'overwrite', mayCreateVariants: true }
    );
    const product = plan.vendors[0].products[0];
    // The file a vendor shipped before these columns existed writes exactly the
    // rows it always wrote: one axis-less variant, both packs, no attribute list.
    expect(product.variants).toHaveLength(1);
    expect(product.variants[0].attributeKey).toBe('');
    expect(product.variants[0].barcode).toBeNull();
    expect(product.variantGroups).toEqual([]);
    expect(product.variants[0].packs.map((pack) => pack.unitName)).toEqual(['Pcs', 'Karton']);
  });
});
