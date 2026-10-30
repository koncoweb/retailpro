/**
 * POST /api/tenant/token
 *
 * Re-mints the browser token only. `src/lib/db/client.ts` calls this before a
 * token expires (and is issued on the fly when refreshing during a query).
 */
import { requireTenantSession } from '../../server/auth-helpers.js';
import { browserDbUrl } from '../../server/turso-platform.js';
import { mintTenantToken } from '../../server/provision.js';
import {
  methodNotAllowed,
  sendJson,
  withErrors,
  type ApiRequest,
  type ApiResponse,
} from '../../server/http.js';

async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const { tenant } = await requireTenantSession(req.headers);
  const { token, expiresAt } = await mintTenantToken(tenant.db_name, tenant.db_hostname);

  sendJson(res, 200, {
    dbUrl: browserDbUrl(tenant.db_hostname),
    token,
    expiresAt,
    tenantId: tenant.id,
  });
}

export default withErrors(handler);
