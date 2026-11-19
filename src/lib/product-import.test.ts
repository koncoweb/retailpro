/**
 * What the rich product sheet means, decided before anything is written.
 *
 * The sheet is long and flat — one line per (variant x pack) — because that is
 * the only shape a person can actually fill in for a product with thirty
 * flavours. Everything that makes that shape ambiguous is settled here: which
 * lines belong to one product, which to one variant, what an attribute cell
 * tolerates, and what an existing SKU is allowed to change.
 *
 * Each case below is a file shape that has been handed over, or a mistake an
 * operator makes in Excel. The writer (`product-write.ts`) executes whatever
 * this decides; nothing here touches the database.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { BulkRow } from './bulk-io';
import { PRODUCT_COLUMNS, PRODUCT_TEMPLATE_ROWS, normalizeRows, readRows, toCsv } from './bulk-io';
import {
  groupProductRows,
  planProductImport,
  type ExistingImportProduct,
  type ProductImportUniverse,
} from './product-import';
import { variantKey } from './variants';

/** A sheet line, written as the column keys so a test reads like the sheet. */
function row(partial: Partial<BulkRow>): BulkRow {
  const blank: BulkRow = {};
  for (const column of PRODUCT_COLUMNS) blank[column.key] = '';
  return { ...blank, ...partial };
}

/** The Kopi Sachet of the fixtures: two axes, one of them with a carton. */
function matrixRows(): BulkRow[] {
  const base = { sku: 'KOP-001', name: 'Kopi Sachet', category: 'Minuman', supplier: 'PT A' };
  return [
    row({
      ...base,
      variantAttrs: 'Rasa=Susu;Ukuran=250ml',
      price: '1000',
      cost: '700',
      stock: '200',
      unit: 'Pcs',
      factor: '1',
    }),
    row({
      ...base,
      variantAttrs: 'Rasa=Susu;Ukuran=250ml',
      price: '22000',
      cost: '16000',
      unit: 'Karton',
      factor: '24',
    }),
    row({
      ...base,
      variantAttrs: 'Rasa=Hitam;Ukuran=250ml',
      price: '1100',
      cost: '750',
      stock: '150',
      unit: 'Pcs',
      factor: '1',
    }),
  ];
}

describe('groupProductRows', () => {
  it('groups the lines of one product into variants, each with its packs', () => {
    const seeds = groupProductRows(matrixRows());

    expect(seeds).toHaveLength(1);
    const product = seeds[0];
    expect(product.sku).toBe('KOP-001');
    expect(product.rowCount).toBe(3);
    expect(product.variantGroups.map((group) => [group.name, group.values])).toEqual([
      ['Rasa', ['Susu', 'Hitam']],
      ['Ukuran', ['250ml']],
    ]);
    expect(product.variants.map((variant) => variant.label)).toEqual(['Susu 250ml', 'Hitam 250ml']);
    expect(product.variants[0].packs.map((pack) => `${pack.unitName}x${pack.conversionFactor}`)).toEqual(
      ['Pcsx1', 'Kartonx24']
    );
    expect(product.variants[0].stock).toBe(200);
    // Opening stock belongs to the variant the line named, never to the model.
    expect(product.variants[1].stock).toBe(150);
  });

  it('keys a variant by attributes, so the same flavour written twice is one variant', () => {
    const [product] = groupProductRows([
      row({ sku: 'KOP-001', variantAttrs: 'Rasa=Susu;Ukuran=250ml', price: '1000', unit: 'Pcs' }),
      // Different axis order inside the cell, same combination.
      row({ sku: 'KOP-001', variantAttrs: 'Ukuran=250ml;Rasa=Susu', unit: 'Karton', factor: '24' }),
    ]);
    expect(product.variants).toHaveLength(1);
    expect(product.variants[0].key).toBe('rasa=susu|ukuran=250ml');
    expect(product.variants[0].packs).toHaveLength(2);
  });

  it('accepts the separators and spellings a person actually types', () => {
    const [product] = groupProductRows([
      row({ sku: 'A', variantAttrs: 'Rasa=Susu|Ukuran=250ml' }),
      row({ sku: 'A', variantAttrs: 'Rasa:Hitam\r\nUkuran:250ml' }),
      row({ sku: 'A', variantAttrs: 'Rasa=Susu; Ukuran=100ml ;' }),
    ]);
    expect(product.variants.map((variant) => variant.key)).toEqual([
      'rasa=susu|ukuran=250ml',
      'rasa=hitam|ukuran=250ml',
      'rasa=susu|ukuran=100ml',
    ]);
    expect(product.variantGroups.map((group) => group.values)).toEqual([
      ['Susu', 'Hitam'],
      ['250ml', '100ml'],
    ]);
  });

  it('treats a blank, "Default" or "-" cell as a product without axes', () => {
    const [product] = groupProductRows([
      row({ sku: 'A', variantAttrs: '' }),
      row({ sku: 'A', variantAttrs: 'Default' }),
      row({ sku: 'A', variantAttrs: '-' }),
    ]);
    expect(product.variants).toHaveLength(1);
    expect(product.variants[0].key).toBe('');
    expect(product.variantGroups).toEqual([]);
  });

  it('names a variant by its typed code when the attribute cell was left out', () => {
    const [product] = groupProductRows([
      row({ sku: 'KOP-001', variantSku: 'KOP-001-LUXU', price: '1000', unit: 'Pcs' }),
      row({ sku: 'KOP-001', variantSku: 'KOP-001-MURAH', price: '500', unit: 'Pcs' }),
    ]);
    // Two codes the app has no axes for: still two variants, keyed by code.
    expect(product.variants.map((variant) => variant.sku)).toEqual(['KOP-001-LUXU', 'KOP-001-MURAH']);
    expect(product.variants.map((variant) => variant.key)).toEqual(['', '']);
    expect(product.variantGroups).toEqual([]);
  });

  it('takes the first line that carries a field, so a repeated column is a no-op', () => {
    const [product] = groupProductRows([
      row({ sku: 'A', name: 'Kopi', category: 'Minuman', minStock: '20' }),
      row({ sku: 'A', name: '', category: '', minStock: '' }),
      row({ sku: 'A', name: 'KOPI SACHET', category: 'Lainnya', minStock: '5' }),
    ]);
    expect(product.name).toBe('Kopi');
    expect(product.category).toBe('Minuman');
    expect(product.minStock).toBe(20);
  });

  it('gives every variant a factor-1 pack, made from its own priced line', () => {
    const [product] = groupProductRows([
      row({ sku: 'A', variantAttrs: 'Rasa=Susu', unit: 'Karton', factor: '24', cost: '16000' }),
    ]);
    expect(product.variants[0].packs.map((pack) => pack.conversionFactor)).toEqual([1, 24]);
    expect(product.variants[0].packs[0].unitName).toBe('Pcs');
  });

  it('reports a code and an attribute cell that disagree instead of guessing', () => {
    const [product] = groupProductRows([
      row({ sku: 'KOP-001', variantSku: 'KOP-001-LAIN', variantAttrs: 'Rasa=Susu', unit: 'Pcs' }),
    ]);
    // The file's code wins — it is what the operator typed on purpose — but the
    // disagreement has to reach the preview, never be smoothed over.
    expect(product.variants[0].sku).toBe('KOP-001-LAIN');
    expect(product.notes.join(' ')).toContain('KOP-001-LAIN');
    expect(product.notes.join(' ')).toContain('KOP-001-SUSU');
  });

  it('reports two vendor codes on one product instead of merging them silently', () => {
    const [product] = groupProductRows([
      row({ sku: 'A', vendorCode: 'VND-0001', variantAttrs: 'Rasa=Susu' }),
      row({ sku: 'A', vendorCode: 'VND-0002', variantAttrs: 'Rasa=Hitam' }),
    ]);
    expect(product.vendorCode).toBe('VND-0001');
    expect(product.notes.join(' ')).toContain('VND-0002');
  });

  it('drops a line with neither a code nor a name', () => {
    expect(groupProductRows([row({ price: '1000' })])).toEqual([]);
  });

  it('regroups the shipped template into two products and three variants', async () => {
    // Template -> CSV bytes -> the reader the browser uses -> the seeds. If this
    // ever stops parsing, the file the owner downloads is not the file the
    // importer reads, and the round trip silently loses the matrix.
    const csv = toCsv(PRODUCT_TEMPLATE_ROWS, PRODUCT_COLUMNS);
    const buffer = new TextEncoder().encode(csv);
    const raw = await readRows({ arrayBuffer: async () => buffer } as unknown as File);
    const seeds = groupProductRows(normalizeRows(raw, PRODUCT_COLUMNS));

    expect(seeds.map((seed) => seed.sku)).toEqual(['CONTOH-001', 'CONTOH-002']);
    expect(seeds[1].variants.map((variant) => variant.label)).toEqual(['Susu 250ml', 'Hitam 250ml']);
    expect(seeds[1].variants[0].packs.map((pack) => pack.unitName)).toEqual(['Pcs', 'Karton']);
    expect(seeds[1].vendorCode).toBe('VND-9999');
    expect(seeds.flatMap((seed) => seed.notes)).toEqual([]);
  });
});

/** The database behind the tests below: one product, one flavour, one pack. */
function universe(overrides: Partial<ProductImportUniverse> = {}): ProductImportUniverse {
  const stored: ExistingImportProduct = {
    id: 'p1',
    sku: 'KOP-001',
    name: 'Kopi Sachet',
    variants: [{ id: 'var1', sku: 'KOP-001-SUSU', attributeKey: 'rasa=susu' }],
    packs: [{ variantId: 'var1', unitName: 'Pcs', conversionFactor: 1 }],
  };
  return {
    products: [stored],
    vendors: [{ id: 'v1', name: 'PT A', code: 'VND-0001' }],
    links: [{ vendorId: 'v1', productId: 'p1', isPreferred: true }],
    prices: [{ vendorId: 'v1', variantId: 'var1', unitName: 'Pcs' }],
    ...overrides,
  };
}

describe('planProductImport', () => {
  const empty: ProductImportUniverse = {
    products: [],
    vendors: [],
    links: [],
    prices: [],
  };

  it('plans the whole matrix of a new product on an empty tenant', () => {
    const plan = planProductImport(groupProductRows(matrixRows()), empty, {
      priceMode: 'overwrite',
    });
    const product = plan.products[0];

    expect(product.action).toBe('create');
    expect(product.mintSku).toBe(false);
    expect(product.variants).toHaveLength(2);
    expect(plan.summary).toMatchObject({
      newProducts: 1,
      extendedProducts: 0,
      newVariants: 2,
      newPacks: 3,
      priceOverwrites: 3,
      conflicts: 0,
    });
    // The derived code is what the writer stores when the sheet left it blank.
    expect(product.variants[0].sku).toBe('KOP-001-SUSU-250ML');
  });

  it('extends an existing SKU instead of dropping the line — the policy change', () => {
    const [seed] = groupProductRows([
      ...matrixRows().map((line) => row({ ...line, variantAttrs: 'Rasa=Hitam' })),
    ]);
    const plan = planProductImport([seed], universe(), { priceMode: 'overwrite' });
    const product = plan.products[0];

    expect(product.action).toBe('extend');
    expect(product.productId).toBe('p1');
    expect(product.variants[0].action).toBe('create');
    expect(plan.summary.extendedProducts).toBe(1);
    // Extending adds: it never proposes a rename of the master it found.
    expect(plan.summary.newProducts).toBe(0);
  });

  it('matches a variant by its stored code before its attributes', () => {
    const [seed] = groupProductRows([
      // A flavour whose code was retyped on the product screen: the code in the
      // file is the stored one, the attribute cell is the old spelling.
      row({ sku: 'KOP-001', variantSku: 'KOP-001-SUSU', variantAttrs: '', unit: 'Pcs', cost: '800' }),
    ]);
    const plan = planProductImport([seed], universe(), { priceMode: 'overwrite' });
    expect(plan.products[0].variants[0]).toMatchObject({
      action: 'match',
      variantId: 'var1',
      reason: 'kode varian',
    });
  });

  it('matches a variant whose code changed but whose attributes are the same', () => {
    const renamed = universe();
    renamed.products[0].variants = [{ id: 'var1', sku: 'KOP-001-ENAK', attributeKey: 'rasa=susu' }];
    const [seed] = groupProductRows([
      row({ sku: 'KOP-001', variantAttrs: 'Rasa=Susu', unit: 'Pcs', cost: '800' }),
    ]);
    const plan = planProductImport([seed], renamed, { priceMode: 'overwrite' });
    // The sheet quoted the old code, which nobody owns any more; the flavour is
    // still the same one, and a second row beside it would be a duplicate.
    expect(plan.products[0].variants[0]).toMatchObject({ action: 'match', variantId: 'var1' });
  });

  it('reports a variant code another product already owns as a conflict', () => {
    const two = universe();
    two.products.push({
      id: 'p2',
      sku: 'SUSU-001',
      name: 'Susu Kotak',
      variants: [{ id: 'var9', sku: 'KOP-001-SUSU', attributeKey: 'rasa=susu-kotak' }],
      packs: [],
    });
    const [seed] = groupProductRows([
      row({ sku: 'TEH-001', name: 'Teh', variantSku: 'KOP-001-SUSU', unit: 'Pcs', cost: '800' }),
    ]);
    const plan = planProductImport([seed], two, { priceMode: 'overwrite' });
    const variant = plan.products[0].variants[0];

    expect(variant.action).toBe('conflict');
    expect(variant.reason).toContain('sudah dipakai produk lain');
    expect(plan.summary.conflicts).toBe(1);
    // A conflict writes nothing at all: no variant row, no price row.
    expect(variant.packs).toEqual([]);
  });

  it('only replaces a negotiated buy price when the overwrite key was given', () => {
    const [seed] = groupProductRows([
      row({
        sku: 'KOP-001',
        variantAttrs: 'Rasa=Susu',
        unit: 'Pcs',
        cost: '800',
        vendorCode: 'VND-0001',
      }),
    ]);
    const gapOnly = planProductImport([seed], universe(), { priceMode: 'gap-only' });
    expect(gapOnly.products[0].variants[0].packs[0].action).toBe('skip');
    expect(gapOnly.summary.priceOverwrites).toBe(0);

    const overwrite = planProductImport([seed], universe(), { priceMode: 'overwrite' });
    expect(overwrite.products[0].variants[0].packs[0].action).toBe('overwrite');
    expect(overwrite.summary.priceOverwrites).toBe(1);

    // The same line for a vendor with no price yet is a fill, in both modes.
    const nobody = universe({ prices: [] });
    expect(
      planProductImport([seed], nobody, { priceMode: 'gap-only' }).products[0].variants[0].packs[0]
        .action
    ).toBe('fill');
  });

  it('counts a missing buy price as something to write, so it can be filled', () => {
    // The case a live preview showed: the product, the flavour and the pack all
    // exist, only the vendor's agreed price is missing. `nochange` would have
    // disabled the button and the gap would have stayed open forever.
    const [seed] = groupProductRows([
      row({
        sku: 'KOP-001',
        variantAttrs: 'Rasa=Susu',
        unit: 'Pcs',
        factor: '1',
        cost: '800',
        vendorCode: 'VND-0001',
      }),
    ]);
    const plan = planProductImport([seed], universe({ prices: [] }), { priceMode: 'gap-only' });
    const product = plan.products[0];

    expect(product.variants[0].action).toBe('match');
    expect(product.variants[0].packs[0].action).toBe('fill');
    expect(product.adds).toBe(0);
    expect(product.priceWrites).toBe(1);
    expect(product.action).toBe('extend');
    expect(plan.summary).toMatchObject({ extendedProducts: 1, unchangedProducts: 0, priceFills: 1 });
  });

  it('promises no buy price for a line that names no vendor', () => {
    // A buy price belongs to a vendor. With neither `Kode Vendor` nor `Supplier`
    // the number still lands on the pack row, but there is no price list to
    // write to, so the plan must not count one — the preview would promise a row
    // the writer could never create.
    const [seed] = groupProductRows([
      row({ sku: 'KOP-001', variantAttrs: 'Rasa=Susu', unit: 'Pcs', factor: '1', cost: '800' }),
    ]);
    const plan = planProductImport([seed], universe({ prices: [] }), { priceMode: 'gap-only' });
    const product = plan.products[0];

    expect(product.variants[0].packs[0].action).toBe('skip');
    expect(product.priceWrites).toBe(0);
    expect(product.action).toBe('nochange');
    expect(plan.summary).toMatchObject({ priceFills: 0, priceOverwrites: 0, unchangedProducts: 1 });
  });

  it('still plans the price of a new pack when the vendor itself is brand new', () => {
    const [seed] = groupProductRows([
      row({
        sku: 'KOP-001',
        variantAttrs: 'Rasa=Hitam',
        unit: 'Pcs',
        factor: '1',
        cost: '750',
        vendorCode: 'VND-0009',
      }),
    ]);
    const plan = planProductImport([seed], universe(), { priceMode: 'gap-only' });

    expect(plan.products[0].newVendor).toBe(true);
    expect(plan.products[0].variants[0].packs[0].action).toBe('fill');
  });

  it('writes no price at all for a line that carries no buy price', () => {
    const [seed] = groupProductRows([
      row({ sku: 'KOP-001', variantAttrs: 'Rasa=Susu', unit: 'Pcs', price: '1500' }),
    ]);
    const plan = planProductImport([seed], universe(), { priceMode: 'overwrite' });
    expect(plan.products[0].variants[0].packs[0].action).toBe('skip');
    expect(plan.summary.priceOverwrites).toBe(0);
  });

  it('counts a re-import of the same file as no change, adding nothing', () => {
    // The guarantee the e2e case checks by counting rows: uploading the same
    // sheet twice must not create a second anything.
    const [seed] = groupProductRows([
      row({
        sku: 'KOP-001',
        name: 'Kopi Sachet',
        variantSku: 'KOP-001-SUSU',
        variantAttrs: 'Rasa=Susu',
        unit: 'Pcs',
        factor: '1',
        cost: '700',
        vendorCode: 'VND-0001',
      }),
    ]);
    const plan = planProductImport([seed], universe(), { priceMode: 'gap-only' });

    expect(plan.products[0].action).toBe('nochange');
    expect(plan.products[0].adds).toBe(0);
    expect(plan.summary).toMatchObject({
      newProducts: 0,
      extendedProducts: 0,
      unchangedProducts: 1,
      newVariants: 0,
      newPacks: 0,
      priceFills: 0,
      priceOverwrites: 0,
    });
  });

  it('adds a pack to the matched variant only, never to another flavour', () => {
    const [seed] = groupProductRows([
      row({ sku: 'KOP-001', variantAttrs: 'Rasa=Susu', unit: 'Pcs', factor: '1', cost: '700' }),
      row({ sku: 'KOP-001', variantAttrs: 'Rasa=Susu', unit: 'Karton', factor: '24', cost: '16000' }),
      row({ sku: 'KOP-001', variantAttrs: 'Rasa=Hitam', unit: 'Pcs', factor: '1', cost: '750' }),
    ]);
    const plan = planProductImport([seed], universe(), { priceMode: 'gap-only' });
    const [susu, hitam] = plan.products[0].variants;

    expect(susu.action).toBe('match');
    expect(susu.packs.map((pack) => [pack.unitName, pack.isNewPack])).toEqual([
      ['Pcs', false],
      ['Karton', true],
    ]);
    expect(hitam.action).toBe('create');
    // The new flavour brings its own pack row; the carton is a new pack on the
    // flavour that was already there. Neither touches the stored `Pcs` of Susu.
    expect(plan.summary).toMatchObject({ newVariants: 1, newPacks: 2, matchedVariants: 1 });
  });

  it('mints a SKU only for a new product whose code column was blank', () => {
    const [seed] = groupProductRows([row({ name: 'Kopi Bubuk', unit: 'Pcs', price: '9000' })]);
    const plan = planProductImport([seed], universe(), { priceMode: 'gap-only' });

    expect(plan.products[0].action).toBe('create');
    expect(plan.products[0].mintSku).toBe(true);
    expect(plan.summary.autoSkuProducts).toBe(1);
    expect(plan.products[0].reason).toContain('SKU dibuat otomatis');
  });

  it('links an existing product by name when the sheet carried no code', () => {
    const [seed] = groupProductRows([
      row({ name: 'kopi sachet', variantAttrs: 'Rasa=Hitam', unit: 'Pcs', cost: '750' }),
    ]);
    const plan = planProductImport([seed], universe(), { priceMode: 'gap-only' });

    expect(plan.products[0].productId).toBe('p1');
    expect(plan.products[0].reason).toBe('dijodohkan lewat nama produk');
  });

  it('leaves an existing preferred vendor alone', () => {
    const [seed] = groupProductRows([
      row({ sku: 'KOP-001', variantAttrs: 'Rasa=Hitam', unit: 'Pcs', cost: '750', vendorCode: 'VND-0002' }),
    ]);
    const prefers = planProductImport([seed], universe(), { priceMode: 'gap-only' });
    expect(prefers.products[0].claimPreference).toBe(false);
    expect(prefers.products[0].newVendor).toBe(true);

    const nobody = universe({ links: [] });
    expect(planProductImport([seed], nobody, { priceMode: 'gap-only' }).products[0].claimPreference).toBe(
      true
    );
  });
});

/**
 * The rich-variant e2e fixture, checked as data rather than as a screen flow.
 *
 * `tests/bulk-import.e2e.ts` uploads this exact file and counts rows the writers
 * made from it: four variants, five packs, one buy price per pack. If a column
 * is renamed or a separator typo slips in, that browser case fails for a reason
 * nobody can see, so the sheet is parsed here first.
 */
describe('the rich variant e2e fixture', () => {
  const FIXTURE = fileURLToPath(
    new URL('../../tests/fixtures/fixture_produk_varian.csv', import.meta.url)
  );

  async function sheet() {
    const buffer = new Uint8Array(readFileSync(FIXTURE));
    // `readRows` only needs `arrayBuffer()`; the browser's File is not available
    // here, so the real reader is handed the same bytes.
    const raw = await readRows({ arrayBuffer: async () => buffer } as unknown as File);
    return normalizeRows(raw, PRODUCT_COLUMNS);
  }

  async function seed() {
    const [product] = groupProductRows(await sheet());
    return product;
  }

  it('reads all five lines by their Indonesian labels', async () => {
    const rows = await sheet();

    expect(rows).toHaveLength(5);
    for (const line of rows) {
      expect(Object.keys(line).sort()).toEqual(PRODUCT_COLUMNS.map((c) => c.key).sort());
      // Every line of a product sheet has to say which product it is about.
      expect(line.sku).toBe('E2E-KPB-01');
      // `Kode` stays the PRODUCT's code on this sheet, never the vendor's.
      expect(line.vendorCode).toBe('VND-E2E-KOPI');
    }
    expect(rows[0].name).toBe('Kopi Tubruk E2E');
    expect(rows[1].unit).toBe('Karton');
    expect(rows[1].factor).toBe('24');
    expect(rows[3].variantSku).toBe('E2E-KPB-01-HITAM-250ML');
  });

  it('groups five lines into one product with four variants and two axes', async () => {
    const product = await seed();

    expect(product.sku).toBe('E2E-KPB-01');
    expect(product.category).toBe('Minuman');
    expect(product.minStock).toBe(20);
    expect(product.rowCount).toBe(5);
    expect(product.vendorName).toBe('PT E2E Roda Kopi');
    expect(product.variantGroups).toEqual([
      { name: 'Rasa', values: ['Susu', 'Hitam'] },
      { name: 'Ukuran', values: ['250ml', '1kg'] },
    ]);
    expect(product.variants.map((variant) => variant.label)).toEqual([
      'Susu 250ml',
      'Susu 1kg',
      'Hitam 250ml',
      'Hitam 1kg',
    ]);
    // Nothing in this file is ambiguous: no line contradicts a code or a vendor.
    expect(product.notes).toEqual([]);
  });

  it('gives each variant its own packs, prices and codes', async () => {
    const product = await seed();

    expect(product.variants.map((variant) => variant.sku ?? variant.derivedSku)).toEqual([
      'E2E-KPB-01-SUSU-250ML',
      'E2E-KPB-01-SUSU-1KG',
      // Typed in the sheet, and identical to the derived code: no note, no guess.
      'E2E-KPB-01-HITAM-250ML',
      'E2E-KPB-01-HITAM-1KG',
    ]);
    expect(product.variants[0].packs.map((pack) => `${pack.unitName}x${pack.conversionFactor}`)).toEqual(
      ['Pcsx1', 'Kartonx24']
    );
    // A carton is priced as a carton, not as 24 pieces.
    expect(product.variants[0].packs.map((pack) => pack.buyPrice)).toEqual([2500, 58000]);
    expect(product.variants[1].packs).toHaveLength(1);
    expect(product.variants[3].packs).toHaveLength(1);
    // Stock is base units, so only the line that carried it holds any.
    expect(product.variants.map((variant) => variant.stock)).toEqual([120, 40, 60, 0]);
    expect(product.variants[0].barcode).toBe('8990000000011');
  });

  it('plans one new product with four variants, five packs and five buy prices', async () => {
    const empty: ProductImportUniverse = { products: [], vendors: [], links: [], prices: [] };
    const plan = planProductImport([await seed()], empty, { priceMode: 'gap-only' });

    expect(plan.products[0].action).toBe('create');
    expect(plan.products[0].mintSku).toBe(false);
    expect(plan.products[0].newVendor).toBe(true);
    expect(plan.products[0].variants.map((variant) => variant.action)).toEqual([
      'create',
      'create',
      'create',
      'create',
    ]);
    expect(plan.summary).toMatchObject({
      newProducts: 1,
      extendedProducts: 0,
      unchangedProducts: 0,
      newVariants: 4,
      newPacks: 5,
      priceFills: 5,
      priceOverwrites: 0,
      conflicts: 0,
      noteLines: 0,
    });
  });

  it('adds nothing when the same file is uploaded a second time', async () => {
    // Exactly what the e2e proves by counting rows: the sheet must resolve to
    // the product and variants the first run created, and change none of them.
    const product = await seed();
    const stored: ProductImportUniverse = {
      products: [
        {
          id: 'p1',
          sku: 'E2E-KPB-01',
          name: 'Kopi Tubruk E2E',
          variants: product.variants.map((variant, index) => ({
            id: `v${index}`,
            sku: variant.sku ?? variant.derivedSku,
            attributeKey: variantKey(variant.attributes),
          })),
          packs: product.variants.flatMap((variant, index) =>
            variant.packs.map((pack) => ({
              variantId: `v${index}`,
              unitName: pack.unitName,
              conversionFactor: pack.conversionFactor,
            }))
          ),
        },
      ],
      vendors: [{ id: 'vendor1', name: 'PT E2E Roda Kopi', code: 'VND-E2E-KOPI' }],
      links: [{ vendorId: 'vendor1', productId: 'p1', isPreferred: true }],
      prices: product.variants.flatMap((variant, index) =>
        variant.packs.map((pack) => ({
          vendorId: 'vendor1',
          variantId: `v${index}`,
          unitName: pack.unitName,
        }))
      ),
    };

    const plan = planProductImport([product], stored, { priceMode: 'gap-only' });
    expect(plan.products[0].action).toBe('nochange');
    expect(plan.products[0].adds).toBe(0);
    expect(plan.summary).toMatchObject({
      newProducts: 0,
      extendedProducts: 0,
      unchangedProducts: 1,
      newVariants: 0,
      newPacks: 0,
      priceFills: 0,
      priceOverwrites: 0,
    });
  });
});
