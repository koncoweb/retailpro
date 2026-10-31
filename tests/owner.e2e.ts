import { test, describe } from '@e2e-dev/web';
import { expect } from 'e2e';
import { signIn } from './support/accounts';
import { APP_CONTEXT } from './support/context';

/**
 * The owner's journey: the numbers a business owner opens the app for, plus the
 * three entry modes and the way out. Everything here runs on the demo tenant, so
 * the checks are about "real data reached the screen", not about exact figures.
 */
describe('owner', { tags: ['owner'], agentContext: APP_CONTEXT }, () => {
  test('the mode chooser offers all three entry points', { session: 'owner' }, async ({ app, screen }) => {
    await app.open('/mode-select');

    await expect(screen.getByRole('heading', 'POS & Kasir', { level: 2 })).toBeVisible();
    await expect(screen.getByRole('heading', 'Back Office', { level: 2 })).toBeVisible();
    await expect(screen.getByRole('heading', 'Vendor & Supplier', { level: 2 })).toBeVisible();
  });

  test('the dashboard shows live business figures', { session: 'owner' }, async ({ app, screen, agent }) => {
    await app.open('/backoffice');
    await expect(screen.getByRole('heading', 'Dashboard', { level: 1 })).toBeVisible();
    await expect(screen.getByText('Total Penjualan Hari Ini')).toBeVisible();

    // A day with no sales is a legitimate zero, so the check is that the cards
    // render real rupiah amounts and the rest of the page is either populated
    // or says so in words — never an error, NaN or a spinner left spinning.
    await agent.assert(
      'the dashboard renders its summary cards with rupiah amounts, and every panel below shows either data or an explicit empty-state sentence; nothing shows an error, NaN, undefined or a spinner that never finishes',
    );
  });

  test('the product list can be searched down to one item', { session: 'owner' }, async ({ app, screen, agent }) => {
    await app.open('/backoffice/inventory/products');
    await expect(screen.getByRole('heading', 'Inventory Produk', { level: 1 })).toBeVisible();

    await agent.act('search the product list for "Cakra Kembar"');

    await expect(screen.getByText('Tepung Terigu Cakra Kembar', { exact: true })).toBeVisible();
    // The other flour is filtered out, so its name is gone from the table.
    await expect(screen.getByText('Tepung Terigu Segitiga Biru', { exact: true })).toBeHidden();
  });

  test('the journal lists balanced double entries', { session: 'owner' }, async ({ app, screen }) => {
    await app.open('/backoffice/finance/journal');
    await expect(screen.getByRole('heading', 'Jurnal Umum', { level: 1 })).toBeVisible();

    // The table renders a "Loading..." row first; the entries replace it.
    await expect(screen.getByText('Loading...')).toBeHidden();

    // Every sale writes two lines that must both be there: the money in, the
    // revenue out. A one-sided journal would show only the first.
    await expect(screen.getByRole('columnheader', 'Debit')).toBeVisible();
    await expect(screen.getByRole('columnheader', 'Kredit')).toBeVisible();
    await expect(screen.getByText(/^Penjualan INV\//).first()).toBeVisible();
    await expect(screen.getByText(/^Pendapatan Penjualan INV\//).first()).toBeVisible();
  });

  test('the employee roster includes the seeded staff', { session: 'owner' }, async ({ app, screen }) => {
    await app.open('/backoffice/hr/employees');
    await expect(screen.getByRole('heading', 'Data Karyawan', { level: 1 })).toBeVisible();

    await expect(screen.getByText('Bayu Pratama')).toBeVisible();
    await expect(screen.getByText('Kasir E2E')).toBeVisible();
  });

  test('the role table opens the permission matrix for a role', { session: 'owner' }, async ({ app, screen, agent }) => {
    await app.open('/backoffice/settings');
    await expect(screen.getByRole('heading', 'Pengaturan', { level: 1 })).toBeVisible();

    await screen.getByRole('tab', 'Karyawan & Role').tap();
    await expect(screen.getByRole('heading', 'Role & Permission')).toBeVisible();

    // The matrix is per role, behind the row's edit control.
    await screen.getByRole('button', { name: 'Ubah permission Cashier' }).tap();
    const dialog = screen.getByRole('dialog', { name: 'Edit Permission: Cashier' });
    await expect(dialog).toBeVisible();

    // Permissions sit in collapsed groups; the owner opens what they came for.
    await agent.act('expand every collapsed permission group in the dialog');
    await expect(dialog.getByText('Akses POS')).toBeVisible();
    await expect(dialog.getByText('Setujui Purchase Order')).toBeVisible();
  });

  test('Ganti Mode switches screen without ending the session', { session: 'owner' }, async ({ app, screen, browser }) => {
    await app.open('/backoffice');

    await screen.getByRole('link', { name: 'Ganti Mode' }).tap();
    await expect(browser).toHaveURL('/mode-select');

    // Ganti Mode only picks another screen for the same person, so the back
    // office still opens without signing in again.
    await app.open('/backoffice');
    await expect(screen.getByRole('heading', 'Dashboard', { level: 1 })).toBeVisible();
  });

  // Session-less on purpose: signing out revokes the session server-side, and
  // that would invalidate the saved `owner` cookie every other test restores.
  // Signing in here mints a throwaway session that is safe to destroy.
  test('Keluar ends the session', async ({ app, screen, browser }) => {
    const credential = signIn('owner');

    await app.open('/login');
    await screen.getByLabel('Email').fill(credential.username);
    await screen.getByLabel('Password').fill(credential.password);
    await screen.getByRole('button', 'Masuk').tap();
    await expect(browser).toHaveURL('/mode-select');

    // The way out of the session itself lives at the bottom of the sidebar.
    await app.open('/backoffice');
    await expect(screen.getByRole('heading', 'Dashboard', { level: 1 })).toBeVisible();
    await screen.getByRole('button', { name: 'Keluar', visible: true }).tap();

    await expect(browser).toHaveURL('/login');
    await expect(screen.getByRole('button', 'Masuk')).toBeEnabled();

    // And the session is really gone: a guarded route now lands on the form.
    await app.open('/backoffice');
    await expect(browser).toHaveURL('/login');
  });
});
