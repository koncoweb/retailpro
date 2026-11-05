/**
 * GET /api/tenant/bootstrap
 *
 * The one call the SPA makes before it can touch any business data. It resolves
 * the caller's tenant, mints a short-lived full-access token for that tenant's
 * database and returns everything the browser needs to open a libSQL client.
 *
 * It also proves the caller still exists as an employee of that company. The
 * control-plane session survives on its own, so before this check a person the
 * owner had deleted — or deactivated — from the Employees screen kept receiving
 * a working token for the company database. Identity is now written by one
 * endpoint (`api/admin/users/[id].ts`) and verified here.
 *
 * The token is never cached by the browser: `TenantContext` keeps it in memory
 * and calls /api/tenant/token to refresh it before it expires.
 */
import { requireTenantSession } from '../../server/auth-helpers.js';
import { browserDbUrl } from '../../server/turso-platform.js';
import { mintTenantToken } from '../../server/provision.js';
import { readTenantAccess, readUserProjection } from '../../server/roles.js';
import {
  HttpError,
  methodNotAllowed,
  sendJson,
  withErrors,
  type ApiRequest,
  type ApiResponse,
} from '../../server/http.js';

async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const { user, tenant } = await requireTenantSession(req.headers);

  // One indexed read of the projection row. A missing row means the account was
  // removed from this company; `is_active = 0` means it was switched off. Both
  // answer the same way as the session check in `requireTenantSession`, so the
  // SPA's existing "account inactive" handling covers both paths.
  const projection = await readUserProjection(tenant, user.id);
  if (!projection || !projection.isActive) {
    throw new HttpError(
      403,
      'account_inactive',
      'Akun Anda sudah tidak aktif di perusahaan ini. Hubungi owner untuk mengaktifkannya kembali.'
    );
  }

  const { token, expiresAt } = await mintTenantToken(tenant.db_name, tenant.db_hostname);

  // The permission matrix, resolved by the same pure resolver the browser uses,
  // so the very first paint already knows what this person may do — no flash of
  // hidden buttons, and no second answer to compare against. `TenantContext`
  // seeds `['tenant-settings']` with exactly this object. The per-employee
  // exceptions come from the same read; only the caller's own slice ships, so a
  // person never learns what was taken back from a colleague.
  const { grants, userPermissions } = await readTenantAccess(tenant);
  const role = user.role ?? 'staff';

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
      role,
      branchId: user.branchId ?? projection.branchId ?? null,
      active: true,
    },
    grants,
    userPermissions: { [user.id]: userPermissions[user.id] ?? {} },
  });
}

export default withErrors(handler);
