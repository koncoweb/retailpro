import { test, describe } from '@e2e-dev/web';
import { expect } from 'e2e';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { tenantClient } from './support/db';
import { APP_CONTEXT } from './support/context';

/**
 * The integrated vendor catalogue: one flat sheet fills vendor, product,
 * catalogue link and buy price; a product typed from the vendor screen lands in
 * the same tables; and a purchase order picks the vendor by itself.
 *
 * The UI checks prove what the buyer sees, with `expect` on locators. The
 * database checks prove what the writers actually did — these flows exist
 * precisely so that the tables stop disagreeing with each other — so they assert
 * plain values with `node:assert` after reading them back through
 * `tests/support/db.ts`, which mints the same tenant token the app uses.
 *
 * The import cases run first and deliberately leave their rows behind: the
 * product they mint is what the purchase-order cases order, so both a full run
 * of this file and a focused run of the PO cases work on a tenant that was
 * seeded once. The vendor created by the product-form case is purged again.
 */

const FIXTURE = resolve('tests/fixtures/fixture_vendor_produk.csv');

const VENDOR_A = 'PT E2E Katalog Sumber';
const VENDOR_B = 'CV E2E Distribusi';
/** The two-pack product: piece and carton, each with its own agreed buy price. */
const CARTON_PRODUCT = 'Tepung Terigu E2E';
const SHEET_SKU = 'GUL-E2E01';

type SqlArg = string | number | null;
type Row = Record<string, SqlArg>;

async function select(sql: string, args: SqlArg[] = []): Promise<Row[]> {
  const client = await tenantClient();
  try {
    const result = await client.execute({ sql, args });
    return result.rows as unknown as Row[];
  } finally {
    client.close();
  }
}

async function mutate(sql: string, args: SqlArg[] = []): Promise<void> {
  const client = await tenantClient();
  try {
    await client.execute({ sql, args });
  } finally {
    client.close();
  }
}

/** The vendor master row, found the way the writers find it. */
async function vendorRow(name: string): Promise<Row | null> {
  const rows = await select('SELECT id, code, phone FROM suppliers WHERE name = ? COLLATE NOCASE', [
    name,
  ]);
  return rows[0] ?? null;
}

async function productRow(name: string): Promise<Row | null> {
  const rows = await select(
    'SELECT id, sku, category, supplier_id FROM products WHERE name = ? COLLATE NOCASE',
    [name]
  );
  return rows[0] ?? null;
}

/** The active buy prices this vendor agreed for one product, keyed by pack. */
async function agreedBuyPrices(vendorId: string, productId: string): Promise<Map<string, number>> {
  const rows = await select(
    `SELECT vpl.unit_name, vpl.buy_price
       FROM vendor_price_list vpl
       JOIN product_variants pv ON pv.id = vpl.variant_id
      WHERE vpl.vendor_id = ? AND pv.product_id = ? AND vpl.status = 'active'`,
    [vendorId, productId]
  );
  return new Map(rows.map((row) => [String(row.unit_name), Number(row.buy_price)]));
}

/** The vendor behind a sheet line, or a failure that says which table lost it. */
async function requireVendor(name: string): Promise<Row> {
  const vendor = await vendorRow(name);
  assert.ok(vendor, `suppliers has no row for "${name}"`);
  return vendor;
}

async function requireProduct(name: string): Promise<Row> {
  const product = await productRow(name);
  assert.ok(product, `products has no row for "${name}"`);
  return product;
}

/** Remove a vendor and everything it owns, so a row made for a test leaves. */
async function purgeVendor(vendorId: string): Promise<void> {
  for (const product of await select('SELECT id FROM products WHERE supplier_id = ?', [vendorId])) {
    await purgeProduct(String(product.id));
  }
  await mutate('DELETE FROM vendor_price_list WHERE vendor_id = ?', [vendorId]);
  await mutate('DELETE FROM vendor_products WHERE vendor_id = ?', [vendorId]);
  await mutate('DELETE FROM suppliers WHERE id = ?', [vendorId]);
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
  await mutate('DELETE FROM products WHERE id = ?', [productId]);
}

/**
 * Remove everything this file's sheet and forms create, so a run starts clean.
 * The product-form case only purges its own vendor on its last step, so an
 * attempt that failed halfway leaves one behind — sweep those by name too.
 */
async function purgeFixtureRows(): Promise<void> {
  for (const stray of await select("SELECT id FROM suppliers WHERE name LIKE 'PT E2E Pintu Produk%'")) {
    await purgeVendor(String(stray.id));
  }
  for (const name of [VENDOR_A, VENDOR_B]) {
    const vendor = await vendorRow(name);
    if (vendor) await purgeVendor(String(vendor.id));
  }
  for (const name of [CARTON_PRODUCT, 'Gula Pasir E2E', 'Minyak Goreng E2E']) {
    const product = await productRow(name);
    if (product) await purgeProduct(String(product.id));
  }
}

describe(
  'vendor catalogue and purchase order auto-fill',
  { tags: ['owner', 'vendor'], agentContext: APP_CONTEXT },
  () => {
    test(
      'the flat sheet writes vendor, product, catalogue link and buy prices',
      { session: 'owner' },
      async ({ app, screen, browser }) => {
        assert.ok(existsSync(FIXTURE), `Missing e2e fixture: ${FIXTURE}`);

        // Masters are additive on purpose, so a second run of this file would
        // read back the phone the re-import case wrote. Start from an empty
        // fixture universe: this case is about rows being created.
        await purgeFixtureRows();

        await app.open('/backoffice/vendors');
        await expect(screen.getByRole('heading', 'Vendor', { level: 1 })).toBeVisible();

        // The button behind this input only opens the operating system's picker,
        // so the sheet is handed straight to the input that picker would fill.
        await browser.locator('#vendor-product-import-file').setInputFiles(FIXTURE);

        // Nothing is written before the buyer has seen the plan.
        const preview = screen.getByRole('dialog', { name: /Preview Import Vendor/ });
        await expect(preview).toBeVisible();
        await expect(preview.getByText(VENDOR_A).first()).toBeVisible();
        await preview.getByRole('button', { name: /^Import \d+ Vendor$/ }).tap();
        await expect(preview).toBeHidden();

        const vendor = await requireVendor(VENDOR_A);
        // A sheet that never mentions a code still gets a real master row: the
        // code is minted from the vendor sequence instead of left blank, which
        // is exactly what the old vendor-import stub used to do.
        assert.match(String(vendor.code), /^VND-\d+$/);
        assert.equal(String(vendor.phone), '0812000001000');

        const product = await requireProduct(CARTON_PRODUCT);
        assert.equal(product.supplier_id, vendor.id);
        // The blank `SKU` column is continued by the app's own sequence.
        assert.ok(String(product.sku).length > 2, 'the import left the SKU blank');

        const packs = await select(
          `SELECT u.name, u.conversion_factor FROM product_units u
             JOIN product_variants v ON v.id = u.variant_id
            WHERE v.product_id = ? ORDER BY u.conversion_factor`,
          [String(product.id)]
        );
        assert.deepEqual(
          packs.map((row) => `${row.name}x${row.conversion_factor}`),
          ['Pcsx1', 'Kartonx24']
        );

        // One catalogue row, preferred: this is the row the PO auto-fill reads.
        const links = await select(
          'SELECT is_preferred, last_cost FROM vendor_products WHERE vendor_id = ? AND product_id = ?',
          [String(vendor.id), String(product.id)]
        );
        assert.equal(links.length, 1);
        assert.equal(Number(links[0].is_preferred), 1);
        assert.equal(Number(links[0].last_cost), 9000);

        // One buy price per pack, because that is how the vendor quoted them.
        const prices = await agreedBuyPrices(String(vendor.id), String(product.id));
        assert.equal(prices.get('Pcs'), 9000);
        assert.equal(prices.get('Karton'), 205000);

        // Provenance: the sheet says so on the price row it wrote.
        const noted = await select(
          `SELECT notes FROM vendor_price_list WHERE vendor_id = ? AND unit_name = 'Pcs'`,
          [String(vendor.id)]
        );
        assert.match(String(noted[0].notes), /import/);

        // The line that carried its own SKU can be found by code on a next sheet.
        const bySku = await select('SELECT id FROM products WHERE sku = ?', [SHEET_SKU]);
        assert.equal(bySku.length, 1);
      }
    );

    test(
      'importing the same sheet again adds nothing and reprices what the sheet says',
      { session: 'owner' },
      async ({ app, screen, browser }) => {
        assert.ok(existsSync(FIXTURE), `Missing e2e fixture: ${FIXTURE}`);

        const before = await requireVendor(VENDOR_A);
        const made = await requireProduct(CARTON_PRODUCT);
        const vendorId = String(before.id);
        const productId = String(made.id);

        // Somebody edited the master in the app, and a delivery moved the agreed
        // price behind the sheet. The re-import has to tell those two apart.
        await mutate('UPDATE suppliers SET phone = ? WHERE id = ?', ['081100009999', vendorId]);
        await mutate(
          `UPDATE vendor_price_list SET buy_price = 999000
             WHERE vendor_id = ? AND variant_id =
               (SELECT id FROM product_variants WHERE product_id = ? LIMIT 1) AND unit_name = 'Pcs'`,
          [vendorId, productId]
        );

        await app.open('/backoffice/vendors');
        await browser.locator('#vendor-product-import-file').setInputFiles(FIXTURE);
        const preview = screen.getByRole('dialog', { name: /Preview Import Vendor/ });
        await expect(preview).toBeVisible();
        await preview.getByRole('button', { name: /^Import \d+ Vendor$/ }).tap();
        await expect(preview).toBeHidden();

        // Masters are additive: the same vendor row, its minted code untouched,
        // and the phone the sheet re-types does not overwrite the edit.
        const after = await requireVendor(VENDOR_A);
        assert.equal(String(after.id), vendorId);
        assert.equal(String(after.code), String(before.code));
        assert.equal(String(after.phone), '081100009999');

        const duplicates = await select(
          'SELECT id FROM products WHERE name = ? COLLATE NOCASE',
          [CARTON_PRODUCT]
        );
        assert.equal(duplicates.length, 1);

        // Prices follow the sheet: the agreement is back at the quoted number.
        const prices = await agreedBuyPrices(vendorId, productId);
        assert.equal(prices.get('Pcs'), 9000);
        assert.equal(prices.get('Karton'), 205000);
      }
    );

    test(
      'adding a vendor hands straight to a product form that is filled with it',
      { session: 'owner' },
      async ({ app, screen, browser }) => {
        const stamp = Date.now().toString(36).toUpperCase().slice(-5);
        const vendorName = `PT E2E Pintu Produk ${stamp}`;
        const productName = `Susu Kental E2E ${stamp}`;

        await app.open('/backoffice/vendors');
        await screen.getByRole('button', { name: 'Tambah Vendor' }).tap();

        const form = screen.getByRole('dialog', { name: 'Tambah Vendor Baru' });
        await form.getByLabel(/Nama Vendor/).fill(vendorName);
        await form.getByLabel(/Telepon/).fill('081200007777');
        await form.getByRole('button', { name: 'Tambah Vendor' }).tap();

        // Saving a vendor used to leave the buyer on the list. The save now
        // carries them into the vendor's own screen with the product form open.
        await expect(browser).toHaveURL(/\/backoffice\/vendors\/[0-9a-f-]+$/);
        await expect(screen.getByRole('heading', vendorName, { level: 1 })).toBeVisible();

        const productForm = screen.getByRole('dialog', { name: 'Tambah Produk Baru' });
        await expect(productForm).toBeVisible();
        // The vendor is not a hint in the header: it is the value of the form's
        // supplier field, so saving files the product in this catalogue.
        const supplier = productForm.getByRole('combobox', { name: 'Supplier' });
        await expect(supplier).toBeVisible();
        await expect(supplier).toContainText(vendorName);

        await productForm.getByPlaceholder('PRD-007').fill(`E2E-PINTU-${stamp}`);
        await productForm.getByPlaceholder('Nama produk').fill(productName);
        await productForm.getByRole('combobox', { name: /Kategori/ }).tap();
        await screen.getByRole('option', { visible: true }).first().tap();
        await productForm.getByLabel(/Harga Beli/).fill('4000');
        await productForm.getByLabel(/Harga Jual/).fill('6000');
        await productForm.getByRole('button', { name: 'Simpan Produk' }).tap();
        await expect(productForm).toBeHidden();

        // Both tabs of the vendor now know the product: the catalogue row, and
        // the agreed buy price — which is what a PO reads next time.
        const panel = screen.getByRole('tabpanel', { visible: true });
        await expect(panel.getByText(productName, { exact: true })).toBeVisible();
        await screen.getByRole('tab', { name: /Harga Beli/ }).tap();
        // The buy-price table prints product and minted SKU in one cell
        // (`Susu Kental E2E · SKU`), so the panel is what has to contain the
        // name — not a text node that only exists on the catalogue tab.
        await expect(panel).toContainText(productName);
        await expect(panel).toContainText('4.000');

        const vendor = await requireVendor(vendorName);
        const stored = await requireProduct(productName);
        assert.equal(stored.supplier_id, vendor.id);
        assert.equal(
          (await agreedBuyPrices(String(vendor.id), String(stored.id))).get('Pcs'),
          4000
        );

        await purgeVendor(String(vendor.id));
      }
    );

    test(
      'choosing a product in a purchase order chooses its vendor and quotes it',
      { session: 'owner' },
      async ({ app, screen, browser }) => {
        await app.open('/backoffice/inventory/po');
        await screen.getByRole('button', { name: 'Buat PO' }).tap();

        const order = screen.getByRole('dialog', { name: 'Buat Purchase Order' });
        await expect(order).toBeVisible();

        // With no vendor chosen yet, each line says who it would order from
        // before the buyer clicks it. The picker is a `role="combobox"` button,
        // so it is reached by the id its label points at, not by a name.
        await browser.locator('#po-product-picker').tap();
        await screen.getByPlaceholder('Cari produk...').fill(CARTON_PRODUCT);
        const suggestion = screen.getByRole('option', { name: new RegExp(CARTON_PRODUCT) });
        await expect(suggestion).toContainText(VENDOR_A);
        await suggestion.tap();

        // The vendor field filled itself, and says that it did.
        await expect(screen.getByText('Vendor (otomatis dari produk)')).toBeVisible();
        await expect(browser.locator('#po-vendor')).toContainText(VENDOR_A);

        // The agreed price for the chosen pack arrived with the vendor: the
        // piece price, not something typed for another vendor earlier.
        await expect(order.getByText(/Harga kesepakatan vendor/)).toBeVisible();
        await expect(order.getByPlaceholder('Harga Satuan')).toHaveValue('9000');

        // Put the line in the cart, then try to move the whole order elsewhere.
        await order.getByPlaceholder('Jumlah').fill('2');
        await order.getByRole('button', { name: 'Tambahkan baris ke order' }).tap();
        const cart = order.getByRole('table');
        await expect(cart.getByText(CARTON_PRODUCT, { exact: true })).toBeVisible();

        await browser.locator('#po-vendor').tap();
        await screen.getByRole('option', { name: new RegExp(VENDOR_B) }).tap();

        // Dropping another vendor's lines is said out loud, not done in silence.
        const confirm = screen.getByRole('alertdialog', { name: /Ganti vendor ke/ });
        await expect(confirm).toBeVisible();
        await expect(confirm).toContainText('1 baris');
        await confirm.getByRole('button', { name: 'Batal' }).tap();
        await expect(confirm).toBeHidden();

        // Cancelling keeps the draft exactly as it was, vendor included.
        await expect(cart.getByText(CARTON_PRODUCT, { exact: true })).toBeVisible();
        await expect(browser.locator('#po-vendor')).toContainText(VENDOR_A);

        await browser.locator('#po-vendor').tap();
        await screen.getByRole('option', { name: new RegExp(VENDOR_B) }).tap();
        await expect(confirm).toBeVisible();
        await confirm.getByRole('button', { name: 'Ganti vendor' }).tap();
        await expect(cart.getByText(CARTON_PRODUCT, { exact: true }).first()).toBeHidden();
        await expect(browser.locator('#po-vendor')).toContainText(VENDOR_B);

        // The order is abandoned, never saved: nothing lands in the tenant.
        await order.getByRole('button', { name: 'Batal' }).tap();
        await expect(order).toBeHidden();
      }
    );
  }
);
