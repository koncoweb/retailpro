/**
 * Browser libSQL client, one per tenant database.
 *
 * The SPA talks straight to its company's Turso database (no server hop), which
 * is why the token is short lived, memory only, and scoped to a single database:
 * a leak is bounded to one company and to one hour.
 *
 * `@libsql/client/web` is the browser entry point; it speaks HTTP/WebSocket to
 * `https://<db>-<org>.turso.io` and never touches Node built-ins.
 */
import { createClient, type Client } from '@libsql/client/web';
import { getTenantSession, millisUntilExpiry, setTenantSession } from '@/lib/tenant-session';
import { logger } from '@/lib/logger';

/** Refresh this long before expiry so a query can never straddle the boundary. */
const REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

export class DbNotReadyError extends Error {
  constructor(message = 'Tenant database is not ready. Sign in and reload.') {
    super(message);
    this.name = 'DbNotReadyError';
  }
}

export class DbTokenError extends Error {
  constructor(message = 'Database token was rejected.') {
    super(message);
    this.name = 'DbTokenError';
  }
}

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';

let client: Client | null = null;
let clientUrl: string | null = null;
let refreshing: Promise<void> | null = null;

function buildClient(url: string, token: string): Client {
  return createClient({ url, authToken: token });
}

/** Drops the cached client. Called on logout and whenever the token rotates. */
export function resetClient(): void {
  if (client) {
    try {
      client.close();
    } catch {
      // already closed
    }
  }
  client = null;
  clientUrl = null;
}

interface TokenResponse {
  dbUrl: string;
  token: string;
  expiresAt: string;
  tenantId: string;
}

/**
 * Re-mints the token via the API and swaps the client. Single-flight: concurrent
 * callers share one request.
 */
export function refreshToken(): Promise<void> {
  if (refreshing) return refreshing;

  refreshing = (async () => {
    const session = getTenantSession();
    if (!session) throw new DbNotReadyError();

    const response = await fetch(`${apiBase}/api/tenant/token`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      throw new DbTokenError(`Token refresh failed (HTTP ${response.status}).`);
    }

    const payload = (await response.json()) as TokenResponse;
    setTenantSession({
      ...session,
      dbUrl: payload.dbUrl,
      token: payload.token,
      expiresAt: payload.expiresAt,
      tenantId: payload.tenantId ?? session.tenantId,
    });

    if (clientUrl !== payload.dbUrl) {
      resetClient();
    }
    client = buildClient(payload.dbUrl, payload.token);
    clientUrl = payload.dbUrl;
    logger.info?.('Tenant token refreshed');
  })();

  refreshing.finally(() => {
    refreshing = null;
  });

  return refreshing;
}

/** Refreshes when the token is inside the expiry window. */
export async function refreshIfNeeded(): Promise<void> {
  const session = getTenantSession();
  if (!session) throw new DbNotReadyError();
  if (millisUntilExpiry(session) > REFRESH_THRESHOLD_MS) return;
  await refreshToken();
}

/** Returns a ready client, refreshing the token when necessary. */
export async function getClient(): Promise<Client> {
  const session = getTenantSession();
  if (!session) throw new DbNotReadyError();

  if (!client || clientUrl !== session.dbUrl) {
    client = buildClient(session.dbUrl, session.token);
    clientUrl = session.dbUrl;
  }

  await refreshIfNeeded();
  return client as Client;
}

/** True for errors that mean "the token is stale", which is worth one retry. */
export function isTokenError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
  return (
    message.includes('unauthorized') ||
    message.includes('not authorized') ||
    message.includes('401') ||
    message.includes('jwt') ||
    message.includes('token')
  );
}
