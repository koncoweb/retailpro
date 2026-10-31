import { test, describe } from '@e2e-dev/web';
import { expect } from 'e2e';
import { APP_CONTEXT } from './support/context';

/**
 * Warehouse staff work the gudang side of the business: the shops' replenishment
 * requests, transfers between stockrooms, and stock counts. They have no finance,
 * no HR and no dashboard, which is what the mode chooser encodes.
 */
describe('warehouse staff', { tags: ['gudang'], agentContext: APP_CONTEXT }, () => {
  test('the mode chooser sends gudang staff to the order queue', { session: 'gudang' }, async ({ app, screen, agent, browser }) => {
    await app.open('/mode-select');

    // The back office card is re-pointed for this role; it says so on screen.
    await expect(screen.getByText('Pesanan Cabang')).toBeVisible();

    await agent.act('enter the back office');

    await expect(browser).toHaveURL('/backoffice/branches/orders');
    await expect(screen.getByRole('heading', 'Pesanan Cabang', { level: 1 })).toBeVisible();
  });

  test('the order queue groups the shops that asked for stock', { session: 'gudang' }, async ({ app, screen }) => {
    await app.open('/backoffice/branches/orders');
    await expect(screen.getByRole('heading', 'Pesanan Cabang', { level: 1 })).toBeVisible();

    // Requests are counted per lane, and each lane has a filter tab. The demo
    // tenant ships with no open request, so the counters may legitimately be 0.
    for (const lane of ['Menunggu Persetujuan', 'Siap Dikirim', 'Dalam Pengiriman']) {
      await expect(screen.getByText(lane)).toBeVisible();
    }
    // "Selesai" is both a lane and a tab, so it is pinned by role.
    await expect(screen.getByRole('tab', 'Menunggu')).toBeVisible();
    await expect(screen.getByRole('tab', 'Selesai')).toBeVisible();
  });

  test('stock transfers and stock counting are both reachable', { session: 'gudang' }, async ({ app, screen }) => {
    await app.open('/backoffice/branches/transfer');
    await expect(screen.getByRole('heading', 'Transfer Stok Antar Gudang', { level: 1 })).toBeVisible();

    await app.open('/backoffice/inventory/opname');
    await expect(screen.getByRole('heading', 'Inventory Produk', { level: 1 })).toBeVisible();
    await expect(screen.getByRole('tab', 'Opname')).toBeSelected();
  });

  test('the warehouse list is readable but finance is not', { session: 'gudang' }, async ({ app, screen, browser }) => {
    await app.open('/backoffice/warehouses');
    await expect(screen.getByRole('heading', 'Manajemen Gudang', { level: 1 })).toBeVisible();

    await app.open('/backoffice/finance/cashflow');
    await expect(browser).toHaveURL('/mode-select');
    await expect(screen.getByText('Pilih mode yang ingin Anda gunakan')).toBeVisible();
  });
});
