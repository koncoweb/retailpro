import { test, describe, afterEach } from '@e2e-dev/web';
import { expect } from 'e2e';
import { deleteUserByEmail } from './support/db';
import { APP_CONTEXT } from './support/context';

/**
 * The admin's own job: running the roster. The owner owns the company, the
 * admin runs it day to day, so this file drives the Employees screen — the one
 * place where an admin changes who can sign in at all.
 */
const created: string[] = [];

afterEach(async () => {
  while (created.length > 0) {
    await deleteUserByEmail(created.pop() as string);
  }
});

describe('tenant admin', { tags: ['admin'], agentContext: APP_CONTEXT }, () => {
  test('adds an employee and gets a one-time password', { session: 'admin' }, async ({ app, screen, browser }) => {
    const email = `e2e.staff.${Date.now()}@tokobahankue.com`;

    await app.open('/backoffice/hr/employees');
    await expect(screen.getByRole('heading', 'Data Karyawan', { level: 1 })).toBeVisible();

    await screen.getByRole('button', 'Tambah Karyawan').tap();

    const form = screen.getByRole('dialog', { name: 'Tambah Karyawan Baru' });
    await expect(form).toBeVisible();

    await form.getByLabel('Nama Lengkap').fill('Staff Baru E2E');
    await form.getByLabel('Email').fill(email);
    await form.getByLabel('Password').fill('RahasiaE2E1');
    await form.getByLabel('Gaji Pokok').fill('4500000');

    // Both pickers are Radix Selects: the trigger is a combobox, the choices
    // are options rendered in a portal.
    await form.getByRole('combobox').first().tap();
    await screen.getByRole('option', 'Staff').tap();

    await form.getByRole('button', 'Simpan').tap();
    created.push(email);

    // The password exists on screen exactly once, in this dialog.
    const credentials = screen.getByRole('dialog', { name: 'Password Sementara' });
    await expect(credentials).toBeVisible();
    await expect(credentials).toContainText(email);
    // The password the admin typed is the one handed over — not a silent
    // replacement generated behind the form.
    await expect(credentials).toContainText('RahasiaE2E1');
    await expect(credentials.getByRole('button', 'Salin')).toBeEnabled();

    await credentials.getByRole('button', { name: 'Tutup' }).tap();

    // The roster was reloaded, so the new person is in it.
    await expect(screen.getByText('Staff Baru E2E')).toBeVisible();
    await expect(browser).toHaveURL('/backoffice/hr/employees');
  });

  test('refuses a password that is too short', { session: 'admin' }, async ({ app, screen, browser }) => {
    const name = 'Staff Pendek E2E';
    // Unique so the assertion below cannot hit a leftover row from an old run.
    const email = `e2e.short.${Date.now()}@tokobahankue.com`;

    await app.open('/backoffice/hr/employees');
    await screen.getByRole('button', 'Tambah Karyawan').tap();

    const form = screen.getByRole('dialog', { name: 'Tambah Karyawan Baru' });
    await expect(form).toBeVisible();

    await form.getByLabel('Nama Lengkap').fill(name);
    await form.getByLabel('Email').fill(email);
    await form.getByLabel('Password').fill('123');

    await form.getByRole('button', 'Simpan').tap();

    // The admin stays on the field: no identity is created, so the one-time
    // password dialog never opens and the form is still there to fix.
    await expect(form.getByText('Password minimal 8 karakter')).toBeVisible();
    await expect(screen.getByRole('dialog', { name: 'Password Sementara' })).toBeHidden();
    await expect(form).toBeVisible();

    // The form is not the only guard: the endpoint refuses the same password
    // when it is reached directly, so a caller that skips the dialog cannot
    // create an identity with a one-character password.
    const direct = await browser.evaluate(async () => {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `e2e.direct.${Date.now()}@tokobahankue.com`,
          name: 'Staff Langsung E2E',
          role: 'staff',
          password: '123',
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      return `${response.status} ${body.error ?? 'no-error-code'}`;
    });
    expect(direct).toBe('400 weak_password');
  });

  test('the role picker previews what each role may do', { session: 'admin' }, async ({ app, screen }) => {
    await app.open('/backoffice/hr/employees');
    await screen.getByRole('button', 'Tambah Karyawan').tap();

    const form = screen.getByRole('dialog', { name: 'Tambah Karyawan Baru' });
    await form.getByRole('combobox').first().tap();

    // Every role the roster form offers; `tenant_owner` is deliberately absent.
    await expect(screen.getByRole('option', 'Cashier')).toBeVisible();
    await expect(screen.getByRole('option', 'Warehouse Staff')).toBeVisible();
    await expect(screen.getByRole('option', 'Store Manager')).toBeVisible();

    await screen.getByRole('option', 'Cashier').tap();

    // Choosing a role renders its permission list, so the admin knows what it grants.
    await expect(form.getByText('Akses POS')).toBeVisible();
    await expect(form.getByText('Lihat Dashboard')).toBeVisible();

    await form.getByRole('button', 'Batal').tap();
    await expect(form).toBeHidden();
  });

  test('the back office still shows the live dashboard', { session: 'admin' }, async ({ app, screen, agent }) => {
    await app.open('/backoffice');
    await expect(screen.getByRole('heading', 'Dashboard', { level: 1 })).toBeVisible();

    // Same check as the owner's: real rupiah amounts, and every panel either
    // has data or says why it is empty.
    await agent.assert(
      'the dashboard renders its summary cards with rupiah amounts, and every panel below shows either data or an explicit empty-state sentence; nothing shows an error, NaN, undefined or a spinner that never finishes',
    );
  });
});
