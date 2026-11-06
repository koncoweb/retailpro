import { test, describe } from '@e2e-dev/web';
import { expect } from 'e2e';
import { APP_CONTEXT } from './support/context';

/**
 * Bulk create (import / export / template) controls for Products, Vendors and
 * Customers, and the owner-only gating that surrounds the mutating half.
 *
 * The actual file-upload path is covered by unit tests in `src/lib/bulk-io.test.ts`
 * (CSV/Excel parsing, header aliases, collision skip vs auto-generate). What is
 * worth proving in the browser is that the affordances reach the right people:
 * an owner sees Import/Export/Template everywhere; a store manager who can only
 * view cannot import products or vendors, but may still download the template so
 * they can read the column format.
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
