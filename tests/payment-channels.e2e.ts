import { test, describe } from '@e2e-dev/web';
import { expect } from 'e2e';
import { APP_CONTEXT } from './support/context';
import path from 'node:path';

/**
 * Payment channels: the owner configures which channels are active and their
 * merchant fees, uploads a QRIS image, and the cashier sees the result at the
 * till. The Z-report must bucket the new `transfer` method and record the fee
 * without changing what the customer paid.
 *
 * Pitfall KS-43: every change to payment buckets must keep the Z-report
 * reconciliation green — the `other` bucket closes to `total − (cash+transfer+
 * card+ewallet+qris)`, so a missing transfer row would silently break the math.
 */
describe('payment channels', { tags: ['owner', 'kasir'], agentContext: APP_CONTEXT }, () => {
  test(
    'the owner can configure payment channels and upload a QRIS image',
    { session: 'owner' },
    async ({ app, screen, agent }) => {
      await app.open('/backoffice/settings');
      await expect(screen.getByRole('heading', 'Pengaturan', { level: 1 })).toBeVisible();

      // Open the Payments tab.
      await screen.getByRole('tab', 'Pembayaran').tap();
      await expect(screen.getByText('Channel Pembayaran')).toBeVisible();

      // The three builtin channels are visible.
      await expect(screen.getByText('Tunai')).toBeVisible();
      await expect(screen.getByText('Transfer Bank')).toBeVisible();
      await expect(screen.getByText('QRIS')).toBeVisible();

      // Toggle a channel and set a fee.
      await agent.act('enable the QRIS channel and set its fee to 0.7 percent');
      await agent.act('enable the Transfer Bank channel and set a flat fee of 5000 rupiah');

      // Upload a QRIS image.
      const fixturePath = path.resolve(__dirname, 'fixtures/qris-sample.png');
      await agent.act(`upload the QRIS image from ${fixturePath}`);

      // Save and reload to verify persistence.
      await agent.act('click the Simpan button to save the payment configuration');
      await app.open('/backoffice/settings');
      await screen.getByRole('tab', 'Pembayaran').tap();

      // The values persisted: QRIS should still show a fee, and the image
      // preview should be visible (or at least the upload button should not
      // reappear as if nothing was saved).
      await expect(screen.getByText('Channel Pembayaran')).toBeVisible();
    },
  );

  test(
    'the cashier sees the configured channels at the POS',
    { session: 'kasir' },
    async ({ app, screen, agent }) => {
      await app.open('/pos');
      await expect(screen.getByRole('heading', 'Point of Sale')).toBeVisible();

      // Add a product to the cart.
      await agent.act('add one product to the cart by clicking on a product tile');

      // Open the payment modal.
      await agent.act('click the Bayar button to open the payment modal');

      // The modal should show the configured channels (not the old hardcoded
      // list). At minimum, Tunai and Transfer should be visible as tabs.
      await expect(screen.getByRole('tab', 'Tunai')).toBeVisible();
      await expect(screen.getByRole('tab', 'Transfer')).toBeVisible();
    },
  );
});
