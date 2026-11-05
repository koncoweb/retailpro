/**
 * Server-side access to one tenant's business database.
 *
 * The browser already holds a token for its own tenant (see `mintTenantToken`).
 * The control plane needs the same reach for two narrow reasons — proving an
 * account still exists before handing out a token, and mirroring an identity
 * change into the tenant's `users` projection — and neither of them may leak a
 * long-lived credential. So every call here mints a 1-minute token, opens a
 * client, and closes it again.
 */
import { createClient, type Client } from '@libsql/client';
import type { TenantDatabaseRow } from './control-db.js';
import { HttpError } from './http.js';
import { isLoopbackHost, LOCAL_DEV_TOKEN } from './provision.js';
import { browserDbUrl, createToken } from './turso-platform.js';

/** Shorter than the browser token: this client never leaves the process. */
const SERVER_TOKEN_TTL = '1m';

export interface TenantConnection {
  url: string;
  token: string;
}

/**
 * Resolves the libSQL coordinates of a tenant database.
 *
 * A local run has no Turso platform token and the dev server ignores the JWT, so
 * minting one through the Platform API would only make localhost unusable — the
 * same branch `mintTenantToken` takes.
 */
export async function tenantConnection(
  tenant: Pick<TenantDatabaseRow, 'db_name' | 'db_hostname'>
): Promise<TenantConnection> {
  const url = browserDbUrl(tenant.db_hostname);
  if (isLoopbackHost(tenant.db_hostname)) {
    return { url, token: LOCAL_DEV_TOKEN };
  }
  const { jwt } = await createToken(tenant.db_name, SERVER_TOKEN_TTL, 'full-access');
  return { url, token: jwt };
}

/**
 * Runs `fn` against a fresh client for `tenant`, always closing it.
 *
 * Connection problems become a typed 502 rather than an unhandled crash: the
 * caller's own failure path (`RequireTenant` in the SPA) already knows how to
 * offer "Coba lagi" for that code.
 */
export async function withTenantClient<T>(
  tenant: Pick<TenantDatabaseRow, 'db_name' | 'db_hostname'>,
  fn: (client: Client) => Promise<T>
): Promise<T> {
  let client: Client | null = null;
  try {
    const { url, token } = await tenantConnection(tenant);
    client = createClient({ url, authToken: token });
    return await fn(client);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new HttpError(502, 'tenant_unreachable', `Company database is unreachable: ${message}`);
  } finally {
    client?.close();
  }
}
