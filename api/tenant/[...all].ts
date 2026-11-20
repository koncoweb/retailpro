/**
 * Tenant catch-all: handles /api/tenant/qris-image, /orders/confirm, /orders/status,
 * /whatsapp-device.
 *
 * Consolidated into a single file to stay within the Vercel Hobby plan's
 * 12-function limit. The routes are:
 *
 *   GET/POST/DELETE /api/tenant/qris-image      — merchant's static QRIS
 *   POST            /api/tenant/orders/confirm  — confirm payment, create tx
 *   POST            /api/tenant/orders/status   — transition / cancel order
 *   GET/POST        /api/tenant/whatsapp-device — pair the invoice sender (QR)
 *
 * More-specific files (`bootstrap.ts`, `provision.ts`, `token.ts`) keep their
 * own routes; Vercel resolves them before this catch-all.
 */
import { createClient } from '@libsql/client';
import { requireAdminSession, requireTenantSession } from '../../server/auth-helpers.js';
import { optionalEnv } from '../../server/env.js';
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
import { QRIS_MAX_DATA_URL_BYTES } from '../../src/lib/payment-channels.js';
import {
  confirmStorefrontOrder,
  transitionStorefrontOrder,
  type OrderTransition,
} from '../../server/storefront-orders.js';
import {
  gowaDeviceConfig,
  gowaDeviceOverview,
  gowaLoginQr,
  gowaLogout,
  gowaReconnect,
  type GowaConfig,
} from '../../server/whatsapp-invoice.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value && value.trim() ? value.trim() : null;
}

async function readQrisColumn(
  tenant: { db_name: string; db_hostname: string },
): Promise<string | null> {
  const { token } = await mintTenantToken(tenant.db_name, tenant.db_hostname);
  const client = createClient({ url: browserDbUrl(tenant.db_hostname), authToken: token });
  try {
    const res = await client.execute('SELECT qris_image FROM tenants LIMIT 1');
    const value = (res.rows[0] as unknown as { qris_image: string | null } | undefined)?.qris_image;
    return typeof value === 'string' && value.trim() ? value : null;
  } finally {
    client.close();
  }
}

async function writeQrisColumn(
  tenant: { db_name: string; db_hostname: string },
  value: string | null,
): Promise<void> {
  const { token } = await mintTenantToken(tenant.db_name, tenant.db_hostname);
  const client = createClient({ url: browserDbUrl(tenant.db_hostname), authToken: token });
  try {
    await client.execute({ sql: 'UPDATE tenants SET qris_image = ?', args: [value] });
  } finally {
    client.close();
  }
}

function safeConfirmError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  console.error('[tenant] order confirm failure:', error);
  return new HttpError(500, 'confirm_failed', 'Gagal mengkonfirmasi pembayaran, coba lagi.');
}

function safeStatusError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  console.error('[tenant] order status change failure:', error);
  return new HttpError(500, 'status_failed', 'Gagal mengubah status pesanan, coba lagi.');
}

// ---------------------------------------------------------------------------
// /qris-image
// ---------------------------------------------------------------------------

async function handleQrisImage(req: ApiRequest, res: ApiResponse) {
  const method = req.method ?? 'GET';

  if (method === 'GET') {
    const { tenant } = await requireTenantSession(req.headers);
    const dataUrl = await readQrisColumn(tenant);
    sendJson(res, 200, { qrisAvailable: !!dataUrl, dataUrl });
    return;
  }

  if (method === 'DELETE') {
    const { tenant } = await requireAdminSession(req.headers);
    await writeQrisColumn(tenant, null);
    sendJson(res, 200, { ok: true, qrisAvailable: false });
    return;
  }

  if (method !== 'POST') return methodNotAllowed(res, ['GET', 'POST', 'DELETE']);

  const { tenant } = await requireAdminSession(req.headers);
  const body = await readJsonBody<{ dataUrl?: unknown }>(req);
  const dataUrl = firstValue(body.dataUrl as string | undefined);

  if (!dataUrl || !dataUrl.startsWith('data:image/')) {
    throw new HttpError(400, 'invalid_image', 'Berkas harus berupa gambar QRIS (PNG, JPEG, atau WebP).');
  }
  if (dataUrl.length > QRIS_MAX_DATA_URL_BYTES) {
    throw new HttpError(413, 'image_too_large', 'Gambar QRIS terlalu besar, perkecil dulu resolusinya.');
  }

  await writeQrisColumn(tenant, dataUrl);
  sendJson(res, 200, { ok: true, qrisAvailable: true, bytes: dataUrl.length });
}

// ---------------------------------------------------------------------------
// /orders/confirm
// ---------------------------------------------------------------------------

async function handleOrdersConfirm(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const { user, tenant } = await requireTenantSession(req.headers);
  const body = await readJsonBody<{ orderId?: unknown }>(req);
  const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
  if (!orderId) {
    throw new HttpError(400, 'missing_order', 'Pesanan belum ditentukan.');
  }

  try {
    sendJson(res, 200, await confirmStorefrontOrder(tenant, orderId, { id: user.id }));
  } catch (error) {
    throw safeConfirmError(error);
  }
}

// ---------------------------------------------------------------------------
// /orders/status
// ---------------------------------------------------------------------------

async function handleOrdersStatus(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const { user, tenant } = await requireTenantSession(req.headers);
  const body = await readJsonBody<{ orderId?: unknown; status?: unknown; reason?: unknown }>(req);

  const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
  const status = typeof body.status === 'string' ? (body.status.trim() as OrderTransition) : '';
  const reason = typeof body.reason === 'string' ? body.reason : null;
  if (!orderId || !status) {
    throw new HttpError(400, 'missing_fields', 'Pesanan dan status tujuan wajib diisi.');
  }

  try {
    const result = await transitionStorefrontOrder(tenant, orderId, status, reason, { id: user.id });
    sendJson(res, 200, { orderId, ...result });
  } catch (error) {
    throw safeStatusError(error);
  }
}

// ---------------------------------------------------------------------------
// /whatsapp-device
// ---------------------------------------------------------------------------

function gowaHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return '';
  }
}

async function resolveWhatsappDeviceId(cfg: GowaConfig, requested: string | null): Promise<string | null> {
  if (requested) return requested;
  const overview = await gowaDeviceOverview(cfg);
  return overview.activeDeviceId;
}

/**
 * Pair the WhatsApp number that sends invoices, by scanning a QR from the
 * owner's settings screen. The GOWA server is platform infrastructure — one
 * sender number behind every storefront — so this is admin-only and reads no
 * tenant rows. Its credentials stay on the server: the browser only ever gets
 * the QR as a `data:` URL.
 */
async function handleWhatsappDevice(req: ApiRequest, res: ApiResponse) {
  const method = req.method ?? 'GET';
  await requireAdminSession(req.headers);

  const cfg = gowaDeviceConfig();
  const sendEnabled = optionalEnv('WHATSAPP_INVOICE_ENABLED') === 'true';
  if (!cfg) {
    // GOWA_URL is deployment config; the screen explains it instead of erroring.
    sendJson(res, 200, {
      configured: false,
      sendEnabled,
      serverHost: '',
      devices: [],
      activeDeviceId: null,
      error: null,
    });
    return;
  }

  if (method === 'GET') {
    // Always 200: an unreachable GOWA is data for the screen (it polls this),
    // not a request failure the owner should see as a toast every few seconds.
    const overview = await gowaDeviceOverview(cfg);
    sendJson(res, 200, { configured: true, sendEnabled, serverHost: gowaHost(cfg.baseUrl), ...overview });
    return;
  }
  if (method !== 'POST') return methodNotAllowed(res, ['GET', 'POST']);

  const body = await readJsonBody<{ action?: unknown; deviceId?: unknown }>(req);
  const action = typeof body.action === 'string' ? body.action.trim() : '';
  const requested = typeof body.deviceId === 'string' && body.deviceId.trim() ? body.deviceId.trim() : null;

  if (action === 'qr') {
    const qr = await gowaLoginQr(cfg, requested);
    if (!qr.ok) throw new HttpError(502, 'gowa_unavailable', qr.error ?? 'Server WhatsApp tidak memberi QR.');
    sendJson(res, 200, {
      ok: true,
      action,
      deviceId: qr.deviceId,
      qrDataUrl: qr.qrDataUrl,
      expiresIn: qr.expiresIn,
    });
    return;
  }

  if (action === 'logout' || action === 'reconnect') {
    const deviceId = await resolveWhatsappDeviceId(cfg, requested);
    if (!deviceId) {
      throw new HttpError(400, 'no_device', 'Server WhatsApp belum punya perangkat untuk dikendalikan.');
    }
    const result = action === 'logout' ? await gowaLogout(cfg, deviceId) : await gowaReconnect(cfg, deviceId);
    if (!result.ok) {
      throw new HttpError(502, 'gowa_unavailable', result.error ?? 'Server WhatsApp tidak menjawab.');
    }
    sendJson(res, 200, { ok: true, action, deviceId });
    return;
  }

  throw new HttpError(400, 'invalid_action', 'Aksi WhatsApp tidak dikenali.');
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
  const path = pathname(req).replace(/^\/api\/tenant\/?/, '');

  switch (path) {
    case 'qris-image':
      return handleQrisImage(req, res);
    case 'orders/confirm':
      return handleOrdersConfirm(req, res);
    case 'orders/status':
      return handleOrdersStatus(req, res);
    case 'whatsapp-device':
      return handleWhatsappDevice(req, res);
    default:
      sendJson(res, 404, {
        error: 'not_found',
        message: `Route /api/tenant/${path} not found`,
      });
  }
}

export default withErrors(handler);
