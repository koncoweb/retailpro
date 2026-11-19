import { describe, test, type Browser } from '@e2e-dev/web';
import { expect, type App, type Screen } from 'e2e';
import assert from 'node:assert/strict';
import { executeTenant, type TenantArg } from './support/db';
import { APP_CONTEXT } from './support/context';

type Row = Record<string, unknown>;

async function select(sql: string, args: TenantArg[] = []): Promise<Row[]> {
  const result = await executeTenant(sql, args);
  return result.rows as unknown as Row[];
}

async function mutate(sql: string, args: TenantArg[] = []): Promise<void> {
  await executeTenant(sql, args);
}

async function purgeFixture(ids: {
  vendorId: string;
  productId: string;
  variantId: string;
  unitId: string;
}): Promise<void> {
  const orders = await select('SELECT id FROM purchase_orders WHERE supplier_id = ?', [ids.vendorId]);
  for (const order of orders) {
    const orderId = String(order.id);
    const receipts = await select('SELECT id FROM goods_receipts WHERE purchase_order_id = ?', [orderId]);
    for (const receipt of receipts) {
      const receiptId = String(receipt.id);
      await mutate('DELETE FROM expenses WHERE goods_receipt_id = ?', [receiptId]);
      await mutate('DELETE FROM goods_receipt_items WHERE goods_receipt_id = ?', [receiptId]);
      await mutate('DELETE FROM product_batches WHERE goods_receipt_id = ?', [receiptId]);
      await mutate('DELETE FROM goods_receipts WHERE id = ?', [receiptId]);
    }
    await mutate('DELETE FROM purchase_order_items WHERE purchase_order_id = ?', [orderId]);
    await mutate('DELETE FROM purchase_orders WHERE id = ?', [orderId]);
  }
  await mutate('DELETE FROM vendor_price_list WHERE vendor_id = ? OR variant_id = ?', [ids.vendorId, ids.variantId]);
  await mutate('DELETE FROM vendor_products WHERE vendor_id = ? OR product_id = ?', [ids.vendorId, ids.productId]);
  await mutate('DELETE FROM product_units WHERE id = ?', [ids.unitId]);
  await mutate('DELETE FROM product_variants WHERE id = ?', [ids.variantId]);
  await mutate('DELETE FROM products WHERE id = ?', [ids.productId]);
  await mutate('DELETE FROM suppliers WHERE id = ?', [ids.vendorId]);
}

async function seedFixture(stamp: string) {
  const suffix = stamp.toLowerCase();
  const ids = {
    vendorId: `e2e-ppn-vendor-${suffix}`,
    productId: `e2e-ppn-product-${suffix}`,
    variantId: `e2e-ppn-variant-${suffix}`,
    unitId: `e2e-ppn-unit-${suffix}`,
  };
  const vendorName = `PT E2E PPN ${stamp}`;
  const productName = `Bahan E2E PPN ${stamp}`;
  const sku = `PPN-${stamp}`;

  await mutate(
    `INSERT INTO suppliers
       (id, name, code, category, status, payment_terms_days, lead_time_days, ppn_enabled)
     VALUES (?, ?, ?, 'supplier', 'active', 0, 0, 0)`,
    [ids.vendorId, vendorName, `VPPN-${stamp}`,]
  );
  await mutate(
    `INSERT INTO products (id, sku, name, cost_price, min_stock_level, supplier_id)
     VALUES (?, ?, ?, 500000, 0, ?)`,
    [ids.productId, sku, productName, ids.vendorId]
  );
  await mutate(
    `INSERT INTO product_variants (id, product_id, sku, name, attributes, cost_price, price)
     VALUES (?, ?, ?, ?, '{}', 500000, 600000)`,
    [ids.variantId, ids.productId, sku, productName]
  );
  await mutate(
    `INSERT INTO product_units (id, product_id, variant_id, name, conversion_factor, cost, price)
     VALUES (?, ?, ?, 'Pcs', 1, 500000, 600000)`,
    [ids.unitId, ids.productId, ids.variantId]
  );
  await mutate(
    `INSERT INTO vendor_products
       (id, vendor_id, product_id, last_cost, lead_time_days, min_order_qty, is_preferred)
     VALUES (?, ?, ?, 500000, 0, 1, 1)`,
    [`e2e-ppn-link-${suffix}`, ids.vendorId, ids.productId]
  );

  return { ...ids, vendorName, productName, sku };
}

async function setVendorPpn(
  app: App,
  screen: Screen,
  browser: Browser,
  vendorName: string,
  enabled: boolean
): Promise<void> {
  await app.open('/backoffice/vendors');
  const search = screen.getByPlaceholder('Cari nama, kode, kontak, atau email...');
  await search.fill(vendorName);
  const row = browser.locator('tr').filter({ hasText: vendorName });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Edit' }).tap();

  const form = screen.getByRole('dialog', { name: 'Edit Vendor' });
  await expect(form).toBeVisible();
  const toggle = form.getByRole('switch', { name: 'Vendor PPN 11 persen' });
  const checked = await toggle.getAttribute('data-state');
  if ((checked === 'checked') !== enabled) await toggle.tap();
  await form.getByRole('button', { name: 'Simpan Perubahan' }).tap();
  await expect(form).toBeHidden();

  await app.open('/backoffice/vendors');
  await screen.getByPlaceholder('Cari nama, kode, kontak, atau email...').fill(vendorName);
  const reloaded = browser.locator('tr').filter({ hasText: vendorName });
  await expect(reloaded).toContainText(enabled ? 'PPN 11%' : 'Non-PPN');
}

async function createOrder(
  app: App,
  screen: Screen,
  browser: Browser,
  fixture: { vendorId: string; productName: string },
  quantity: string,
  note: string,
  submit: boolean
): Promise<Row> {
  await app.open('/backoffice/inventory/po');
  await screen.getByRole('button', { name: 'Buat PO' }).tap();
  const dialog = screen.getByRole('dialog', { name: 'Buat Purchase Order' });
  await expect(dialog).toBeVisible();

  await browser.locator('#po-product-picker').tap();
  await screen.getByPlaceholder('Cari produk...').fill(fixture.productName);
  await screen.getByRole('option', { name: new RegExp(fixture.productName) }).tap();
  await dialog.getByPlaceholder('Jumlah').fill(quantity);
  await dialog.getByRole('button', { name: 'Tambahkan baris ke order' }).tap();
  await dialog.getByPlaceholder('Catatan untuk PO ini...').fill(note);
  await dialog.getByRole('button', { name: submit ? 'Simpan & Ajukan' : 'Simpan Draf' }).tap();
  await expect(dialog).toBeHidden();

  const rows = await select(
    `SELECT id, po_number, status, subtotal_amount, ppn_rate, ppn_amount, total_amount
       FROM purchase_orders WHERE supplier_id = ? AND notes = ?`,
    [fixture.vendorId, note]
  );
  assert.equal(rows.length, 1, `expected one PO for ${note}`);
  return rows[0];
}

describe(
  'vendor PPN purchase-order snapshots',
  { tags: ['owner', 'vendor', 'purchase-order', 'ppn'], agentContext: APP_CONTEXT },
  () => {
    test(
      'persists vendor PPN, keeps historical PO tax, and books a gross partial receipt',
      { session: 'owner' },
      async ({ app, screen, browser }) => {
        const stamp = Date.now().toString(36).toUpperCase().slice(-6);
        const fixture = await seedFixture(stamp);

        try {
          await setVendorPpn(app, screen, browser, fixture.vendorName, true);
          assert.equal(Number((await select('SELECT ppn_enabled FROM suppliers WHERE id = ?', [fixture.vendorId]))[0].ppn_enabled), 1);

          const taxable = await createOrder(
            app,
            screen,
            browser,
            fixture,
            '2',
            `PPN taxable ${stamp}`,
            true
          );
          assert.deepEqual(
            {
              status: taxable.status,
              subtotal: Number(taxable.subtotal_amount),
              rate: Number(taxable.ppn_rate),
              tax: Number(taxable.ppn_amount),
              total: Number(taxable.total_amount),
            },
            { status: 'submitted', subtotal: 1_000_000, rate: 11, tax: 110_000, total: 1_110_000 }
          );

          await app.open('/backoffice/inventory/po');
          await screen.getByPlaceholder('Cari nomor PO atau vendor...').fill(String(taxable.po_number));
          const taxableRow = browser.locator('tr').filter({ hasText: String(taxable.po_number) });
          await expect(taxableRow).toContainText('Rp 1.110.000');
          await taxableRow.getByRole('button', { name: String(taxable.po_number) }).tap();
          const detail = screen.getByRole('dialog', { name: String(taxable.po_number) });
          await expect(detail).toContainText('PPN 11%');
          await expect(detail).toContainText('Rp 110.000');
          await expect(detail).toContainText('Rp 1.110.000');

          const printButton = detail.getByRole('button', { name: 'Cetak / Simpan PDF' });
          await expect(printButton).toBeVisible();
          await browser.evaluate(() => {
            const originalCreate = document.createElement.bind(document);
            document.createElement = ((tagName: string, options?: ElementCreationOptions) => {
              const node = originalCreate(tagName, options);
              if (tagName.toLowerCase() === 'iframe' && node instanceof HTMLIFrameElement) {
                node.addEventListener('load', () => {
                  const marker = originalCreate('pre');
                  marker.setAttribute('data-e2e-po-print-capture', 'true');
                  marker.style.display = 'none';
                  marker.textContent = node.contentDocument?.documentElement.outerHTML ?? '';
                  document.body.appendChild(marker);
                }, { once: true });
                document.createElement = originalCreate;
              }
              return node;
            }) as typeof document.createElement;
            return true;
          });
          await printButton.tap();
          const printCapture = browser.locator('[data-e2e-po-print-capture="true"]');
          await expect(printCapture).toContainText(String(taxable.po_number));
          await expect(printCapture).toContainText(fixture.vendorName);
          await expect(printCapture).toContainText('PPN 11%');
          await expect(printCapture).toContainText('Total Pembayaran');
          await expect(printCapture).toContainText('Rp&nbsp;1.110.000');
          await expect(printCapture).toContainText('bukan faktur pajak');
          await detail.getByRole('button', { name: 'Tutup' }).tap();

          await setVendorPpn(app, screen, browser, fixture.vendorName, false);
          assert.equal(Number((await select('SELECT ppn_enabled FROM suppliers WHERE id = ?', [fixture.vendorId]))[0].ppn_enabled), 0);

          const nonTaxable = await createOrder(
            app,
            screen,
            browser,
            fixture,
            '1',
            `PPN non-taxable ${stamp}`,
            false
          );
          assert.deepEqual(
            {
              status: nonTaxable.status,
              subtotal: Number(nonTaxable.subtotal_amount),
              rate: Number(nonTaxable.ppn_rate),
              tax: Number(nonTaxable.ppn_amount),
              total: Number(nonTaxable.total_amount),
            },
            { status: 'draft', subtotal: 500_000, rate: 0, tax: 0, total: 500_000 }
          );

          const historical = (await select(
            'SELECT ppn_rate, ppn_amount, total_amount FROM purchase_orders WHERE id = ?',
            [String(taxable.id)]
          ))[0];
          assert.deepEqual(
            [Number(historical.ppn_rate), Number(historical.ppn_amount), Number(historical.total_amount)],
            [11, 110_000, 1_110_000]
          );

          await app.open('/backoffice/inventory/po');
          await screen.getByPlaceholder('Cari nomor PO atau vendor...').fill(String(taxable.po_number));
          let row = browser.locator('tr').filter({ hasText: String(taxable.po_number) });
          await row.getByRole('button', { name: 'Setujui' }).tap();
          await expect(row).toContainText('Disetujui');
          await row.getByRole('button', { name: 'Terima Barang' }).tap();

          const receipt = screen.getByRole('dialog', { name: new RegExp(`Terima Barang.*${taxable.po_number}`) });
          await expect(receipt).toBeVisible();
          const numericInputs = browser.locator('[role="dialog"] tr input[type="number"]');
          await numericInputs.nth(0).fill('1');
          await numericInputs.nth(1).fill('600000');
          await expect(receipt).toContainText('Rp 600.000');
          await expect(receipt).toContainText('Rp 66.000');
          await expect(receipt).toContainText('Rp 666.000');
          await receipt.getByRole('button', { name: 'Simpan Penerimaan' }).tap();
          await expect(receipt).toBeHidden();

          const receipts = await select(
            `SELECT id, subtotal_amount, ppn_rate, ppn_amount, total_amount
               FROM goods_receipts WHERE purchase_order_id = ?`,
            [String(taxable.id)]
          );
          assert.equal(receipts.length, 1);
          assert.deepEqual(
            [
              Number(receipts[0].subtotal_amount),
              Number(receipts[0].ppn_rate),
              Number(receipts[0].ppn_amount),
              Number(receipts[0].total_amount),
            ],
            [600_000, 11, 66_000, 666_000]
          );
          const expense = (await select(
            'SELECT amount, amount_paid FROM expenses WHERE goods_receipt_id = ?',
            [String(receipts[0].id)]
          ))[0];
          assert.deepEqual([Number(expense.amount), Number(expense.amount_paid)], [666_000, 666_000]);
          const batch = (await select(
            'SELECT cost_price FROM product_batches WHERE goods_receipt_id = ?',
            [String(receipts[0].id)]
          ))[0];
          assert.equal(Number(batch.cost_price), 600_000);

          await app.open('/backoffice/inventory/po');
          await screen.getByPlaceholder('Cari nomor PO atau vendor...').fill(String(taxable.po_number));
          row = browser.locator('tr').filter({ hasText: String(taxable.po_number) });
          await row.getByRole('button', { name: String(taxable.po_number) }).tap();
          const reopened = screen.getByRole('dialog', { name: String(taxable.po_number) });
          await expect(reopened).toContainText('PPN 11%');
          await expect(reopened).toContainText('Rp 66.000');
          await expect(reopened).toContainText('Rp 666.000');
          await expect(reopened.getByRole('button', { name: 'Cetak / Simpan PDF' })).toBeVisible();
        } finally {
          await purgeFixture(fixture);
        }
      }
    );
  }
);
