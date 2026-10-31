/**
 * GET /api/storefront/catalog
 *
 * Public, read-only catalogue for ONE tenant's online channel (the `type =
 * 'online'` branch, e.g. "Thalia Online"). It exists so the storefront can show
 * real goods without ever holding a database credential: this handler resolves
 * the tenant, mints a short-lived token and returns prose JSON.
 *
 * Query: `?slug=<tenant slug>` (defaults to STOREFRONT_TENANT_SLUG, then
 * `thalia`). CORS is wide open because the response is the same catalogue a
 * visitor can read in the browser anyway; nothing cost-bearing is included.
 *
 * A shop that sells goods from every tenant at once reads
 * `/api/storefront/marketplace` instead, which returns the same product shape
 * with the seller attached.
 */
import { createClient } from '@libsql/client';
import { getControlDb } from '../../server/control-db.js';
import {
  HttpError,
  methodNotAllowed,
  sendJson,
  withErrors,
  type ApiRequest,
  type ApiResponse,
} from '../../server/http.js';
import { mintTenantToken } from '../../server/provision.js';
import { readTenantCatalog } from '../../server/storefront-catalog.js';
import { browserDbUrl } from '../../server/turso-platform.js';

const DEFAULT_SLUG = 'thalia';

function allowCors(res: ApiResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value && value.trim() ? value.trim() : null;
}

async function handler(req: ApiRequest, res: ApiResponse) {
  allowCors(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET', 'OPTIONS']);

  const slug =
    firstValue(req.query?.slug) ?? process.env.STOREFRONT_TENANT_SLUG?.trim() ?? DEFAULT_SLUG;

  const tenant = await getControlDb()
    .selectFrom('tenant_databases')
    .select(['id', 'slug', 'company_name', 'db_name', 'db_hostname', 'status'])
    .where('slug', '=', slug)
    .executeTakeFirst();
  if (!tenant) {
    throw new HttpError(404, 'tenant_not_found', `No tenant with slug "${slug}".`);
  }
  if (tenant.status !== 'active') {
    throw new HttpError(409, 'tenant_inactive', `Tenant "${slug}" is ${tenant.status}.`);
  }

  const { token } = await mintTenantToken(tenant.db_name, tenant.db_hostname);
  const client = createClient({ url: browserDbUrl(tenant.db_hostname), authToken: token });
  try {
    sendJson(res, 200, await readTenantCatalog(client, tenant));
  } finally {
    client.close();
  }
}

export default withErrors(handler);
