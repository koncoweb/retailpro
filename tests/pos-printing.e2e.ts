import { test, describe } from '@e2e-dev/web';
import { expect } from 'e2e';
import { APP_CONTEXT } from './support/context';

/**
 * Printing is the POS feature that touches real hardware, so a headless run
 * can never prove a strip of paper came out. What it *can* prove — and what
 * this suite pins down — is the wiring around it: the settings screen exposes
 * the transport picker, the checkout path stays green while a fire-and-forget
 * print happens, the history screen offers a reprint control, and closing a
 * shift offers a Z-report. The physical `driver`/`usb`/`bluetooth` transports
 * are intentionally out of scope here (see the plan's test matrix): in this
 * browser `window.print()` is inert, so we assert the UI *reacts* to a print
 * attempt (a toast) rather than the bytes a printer would receive. Those are
 * covered by the pure `src/lib/print/__tests__` unit tests instead.
 */
describe('pos-printing', { tags: ['kasir', 'owner'], agentContext: APP_CONTEXT }, () => {
  // 1. The tenant-level transport picker lives under Settings → Perusahaan, in
  //    the "Printer & Koneksi" block of the receipt panel. Nothing is written
  //    here; we only prove the controls are reachable.
  test('the receipt settings expose the printer transport picker', { session: 'owner' }, async ({ app, screen }) => {
    await app.open('/backoffice/settings');
    await expect(screen.getByRole('heading', 'Pengaturan', { level: 1 })).toBeVisible();

    await screen.getByRole('tab', 'Perusahaan').tap();
    await expect(screen.getByText('Printer & Koneksi')).toBeVisible();

    // Mode + paper width selects and the gesture-bound action buttons.
    await expect(screen.getByText('Sambungkan Printer')).toBeVisible();
    await expect(screen.getByRole('button', 'Cetak Tes')).toBeVisible();
  });

  // 2. A cash sale still completes while an (inert) auto-print runs, and the
  //    resulting history row can be reprinted — tapping reprint is answered
  //    with a print toast either way, which is what the cashier sees.
  test('a completed sale can be reprinted from the history', { session: 'kasir' }, async ({ app, screen }) => {
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
    await search.fill('Tepung Terigu Cakra Kembar');
    await screen.getByRole('button', { name: /Tepung Terigu Cakra Kembar/ }).tap();
    const units = screen.getByRole('dialog', { name: /Pilih Satuan/ });
    await units.getByRole('button', { name: /Satuan Dasar/ }).tap();
    await screen.getByRole('button', { name: /^Bayar / }).tap();
    const payment = screen.getByRole('dialog', { name: 'Pembayaran' });
    await expect(payment).toBeVisible();
    await payment.getByRole('button', 'Uang Pas').tap();
    await payment.getByRole('button', 'Bayar').tap();
    await expect(screen.getByText('Keranjang kosong')).toBeVisible();

    // The fresh sale is the first row of the history; it carries a reprint
    // control. Tapping it must produce a print toast (success or "gagal"),
    // never a silent no-op and never a crash of the page.
    await app.open('/pos/transactions');
    await expect(screen.getByRole('heading', 'Riwayat Transaksi', { level: 1 })).toBeVisible();
    const reprint = screen.getByRole('button', 'Cetak ulang struk').first();
    await expect(reprint).toBeVisible();
    await reprint.tap();
    await expect(screen.getByText(/tercetak|gagal mencetak/i).first()).toBeVisible();
  });

  // 3. A closed shift row in the shift history carries a Z-report reprint
  //    control, so the day's report is reachable after the till has moved on.
  test('a closed shift offers a Z-report reprint', { session: 'kasir' }, async ({ app, screen }) => {
    await app.open('/pos/shifts');
    await expect(screen.getByRole('heading', 'Manajemen Shift', { level: 1 })).toBeVisible();

    // Close whatever is open so there is a closed row to reprint from.
    const openingForm = screen.getByText('Buka Shift Baru');
    if ((await openingForm.isVisible()) === false) {
      await screen.getByPlaceholder('Masukkan total uang tunai yang ada...').fill('0');
      await screen.getByRole('button', 'Konfirmasi Tutup Shift').tap();
    }

    // The desktop history table has a dedicated "Cetak" column for reports.
    await expect(
      screen.getByRole('button', 'Cetak laporan shift').first(),
    ).toBeVisible();
  });
});
