/**
 * Storefront catch-all: handles /api/storefront/channels, /qris, and /orders.
 *
 * Consolidated into a single file to stay within the Vercel Hobby plan's
j *
 *   GET  /api/storefront/channels  — payment-channel readout (public)
 *   GET  /api/storefront/qris     — static QRIS image bytes (public)
 *   POST / GET /api/storefront/orders — checkout hand-off + status poll
 *
 * More-specific files (`catalog.ts`, `marketplace.ts`) keep their own routes;
 * Vercel resolves them before this catch-all.
 */
import { createClient } from '@libsql/client';
import {
  HttpError,
  methodNotAllowed,
  readJsonBody,
  sendJson,
  withErrors,
  type ApiRequest,
  type ApiResponse,
} from '../../server/http.js';
import { mintTenantToken } from '../../server/provision.js';
import { browserDbUrl } from '../../server/turso-platform.js';
import {
  decodeQrisDataUrl,
  findActiveTenantBySlug,
  listActiveTenants,
  readPaymentConfig,
  type StorefrontPaymentConfig,
} from '../../server/storefront-payments.js';
import { createStorefrontOrders, readOrderStatuses } from '../../server/storefront-orders.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function allowCors(res: ApiResponse, methods: string): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value && value.trim() ? value.trim() : null;
}

function sendPublicJson(res: ApiResponse, payload: unknown): void {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.end(JSON.stringify(payload));
}

/** Turn any non-`HttpError` (a raw libSQL failure) into a safe generic error. */
function safeOrderError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  console.error('[storefront] orders failure:', error);
  return new HttpError(503, 'storefront_unavailable', 'Pesanan belum dapat diproses, coba lagi sebentar.');
}

// ---------------------------------------------------------------------------
// /channels
// ---------------------------------------------------------------------------

async function readOneChannel(slug: string): Promise<StorefrontPaymentConfig> {
  const tenant = await findActiveTenantBySlug(slug);
  const { token } = await mintTenantToken(tenant.db_name, tenant.db_hostname);
  const client = createClient({ url: browserDbUrl(tenant.db_hostname), authToken: token });
  try {
    return await readPaymentConfig(client, tenant);
  } finally {
    client.close();
  }
}

async function handleChannels(_req: ApiRequest, res: ApiResponse) {
  allowCors(res, 'GET, OPTIONS');
  const slug = firstValue(_req.query?.slug);
  if (slug) {
    sendPublicJson(res, await readOneChannel(slug));
    return;
  }
  const tenants = await listActiveTenants();
  const configs: StorefrontPaymentConfig[] = [];
  const skipped: { slug: string; reason: 'unavailable' }[] = [];
  for (const tenant of tenants) {
    try {
      configs.push(await readOneChannel(tenant.slug));
    } catch (error) {
      console.error(
        `[storefront] channels for "${tenant.slug}" skipped:`,
        error instanceof Error ? error.message : error
      );
      skipped.push({ slug: tenant.slug, reason: 'unavailable' });
    }
  }
  sendPublicJson(res, {
    shops: configs,
    tenants: { total: tenants.length, live: configs.length },
    skipped,
    syncedAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// /qris
// ---------------------------------------------------------------------------

const DEFAULT_QRIS_SLUG = 'thalia';

async function handleQris(_req: ApiRequest, res: ApiResponse) {
  allowCors(res, 'GET, OPTIONS');
  const slug =
    firstValue(_req.query?.slug) ?? process.env.STOREFRONT_TENANT_SLUG?.trim() ?? DEFAULT_QRIS_SLUG;

  const tenant = await findActiveTenantBySlug(slug);
  const { token } = await mintTenantToken(tenant.db_name, tenant.db_hostname);
  const client = createClient({ url: browserDbUrl(tenant.db_hostname), authToken: token });
  let image: unknown;
  try {
    const result = await client.execute('SELECT qris_image FROM tenants LIMIT 1');
    image = (result.rows[0] as unknown as { qris_image: string | null } | undefined)?.qris_image;
  } finally {
    client.close();
  }

  const decoded = decodeQrisDataUrl(image);
  if (!decoded || decoded.bytes.length === 0) {
    throw new HttpError(404, 'qris_not_available', `Tenant "${slug}" has no static QRIS image.`);
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', decoded.mime);
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.end(decoded.bytes);
}

// ---------------------------------------------------------------------------
// /orders
// ---------------------------------------------------------------------------

async function handleOrders(req: ApiRequest, res: ApiResponse) {
  if (req.method === 'POST') {
    allowCors(res, 'GET, POST, OPTIONS');
    const body = await readJsonBody(req);
    try {
      sendJson(res, 201, await createStorefrontOrders(body));
    } catch (error) {
      throw safeOrderError(error);
    }
    return;
  }

  if (req.method !== 'GET') {
    allowCors(res, 'GET, POST, OPTIONS');
    return methodNotAllowed(res, ['GET', 'POST', 'OPTIONS']);
  }
  allowCors(res, 'GET, POST, OPTIONS');

  const parent = firstValue(req.query?.parent);
  if (!parent) {
    throw new HttpError(400, 'missing_parent', 'Parameter `parent` wajib diisi.');
  }
  const slugsRaw = firstValue(req.query?.slugs);
  const slugs = slugsRaw ? slugsRaw.split(',').map((s) => s.trim()).filter(Boolean) : undefined;

  try {
    sendJson(res, 200, { parent, orders: await readOrderStatuses(parent, slugs) });
  } catch (error) {
    throw safeOrderError(error);
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function pathname(req: ApiRequest): string {
  const raw = req.url ?? '/';
  const q = raw.indexOf('?');
  return q >= 0 ? raw.slice(0, q) : raw;
}

async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method === 'OPTIONS') {
    allowCors(res, 'GET, POST, OPTIONS');
    res.statusCode = 204;
    res.end();
    return;
  }

  const path = pathname(req).replace(/^\/api\/storefront\/?/, '');

  switch (path) {
    case 'channels':
      if (req.method !== 'GET') return methodNotAllowed(res, ['GET', 'OPTIONS']);
      return handleChannels(req, res);
    case 'qris':
      if (req.method !== 'GET') return methodNotAllowed(res, ['GET', 'OPTIONS']);
      return handleQris(req, res);
    case 'orders':
      return handleOrders(req, res);
    default:
      sendJson(res, 404, {
        error: 'not_found',
        message: `Route /api/storefront/${path} not found`,
      });
  }
}

export default withErrors(handler);
