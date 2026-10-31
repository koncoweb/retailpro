/**
 * Test identities for the end-to-end suite (`tests/**\/*.e2e.ts`).
 *
 * The demo tenant seeds a full staff roster into the tenant's own `users`
 * table, but only the owner exists on the control plane — the seeded cashiers,
 * admins and warehouse staff cannot sign in. This script creates the missing
 * Better Auth identities (same code path as `/api/admin/users`, minus the HTTP
 * layer) and mirrors each one into the tenant database so joins keep working.
 *
 *   npm run e2e:users            create the accounts that are missing
 *   npm run e2e:users -- --reset recreate them with the known password
 *
 * Idempotent: an existing identity keeps its role/tenant/branch, and its
 * password is left alone unless `--reset` is passed.
 *
 * Accounts (override the prefix with E2E_USER_PREFIX, the password with
 * E2E_STAFF_PASSWORD):
 *   e2e.admin@tokobahankue.com   tenant_admin  -> back office, HR, settings
 *   e2e.kasir@tokobahankue.com   cashier       -> POS only
 *   e2e.gudang@tokobahankue.com  warehouse     -> stock documents only
 */
import 'dotenv/config';
import { createClient } from '@libsql/client';
import { createToken } from '../server/turso-platform';

const DOMAIN = process.env.E2E_USER_DOMAIN?.trim() || 'tokobahankue.com';
const PASSWORD = process.env.E2E_STAFF_PASSWORD ?? 'Thalia2026!';
const SLUG = process.env.STOREFRONT_TENANT_SLUG?.trim() || 'thalia';
const RESET = process.argv.includes('--reset');

interface TestAccount {
  local: string;
  name: string;
  role: 'tenant_admin' | 'cashier' | 'warehouse';
  /** Branch code from the tenant `branches` table; null means tenant-wide. */
  branch: string | null;
}

const ACCOUNTS: TestAccount[] = [
  { local: 'e2e.admin', name: 'Admin E2E', role: 'tenant_admin', branch: 'THL-01' },
  { local: 'e2e.kasir', name: 'Kasir E2E', role: 'cashier', branch: 'THL-01' },
  { local: 'e2e.gudang', name: 'Gudang E2E', role: 'warehouse', branch: 'THL-01' },
];

function fail(message: string): never {
  console.error(`\n[x] ${message}\n`);
  process.exit(1);
}

const control = createClient({
  url: process.env.CONTROL_DB_URL ?? fail('CONTROL_DB_URL is not set.'),
  authToken: process.env.CONTROL_DB_TOKEN,
});

async function main(): Promise<void> {
  const tenantRow = await control.execute({
    sql: 'SELECT id, db_name, db_hostname FROM tenant_databases WHERE slug = ?',
    args: [SLUG],
  });
  const tenant = tenantRow.rows[0];
  if (!tenant) fail(`No tenant "${SLUG}" in tenant_databases. Run the demo setup first.`);

  const tenantId = String(tenant.id);
  const dbName = String(tenant.db_name);
  const dbHostname = String(tenant.db_hostname);

  const { auth } = await import('../server/auth');
  const tenantClient = createClient({
    url: dbHostname.startsWith('http') ? dbHostname : `https://${dbHostname}`,
    authToken: (await createToken(dbName, '10m')).jwt,
  });

  try {
    const branches = await tenantClient.execute('SELECT id, code FROM branches');
    const branchIds = new Map(branches.rows.map((row) => [String(row.code), String(row.id)]));

    for (const account of ACCOUNTS) {
      const email = `${account.local}@${DOMAIN}`;
      const branchId = account.branch ? branchIds.get(account.branch) ?? null : null;
      if (account.branch && !branchId) fail(`Branch "${account.branch}" is missing in the tenant.`);

      const existing = await control.execute({
        sql: 'SELECT id FROM user WHERE email = ?',
        args: [email],
      });

      let previousId = existing.rows.length > 0 ? String(existing.rows[0].id) : null;
      if (previousId && RESET) {
        for (const table of ['session', 'account']) {
          await control.execute({ sql: `DELETE FROM ${table} WHERE userId = ?`, args: [previousId] });
        }
        await control.execute({ sql: 'DELETE FROM user WHERE id = ?', args: [previousId] });
        console.log(`[~] ${email}: reset`);
        previousId = null;
      }

      let userId: string;
      if (previousId) {
        userId = previousId;
        console.log(`[=] ${email}: already exists`);
      } else {
        // signUpEmail hashes the password exactly as the sign-in form expects;
        // `createUser` needs an admin request context that a script has not got.
        const signedUp = await auth.api.signUpEmail({
          body: { email, password: PASSWORD, name: account.name },
        });
        userId = signedUp.user.id;
        console.log(`[+] ${email}: created (${userId})`);
      }

      // `additionalFields` are `input: false`, so the authoritative write is here.
      await control.execute({
        sql: `UPDATE user SET role = ?, tenantId = ?, branchId = ?, status = 'active', name = ?, updatedAt = ?
               WHERE id = ?`,
        args: [account.role, tenantId, branchId, account.name, new Date().toISOString(), userId],
      });

      // Mirror into the tenant's own `users` table, as `Employees.tsx` does.
      await tenantClient.execute({
        sql: `INSERT INTO users (id, email, name, role, assigned_branch_id, is_active, base_salary, created_at)
              VALUES (?, ?, ?, ?, ?, 1, 0, ?)
              ON CONFLICT (id) DO UPDATE
              SET email = excluded.email, name = excluded.name, role = excluded.role,
                  assigned_branch_id = excluded.assigned_branch_id, is_active = 1`,
        args: [userId, email, account.name, account.role, branchId, new Date().toISOString()],
      });

      console.log(`    ${account.role.padEnd(13)} ${account.branch ?? '-'} branch=${branchId ?? '-'}`);
    }

    console.log(`\n[i] password for all test staff: ${PASSWORD}\n`);
  } finally {
    tenantClient.close();
    control.close();
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
