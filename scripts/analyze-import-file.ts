/**
 * Why did an import only write part of my file?
 *
 * One command that answers the question an operator actually asks after a big
 * sheet finishes: "the file has 282 rows, why does the app show 8?". It reads
 * the sheet through the same parser the import dialog uses, then reports four
 * things in order:
 *
 *   1. ISI FILE      what the file really holds (columns, fill rate, duplicates)
 *   2. ATURAN LAMA   what the pre-rich (8-column) importer did with it
 *   3. ATURAN SEKARANG what the current planner promises against the tenant's
 *                      real data — the same numbers the preview dialog shows
 *   4. JEJAK TULIS   where a half-finished run actually stopped in the database
 *
 *   npm run analyze:import -- produk_2026-11-10.xlsx
 *   npm run analyze:import -- C:/path/ke/produk.csv
 *
 * Read-only. Nothing here writes: the planner is pure and the database is only
 * queried, so running this against a live tenant is safe.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PRODUCT_COLUMNS,
  normalizeRows,
  parseIdNumber,
  readRows,
  type BulkRow,
  type ColumnDef,
} from '../src/lib/bulk-io';
import {
  groupProductRows,
  planProductImport,
  type ProductImportUniverse,
} from '../src/lib/product-import';
import { parseVariantAttributes, variantKey } from '../src/lib/variants';
import { tenantClient } from '../tests/support/db';

/**
 * The sheet contract as it stood before the rich import: eight flat columns and
 * no way to say anything about a variant. Kept here on purpose, so "what would
 * the old importer have done" stays measurable instead of remembered.
 */
const OLD_COLUMNS: ColumnDef[] = [
  { key: 'sku', label: 'SKU', aliases: ['kode'], width: 16 },
  { key: 'name', label: 'Nama Produk', aliases: ['nama', 'produk', 'product', 'name'], width: 30 },
  { key: 'category', label: 'Kategori', aliases: ['kategori', 'category'], width: 16 },
  { key: 'price', label: 'Harga Jual', aliases: ['harga', 'price', 'harga jual'], width: 12 },
  { key: 'cost', label: 'Harga Modal', aliases: ['modal', 'cost', 'hpp'], width: 12 },
  { key: 'stock', label: 'Stok', aliases: ['stok awal', 'qty', 'stock'], width: 8 },
  { key: 'minStock', label: 'Stok Minimum', aliases: ['minimum', 'min stok', 'reorder'], width: 12 },
  { key: 'supplier', label: 'Supplier', aliases: ['vendor', 'pemasok', 'supplier'], width: 22 },
];

const blank = (value: unknown) => String(value ?? '').trim() === '';
const lower = (value: unknown) => String(value ?? '').trim().toLowerCase();

/** Mirrors the universe the preview dialog loads, so both say the same thing. */
async function loadUniverse(tenant: Awaited<ReturnType<typeof tenantClient>>) {
  const [productRes, variantRes, unitRes, vendorRes, linkRes, priceRes] = await Promise.all([
    tenant.execute('SELECT id, sku, name FROM products'),
    tenant.execute('SELECT id, product_id, sku, attributes FROM product_variants'),
    tenant.execute('SELECT variant_id, name, conversion_factor FROM product_units'),
    tenant.execute('SELECT id, name, code FROM suppliers'),
    tenant.execute('SELECT vendor_id, product_id, is_preferred FROM vendor_products'),
    tenant.execute('SELECT vendor_id, variant_id, unit_name FROM vendor_price_list'),
  ]);

  const variantsByProduct = new Map<string, ProductImportUniverse['products'][number]['variants']>();
  for (const row of variantRes.rows) {
    const list = variantsByProduct.get(String(row.product_id)) ?? [];
    list.push({
      id: String(row.id),
      sku: row.sku == null ? null : String(row.sku),
      attributeKey: variantKey(parseVariantAttributes(row.attributes == null ? null : String(row.attributes))),
    });
    variantsByProduct.set(String(row.product_id), list);
  }

  const variantToProduct = new Map(
    variantRes.rows.map((row) => [String(row.id), String(row.product_id)] as const)
  );
  const packsByProduct = new Map<string, ProductImportUniverse['products'][number]['packs']>();
  for (const unit of unitRes.rows) {
    const productId = unit.variant_id == null ? undefined : variantToProduct.get(String(unit.variant_id));
    if (!productId) continue;
    const list = packsByProduct.get(productId) ?? [];
    list.push({
      variantId: String(unit.variant_id),
      unitName: String(unit.name),
      conversionFactor: Number(unit.conversion_factor ?? 1),
    });
    packsByProduct.set(productId, list);
  }

  const universe: ProductImportUniverse = {
    products: productRes.rows.map((row) => ({
      id: String(row.id),
      sku: row.sku == null ? null : String(row.sku),
      name: String(row.name),
      variants: variantsByProduct.get(String(row.id)) ?? [],
      packs: packsByProduct.get(String(row.id)) ?? [],
    })),
    vendors: vendorRes.rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      code: row.code == null ? null : String(row.code),
    })),
    links: linkRes.rows.map((row) => ({
      vendorId: String(row.vendor_id),
      productId: String(row.product_id),
      isPreferred: Number(row.is_preferred ?? 0) === 1,
    })),
    prices: priceRes.rows.map((row) => ({
      vendorId: String(row.vendor_id),
      variantId: String(row.variant_id),
      unitName: String(row.unit_name),
    })),
  };

  return { universe, productCount: productRes.rows.length };
}

function describeFile(raw: BulkRow[], normalized: BulkRow[]) {
  const headers = Object.keys(raw[0] ?? {});
  console.log('baris data :', raw.length);
  console.log('header     :', headers.join(' | '));
  for (const header of headers) {
    const filled = raw.filter((row) => !blank(row[header])).length;
    console.log(`  ${header.padEnd(18)} terisi ${filled}/${raw.length}`);
  }
  // Stats are read off the *normalized* rows: the file's own header labels only
  // exist until `normalizeRows` maps them onto the keys the importer uses.
  const skus = normalized.map((row) => lower(row.sku)).filter(Boolean);
  const names = normalized.map((row) => lower(row.name)).filter(Boolean);
  const dupes = (list: string[]) =>
    [...new Set(list)].filter((value) => list.filter((item) => item === value).length > 1).length;
  console.log('SKU berbeda:', new Set(skus).size, '| SKU kembar dalam file:', dupes(skus));
  console.log('nama berbeda:', new Set(names).size, '| nama kembar:', dupes(names));
  console.log(
    'Harga Jual <= 0:',
    normalized.filter((row) => parseIdNumber(row.price) <= 0).length,
    '| Harga Modal <= 0:',
    normalized.filter((row) => parseIdNumber(row.cost) <= 0).length,
    '| Supplier terisi:',
    normalized.filter((row) => !blank(row.supplier)).length
  );
}

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('Pakai: npm run analyze:import -- <pathfile.csv|.xlsx>');
    process.exitCode = 1;
    return;
  }

  const path = resolve(target);
  const bytes = readFileSync(path);
  const raw = await readRows({ arrayBuffer: async () => new Uint8Array(bytes) } as unknown as File);
  const newRows = normalizeRows(raw, PRODUCT_COLUMNS);

  console.log('=== 1. ISI FILE ===');
  console.log('berkas:', path);
  describeFile(raw, newRows);

  const tenant = await tenantClient();
  try {
    const { universe, productCount } = await loadUniverse(tenant);

    console.log('\n=== 2. ATURAN LAMA (8 kolom, sebelum impor varian kaya) ===');
    const oldRows = normalizeRows(raw, OLD_COLUMNS);
    const rejected = oldRows.filter((row) => blank(row.name) || parseIdNumber(row.price) <= 0);
    const accepted = oldRows.filter((row) => !blank(row.name) && parseIdNumber(row.price) > 0);
    const bySku = new Set(universe.products.map((row) => lower(row.sku)).filter(Boolean));
    const byName = new Set(universe.products.map((row) => lower(row.name)).filter(Boolean));
    // The old importer threw a matching SKU away instead of extending it, so a
    // re-run of the same file "did nothing" for every row already written.
    const alreadyThere = accepted.filter(
      (row) => (lower(row.sku) && bySku.has(lower(row.sku))) || (!lower(row.sku) && byName.has(lower(row.name)))
    );
    console.log('produk di database            :', productCount);
    console.log('baris ditolak (nama/harga)    :', rejected.length);
    console.log('baris dibuang (sudah ada SKU) :', alreadyThere.length);
    console.log('yang akan dicoba ditulis      :', accepted.length - alreadyThere.length);

    console.log('\n=== 3. ATURAN SEKARANG (perencana + data tenant nyata) ===');
    const withIdentity = newRows.filter((row) => !blank(row.sku) || !blank(row.name));
    const seeds = groupProductRows(withIdentity);
    const plan = planProductImport(seeds, universe, { priceMode: 'gap-only' });
    console.log('produk dalam file :', seeds.length);
    console.log('varian            :', seeds.reduce((n, seed) => n + seed.variants.length, 0));
    console.log('pecahan           :', seeds.reduce(
      (n, seed) => n + seed.variants.reduce((m, variant) => m + variant.packs.length, 0),
      0
    ));
    console.log('rencana           :', JSON.stringify(plan.summary));
    console.log(
      'artinya           :',
      `${plan.summary.newProducts + plan.summary.extendedProducts} produk akan ditulis,`,
      `${plan.summary.unchangedProducts} tidak ada yang baru`
    );
    // A product the planner calls `nochange` is the honest answer to "why did
    // nothing happen for this row": the file adds neither a variant nor a price.
    const untouched = plan.products.filter((product) => product.action === 'nochange');
    console.log('produk tidak ada yang baru :', untouched.length);
    for (const product of untouched.slice(0, 5)) {
      console.log('  ', product.seed.sku || product.seed.name, '-', product.reason);
    }
    const conflicts = plan.products.filter((product) =>
      product.variants.some((variant) => variant.action === 'conflict')
    );
    for (const product of conflicts.slice(0, 5)) {
      const variant = product.variants.find((row) => row.action === 'conflict');
      console.log('  tabrakan kode:', product.seed.sku || product.seed.name, '-', variant?.reason);
    }

    console.log('\n=== 4. JEJAK TULIS (kapan terakhir ada produk dibuat) ===');
    const days = await tenant.execute(
      'SELECT substr(created_at, 1, 19) AS detik, COUNT(*) AS n FROM products GROUP BY detik ORDER BY detik DESC LIMIT 6'
    );
    for (const row of days.rows) {
      console.log('  ', String(row.detik), '->', String(row.n), 'produk');
    }
    const fileSkus = newRows.map((row) => lower(row.sku)).filter(Boolean);
    const present = fileSkus.filter((sku) => bySku.has(sku));
    console.log('SKU file yang sudah ada di database:', present.length, 'dari', fileSkus.length);
    const last = await tenant.execute(
      'SELECT MIN(created_at) AS awal, MAX(created_at) AS akhir, COUNT(*) AS n FROM products'
    );
    const bounds = last.rows[0];
    if (bounds) {
      console.log(
        'rentang tulis seluruh produk:',
        String(bounds.awal),
        '->',
        String(bounds.akhir),
        `(${String(bounds.n)} baris)`
      );
    }

    // The question a half-imported file actually raises is not "how many are
    // missing" but "where did it stop". Mapping each present SKU back to its
    // line number in the file answers that directly: a run that ends after a
    // contiguous prefix stopped, it did not skip around.
    const lineOf = new Map<string, number>();
    newRows.forEach((row, index) => {
      const sku = lower(row.sku);
      if (sku && !lineOf.has(sku)) lineOf.set(sku, index + 1);
    });
    const stamps = await tenant.execute({
      sql: `SELECT sku, name, created_at FROM products WHERE ${present
        .map(() => 'LOWER(sku) = ?')
        .join(' OR ')}`,
      args: present,
    });
    const written = stamps.rows
      .map((row) => ({
        line: lineOf.get(lower(row.sku)) ?? 0,
        sku: String(row.sku),
        name: String(row.name),
        createdAt: String(row.created_at),
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    console.log('\nbaris file yang tertulis (urut waktu tulis):');
    for (const row of written) {
      console.log(`  baris ${String(row.line).padStart(3)} ${row.sku}  ${row.createdAt}  ${row.name}`);
    }
    const stoppedAfter = Math.max(0, ...written.map((row) => row.line));
    // The pre-rich writer stored the *product* SKU in `product_variants.sku` as
    // well, and that column is UNIQUE across the whole catalogue. A code another
    // product's variant already owns therefore made the insert fail for that one
    // row — which is exactly the kind of row that used to end the whole run.
    const variantOwners = await tenant.execute('SELECT product_id, sku FROM product_variants');
    const ownerOfVariantSku = new Map<string, string>();
    for (const row of variantOwners.rows) {
      const sku = lower(row.sku);
      if (sku) ownerOfVariantSku.set(sku, String(row.product_id));
    }
    const productIdSet = new Set(universe.products.map((row) => row.id));
    const missing = newRows.filter((row) => lower(row.sku) && !bySku.has(lower(row.sku)));
    const claimedByVariant = missing.filter((row) =>
      ownerOfVariantSku.has(lower(row.sku))
    );
    console.log(
      'SKU (produk belum ada) yang sudah dipakai sebagai Kode Varian:',
      claimedByVariant.length,
      'dari',
      missing.length
    );
    for (const row of claimedByVariant.slice(0, 5)) {
      const ownerId = ownerOfVariantSku.get(lower(row.sku));
      console.log(
        '  ',
        String(row.sku),
        '-> kode varian milik',
        ownerId && productIdSet.has(ownerId)
          ? universe.products.find((p) => p.id === ownerId)?.sku ?? ownerId
          : 'baris yatim (produk tidak ada)',
        '|',
        String(row.name)
      );
    }
    if (stoppedAfter > 0) {
      const lost = newRows.length - stoppedAfter;
      console.log(
        'berhenti setelah baris ke-:',
        stoppedAfter,
        'dari',
        newRows.length,
        `→ ${lost} baris sesudahnya tidak pernah ditulis`
      );
      // The line right after the last committed one is the suspect; it is only
      // meaningful when the run covered a clean prefix of the file.
      const next = newRows[stoppedAfter];
      if (next && lost > 0 && written.length === stoppedAfter) {
        console.log(
          'baris yang menghentikan run:',
          String(next.sku),
          '|',
          String(next.name),
          '| supplier:',
          String(next.supplier ?? ''),
          '| barcode varian:',
          String(next.barcode ?? '(kosong)')
        );
        // Name the data causes the old path could have tripped on, so "the file
        // is not the problem" stays a measurement instead of an opinion.
        const skuKey = lower(next.sku);
        const causes = [
          bySku.has(skuKey) ? 'products.sku sudah ada' : null,
          ownerOfVariantSku.has(skuKey) ? 'product_variants.sku sudah ada' : null,
          !byName.has(lower(next.name)) ? null : 'nama produk sudah ada (tidak uniki)',
        ].filter(Boolean);
        console.log(
          'penyebab data pada baris itu:',
          causes.length > 0 ? causes.join(' + ') : 'tidak ada (SKU/varian/nama tidak menabrak apa pun)'
        );
      }
    }
  } finally {
    tenant.close();
  }
}

await main();
