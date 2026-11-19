import { test, describe } from '@e2e-dev/web';
import { expect } from 'e2e';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { executeTenant } from './support/db';
import { APP_CONTEXT } from './support/context';

/**
 * Bulk create (import / export / template) controls for Products, Vendors and
 * Customers, and the owner-only gating that surrounds the mutating half.
 *
 * What is worth proving in the browser is twofold. First that the affordances
 * reach the right people: an owner sees Import/Export/Template everywhere; a
 * store manager who can only view cannot import products or vendors, but may
 * still download the template so they can read the column format. Second that
 * the rich variant sheet actually lands: the parsing rules are unit-tested in
 * `src/lib/product-import.test.ts`, but only a real upload through the real
 * dialog into a real tenant can show that the four variants, their per-pack
 * prices and their opening stock arrive in the tables the rest of the app reads.
 */
describe(
  'bulk import controls',
  { tags: ['owner', 'rbac'], agentContext: APP_CONTEXT },
  () => {
    test('the owner sees Import, Export CSV and the template on products', { session: 'owner' }, async ({ app, screen }) => {
      await app.open('/backoffice/inventory/products');
      await expect(screen.getByRole('heading', 'Inventory Produk', { level: 1 })).toBeVisible();

      await expect(screen.getByRole('button', { name: 'Import', exact: true })).toBeVisible();
      await expect(screen.getByRole('button', { name: 'Export CSV' })).toBeVisible();
      await expect(screen.getByRole('button', { name: 'Template CSV' })).toBeVisible();
      await expect(screen.getByRole('button', { name: 'Template Excel' })).toBeVisible();
    });

    test('the owner sees Import and Export CSV on vendors', { session: 'owner' }, async ({ app, screen }) => {
      await app.open('/backoffice/vendors');
      await expect(screen.getByRole('heading', 'Vendor', { level: 1 })).toBeVisible();

      await expect(screen.getByRole('button', { name: 'Import', exact: true })).toBeVisible();
      await expect(screen.getByRole('button', { name: 'Export CSV' })).toBeVisible();
      await expect(screen.getByRole('button', { name: 'Template CSV' })).toBeVisible();
    });

    test('the owner sees Import and Export CSV on customers', { session: 'owner' }, async ({ app, screen }) => {
      await app.open('/backoffice/crm/customers');
      await expect(screen.getByRole('heading', 'Data Pelanggan', { level: 1 })).toBeVisible();

      await expect(screen.getByRole('button', { name: 'Import', exact: true })).toBeVisible();
      await expect(screen.getByRole('button', { name: 'Export CSV' })).toBeVisible();
    });

    test('a store manager cannot import products or vendors, but the template stays open', { session: 'manager' }, async ({ app, screen }) => {
      // Products import is gated behind manage_variants, which a manager lacks.
      await app.open('/backoffice/inventory/products');
      await expect(screen.getByRole('button', { name: 'Import', exact: true })).toBeHidden();
      // The blank template carries sample rows only, so it is never gated.
      await expect(screen.getByRole('button', { name: 'Template CSV' })).toBeVisible();

      // Vendors import is gated behind manage_vendor_prices.
      await app.open('/backoffice/vendors');
      await expect(screen.getByRole('button', { name: 'Import', exact: true })).toBeHidden();
    });

    test('a store manager can import customers (view_finance)', { session: 'manager' }, async ({ app, screen }) => {
      await app.open('/backoffice/crm/customers');
      await expect(screen.getByRole('button', { name: 'Import', exact: true })).toBeVisible();
    });
  }
);

/**
 * The rich variant sheet, uploaded for real.
 *
 * `tests/fixtures/fixture_produk_varian.csv` is one product written on five
 * lines: two axes (`Rasa` x `Ukuran`) giving four variants, one of which also
 * sells by the carton, one of which is named by a typed `Kode Varian`, and one
 * of which carries no opening stock at all. That is the shape the flat file was
 * designed for and the shape the writers were built to store, so the case below
 * reads the tables back rather than trusting the dialog: a variant that reached
 * the preview but not `product_variants` would be a silent data loss.
 *
 * The second case is the additive guarantee. Masters survive a re-import
 * unchanged, so uploading the same file again has to add zero rows — and a buy
 * price somebody negotiated in the app must still be there afterwards.
 */

const PRODUCT_FIXTURE = resolve('tests/fixtures/fixture_produk_varian.csv');

const PRODUCT_SKU = 'E2E-KPB-01';
const PRODUCT_NAME = 'Kopi Tubruk E2E';
const VENDOR_CODE = 'VND-E2E-KOPI';
const VENDOR_NAME = 'PT E2E Roda Kopi';

type SqlArg = string | number | null;
type Row = Record<string, SqlArg>;

async function select(sql: string, args: SqlArg[] = []): Promise<Row[]> {
  const result = await executeTenant(sql, args);
  return result.rows as unknown as Row[];
}

async function mutate(sql: string, args: SqlArg[] = []): Promise<void> {
  await executeTenant(sql, args);
}

/** `{"Rasa":"Hitam","Ukuran":"250ml"}` read back as the sheet writes it. */
function attributeText(raw: unknown): string {
  const parsed = JSON.parse(String(raw ?? '{}')) as Record<string, string>;
  return Object.keys(parsed)
    .sort()
    .map((name) => `${name}=${parsed[name]}`)
    .join(';');
}

async function requireProduct(): Promise<Row> {
  const rows = await select(
    `SELECT id, sku, name, category, min_stock_level, supplier_id, cost_price, variant_attributes
       FROM products WHERE sku = ?`,
    [PRODUCT_SKU]
  );
  assert.equal(rows.length, 1, `products should hold exactly one ${PRODUCT_SKU}`);
  return rows[0];
}

/** The four variants, as `sku|label|attributes`. */
async function variantLines(productId: string): Promise<string[]> {
  const rows = await select(
    `SELECT sku, name, attributes FROM product_variants
      WHERE product_id = ? AND status = 'active' ORDER BY sku`,
    [productId]
  );
  return rows.map((row) => `${row.sku}|${row.name}|${attributeText(row.attributes)}`);
}

/** Every pack of every variant, as `sku|name x factor|cost/price`. */
async function packLines(productId: string): Promise<string[]> {
  const rows = await select(
    `SELECT v.sku AS sku, u.name AS name, u.conversion_factor AS factor, u.cost AS cost, u.price AS price
       FROM product_units u JOIN product_variants v ON v.id = u.variant_id
      WHERE v.product_id = ? ORDER BY v.sku, u.conversion_factor`,
    [productId]
  );
  return rows.map(
    (row) => `${row.sku}|${row.name} x${Number(row.factor)}|${Number(row.cost)}/${Number(row.price)}`
  );
}

/** The buy prices the sheet agreed, one row per (variant, pack). */
async function priceLines(productId: string, vendorId: string): Promise<string[]> {
  const rows = await select(
    `SELECT v.sku AS sku, vpl.unit_name AS unit, vpl.buy_price AS buy
       FROM vendor_price_list vpl JOIN product_variants v ON v.id = vpl.variant_id
      WHERE v.product_id = ? AND vpl.vendor_id = ? AND vpl.status = 'active'
      ORDER BY v.sku, vpl.unit_name`,
    [productId, vendorId]
  );
  return rows.map((row) => `${row.sku}|${row.unit}|${Number(row.buy)}`);
}

/** Opening stock, which belongs to the variant the line named, not the product. */
async function batchLines(productId: string): Promise<string[]> {
  const rows = await select(
    `SELECT v.sku AS sku, b.quantity_initial AS qty
       FROM product_batches b JOIN product_variants v ON v.id = b.variant_id
      WHERE b.product_id = ? ORDER BY v.sku`,
    [productId]
  );
  return rows.map((row) => `${row.sku}|${Number(row.qty)}`);
}

/** Everything a re-import could plausibly change, in one comparable snapshot. */
async function snapshot(productId: string, vendorId: string): Promise<Record<string, unknown>> {
  const [product] = await select('SELECT name, cost_price, variant_attributes FROM products WHERE id = ?', [
    productId,
  ]);
  return {
    name: product?.name,
    cost: Number(product?.cost_price),
    axes: attributeGroups(String(product?.variant_attributes ?? '[]')),
    variants: await variantLines(productId),
    packs: await packLines(productId),
    prices: await priceLines(productId, vendorId),
    batches: await batchLines(productId),
  };
}

/** The product's axes as `Rasa:Susu/Hitam + Ukuran:250ml/1kg`. */
function attributeGroups(raw: string): string {
  const groups = JSON.parse(raw) as Array<{ name: string; values: string[] }>;
  return groups.map((group) => `${group.name}:${group.values.join('/')}`).join(' + ');
}

async function purgeProduct(productId: string): Promise<void> {
  const ids = (
    await select('SELECT id FROM product_variants WHERE product_id = ?', [productId])
  ).map((row) => String(row.id));
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(', ');
    await mutate(`DELETE FROM vendor_price_list WHERE variant_id IN (${placeholders})`, ids);
    await mutate(`DELETE FROM product_units WHERE variant_id IN (${placeholders})`, ids);
  }
  await mutate('DELETE FROM product_batches WHERE product_id = ?', [productId]);
  await mutate('DELETE FROM vendor_products WHERE product_id = ?', [productId]);
  await mutate('DELETE FROM product_variants WHERE product_id = ?', [productId]);
  await mutate('DELETE FROM audit_logs WHERE entity = ? AND entity_id = ?', ['products', productId]);
  await mutate('DELETE FROM products WHERE id = ?', [productId]);
}

/**
 * Remove the fixture's product and the vendor its lines name, so the create
 * case starts from an empty universe. The vendor row is left to the vendor
 * cascade: a catalogue row pointing at a deleted product would break the PO
 * screen for the rest of the suite.
 */
async function purgeFixtureRows(): Promise<void> {
  for (const stray of await select('SELECT id FROM products WHERE sku = ?', [PRODUCT_SKU])) {
    await purgeProduct(String(stray.id));
  }
  const vendor = (await select('SELECT id FROM suppliers WHERE code = ?', [VENDOR_CODE]))[0];
  if (!vendor) return;
  const vendorId = String(vendor.id);
  for (const owned of await select('SELECT id FROM products WHERE supplier_id = ?', [vendorId])) {
    await purgeProduct(String(owned.id));
  }
  await mutate('DELETE FROM vendor_price_list WHERE vendor_id = ?', [vendorId]);
  await mutate('DELETE FROM vendor_products WHERE vendor_id = ?', [vendorId]);
  await mutate('DELETE FROM suppliers WHERE id = ?', [vendorId]);
}

describe('rich variant product import', { tags: ['owner', 'variants'], agentContext: APP_CONTEXT }, () => {
  test(
    'one flat sheet writes the product, four variants, five packs and their prices',
    { session: 'owner' },
    async ({ app, screen, browser }) => {
      assert.ok(existsSync(PRODUCT_FIXTURE), `Missing e2e fixture: ${PRODUCT_FIXTURE}`);
      await purgeFixtureRows();

      await app.open('/backoffice/inventory/products');
      await expect(screen.getByRole('heading', 'Inventory Produk', { level: 1 })).toBeVisible();

      // The Import button only opens the operating system's picker, so the sheet
      // is handed straight to the input that picker would fill.
      await browser.locator('#product-import-file').setInputFiles(PRODUCT_FIXTURE);

      const preview = screen.getByRole('dialog', { name: /Preview Import Produk/ });
      await expect(preview).toBeVisible();
      // The plan is stated in rows, not hoped for: four variants and five packs.
      await expect(preview).toContainText('4 varian baru');
      await expect(preview).toContainText('5 pecahan baru');
      // The typed code and the attribute cell both reach the table.
      await expect(preview).toContainText('Susu 250ml');
      await expect(preview).toContainText(`${PRODUCT_SKU}-HITAM-250ML`);
      await preview.getByRole('button', { name: /^Import \d+ Produk$/ }).tap();
      await expect(preview).toBeHidden();

      const product = await requireProduct();
      const productId = String(product.id);
      assert.equal(product.name, PRODUCT_NAME);
      assert.equal(product.category, 'Minuman');
      assert.equal(Number(product.min_stock_level), 20);
      // The axes the five lines describe, in the order the file wrote them.
      assert.equal(attributeGroups(String(product.variant_attributes)), 'Rasa:Susu/Hitam + Ukuran:250ml/1kg');

      assert.deepEqual(await variantLines(productId), [
        `${PRODUCT_SKU}-HITAM-1KG|Hitam 1kg|Rasa=Hitam;Ukuran=1kg`,
        `${PRODUCT_SKU}-HITAM-250ML|Hitam 250ml|Rasa=Hitam;Ukuran=250ml`,
        `${PRODUCT_SKU}-SUSU-1KG|Susu 1kg|Rasa=Susu;Ukuran=1kg`,
        `${PRODUCT_SKU}-SUSU-250ML|Susu 250ml|Rasa=Susu;Ukuran=250ml`,
      ]);

      // Each variant owns its own packs, and each pack its own prices: the
      // carton is 58.000 because the sheet said so, not 24 x 2.500.
      assert.deepEqual(await packLines(productId), [
        `${PRODUCT_SKU}-HITAM-1KG|Pcs x1|900/1300`,
        `${PRODUCT_SKU}-HITAM-250ML|Pcs x1|800/1100`,
        `${PRODUCT_SKU}-SUSU-1KG|Pcs x1|30000/42000`,
        `${PRODUCT_SKU}-SUSU-250ML|Pcs x1|2500/3500`,
        `${PRODUCT_SKU}-SUSU-250ML|Karton x24|58000/79000`,
      ]);

      // The model's summary cost stays the first variant's piece price, which is
      // what the PO screen and the reports still read.
      assert.equal(Number(product.cost_price), 2500);

      // Opening stock landed on the three variants that carried it, in base units.
      assert.deepEqual(await batchLines(productId), [
        `${PRODUCT_SKU}-HITAM-250ML|60`,
        `${PRODUCT_SKU}-SUSU-1KG|40`,
        `${PRODUCT_SKU}-SUSU-250ML|120`,
      ]);

      // The vendor was referenced by CODE, and became a real master row.
      const vendor = (await select('SELECT id, code, name, status FROM suppliers WHERE code = ?', [
        VENDOR_CODE,
      ]))[0];
      assert.ok(vendor, `suppliers has no row coded ${VENDOR_CODE}`);
      assert.equal(vendor.name, VENDOR_NAME);
      assert.equal(vendor.status, 'active');
      assert.equal(String(product.supplier_id), String(vendor.id));

      // One buy price per (variant, pack) — the bug this sheet used to hit, where
      // every pack's price landed on whichever variant the query returned first.
      assert.deepEqual(await priceLines(productId, String(vendor.id)), [
        `${PRODUCT_SKU}-HITAM-1KG|Pcs|900`,
        `${PRODUCT_SKU}-HITAM-250ML|Pcs|800`,
        `${PRODUCT_SKU}-SUSU-1KG|Pcs|30000`,
        `${PRODUCT_SKU}-SUSU-250ML|Karton|58000`,
        `${PRODUCT_SKU}-SUSU-250ML|Pcs|2500`,
      ]);

      const links = await select(
        'SELECT is_preferred, last_cost, min_order_qty, vendor_sku FROM vendor_products WHERE vendor_id = ? AND product_id = ?',
        [String(vendor.id), productId]
      );
      assert.equal(links.length, 1);
      assert.equal(Number(links[0].is_preferred), 1);
      assert.equal(Number(links[0].last_cost), 2500);
      assert.equal(Number(links[0].min_order_qty), 10);
      assert.equal(links[0].vendor_sku, 'E2E-KP-SUSU250');

      // The barcode landed on the variant that carried it, and nowhere else.
      const barcodes = await select(
        'SELECT sku, barcode FROM product_variants WHERE product_id = ? ORDER BY sku',
        [productId]
      );
      assert.deepEqual(
        barcodes.map((row) => `${String(row.sku).replace(`${PRODUCT_SKU}-`, '')}|${row.barcode ?? ''}`),
        ['HITAM-1KG|', 'HITAM-250ML|', 'SUSU-1KG|', 'SUSU-250ML|8990000000011']
      );
    }
  );

  test(
    'uploading the same sheet again adds nothing and keeps what the app edited',
    { session: 'owner' },
    async ({ app, screen, browser }) => {
      const product = await requireProduct();
      const productId = String(product.id);
      const vendor = (await select('SELECT id FROM suppliers WHERE code = ?', [VENDOR_CODE]))[0];
      assert.ok(vendor, `the fixture vendor disappeared: ${VENDOR_CODE}`);
      const vendorId = String(vendor.id);

      const before = await snapshot(productId, vendorId);

      // Somebody renamed the product and negotiated the carton price in the app.
      // A second upload of the same file must not undo either of those.
      await mutate('UPDATE products SET name = ? WHERE id = ?', [`${PRODUCT_NAME} Edit`, productId]);
      await mutate(
        `UPDATE vendor_price_list SET buy_price = 61000
          WHERE vendor_id = ? AND unit_name = 'Karton' AND variant_id =
            (SELECT id FROM product_variants WHERE product_id = ? AND sku = ?)`,
        [vendorId, productId, `${PRODUCT_SKU}-SUSU-250ML`]
      );

      await app.open('/backoffice/inventory/products');
      await browser.locator('#product-import-file').setInputFiles(PRODUCT_FIXTURE);
      const preview = screen.getByRole('dialog', { name: /Preview Import Produk/ });
      await expect(preview).toBeVisible();
      // The plan says so before anything could be written: nothing left to add.
      await expect(preview).toContainText('0 akan ditulis');
      await expect(preview).toContainText('1 tidak ada yang baru');
      await preview.getByRole('button', { name: 'Batal' }).tap();
      await expect(preview).toBeHidden();

      assert.deepEqual(await snapshot(productId, vendorId), {
        ...before,
        name: `${PRODUCT_NAME} Edit`,
        prices: (before.prices as string[]).map((line) =>
          line === `${PRODUCT_SKU}-SUSU-250ML|Karton|58000`
            ? `${PRODUCT_SKU}-SUSU-250ML|Karton|61000`
            : line
        ),
      });

      // Still one product, four variants, five packs, five prices.
      const counts = await select(
        `SELECT
           (SELECT COUNT(*) FROM products WHERE sku = ?) AS products,
           (SELECT COUNT(*) FROM product_variants WHERE product_id = ?) AS variants,
           (SELECT COUNT(*) FROM product_units u JOIN product_variants v ON v.id = u.variant_id WHERE v.product_id = ?) AS packs,
           (SELECT COUNT(*) FROM vendor_price_list vpl JOIN product_variants v ON v.id = vpl.variant_id WHERE v.product_id = ?) AS prices`,
        [PRODUCT_SKU, productId, productId, productId]
      );
      assert.deepEqual(counts[0], { products: 1, variants: 4, packs: 5, prices: 5 });
    }
  );
});

/**
 * The vendor sheet written the way it is now asked to be written: ONE vendor per
 * file, its own columns on the first row only, and as many products, variants and
 * packs below it as the vendor has.
 *
 * `fixture_vendor_produk_satu_vendor.csv` is that file — a vendor row, a product
 * without variants quoted in two packs, and a product in three variants x two
 * packs, one of which names its `Kode Varian` and carries a barcode.
 * `fixture_vendor_produk_satu_vendor_varian_baru.csv` is the same vendor adding a
 * fourth flavour to a product that already exists, which is the write the
 * template's last row teaches and the permission gates.
 *
 * The last case is the round trip the format exists for: the sheet the app
 * exports for one vendor is handed straight back and changes nothing. That is
 * what lets an owner email it to a supplier with "isi harga ini lalu kirim balik"
 * without fearing a second copy of anything.
 */

const SHEET_FIXTURE = resolve('tests/fixtures/fixture_vendor_produk_satu_vendor.csv');
const SHEET_APPEND_FIXTURE = resolve(
  'tests/fixtures/fixture_vendor_produk_satu_vendor_varian_baru.csv'
);
const SHEET_VENDOR_CODE = 'VND-E2E-SATU';
const SHEET_VENDOR_NAME = 'PT E2E Satu Vendor';
const FLAT_SKU = 'E2E-SV-001';
const VARIANTS_SKU = 'E2E-SV-002';
const SHEET_SKUS = [FLAT_SKU, VARIANTS_SKU];
/** `VENDOR_PRODUCT_COLUMNS` is 21 wide, and its first seven cells are the vendor. */
const SHEET_CELLS = 21;
const VENDOR_ONLY_BLANK_CELLS = 21 - 7;

async function sheetProductId(sku: string): Promise<string> {
  const rows = await select('SELECT id FROM products WHERE sku = ?', [sku]);
  assert.equal(rows.length, 1, `products should hold exactly one ${sku}`);
  return String(rows[0].id);
}

async function sheetVendorId(): Promise<string> {
  const vendor = (
    await select('SELECT id FROM suppliers WHERE code = ?', [SHEET_VENDOR_CODE])
  )[0];
  assert.ok(vendor, `suppliers has no row coded ${SHEET_VENDOR_CODE}`);
  return String(vendor.id);
}

/** One vendor's whole offer, as the lines a re-import could not change. */
async function sheetSnapshot(vendorId: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { vendorId };
  for (const sku of SHEET_SKUS) {
    const productId = await sheetProductId(sku);
    const [product] = await select(
      'SELECT name, cost_price, variant_attributes FROM products WHERE id = ?',
      [productId]
    );
    out[sku] = {
      name: String(product?.name ?? ''),
      cost: Number(product?.cost_price),
      axes: String(product?.variant_attributes ?? ''),
      variants: await variantLines(productId),
      packs: await packLines(productId),
      prices: await priceLines(productId, vendorId),
      batches: await batchLines(productId),
    };
  }
  return out;
}

/** The flavour a price or pack row belongs to, as the sheet named it. */
function flavour(raw: unknown): string {
  const attributes = JSON.parse(String(raw ?? '{}')) as Record<string, string>;
  return attributes.Rasa ?? 'Default';
}

/** The variants of one product as `Rasa=…;Ukuran=…|barcode`, so identity and
 * barcode are compared in one line and no minted code is pinned. */
async function sheetVariants(productId: string): Promise<string[]> {
  const rows = await select(
    'SELECT attributes, barcode FROM product_variants WHERE product_id = ? ORDER BY sku',
    [productId]
  );
  return rows
    .map((row) => `${attributeText(row.attributes)}|${String(row.barcode ?? '')}`)
    .sort();
}

/** Every pack the product sells, as `flavour|unit x factor|buy price`. */
async function sheetPacks(productId: string): Promise<string[]> {
  const rows = await select(
    `SELECT v.attributes AS attributes, u.name AS unit, u.conversion_factor AS factor, u.cost AS cost
       FROM product_units u JOIN product_variants v ON v.id = u.variant_id
      WHERE v.product_id = ?`,
    [productId]
  );
  return rows
    .map((row) => `${flavour(row.attributes)}|${row.unit} x${Number(row.factor)}|${Number(row.cost)}`)
    .sort();
}

/** The agreed buy prices, as `flavour|unit|buy price`. */
async function sheetPrices(productId: string, vendorId: string): Promise<string[]> {
  const rows = await select(
    `SELECT v.attributes AS attributes, vpl.unit_name AS unit, vpl.buy_price AS buy
       FROM vendor_price_list vpl JOIN product_variants v ON v.id = vpl.variant_id
      WHERE v.product_id = ? AND vpl.vendor_id = ? AND vpl.status = 'active'`,
    [productId, vendorId]
  );
  return rows
    .map((row) => `${flavour(row.attributes)}|${row.unit}|${Number(row.buy)}`)
    .sort();
}

/** Count of every row the sheet could create, so "nothing new" is measured. */
async function sheetCounts(vendorId: string): Promise<Record<string, number>> {
  const ids = [];
  for (const sku of SHEET_SKUS) ids.push(await sheetProductId(sku));
  const rows = await select(
    `SELECT
       (SELECT COUNT(*) FROM suppliers WHERE code = ?) AS vendors,
       (SELECT COUNT(*) FROM products WHERE sku IN (${ids.map(() => '?').join(', ')})) AS products,
       (SELECT COUNT(*) FROM product_variants WHERE product_id IN (${ids.map(() => '?').join(', ')})) AS variants,
       (SELECT COUNT(*) FROM product_units WHERE variant_id IN (SELECT id FROM product_variants WHERE product_id IN (${ids.map(() => '?').join(', ')}))) AS packs,
       (SELECT COUNT(*) FROM vendor_price_list WHERE vendor_id = ?) AS prices,
       (SELECT COUNT(*) FROM vendor_products WHERE vendor_id = ?) AS links`,
    [SHEET_VENDOR_CODE, ...ids, ...ids, ...ids, vendorId, vendorId]
  );
  return Object.fromEntries(
    Object.entries(rows[0]).map(([key, value]) => [key, Number(value)])
  );
}

/** Delete the sheet's vendor and both products, so the create case is a create. */
async function purgeSheetRows(): Promise<void> {
  const vendor = (await select('SELECT id FROM suppliers WHERE code = ?', [SHEET_VENDOR_CODE]))[0];
  for (const sku of SHEET_SKUS) {
    for (const stray of await select('SELECT id FROM products WHERE sku = ?', [sku])) {
      await purgeProduct(String(stray.id));
    }
  }
  if (!vendor) return;
  const vendorId = String(vendor.id);
  for (const owned of await select('SELECT id FROM products WHERE supplier_id = ?', [vendorId])) {
    await purgeProduct(String(owned.id));
  }
  await mutate('DELETE FROM vendor_price_list WHERE vendor_id = ?', [vendorId]);
  await mutate('DELETE FROM vendor_products WHERE vendor_id = ?', [vendorId]);
  await mutate('DELETE FROM suppliers WHERE id = ?', [vendorId]);
}

/** The sheet as the browser saved it: header, then one array of cells per row. */
function parseDownloadedCsv(text: string): string[][] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line !== '');
  return lines.map((line) => line.split(','));
}

describe(
  'one vendor per file',
  { tags: ['owner', 'variants'], agentContext: APP_CONTEXT },
  () => {
    test(
      'a sheet that states its vendor once writes the vendor and both products',
      { session: 'owner' },
      async ({ app, screen, browser }) => {
        assert.ok(existsSync(SHEET_FIXTURE), `Missing e2e fixture: ${SHEET_FIXTURE}`);
        await purgeSheetRows();

        await app.open('/backoffice/vendors');
        await expect(screen.getByRole('heading', 'Vendor', { level: 1 })).toBeVisible();

        await browser.locator('#vendor-product-import-file').setInputFiles(SHEET_FIXTURE);
        const preview = screen.getByRole('dialog', { name: /Preview Import Vendor/ });
        await expect(preview).toBeVisible();
        // One vendor, told once, and two products under it: the file's shape is
        // the plan's shape.
        await expect(preview).toContainText('1 vendor baru');
        await expect(preview).toContainText('2 produk baru');
        // The rule is stated where the operator reads it, and no banner about
        // several vendors appears for a file that holds one.
        await expect(preview).toContainText('Satu sheet untuk satu vendor');
        await expect(preview).not.toContainText('format barunya satu vendor per file');
        // The flavours come from the sheet's own columns, not from a guess.
        await expect(preview).toContainText('varian dibuat dari kolom Kode/Atribut Varian sheet ini');
        await preview.getByRole('button', { name: /^Import \d+ Vendor$/ }).tap();
        await expect(preview).toBeHidden();

        const [vendor] = await select(
          'SELECT id, code, name, phone, email, payment_terms_days FROM suppliers WHERE code = ?',
          [SHEET_VENDOR_CODE]
        );
        assert.ok(vendor, `suppliers has no row coded ${SHEET_VENDOR_CODE}`);
        assert.equal(String(vendor.name), SHEET_VENDOR_NAME);
        assert.equal(String(vendor.phone), '0812000004000');
        assert.equal(Number(vendor.payment_terms_days), 21);
        const vendorId = String(vendor.id);

        // The plain product: one axis-less variant, both packs, both prices.
        const flatId = await sheetProductId(FLAT_SKU);
        assert.deepEqual(await sheetVariants(flatId), ['|']);
        assert.deepEqual(await sheetPacks(flatId), [
          'Default|Karton x24|250000',
          'Default|Pcs x1|11000',
        ]);
        assert.deepEqual(await sheetPrices(flatId, vendorId), [
          'Default|Karton|250000',
          'Default|Pcs|11000',
        ]);
        assert.deepEqual(await batchLines(flatId), [`${FLAT_SKU}|40`]);

        // The varied product: three flavours, two packs each, six agreed prices.
        const variedId = await sheetProductId(VARIANTS_SKU);
        assert.deepEqual(await sheetVariants(variedId), [
          'Rasa=Lemon;Ukuran=25s|8990000000335',
          'Rasa=Melon;Ukuran=25s|8990000000328',
          'Rasa=Original;Ukuran=25s|8990000000311',
        ]);
        assert.deepEqual(await sheetPacks(variedId), [
          'Lemon|Karton x25|210000',
          'Lemon|Pcs x1|9000',
          'Melon|Karton x25|200000',
          'Melon|Pcs x1|8500',
          'Original|Karton x25|190000',
          'Original|Pcs x1|8000',
        ]);
        assert.deepEqual(await sheetPrices(variedId, vendorId), [
          'Lemon|Karton|210000',
          'Lemon|Pcs|9000',
          'Melon|Karton|200000',
          'Melon|Pcs|8500',
          'Original|Karton|190000',
          'Original|Pcs|8000',
        ]);
        // A typed `Kode Varian` is the variant's real code, not a hint.
        const codes = (
          await select('SELECT sku FROM product_variants WHERE product_id = ?', [variedId])
        ).map((row) => String(row.sku));
        assert.ok(
          codes.includes(`${VARIANTS_SKU}-LEMON-25S`),
          `the typed variant code is missing: ${codes.join(', ')}`
        );

        const [product] = await select(
          'SELECT variant_attributes FROM products WHERE id = ?',
          [variedId]
        );
        const axes = JSON.parse(String(product.variant_attributes)) as Array<{
          name: string;
          values: string[];
        }>;
        assert.deepEqual(axes.map((group) => group.name), ['Rasa', 'Ukuran']);
        assert.deepEqual(axes.find((group) => group.name === 'Rasa')?.values, [
          'Original',
          'Melon',
          'Lemon',
        ]);
        assert.deepEqual(axes.find((group) => group.name === 'Ukuran')?.values, ['25s']);

        // One catalogue link per product, preferred, from the sheet.
        const links = await select(
          'SELECT product_id, is_preferred FROM vendor_products WHERE vendor_id = ?',
          [vendorId]
        );
        assert.equal(links.length, 2);
        assert.equal(links.filter((row) => Number(row.is_preferred) === 1).length, 2);
      }
    );

    test(
      'the same sheet naming a flavour the product lacks appends that variant',
      { session: 'owner' },
      async ({ app, screen, browser }) => {
        assert.ok(existsSync(SHEET_APPEND_FIXTURE), `Missing e2e fixture: ${SHEET_APPEND_FIXTURE}`);
        const vendorId = await sheetVendorId();
        const variedId = await sheetProductId(VARIANTS_SKU);
        const before = await sheetCounts(vendorId);
        // This case appends a flavour, so it needs the product WITHOUT it — the
        // state the previous case writes. It is stated as the requirement rather
        // than as `before.variants === 4`, because a retried attempt that already
        // imported would otherwise fail with a number that explains nothing.
        assert.deepEqual(
          (await sheetVariants(variedId)).filter((line) => line.startsWith('Rasa=Nanas')),
          [],
          `kasus ini butuh ${VARIANTS_SKU} yang belum punya rasa Nanas; jalankan ulang kasus "a sheet that states its vendor once"`
        );

        await app.open('/backoffice/vendors');
        await browser.locator('#vendor-product-import-file').setInputFiles(SHEET_APPEND_FIXTURE);
        const preview = screen.getByRole('dialog', { name: /Preview Import Vendor/ });
        await expect(preview).toBeVisible();
        // The plan says the write out loud, before anything is committed: one
        // flavour to make, two packs to sell in it, nothing else new.
        await expect(preview).toContainText('1 varian baru');
        await expect(preview).toContainText('2 pecahan baru');
        await expect(preview).toContainText('0 produk baru');
        // And the table draws those rows rather than only counting them in the
        // header: one row per pack of the flavour to be made. A sheet whose whole
        // job is to extend a product has no price line for its stored packs, so
        // this is the only place an operator can see what will actually be
        // created. The flavour is spelled the way the preview names a variant
        // that is not in the database yet — the values of its attribute key.
        const plannedVariants = preview.getByRole('row').filter({ hasText: 'varian baru' });
        await expect(plannedVariants).toHaveCount(2);
        await expect(plannedVariants.first()).toContainText('nanas');
        await preview.getByRole('button', { name: /^Import \d+ Vendor$/ }).tap();
        await expect(preview).toBeHidden();

        assert.deepEqual(await sheetVariants(variedId), [
          'Rasa=Lemon;Ukuran=25s|8990000000335',
          'Rasa=Melon;Ukuran=25s|8990000000328',
          'Rasa=Nanas;Ukuran=25s|8990000000342',
          'Rasa=Original;Ukuran=25s|8990000000311',
        ]);
        // The appended flavour sells in both packs at the prices this file quoted.
        assert.deepEqual(await sheetPrices(variedId, vendorId), [
          'Lemon|Karton|210000',
          'Lemon|Pcs|9000',
          'Melon|Karton|200000',
          'Melon|Pcs|8500',
          'Nanas|Karton|220000',
          'Nanas|Pcs|9500',
          'Original|Karton|190000',
          'Original|Pcs|8000',
        ]);
        // Appending means exactly one more variant and two more of everything
        // that hangs off it: no product, no catalogue row, no extra link.
        assert.deepEqual(await sheetCounts(vendorId), {
          ...before,
          variants: 5,
          packs: before.packs + 2,
          prices: before.prices + 2,
        });
        const axes = JSON.parse(
          String(
            (await select('SELECT variant_attributes FROM products WHERE id = ?', [variedId]))[0]
              .variant_attributes
          )
        ) as Array<{ name: string; values: string[] }>;
        assert.deepEqual(axes.find((group) => group.name === 'Rasa')?.values, [
          'Original',
          'Melon',
          'Lemon',
          'Nanas',
        ]);
      }
    );

    test(
      're-uploading the one-vendor sheet adds no row anywhere',
      { session: 'owner' },
      async ({ app, screen, browser }) => {
        const vendorId = await sheetVendorId();
        const before = await sheetCounts(vendorId);
        const snapshot = await sheetSnapshot(vendorId);

        await app.open('/backoffice/vendors');
        await browser.locator('#vendor-product-import-file').setInputFiles(SHEET_FIXTURE);
        const preview = screen.getByRole('dialog', { name: /Preview Import Vendor/ });
        await expect(preview).toBeVisible();
        // Nothing left to add: the file's products exist and so does every
        // flavour its lines name.
        await expect(preview).toContainText('0 produk baru');
        await expect(preview).not.toContainText('varian baru');
        await expect(preview).not.toContainText('pecahan baru');
        await expect(preview.getByRole('row').filter({ hasText: 'varian baru' })).toHaveCount(0);
        await preview.getByRole('button', { name: /^Import \d+ Vendor$/ }).tap();
        await expect(preview).toBeHidden();

        assert.deepEqual(await sheetCounts(vendorId), before);
        assert.deepEqual(await sheetSnapshot(vendorId), snapshot);
      }
    );

    test(
      'the exported one-vendor sheet reads back as the same file',
      { session: 'owner' },
      async ({ app, screen, browser }) => {
        const vendorId = await sheetVendorId();
        const before = await sheetCounts(vendorId);
        const snapshot = await sheetSnapshot(vendorId);
        // Any sheet opens the dialog, and its export menu is per vendor — that is
        // the way an owner hands one supplier exactly its own prices.
        await app.open('/backoffice/vendors');
        await browser.locator('#vendor-product-import-file').setInputFiles(SHEET_APPEND_FIXTURE);
        const preview = screen.getByRole('dialog', { name: /Preview Import Vendor/ });
        await expect(preview).toBeVisible();

        const download = await browser.waitForDownload(() =>
          preview.getByRole('button', { name: 'Sheet per Vendor (CSV)' }).tap()
        );
        assert.match(
          download.suggestedFilename,
          /^sheet_vendor_VND-E2E-SATU_\d{4}-\d{2}-\d{2}\.csv$/
        );

        const lines = parseDownloadedCsv(readFileSync(download.absolutePath, 'utf8'));
        assert.equal(lines[0].length, SHEET_CELLS);
        assert.equal(lines[0][SHEET_CELLS - 1], 'Barcode Varian');
        // Row 1 is the vendor and nothing else — the shape the dialog teaches. The
        // seven cells are compared against the master itself, because that is the
        // promise: the sheet states the vendor exactly as the app knows it.
        const [master] = await select(
          `SELECT code, name, category, contact_person, phone, email, payment_terms_days
             FROM suppliers WHERE id = ?`,
          [vendorId]
        );
        assert.deepEqual(lines[1].slice(0, 7), [
          String(master.code),
          String(master.name),
          String(master.category ?? ''),
          String(master.contact_person ?? ''),
          String(master.phone ?? ''),
          String(master.email ?? ''),
          String(master.payment_terms_days ?? ''),
        ]);
        assert.deepEqual(lines[1].slice(7), new Array(VENDOR_ONLY_BLANK_CELLS).fill(''));
        // Every product row below it leaves the vendor block blank.
        for (const line of lines.slice(2)) {
          assert.deepEqual(line.slice(0, 7), ['', '', '', '', '', '', '']);
          assert.notEqual(line[7], '');
        }
        // One line per (variant, pack) for both products — two packs for the plain
        // one, four flavours x two packs for the varied one — plus the vendor row.
        assert.equal(lines.length, 1 + 1 + 2 + 8);
        // The sheet names each flavour by the code the app itself minted for it,
        // which is what makes handing the file back a no-op rather than a duplicate.
        assert.ok(
          lines.every((line, index) =>
            index < 2 || line[18] === '' || /^E2E-SV-00\d-[A-Z0-9]+-\d+S$/.test(line[18])
          ),
          `product rows must address variants by stored code: ${lines
            .slice(2)
            .map((line) => line[18])
            .join(', ')}`
        );

        // Close the dialog first: the file being handed back is a fresh upload, not
        // a second sheet laid over the first one's plan.
        await preview.getByRole('button', { name: 'Batal' }).tap();
        await expect(preview).toBeHidden();

        // Handing that file back is the round trip: it plans nothing new.
        await browser.locator('#vendor-product-import-file').setInputFiles(download.absolutePath);
        await expect(preview).toBeVisible();
        await expect(preview).toContainText('0 produk baru');
        await expect(preview).not.toContainText('varian baru');
        await expect(preview).not.toContainText('pecahan baru');
        // Read back as a table, not only as a headline: the file the app wrote
        // offers no row that creates a variant or a pack.
        await expect(preview.getByRole('row').filter({ hasText: 'varian baru' })).toHaveCount(0);
        await expect(preview.getByRole('row').filter({ hasText: 'pecahan baru' })).toHaveCount(0);
        // Cancel, because an export must never have to write anything to prove
        // it is readable.
        await preview.getByRole('button', { name: 'Batal' }).tap();
        await expect(preview).toBeHidden();

        assert.deepEqual(await sheetCounts(vendorId), before);
        assert.deepEqual(await sheetSnapshot(vendorId), snapshot);
      }
    );
  }
);
