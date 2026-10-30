/**
 * POST /api/tenant/provision  { companyName, slug, branchName?, branchAddress? }
 *
 * Creates a brand new Turso database for the signed-in user, applies the tenant
 * schema + seed, and registers it in the control plane.
 *
 * 409 when the account already owns a tenant, 429 when the free-tier database
 * budget (`TURSO_MAX_TENANT_DATABASES`) is exhausted.
 */
import { getSession } from '../../server/auth-helpers.js';
import { HttpError, readJsonBody, methodNotAllowed, sendJson, withErrors, type ApiRequest, type ApiResponse } from '../../server/http.js';
import { ProvisionError, provisionTenant } from '../../server/provision.js';
import { TursoApiError } from '../../server/turso-platform.js';

interface ProvisionBody {
  companyName?: string;
  slug?: string;
  branchName?: string;
  branchAddress?: string;
}

async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const session = await getSession(req.headers);
  if (!session?.user) {
    throw new HttpError(401, 'unauthenticated', 'Sign in first.');
  }

  const body = await readJsonBody<ProvisionBody>(req);
  const companyName = (body.companyName ?? '').trim();
  const slug = (body.slug ?? companyName).trim();

  if (companyName.length < 2) {
    throw new HttpError(400, 'invalid_company_name', 'Company name is too short.');
  }

  try {
    const result = await provisionTenant({
      userId: session.user.id,
      userEmail: session.user.email,
      userName: session.user.name ?? session.user.email,
      companyName,
      slug,
      branchName: body.branchName,
      branchAddress: body.branchAddress,
    });

    sendJson(res, 201, result);
  } catch (error) {
    if (error instanceof ProvisionError) {
      throw new HttpError(error.status, error.code, error.message);
    }
    if (error instanceof TursoApiError) {
      throw new HttpError(502, 'turso_error', error.message, { endpoint: error.endpoint });
    }
    throw error;
  }
}

export default withErrors(handler);
