/**
 * Session helpers shared by the non-auth API routes.
 */
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import { auth, ADMIN_ROLES, type SessionUser } from './auth.js';
import type { AppRole } from './access.js';
import type { TenantDatabaseRow } from './control-db.js';
import { resolveTenantForUser } from './provision.js';
import { HttpError } from './http.js';

export interface AuthenticatedRequest {
  user: SessionUser;
  tenant: TenantDatabaseRow;
}

export async function getSession(headers: IncomingHttpHeaders) {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(headers) });
  return session;
}

/**
 * Requires a signed-in user that belongs to a provisioned tenant.
 * Throws `HttpError` with the right status for each failure mode.
 */
export async function requireTenantSession(
  headers: IncomingHttpHeaders
): Promise<AuthenticatedRequest> {
  const session = await getSession(headers);
  if (!session?.user) {
    throw new HttpError(401, 'unauthenticated', 'Sign in first.');
  }

  const user = session.user as unknown as SessionUser;
  if (user.status && user.status !== 'active') {
    throw new HttpError(403, 'account_inactive', 'This account is not active.');
  }

  const tenant = await resolveTenantForUser(user.id, user.tenantId);
  if (!tenant) {
    throw new HttpError(404, 'no_tenant', 'This account is not linked to a company yet.');
  }
  if (tenant.status !== 'active') {
    throw new HttpError(403, 'tenant_inactive', `Company is ${tenant.status}.`);
  }

  return { user, tenant };
}

/** Same as `requireTenantSession`, plus an admin-role check. */
export async function requireAdminSession(
  headers: IncomingHttpHeaders
): Promise<AuthenticatedRequest> {
  const context = await requireTenantSession(headers);
  const role = context.user.role as AppRole | undefined;
  if (!role || !ADMIN_ROLES.includes(role)) {
    throw new HttpError(403, 'forbidden', 'Only owner/admin roles can manage employees.');
  }
  return context;
}
