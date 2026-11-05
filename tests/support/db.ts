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

/** The tenant's settings document, parsed. Returns `{}` when nothing is stored. */
async function readSettings(): Promise<Record<string, unknown>> {
  const tenant = await tenantClient();
  try {
    const row = await tenant.execute('SELECT settings FROM tenants LIMIT 1');
    const raw = row.rows[0]?.settings;
    if (typeof raw !== 'string' || !raw) return {};
    return JSON.parse(raw) as Record<string, unknown>;
  } finally {
    tenant.close();
  }
}

/**
 * The `cust_*` key a custom role was saved under, found by its label.
 *
 * The id is generated in the browser, so a test that creates a role through the
 * Settings UI cannot know its key — it reads it back from the settings document
 * the same save wrote.
 */
export async function findCustomRoleKeyByLabel(label: string): Promise<string | null> {
  const settings = await readSettings();
  const roles = (settings.custom_roles ?? {}) as Record<string, { label?: unknown }>;
  for (const [key, value] of Object.entries(roles)) {
    if (value?.label === label) return key;
  }
  return null;
}

/**
 * Removes a custom role (and any scope row) straight from the settings document.
 * Cleanup for the shared cloud tenant when a test cannot delete it through the
 * UI because it is still assigned to a person.
 */
export async function deleteCustomRoleSetting(key: string): Promise<void> {
  const tenant = await tenantClient();
  try {
    const row = await tenant.execute('SELECT id, settings FROM tenants LIMIT 1');
    const current = row.rows[0];
    if (!current) return;
    const settings = JSON.parse(String(current.settings ?? '{}')) as Record<string, unknown>;
    for (const bucket of ['custom_roles', 'role_scopes', 'role_permissions']) {
      const map = settings[bucket];
      if (map && typeof map === 'object' && key in (map as Record<string, unknown>)) {
        delete (map as Record<string, unknown>)[key];
        if (Object.keys(map as object).length === 0) delete settings[bucket];
      }
    }
    await tenant.execute({
      sql: 'UPDATE tenants SET settings = ? WHERE id = ?',
      args: [JSON.stringify(settings), String(current.id)],
    });
  } finally {
    tenant.close();
  }
}
