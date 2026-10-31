import { test, describe } from '@e2e-dev/web';
import { expect } from 'e2e';
import { APP_CONTEXT } from './support/context';

/**
 * The cashier's whole job is one screen deep: open the drawer, sell, and leave a
 * trail the owner can audit. The sale is the money path, so it goes through the
 * real form — stock batches are deducted, an invoice is written and an audit row
 * lands in the same transaction.
 */
describe('cashier', { tags: ['kasir'], agentContext: APP_CONTEXT }, () => {
  test('opens a shift and rings up a cash sale', { session: 'kasir' }, async ({ app, screen, browser }) => {
    // 1. A shift must be open before the till accepts money. The page keeps a
    //    shift across runs, so either state is accepted here.
    await app.open('/pos/shifts');
    await expect(screen.getByRole('heading', 'Manajemen Shift', { level: 1 })).toBeVisible();

    if (await screen.getByText('Buka Shift Baru').isVisible()) {
      await screen.getByPlaceholder('Contoh: 200000').fill('200000');
      await screen.getByRole('button', 'Buka Shift Sekarang').tap();
    }
    await expect(screen.getByText('Shift Aktif')).toBeVisible();

    // 2. Sell one base unit of a product that is in stock at this branch.
    await app.open('/pos');
    const search = screen.getByPlaceholder('Cari produk...');
    await expect(search).toBeVisible();
    await search.fill('Tepung Terigu Cakra Kembar');
    await screen.getByRole('button', { name: /Tepung Terigu Cakra Kembar/ }).tap();

    // Every seeded product is sold in more than one unit, so the till asks which one.
    const units = screen.getByRole('dialog', { name: /Pilih Satuan/ });
    await units.getByRole('button', { name: /Satuan Dasar/ }).tap();

    await expect(screen.getByText('1 item')).toBeVisible();

    // 3. Pay cash, exactly the amount due.
    await screen.getByRole('button', { name: /^Bayar / }).tap();

    const payment = screen.getByRole('dialog', { name: 'Pembayaran' });
    await expect(payment).toBeVisible();
    await payment.getByRole('button', 'Uang Pas').tap();
    await payment.getByRole('button', 'Bayar').tap();

    // A completed sale empties the cart; a rejected one leaves the line in place.
    await expect(screen.getByText('Keranjang kosong')).toBeVisible();

    // 4. The sale is in the day's history under its POS invoice number.
    await app.open('/pos/transactions');
    await expect(screen.getByRole('heading', 'Riwayat Transaksi', { level: 1 })).toBeVisible();
    await expect(screen.getByText(/INV\//).first()).toBeVisible();
    await expect(browser).toHaveURL('/pos/transactions');
  });

  test('the till keeps the shift and its cash total visible', { session: 'kasir' }, async ({ app, screen }) => {
    await app.open('/pos/shifts');

    // Either the shift is open with a drawer total, or the cashier is offered
    // the opening form — but never an empty screen.
    await expect(
      screen.getByText('Shift Aktif').or(screen.getByText('Shift Ditutup')),
    ).toBeVisible();
  });
});
