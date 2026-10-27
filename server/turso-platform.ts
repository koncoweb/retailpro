/**
 * Thin wrapper over the Turso Platform API (https://api.turso.tech/v1).
 *
 * Only what provisioning needs: create a database, mint a token, delete a
 * database, list databases, and read usage. Everything is organization-scoped
 * by `TURSO_ORG_SLUG`.
 */
import { requiredEnv, tursoApiToken, tursoOrg } from './env';

const API_BASE = 'https://api.turso.tech/v1';

export class TursoApiError extends Error {
  status: number;
  endpoint: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(status: number, endpoint: string, message: string, body?: any) {
    super(message);
    this.name = 'TursoApiError';
    this.status = status;
    this.endpoint = endpoint;
    this.body = body;
  }
}

export interface TursoDatabase {
  name: string;
  dbId?: string;
  hostname: string;
  group?: string;
  primaryRegion?: string;
  blockReads?: boolean;
  blockWrites?: boolean;
  deleteProtection?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function tursoFetch<T>(endpoint: string, init: RequestInit = {}): Promise<T> {
  const token = tursoApiToken();
  const url = `${API_BASE}${endpoint}`;

  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
  }

  if (!response.ok) {
    const message =
      parsed?.error ?? parsed?.message ?? `Turso API ${response.status} on ${endpoint}`;
    throw new TursoApiError(response.status, endpoint, message, parsed);
  }

  return parsed as T;
}

/**
 * The Platform API has changed key casing between versions (`hostname` vs
 * `Hostname`), so both are accepted.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normaliseDatabase(raw: any): TursoDatabase {
  const db = raw?.database ?? raw;
  return {
    name: db?.Name ?? db?.name ?? '',
    dbId: db?.DbId ?? db?.db_id ?? db?.id,
    hostname: db?.Hostname ?? db?.hostname ?? '',
    group: db?.group ?? db?.Group,
    primaryRegion: db?.primaryRegion ?? db?.primary_region,
    blockReads: db?.block_reads ?? false,
    blockWrites: db?.block_writes ?? false,
    deleteProtection: db?.delete_protection ?? false,
  };
}

export async function createDatabase(name: string, group: string): Promise<TursoDatabase> {
  const org = tursoOrg();
  const raw = await tursoFetch<unknown>(`/organizations/${org}/databases`, {
    method: 'POST',
    body: JSON.stringify({ name, group }),
  });
  return normaliseDatabase(raw);
}

/**
 * @param expiration e.g. `10m`, `60m`, `1d`
 * @param authorization `full-access` | `read-only`
 */
export async function createToken(
  database: string,
  expiration: string,
  authorization: 'full-access' | 'read-only' = 'full-access'
): Promise<{ jwt: string }> {
  const org = tursoOrg();
  const query = new URLSearchParams({ expiration, authorization });
  const raw = await tursoFetch<{ jwt?: string; token?: string }>(
    `/organizations/${org}/databases/${encodeURIComponent(database)}/auth/tokens?${query}`,
    { method: 'POST' }
  );
  const jwt = raw?.jwt ?? raw?.token;
  if (!jwt) {
    throw new TursoApiError(502, 'auth/tokens', 'Turso returned no token');
  }
  return { jwt };
}

export async function deleteDatabase(database: string): Promise<void> {
  const org = tursoOrg();
  await tursoFetch<unknown>(`/organizations/${org}/databases/${encodeURIComponent(database)}`, {
    method: 'DELETE',
  });
}

export async function listDatabases(): Promise<TursoDatabase[]> {
  const org = tursoOrg();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = await tursoFetch<any>(`/organizations/${org}/databases`);
  const list = raw?.databases ?? [];
  return Array.isArray(list) ? list.map(normaliseDatabase) : [];
}

/** Per-database usage, used by the fleet guard and the platform dashboard. */
export async function getUsage(): Promise<unknown> {
  const org = tursoOrg();
  return tursoFetch<unknown>(`/organizations/${org}/usage`);
}

/**
 * Builds the libSQL URL the browser connects to. `https://` is used because the
 * browser entry point (`@libsql/client/web`) speaks HTTP, not WebSockets.
 */
export function browserDbUrl(hostname: string): string {
  if (hostname.startsWith('http://') || hostname.startsWith('https://')) return hostname;
  return `https://${hostname}`;
}

export function requireTursoConfig(): {
  org: string;
} {
  // Fails fast with a readable message when the deployment is misconfigured.
  requiredEnv('TURSO_API_TOKEN');
  return { org: tursoOrg() };
}
