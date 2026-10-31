/**
 * Direct database access for e2e fixtures and cleanup.
 *
 * The app itself talks to Turso over HTTP with a short-lived tenant token minted
 * by `/api/tenant/token`; a test that creates a row through the UI needs the
 * same two handles to remove it again, so this helper reuses the server's
 * platform token and registry row instead of scraping the UI.
 */
import { createClient, type Client } from '@libsql/client';

// The runner loads the config, not the environment: do it again for test code.
try {
  process.loadEnvFile();
} catch {
  // no .env — fall back to the shell environment
}

const API_BASE = 'https://api.turso.tech/v1';

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set; start the suite from the repository root.`);
  return value;
}

export async function tenantRegistry(): Promise<{ id: string; dbName: string; dbHostname: string }> {
  const control = controlClient();
  try {
    const slug = process.env.STOREFRONT_TENANT_SLUG?.trim() || 'thalia';
    const row = await control.execute({
      sql: 'SELECT id, db_name, db_hostname FROM tenant_databases WHERE slug = ?',
      args: [slug],
    });
    const tenant = row.rows[0];
    if (!tenant) throw new Error(`No tenant "${slug}" registered in tenant_databases.`);
    return {
      id: String(tenant.id),
      dbName: String(tenant.db_name),
      dbHostname: String(tenant.db_hostname),
    };
  } finally {
    control.close();
  }
}

export function controlClient(): Client {
  return createClient({
    url: requireEnv('CONTROL_DB_URL'),
    authToken: process.env.CONTROL_DB_TOKEN,
  });
}

export async function tenantClient(): Promise<Client> {
  const org = requireEnv('TURSO_ORG_SLUG');
  const { dbName, dbHostname } = await tenantRegistry();
  const response = await fetch(
    `${API_BASE}/organizations/${org}/databases/${encodeURIComponent(dbName)}/auth/tokens?expiration=10m&authorization=full-access`,
    { method: 'POST', headers: { Authorization: `Bearer ${requireEnv('TURSO_API_TOKEN')}` } },
  );
  if (!response.ok) throw new Error(`Turso token request failed: ${response.status}`);
  const { jwt } = (await response.json()) as { jwt?: string };
  if (!jwt) throw new Error('Turso returned no token.');
  return createClient({
    url: dbHostname.startsWith('http') ? dbHostname : `https://${dbHostname}`,
    authToken: jwt,
  });
}

/**
 * Removes an identity created through the Employees screen: the control-plane
 * rows (Better Auth user, its credential account and sessions) plus the
 * tenant's own `users` projection.
 */
export async function deleteUserByEmail(email: string): Promise<void> {
  const control = controlClient();
  try {
    const row = await control.execute({ sql: 'SELECT id FROM user WHERE email = ?', args: [email] });
    const id = row.rows[0]?.id;
    if (id) {
      for (const table of ['session', 'account']) {
        await control.execute({ sql: `DELETE FROM ${table} WHERE userId = ?`, args: [id] });
      }
      await control.execute({ sql: 'DELETE FROM user WHERE id = ?', args: [id] });
    }
  } finally {
    control.close();
  }

  const tenant = await tenantClient();
  try {
    await tenant.execute({ sql: 'DELETE FROM users WHERE email = ?', args: [email] });
  } finally {
    tenant.close();
  }
}
