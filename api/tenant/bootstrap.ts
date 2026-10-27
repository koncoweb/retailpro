/**
 * GET /api/tenant/bootstrap
 *
 * The one call the SPA makes before it can touch any business data. It resolves
 * the caller's tenant, mints a short-lived full-access token for that tenant's
 * database and returns everything the browser needs to open a libSQL client.
 *
 * The token is never cached by the browser: `TenantContext` keeps it in memory
 * and calls /api/tenant/token to refresh it before it expires.
 */
import { requireTenantSession } from '../../server/auth-helpers';
import { browserDbUrl } from '../../server/turso-platform';
import { mintTenantToken } from '../../server/provision';
import { methodNotAllowed, sendJson, withErrors, type ApiRequest, type ApiResponse } from '../../server/http';

async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const { user, tenant } = await requireTenantSession(req.headers);
  const { token, expiresAt } = await mintTenantToken(tenant.db_name, tenant.db_hostname);

  sendJson(res, 200, {
    dbUrl: browserDbUrl(tenant.db_hostname),
    token,
    expiresAt,
    tenant: {
      id: tenant.id,
      name: tenant.company_name,
      slug: tenant.slug,
    },
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role ?? 'staff',
      branchId: user.branchId ?? null,
    },
  });
}

export default withErrors(handler);
