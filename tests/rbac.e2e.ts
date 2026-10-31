import { test, describe, type Browser } from '@e2e-dev/web';
import { expect, type App, type Screen } from 'e2e';

/**
 * The route table is the only place that decides who may open a screen
 * (`RoleBasedRoute` in src/App.tsx). This suite pins that table per role: a
 * screen the role may open renders its heading, one it may not bounces back to
 * /mode-select. It needs no agent, so it is the cheap, broad guard.
 */

/** Route -> the level-1 heading the page renders once its data has loaded. */
const SCREEN: Record<string, string> = {
  '/backoffice': 'Dashboard',
  '/backoffice/branches': 'Manajemen Cabang',
  '/backoffice/warehouses': 'Manajemen Gudang',
  '/backoffice/branches/dashboard': 'Dashboard Percabangan',
  '/backoffice/branches/orders': 'Pesanan Cabang',
  '/backoffice/branches/transfer': 'Transfer Stok Antar Gudang',
  '/backoffice/inventory/products': 'Inventory Produk',
  '/backoffice/finance/journal': 'Jurnal Umum',
  '/backoffice/finance/ap-ar': 'Hutang & Piutang',
  '/backoffice/finance/expenses': 'Pengeluaran',
  '/backoffice/hr/employees': 'Data Karyawan',
  '/backoffice/reports': 'Laporan & Analitik',
  '/backoffice/settings': 'Pengaturan',
  '/backoffice/vendors': 'Vendor',
  '/pos/shifts': 'Manajemen Shift',
  '/pos/transactions': 'Riwayat Transaksi',
};

async function expectScreen(app: App, screen: Screen, path: string) {
  await app.open(path);
  await expect(screen.getByRole('heading', SCREEN[path], { level: 1 })).toBeVisible();
}

async function expectRedirectToModeSelect(app: App, browser: Browser, path: string) {
  await app.open(path);
  await expect(browser).toHaveURL('/mode-select');
}

test('an anonymous visitor is sent to the login form', async ({ app, screen, browser }) => {
  await app.open('/backoffice');

  await expect(browser).toHaveURL('/login');
  await expect(screen.getByRole('button', 'Masuk')).toBeEnabled();
});

describe('owner', { tags: ['rbac'] }, () => {
  test('reaches every back-office module', { session: 'owner' }, async ({ app, screen }) => {
    for (const path of [
      '/backoffice',
      '/backoffice/branches',
      '/backoffice/inventory/products',
      '/backoffice/finance/journal',
      '/backoffice/finance/ap-ar',
      '/backoffice/hr/employees',
      '/backoffice/reports',
      '/backoffice/settings',
      '/backoffice/vendors',
    ]) {
      await expectScreen(app, screen, path);
    }
  });

  test('reaches the point of sale', { session: 'owner' }, async ({ app, screen }) => {
    for (const path of ['/pos/shifts', '/pos/transactions']) {
      await expectScreen(app, screen, path);
    }
  });

  test('the sidebar names the session role', { session: 'owner' }, async ({ app, screen }) => {
    await app.open('/backoffice');
    await expect(screen.getByRole('heading', 'Dashboard', { level: 1 })).toBeVisible();
    // The identity card reads its label from ROLES (src/config/roles.ts).
    // `visible: true` matters: BackOfficeLayout renders a second, closed copy
    // of the sidebar for narrow screens, and that copy is the first match.
    await expect(screen.getByText('Surya', { exact: true, visible: true })).toBeVisible();
    await expect(screen.getByText('Owner', { exact: true, visible: true })).toBeVisible();
  });
});

describe('tenant admin', { tags: ['rbac'] }, () => {
  test('has the same back-office reach as the owner', { session: 'admin' }, async ({ app, screen }) => {
    for (const path of [
      '/backoffice',
      '/backoffice/branches',
      '/backoffice/inventory/products',
      '/backoffice/finance/journal',
      '/backoffice/hr/employees',
      '/backoffice/reports',
      '/backoffice/settings',
    ]) {
      await expectScreen(app, screen, path);
    }
  });

  test('the sidebar names the session role', { session: 'admin' }, async ({ app, screen }) => {
    await app.open('/backoffice');
    await expect(screen.getByRole('heading', 'Dashboard', { level: 1 })).toBeVisible();
    await expect(screen.getByText('Admin E2E', { exact: true, visible: true })).toBeVisible();
    await expect(screen.getByText('Admin', { exact: true, visible: true })).toBeVisible();
  });
});

describe('cashier', { tags: ['rbac'] }, () => {
  test('reaches the point of sale', { session: 'kasir' }, async ({ app, screen }) => {
    for (const path of ['/pos/shifts', '/pos/transactions']) {
      await expectScreen(app, screen, path);
    }
  });

  /**
   * The chooser only offers the card that opens. Offering one the route guard
   * refuses looks like a broken app: the click lands back on this screen.
   */
  test('the mode chooser offers the till and nothing else', { session: 'kasir' }, async ({ app, screen }) => {
    await app.open('/mode-select');

    await expect(screen.getByRole('heading', 'POS & Kasir', { level: 2 })).toBeVisible();
    await expect(screen.getByRole('heading', 'Back Office', { level: 2 })).toBeHidden();
    await expect(screen.getByRole('heading', 'Vendor & Supplier', { level: 2 })).toBeHidden();
  });

  test('is turned away from the back office', { session: 'kasir' }, async ({ app, browser }) => {
    for (const path of [
      '/backoffice',
      '/backoffice/inventory/products',
      '/backoffice/finance/journal',
      '/backoffice/hr/employees',
      '/backoffice/reports',
      '/backoffice/settings',
    ]) {
      await expectRedirectToModeSelect(app, browser, path);
    }
  });
});

describe('warehouse staff', { tags: ['rbac'] }, () => {
  test('the mode chooser offers the back office and nothing else', { session: 'gudang' }, async ({ app, screen }) => {
    await app.open('/mode-select');

    await expect(screen.getByRole('heading', 'Back Office', { level: 2 })).toBeVisible();
    await expect(screen.getByRole('heading', 'POS & Kasir', { level: 2 })).toBeHidden();
    await expect(screen.getByRole('heading', 'Vendor & Supplier', { level: 2 })).toBeHidden();
  });

  test('reaches the stock documents', { session: 'gudang' }, async ({ app, screen }) => {
    for (const path of [
      '/backoffice/branches/orders',
      '/backoffice/branches/transfer',
      '/backoffice/inventory/products',
      '/backoffice/warehouses',
    ]) {
      await expectScreen(app, screen, path);
    }
  });

  test('is turned away from the dashboard, finance, HR and reports', { session: 'gudang' }, async ({ app, browser }) => {
    for (const path of [
      '/backoffice',
      '/backoffice/finance/journal',
      '/backoffice/hr/employees',
      '/backoffice/reports',
      '/backoffice/settings',
    ]) {
      await expectRedirectToModeSelect(app, browser, path);
    }
  });

  /**
   * The vendor directory is manager-only. Nothing offers it to gudang staff any
   * more (the mode chooser card is gone), and typing the URL still bounces.
   */
  test('is turned away from the vendor directory', { session: 'gudang' }, async ({ app, browser }) => {
    await expectRedirectToModeSelect(app, browser, '/backoffice/vendors');
  });
});
