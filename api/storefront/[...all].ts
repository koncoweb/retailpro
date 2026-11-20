/**
 * Storefront catch-all: handles /api/storefront/channels, /qris, /orders, /webhook.
 *
 * Consolidated into a single file to stay within the Vercel Hobby plan's
 * 12-function limit. Mounting the GOWA webhook here (rather than a new
 * function file) is that constraint in action.
 *
 *   GET  /api/storefront/channels  — payment-channel readout (public)
 *   GET  /api/storefront/qris     — static QRIS image bytes (public)
 *   POST / GET /api/storefront/orders — checkout hand-off + status poll
 *   GET  /api/storefront/webhook  — GOWA subscriber verification (hub.challenge)
 *   POST /api/storefront/webhook  — GOWA webhook receipts (message.ack, replies)
 *
 * More-specific files (`catalog.ts`, `marketplace.ts`) keep their own routes;
 * Vercel resolves them before this catch-all.
 */
import { randomUUID, timingSafeEqual } from 'node:crypto';
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
import { optionalEnv } from '../../server/env.js';
import { getControlDb } from '../../server/control-db.js';
import {
  applyWebhookToOrders,
  parseWebhookEvent,
  verifyWebhookSignature,
} from '../../server/whatsapp-invoice.js';

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
// /webhook — GOWA (WhatsApp) receipts
// ---------------------------------------------------------------------------

/** Read the request body verbatim: the HMAC is computed over the raw bytes. */
async function readRawBody(req: ApiRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  if (chunks.length > 0) return Buffer.concat(chunks);
  // A platform-parsed body (`req.body`) is byte-faithful for JSON payloads.
  if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');
  if (req.body && typeof req.body === 'object') return Buffer.from(JSON.stringify(req.body), 'utf8');
  return Buffer.alloc(0);
}

function constantTimeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

async function handleWebhook(req: ApiRequest, res: ApiResponse) {
  // Optional subscriber-URL handshake (`?hub.mode=subscribe&hub.verify_token=…`).
  // GOWA itself only POSTs and never performs this check, so it stays here for
  // other integrations and answers 403 while GOWA_WEBHOOK_VERIFY_TOKEN is unset.
  if (req.method === 'GET') {
    const params = new URL(req.url ?? '/', 'http://local').searchParams;
    if (params.get('hub.mode') === 'subscribe') {
      const secret = optionalEnv('GOWA_WEBHOOK_VERIFY_TOKEN');
      const token = params.get('hub.verify_token') ?? '';
      if (secret && constantTimeEquals(token, secret)) {
        res.statusCode = 200;
        res.end(params.get('hub.challenge') ?? '');
        return;
      }
      res.statusCode = 403;
      res.end();
      return;
    }
    return methodNotAllowed(res, ['GET', 'POST', 'OPTIONS']);
  }
  if (req.method !== 'POST') return methodNotAllowed(res, ['GET', 'POST', 'OPTIONS']);

  const raw = await readRawBody(req);

  // Signature gate: without a configured secret the endpoint stays shut —
  // accepting unauthenticated pushes would let anyone forge delivery receipts.
  const secret = optionalEnv('GOWA_WEBHOOK_SECRET');
  if (!secret) {
    sendJson(res, 503, { error: 'webhook_not_configured', message: 'GOWA_WEBHOOK_SECRET belum diset.' });
    return;
  }
  const signature = req.headers['x-hub-signature-256'];
  if (!verifyWebhookSignature(raw, Array.isArray(signature) ? signature[0] : signature, secret)) {
    sendJson(res, 401, { error: 'invalid_signature', message: 'Tanda tangan webhook tidak valid.' });
    return;
  }

  let body: unknown;
  try {
    body = raw.length ? JSON.parse(raw.toString('utf8')) : null;
  } catch {
    throw new HttpError(400, 'invalid_payload', 'Body webhook bukan JSON.');
  }
  const parsed = body ? parseWebhookEvent(body as Record<string, unknown>) : null;
  if (!parsed) {
    sendJson(res, 200, { ok: true, outcome: 'ignored' });
    return;
  }

  // Project onto tenant order rows first (the useful part), then log the raw
  // receipt in the control DB; a telemetry failure must not make GOWA retry.
  let outcome = 'ignored';
  let hits: { invoiceNumber: string }[] = [];
  try {
    hits = await applyWebhookToOrders(parsed);
    if (hits.length) outcome = 'matched';
  } catch (error) {
    console.error('[webhook] order projection failed:', error instanceof Error ? error.message : error);
  }
  try {
    await getControlDb()
      .insertInto('whatsapp_events')
      .values({
        // Written explicitly rather than left to the column DEFAULTs: Vercel's
        // build-time type check treats these keys as required, and an ISO stamp
        // costs us nothing.
        id: randomUUID(),
        event: parsed.event,
        device_id: parsed.deviceId,
        message_id: parsed.messageId,
        chat_jid: parsed.chatJid,
        sender_jid: parsed.senderJid,
        ack: parsed.ack,
        body: parsed.body,
        outcome,
        payload: JSON.stringify(body),
        received_at: new Date().toISOString(),
      })
      .execute();
  } catch (error) {
    console.error('[webhook] whatsapp_events log failed:', error instanceof Error ? error.message : error);
  }

  sendJson(res, 200, { ok: true, outcome, orders: hits.map((h) => h.invoiceNumber) });
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
    case 'webhook':
      return handleWebhook(req, res);
    default:
      sendJson(res, 404, {
        error: 'not_found',
        message: `Route /api/storefront/${path} not found`,
      });
  }
}

export default withErrors(handler);
