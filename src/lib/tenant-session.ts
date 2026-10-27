/**
 * In-memory tenant session.
 *
 * Holds the one thing the browser needs to reach its company's database: the
 * libSQL URL plus a short-lived full-access token.
 *
 * Deliberately **not** persisted: no localStorage, no sessionStorage, no
 * IndexedDB. A page reload re-bootstraps through `/api/tenant/bootstrap`, which
 * costs one round trip and means a closed tab can never leak a token.
 */
import type { UserRole } from '@/types';

export interface TenantSession {
  /** `https://<db>-<org>.turso.io` */
  dbUrl: string;
  /** Short-lived libSQL JWT (~60 minutes). */
  token: string;
  /** ISO timestamp of the token expiry. */
  expiresAt: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  userId: string;
  userName: string;
  userEmail: string;
  role: UserRole;
  branchId: string | null;
}

let current: TenantSession | null = null;

export function getTenantSession(): TenantSession | null {
  return current;
}

export function setTenantSession(session: TenantSession): void {
  current = session;
}

export function clearTenantSession(): void {
  current = null;
}

export function hasTenantSession(): boolean {
  return current !== null;
}

/** Milliseconds until the token expires; negative when already expired. */
export function millisUntilExpiry(session: TenantSession = assertSession()): number {
  return new Date(session.expiresAt).getTime() - Date.now();
}

function assertSession(): TenantSession {
  if (!current) throw new Error('Tenant session is not initialised');
  return current;
}
