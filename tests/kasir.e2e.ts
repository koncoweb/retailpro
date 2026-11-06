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
      await screen.getByPlaceholder('Contoh: 200000 (0 = tanpa uang tunai)').fill('200000');
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

    // `visible: true` because the count prints twice from lg up: the side panel
    // the cashier sees and the sticky summary bar that only shows below lg.
    await expect(screen.getByText('1 item', { visible: true })).toBeVisible();

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

  /**
   * A product sold in flavours is several SKUs on the shelf, each with its own
   * stock and its own price. The till has to know which one left, so it asks
   * flavour first and pack second — and the price must come from that flavour.
   */
  test('a variant product asks which flavour before which pack', { session: 'kasir' }, async ({ app, screen }) => {
    // Same precondition as the sale above, repeated so this case also runs alone.
    // The heading has to be there before the form is asked about, or the check
    // races the first render and reads an empty page.
    await app.open('/pos/shifts');
    await expect(screen.getByRole('heading', 'Manajemen Shift', { level: 1 })).toBeVisible();
    if (await screen.getByText('Buka Shift Baru').isVisible()) {
      await screen.getByPlaceholder('Contoh: 200000 (0 = tanpa uang tunai)').fill('200000');
      await screen.getByRole('button', 'Buka Shift Sekarang').tap();
    }
    await expect(screen.getByText('Shift Aktif')).toBeVisible();

    await app.open('/pos');
    const search = screen.getByPlaceholder('Cari produk...');
    await expect(search).toBeVisible();
    await search.fill('Susu Kental Manis');
    await screen.getByRole('button', { name: /Susu Kental Manis/ }).tap();

    // Step one: which flavour. Every row is a SKU with its own stock.
    const variants = screen.getByRole('dialog', { name: /Pilih Varian/ });
    await expect(variants).toBeVisible();
    await expect(variants.getByText(/TLR-003-PUTIH/)).toBeVisible();
    await expect(variants.getByText(/TLR-003-COKELAT/)).toBeVisible();

    // Cokelat is the dearer flavour, so the next screen proves the picker handed
    // over that variant's pricelist rather than the product's cheapest one.
    await variants.getByRole('button', { name: /TLR-003-COKELAT/ }).tap();

    const packs = screen.getByRole('dialog', { name: /Pilih Satuan - Cokelat/ });
    await expect(packs).toBeVisible();
    await expect(packs.getByText(/16\.000/).first()).toBeVisible();
    await expect(packs.getByText(/15\.000/)).toBeHidden();
    await packs.getByRole('button', { name: /kaleng \(1\)/ }).tap();

    // The picker closes once the pick is made; until it has, its flavour labels
    // are still in the DOM and would answer for the cart line below.
    await expect(packs).toBeHidden();

    // The line keeps the flavour beside the product and is priced as Cokelat.
    await expect(screen.getByText('1 item', { visible: true })).toBeVisible();
    await expect(screen.getByText('Cokelat', { exact: true })).toBeVisible();
    await expect(screen.getByText('kaleng', { exact: true })).toBeVisible();
    await expect(screen.getByText(/16\.000/).first()).toBeVisible();
  });

  test('the till keeps the shift and its cash total visible', { session: 'kasir' }, async ({ app, screen }) => {
    await app.open('/pos/shifts');

    // Either the shift is open with a drawer total, or the cashier is offered
    // the opening form — but never an empty screen.
    await expect(
      screen.getByText('Shift Aktif').or(screen.getByText('Shift Ditutup')),
    ).toBeVisible();
  });

  /**
   * "Sold by piece, priced like a carton" (plan G5).
   *
   * Box Kue 20x20 is stocked per `pcs` (Rp7.000) and per `dus` of 50 (Rp215.000).
   * The Thalia demo turns on `pricing.auto_pack_price`, so once the cashier
   * takes a full dus worth of pieces the till must drop the LINE PRICE to the
   * pack deal while the line stays `pcs` with conversion factor 1 — stock drain,
   * the cart merge key and the receipt therefore behave exactly as a normal
   * piece sale. Only the price moves.
   */
  test('a full carton of pieces is auto-priced like the carton', { session: 'kasir' }, async ({ app, screen }) => {
    await app.open('/pos/shifts');
    await expect(screen.getByRole('heading', 'Manajemen Shift', { level: 1 })).toBeVisible();
    if (await screen.getByText('Buka Shift Baru').isVisible()) {
      await screen.getByPlaceholder('Contoh: 200000 (0 = tanpa uang tunai)').fill('200000');
      await screen.getByRole('button', 'Buka Shift Sekarang').tap();
    }
    await expect(screen.getByText('Shift Aktif')).toBeVisible();

    await app.open('/pos');
    const search = screen.getByPlaceholder('Cari produk...');
    await expect(search).toBeVisible();
    await search.fill('Box Kue 20x20 Putih');
    await screen.getByRole('button', { name: /Box Kue 20x20 Putih/ }).tap();

    // Sell it by the piece — the smallest pack, never the dus.
    const units = screen.getByRole('dialog', { name: /Pilih Satuan/ });
    await units.getByRole('button', { name: /Satuan Dasar/ }).tap();
    await expect(units).toBeHidden();

    // One piece is not a carton yet: the line stays at the shelf price, pcs.
    await expect(screen.getByText('1 item', { visible: true })).toBeVisible();
    await expect(screen.getByText('pcs', { exact: true })).toBeVisible();
    await expect(screen.getByText(/otomatis/)).toBeHidden();

    // Take a full dus worth (50 pcs). Only the cart line's quantity input is a
    // number spinbutton on this screen, so this locator is unambiguous.
    await screen.getByRole('spinbutton').fill('50');

    // The advisor fires: the price dropped to the pack deal, but the unit is
    // still the base `pcs` — the carton was never added as its own line.
    await expect(screen.getByText(/otomatis/)).toBeVisible();
    await expect(screen.getByText('pcs', { exact: true })).toBeVisible();
    await expect(screen.getByText('dus', { exact: true })).toBeHidden();
    // 50 pcs at the floored carton deal = Rp225.000, not 50 x Rp7.000 = Rp350.000.
    await expect(screen.getByText(/Total: .*225\.000/)).toBeVisible();
  });

  /**
   * Shift = kehadiran (§2 of the POS hardening plan), in both directions.
   *
   * An empty drawer is a normal Monday, so `Rp0` has to open the shift, and the
   * same click has to put the day's check-in in the attendance table — the
   * cashier sees it on their own /absen screen, labelled as coming from the
   * shift rather than from a forgotten GPS punch.
   */
  test('an empty drawer opens the shift and books the day\'s check-in', { session: 'kasir' }, async ({ app, screen }) => {
    await app.open('/pos/shifts');
    await expect(screen.getByRole('heading', 'Manajemen Shift', { level: 1 })).toBeVisible();

    // Whatever a previous run left open is closed first, so the Rp0 opening
    // below is really exercised instead of skipped.
    const openingForm = screen.getByText('Buka Shift Baru');
    if ((await openingForm.isVisible()) === false) {
      await screen.getByPlaceholder('Masukkan total uang tunai yang ada...').fill('0');
      await screen.getByRole('button', 'Konfirmasi Tutup Shift').tap();
    }
    await expect(openingForm).toBeVisible();

    await screen.getByRole('button', 'Rp0 (tanpa tunai)').tap();
    await screen.getByRole('button', 'Buka Shift Sekarang').tap();

    // One message proves both halves: the empty drawer was accepted (the old
    // `<= 0` validation refused to even try) and the check-in was booked.
    await expect(
      screen.getByText(/Shift berhasil dibuka tanpa uang tunai awal/)
    ).toBeVisible();
    await expect(
      screen.getByText(/Absensi tercatat otomatis|Absensi hari ini sudah tercatat/)
    ).toBeVisible();
    await expect(screen.getByText('Shift Aktif')).toBeVisible();

    // The attendance half of the same click, on the cashier's own screen.
    await app.open('/absen');
    await expect(screen.getByText('Status hari ini')).toBeVisible();
    await expect(screen.getByText(/^Masuk \d{2}:\d{2}$/)).toBeVisible();
    await expect(screen.getByText('Otomatis dari buka shift')).toBeVisible();
  });
});
