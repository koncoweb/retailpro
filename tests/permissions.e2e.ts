import { test, describe, afterEach, type Browser } from '@e2e-dev/web';
import { expect } from 'e2e';
import {
  controlClient,
  tenantClient,
  deleteUserByEmail,
  findCustomRoleKeyByLabel,
  deleteCustomRoleSetting,
} from './support/db';
import { APP_CONTEXT } from './support/context';

/**
 * The identity half of the role system, proven against the real endpoints — not
 * the browser's optimistic UI.
 *
 * The whole point of Phase 0 was that a page writing only the tenant projection
 * changes nothing at login. So these tests write through `PATCH`/`DELETE
 * /api/admin/users/[id]` and then read the two databases directly: the control
 * row (what Better Auth authenticates against) and the tenant projection (what
 * `/api/tenant/bootstrap` checks before minting a token). A green run here means
 * the two stores actually agree, which is exactly the bug being closed.
 */

const DOMAIN = 'tokobahankue.com';
const PASSWORD = 'RahasiaE2E1';

function newEmail(prefix: string): string {
  return `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@${DOMAIN}`;
}

/** POST /api/admin/users through the running app, returning the typed body. */
async function createUser(
  browser: Browser,
  body: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  return browser.evaluate(async (payload: unknown) => {
    const response = await fetch('/api/admin/users', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { status: response.status, json: (await response.json().catch(() => ({}))) as Record<string, unknown> };
  }, body) as Promise<{ status: number; json: Record<string, unknown> }>;
}

async function patchUser(
  browser: Browser,
  id: string,
  body: Record<string, unknown>,
): Promise<{ status: number; code: string }> {
  return browser.evaluate(
    async (args: unknown) => {
      const { id: userId, patch } = args as { id: string; patch: Record<string, unknown> };
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      return { status: response.status, code: json.error ?? 'no-error-code' };
    },
    { id, patch: body },
  ) as Promise<{ status: number; code: string }>;
}

async function deleteUser(
  browser: Browser,
  id: string,
): Promise<{ status: number; code: string }> {
  return browser.evaluate(
    async (userId: string) => {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      return { status: response.status, code: json.error ?? 'no-error-code' };
    },
    id,
  ) as Promise<{ status: number; code: string }>;
}

/** Ask the real sign-in endpoint. Used only to prove a refused login. */
async function signInFails(browser: Browser, email: string): Promise<boolean> {
  const result = await browser.evaluate(
    async (target: string) => {
      const response = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: target, password: 'RahasiaE2E1' }),
      });
      return { status: response.status, ok: response.ok };
    },
    email,
  ) as { status: number; ok: boolean };
  // A refused sign-in never mints a session; Better Auth answers 4xx.
  return !result.ok && result.status >= 400;
}

const identityCleanup: string[] = [];
let pendingRoleKey: string | null = null;

/**
 * Retry a direct database read until it satisfies `done`.
 *
 * The API writes on its own libSQL connection while the test opens a separate
 * one, and Turso is eventually consistent across replicas: a read taken a few
 * hundred milliseconds after a write can still miss it. Polling turns that race
 * into a passed assertion instead of a flaky failure, without weakening what is
 * checked.
 */
async function pollDb<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  tries = 20,
  delayMs = 500,
): Promise<T> {
  let value = await read();
  for (let attempt = 0; attempt < tries && !done(value); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    value = await read();
  }
  return value;
}

afterEach(async () => {
  while (identityCleanup.length > 0) {
    await deleteUserByEmail(identityCleanup.pop() as string);
  }
  if (pendingRoleKey) {
    await deleteCustomRoleSetting(pendingRoleKey);
    pendingRoleKey = null;
  }
});

describe('identity enforcement (server-side)', { tags: ['permissions'], agentContext: APP_CONTEXT }, () => {
  test('PATCH is one writer for both the control row and the tenant projection', { session: 'owner' }, async ({ app, browser }) => {
    await app.open('/mode-select');
    const email = newEmail('e2e.ident');
    identityCleanup.push(email);

    // Creation writes the control identity; the projection is the PATCH writer's
    // responsibility — so a role change must land in both stores at once.
    const created = await createUser(browser, { email, name: 'Ident E2E', role: 'cashier', password: PASSWORD });
    expect(String(created.status)).toBe('201');
    const userId = String(created.json.userId);
    expect(userId).toBeTruthy();

    const patched = await patchUser(browser, userId, { role: 'warehouse' });
    expect(String(patched.status)).toBe('200');

    const controlRole = await pollDb(
      async () => {
        const control = controlClient();
        try {
          const row = await control.execute({ sql: 'SELECT role FROM user WHERE id = ?', args: [userId] });
          return String(row.rows[0]?.role ?? '');
        } finally {
          control.close();
        }
      },
      (role) => role === 'warehouse',
    );
    expect(controlRole).toBe('warehouse');

    const projectionRole = await pollDb(
      async () => {
        const tenant = await tenantClient();
        try {
          const row = await tenant.execute({ sql: 'SELECT role FROM users WHERE id = ?', args: [userId] });
          return String(row.rows[0]?.role ?? '');
        } finally {
          tenant.close();
        }
      },
      (role) => role === 'warehouse',
    );
    // The projection mirrors the control plane — that is what a token is checked against.
    expect(projectionRole).toBe('warehouse');
  });

  test('PATCH active=false bans the control login and clears the projection flag', { session: 'owner' }, async ({ app, browser }) => {
    await app.open('/mode-select');
    const email = newEmail('e2e.inact');
    identityCleanup.push(email);
    const created = await createUser(browser, { email, name: 'Nonaktif E2E', role: 'cashier', password: PASSWORD });
    const userId = String(created.json.userId);

    const patched = await patchUser(browser, userId, { active: false });
    expect(String(patched.status)).toBe('200');

    const flags = await pollDb(
      async () => {
        const control = controlClient();
        try {
          const row = await control.execute({ sql: 'SELECT status, banned FROM user WHERE id = ?', args: [userId] });
          return { status: String(row.rows[0]?.status ?? ''), banned: Number(row.rows[0]?.banned ?? -1) };
        } finally {
          control.close();
        }
      },
      (value) => value.status === 'inactive' && value.banned === 1,
    );
    // Both together: status is the app-facing flag, banned is what makes Better
    // Auth itself refuse the next sign-in (only bootstrap used to notice status).
    expect(flags.status).toBe('inactive');
    expect(flags.banned).toBe(1);

    const isActive = await pollDb(
      async () => {
        const tenant = await tenantClient();
        try {
          const row = await tenant.execute({ sql: 'SELECT is_active FROM users WHERE id = ?', args: [userId] });
          return Number(row.rows[0]?.is_active ?? -1);
        } finally {
          tenant.close();
        }
      },
      (value) => value === 0,
    );
    expect(isActive).toBe(0);
  });

  test('DELETE removes the identity so the login is refused', { session: 'owner' }, async ({ app, browser }) => {
    await app.open('/mode-select');
    const email = newEmail('e2e.gone');
    // Do not register it for cleanup: the delete under test already removes it.
    const created = await createUser(browser, { email, name: 'Hapus E2E', role: 'staff', password: PASSWORD });
    const userId = String(created.json.userId);

    const removed = await deleteUser(browser, userId);
    expect(String(removed.status)).toBe('200');

    const remaining = await pollDb(
      async () => {
        const control = controlClient();
        try {
          const row = await control.execute({ sql: 'SELECT id FROM user WHERE id = ?', args: [userId] });
          return row.rows.length;
        } finally {
          control.close();
        }
      },
      (count) => count === 0,
    );
    expect(String(remaining)).toBe('0');

    // With no identity left, the sign-in endpoint must refuse.
    expect(await signInFails(browser, email)).toBe(true);
  });

  test('the endpoint refuses an unknown role and removing yourself', { session: 'owner' }, async ({ app, browser }) => {
    await app.open('/mode-select');
    // Unknown role: not a builtin, not a custom role of this tenant.
    const email = newEmail('e2e.badrole');
    const created = await createUser(browser, { email, name: 'Role Salah', role: 'cashier', password: PASSWORD });
    const userId = String(created.json.userId);
    identityCleanup.push(email);

    const bad = await patchUser(browser, userId, { role: 'definitely_not_a_role' });
    expect(String(bad.status)).toBe('400');

    await app.open('/backoffice/settings');
    const ownerId = await browser.evaluate(async () => {
      const response = await fetch('/api/auth/get-session', { credentials: 'include' });
      const json = (await response.json().catch(() => ({}))) as { user?: { id?: string } };
      return json.user?.id ?? '';
    }) as string;
    expect(ownerId).toBeTruthy();

    // The acting admin is the owner; pointing the endpoint at their own id is
    // refused so one bad click cannot lock the company out of itself. The owner
    // specifically hits the owner-protection guard; a non-owner hits the
    // self-removal guard. Either way the write is refused with a 400.
    const self = await patchUser(browser, ownerId, { active: false });
    expect(String(self.status)).toBe('400');
    expect(['cannot_remove_yourself', 'cannot_reassign_owner']).toContain(self.code);
  });
});

/**
 * The owner-facing custom-role flow, driven through the real Settings screen.
 *
 * It proves the four things the feature is made of — a role can be created from
 * the matrix, it becomes an assignable identity, it cannot be deleted while it
 * is somebody's role, and the shared tenant is left clean afterwards.
 */
describe('custom role lifecycle', { tags: ['permissions'], agentContext: APP_CONTEXT }, () => {
  test('create a role, assign it, and refuse deleting it while in use', { session: 'owner' }, async ({ app, screen, browser }) => {
    const label = `Supervisor E2E ${Date.now()}`;
    const email = newEmail('e2e.sup');
    identityCleanup.push(email);

    await app.open('/backoffice/settings');
    await screen.getByRole('tab', 'Karyawan & Role').tap();

    // Open the creator and save a role (it starts from the default base role).
    await screen.getByRole('button', 'Buat role').tap();
    const creator = screen.getByRole('alertdialog', { name: 'Role kustom baru' });
    await expect(creator).toBeVisible();
    await creator.getByLabel('Nama role').fill(label);
    await creator.getByRole('button', 'Buat role').tap();

    // The role is written straight away, then it must appear in the list.
    await expect(screen.getByText(label)).toBeVisible();

    // Its key is generated in the browser; read it back from the settings doc.
    const roleKey = await findCustomRoleKeyByLabel(label);
    expect(roleKey).toBeTruthy();
    pendingRoleKey = roleKey;

    // Assign it through the admin endpoint: create a plain account, then PATCH
    // the role to the custom key. PATCH is the single writer that mirrors the
    // projection, so the tenant roster count that guards deletion sees it.
    const created = await createUser(browser, { email, name: 'Supervisor E2E', role: 'staff', password: PASSWORD });
    expect(String(created.status)).toBe('201');
    const userId = String(created.json.userId);
    const assigned = await patchUser(browser, userId, { role: roleKey as string });
    expect(String(assigned.status)).toBe('200');

    // Reload so the roster count reflects the new holder, then open the editor
    // for *this* role (the delete button only renders for the selected role).
    await app.open('/backoffice/settings');
    await screen.getByRole('tab', 'Karyawan & Role').tap();
    await screen.getByRole('button', { name: new RegExp(label) }).tap();
    await screen.getByRole('button', { name: `Hapus role ${label}` }).tap();
    const confirm = screen.getByRole('alertdialog', { name: `Hapus role ${label}?` });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', 'Hapus role').tap();

    // Refused: the role is somebody's identity, deleting it would lock them out.
    await expect(screen.getByText(/dipakai 1 karyawan/)).toBeVisible();

    // And it really is still there.
    expect(await findCustomRoleKeyByLabel(label)).toBe(roleKey);
  });
});
