/**
 * WhatsApp invoice delivery through a self-hosted GOWA server
 * (`aldinokemal/go-whatsapp-web-multidevice`).
 *
 * When a storefront order is created, each seller row gets one invoice message
 * to the buyer's number: totals, the chosen rekening for `transfer`, or the
 * QRIS image when the channel is `qris`. Everything here is deliberately
 * FAIL-SOFT — a GOWA outage, a logged-out device or a bad number must never
 * fail `POST /api/storefront/orders`: the order is the money path, WhatsApp is
 * a convenience on top of it. Every send outcome is recorded on the order row
 * (`wa_status`/`wa_message_id`/`wa_sent_at`/`wa_error`, migration 016) so a
 * retry can dedupe and the owner's order screen can show delivery state.
 *
 * The pure helpers (phone normalization, text building, webhook signature
 * check, ack parsing) are exported so the unit tests can drive them without a
 * network or a database.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createClient, type Client } from '@libsql/client';
import { optionalEnv } from './env.js';
import { listActiveTenants, type ActiveTenant } from './storefront-payments.js';
import { mintTenantToken } from './provision.js';
import { browserDbUrl } from './turso-platform.js';

/* -------------------------------------------------------------------------- */
/* Configuration                                                               */
/* -------------------------------------------------------------------------- */

export interface GowaConfig {
  baseUrl: string;
  /** Pre-encoded `Basic ...` header value; empty when auth is not configured. */
  authHeader: string;
  deviceId: string | null;
}

/** NULL when the feature is off or the server URL is missing — every caller stops there. */
export function gowaConfig(): GowaConfig | null {
  if (optionalEnv('WHATSAPP_INVOICE_ENABLED') !== 'true') return null;
  return gowaEndpoint();
}

/** Connection settings on their own, ignoring the invoice kill-switch. */
function gowaEndpoint(): GowaConfig | null {
  const baseUrl = optionalEnv('GOWA_URL');
  if (!baseUrl) return null;
  const user = optionalEnv('GOWA_USERNAME');
  const pass = optionalEnv('GOWA_PASSWORD');
  const authHeader =
    user && pass ? `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` : '';
  return { baseUrl: baseUrl.replace(/\/+$/, ''), authHeader, deviceId: optionalEnv('GOWA_DEVICE_ID') ?? null };
}

/**
 * Config for the owner's device-linking screen. Unlike `gowaConfig()` this
 * ignores `WHATSAPP_INVOICE_ENABLED`, so the number can be paired by scanning
 * the QR *before* invoice sending is switched on.
 */
export function gowaDeviceConfig(): GowaConfig | null {
  return gowaEndpoint();
}

/** Per-request ceiling for a GOWA call; a hung server must not stall checkout. */
const GOWA_TIMEOUT_MS = 10_000;

/** A pairing QR is a few hundred KB at most; refuse anything larger. */
const GOWA_QR_MAX_BYTES = 2 * 1024 * 1024;

/* -------------------------------------------------------------------------- */
/* Pure helpers (unit-tested)                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Indonesian local numbers (`08…`, `+62…`, `8…`, `62…`) → GOWA-ready `62…`.
 * NULL when the digits cannot be a usable ID mobile number — the caller skips
 * the send instead of guessing a destination.
 */
export function normalizeWaPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith('8')) digits = `62${digits}`;
  return /^62\d{8,13}$/.test(digits) ? digits : null;
}

const rupiah = (n: number) => `Rp${Math.round(n).toLocaleString('id-ID')}`;

export interface InvoiceLine {
  name: string;
  qty: number;
  unitName: string;
  total: number;
}

export interface InvoiceInput {
  shopName: string;
  invoiceNumber: string;
  customerName: string;
  lines: InvoiceLine[];
  subtotal: number;
  shipping: number;
  total: number;
  fulfillment: string;
  notes: string | null;
  paymentChannel: string | null;
  /** Resolved rekening for `transfer`; ignored otherwise. */
  bank: { name: string; accountNumber: string; accountName: string } | null;
  /** When true and the channel is qris, the QRIS image goes as a second message. */
  qrisComing: boolean;
}

/** The buyer-facing invoice text — Indonesian, matching the checkout page. */
export function buildInvoiceText(order: InvoiceInput): string {
  const items = order.lines
    .map((line) => `• ${line.qty}× ${line.name} · ${line.unitName} — ${rupiah(line.total)}`)
    .join('\n');
  const parts = [
    `*${order.shopName}* — Invoice ${order.invoiceNumber}`,
    '',
    `Halo ${order.customerName}, pesanan Anda sudah kami terima 🙏`,
    '',
    items,
    '',
    `Subtotal : ${rupiah(order.subtotal)}`,
    `Ongkir   : ${order.shipping > 0 ? rupiah(order.shipping) : '—'}`,
    `*TOTAL   : ${rupiah(order.total)}*`,
    '',
  ];
  if (order.paymentChannel === 'transfer' && order.bank) {
    parts.push(
      'Bayar transfer ke:',
      `${order.bank.name}: ${order.bank.accountNumber} a.n. ${order.bank.accountName}`,
      'Setelah transfer, kirim buktinya ke nomor ini ya.',
    );
  } else if (order.paymentChannel === 'qris') {
    parts.push(
      order.qrisComing
        ? 'Silakan pindai QRIS berikut untuk membayar (gambar dikirim di pesan ini 📲).'
        : 'Silakan pindai QRIS di aplikasi toko untuk membayar.',
    );
  } else if (order.fulfillment === 'delivery') {
    parts.push('Pembayaran tunai saat pesanan diterima.');
  } else {
    parts.push('Pembayaran tunai saat ambil di toko.');
  }
  if (order.notes) parts.push('', `Catatan: ${order.notes}`);
  parts.push('', 'Status: Menunggu pembayaran.');
  return parts.join('\n');
}

/**
 * Verify GOWA's `X-Hub-Signature-256: sha256=<hex>` HMAC over the raw body.
 * Constant-time compare; a missing secret means the receiver is not
 * configured, which the caller answers with 503 (never "accept anything").
 */
export function verifyWebhookSignature(rawBody: Buffer, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const provided = header.startsWith('sha256=') ? header.slice('sha256='.length) : header;
  if (!/^[0-9a-f]{64}$/i.test(provided)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
  } catch {
    return false;
  }
}

/** GOWA ack numbers (whatsmeow): 2 server, 3 delivered, 4 read. Strings pass through. */
export function parseAckStatus(status: unknown): 'server' | 'delivered' | 'read' | null {
  const n = typeof status === 'number' ? status : Number(status);
  if (n === 2) return 'server';
  if (n === 3) return 'delivered';
  if (n === 4) return 'read';
  if (status === 'delivered' || status === 'read' || status === 'server') return status;
  return null;
}

/** The only acks that move `wa_ack` forward. */
export function isProgressAck(ack: string | null): ack is 'delivered' | 'read' {
  return ack === 'delivered' || ack === 'read';
}

/* -------------------------------------------------------------------------- */
/* GOWA HTTP client                                                            */
/* -------------------------------------------------------------------------- */

interface GowaSendResult {
  ok: boolean;
  messageId: string | null;
  error: string | null;
}

async function gowaPost(
  cfg: GowaConfig,
  path: string,
  body: { json?: unknown; form?: FormData }
): Promise<GowaSendResult> {
  const headers: Record<string, string> = {};
  if (cfg.authHeader) headers.Authorization = cfg.authHeader;
  if (cfg.deviceId) headers['X-Device-Id'] = cfg.deviceId;
  const init: RequestInit = { method: 'POST', headers, signal: AbortSignal.timeout(GOWA_TIMEOUT_MS) };
  if (body.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body.json);
  } else {
    init.body = body.form;
  }
  try {
    const response = await fetch(`${cfg.baseUrl}${path}`, init);
    const parsed = (await response.json().catch(() => null)) as {
      code?: string;
      message?: string;
      results?: { message_id?: string };
    } | null;
    if (!response.ok || parsed?.code !== 'SUCCESS') {
      return {
        ok: false,
        messageId: null,
        error: `${path}: HTTP ${response.status} ${parsed?.code ?? ''} ${parsed?.message ?? ''}`.trim(),
      };
    }
    return { ok: true, messageId: parsed?.results?.message_id ?? null, error: null };
  } catch (error) {
    return { ok: false, messageId: null, error: `${path}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/* -------------------------------------------------------------------------- */
/* Device linking (owner settings screen)                                      */
/* -------------------------------------------------------------------------- */

/**
 * `{ok, data, error}` as one shape on purpose: the unit test imports this
 * module, so `tsconfig.app.json` typechecks it too — and without
 * `strictNullChecks` TypeScript cannot narrow a union on a boolean flag.
 */
interface GowaReply<T> {
  ok: boolean;
  data: T | null;
  error: string | null;
}

/** Answer of a device-control call, where there is nothing to read back. */
export type GowaActionReply = { ok: boolean; error: string | null };

/**
 * GET/POST a GOWA route and unwrap the `{code, message, results}` envelope.
 * Unlike `gowaPost()` this never talks about orders: it returns `results` so
 * the caller can read device state, and it reports the failure as a string the
 * settings screen can show as-is.
 */
async function gowaJson<T>(cfg: GowaConfig, path: string, method: 'GET' | 'POST' = 'GET'): Promise<GowaReply<T>> {
  const headers: Record<string, string> = {};
  if (cfg.authHeader) headers.Authorization = cfg.authHeader;
  try {
    const response = await fetch(`${cfg.baseUrl}${path}`, { method, headers, signal: AbortSignal.timeout(GOWA_TIMEOUT_MS) });
    const parsed = (await response.json().catch(() => null)) as {
      code?: string;
      message?: string;
      results?: T;
    } | null;
    if (!response.ok || parsed?.code !== 'SUCCESS') {
      return {
        ok: false,
        data: null,
        error: `${path}: HTTP ${response.status} ${parsed?.code ?? ''} ${parsed?.message ?? ''}`.trim(),
      };
    }
    return { ok: true, data: (parsed?.results ?? null) as T | null, error: null };
  } catch (error) {
    return { ok: false, data: null, error: `${path}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** One device slot registered on the GOWA server. */
export interface GowaDevice {
  id: string;
  name: string;
  state: string;
  jid: string;
}

export interface GowaDeviceView extends GowaDevice {
  isConnected: boolean;
  isLoggedIn: boolean;
  /** `6281999824806` — the number the owner recognises as the sender. */
  phone: string | null;
}

/** `results` of `GET /devices`: `[{id, display_name, state, jid, created_at}]`. */
export function parseGowaDevices(raw: unknown): GowaDevice[] {
  if (!Array.isArray(raw)) return [];
  const devices: GowaDevice[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    // Current builds key it `id`, older ones `device_id`; an entry without
    // either cannot be addressed, so it is dropped.
    const id = typeof rec.id === 'string' ? rec.id : typeof rec.device_id === 'string' ? rec.device_id : '';
    if (!id) continue;
    devices.push({
      id,
      name: typeof rec.display_name === 'string' ? rec.display_name : '',
      state: typeof rec.state === 'string' ? rec.state : '',
      jid: typeof rec.jid === 'string' ? rec.jid : '',
    });
  }
  return devices;
}

/** `results` of `GET /devices/{id}/status`: `{device_id, is_connected, is_logged_in}`. */
export function parseGowaDeviceStatus(raw: unknown): { isConnected: boolean; isLoggedIn: boolean } {
  const rec = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { isConnected: rec.is_connected === true, isLoggedIn: rec.is_logged_in === true };
}

/** `6281999824806@s.whatsapp.net` → `6281999824806`; a group/broadcast/empty JID → null. */
export function jidToPhone(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const [user, server] = jid.split('@');
  if (!user || !/^\d{8,15}$/.test(user)) return null;
  if (server && server !== 's.whatsapp.net' && server !== 'lid') return null;
  return user;
}

/**
 * GOWA answers `qr_link` with an absolute `http://<host>/statics/qrcode/….png`.
 * The scheme is often plain http and the host is the container's own name, so
 * only the path is trusted and it is re-fetched through the configured base
 * URL — which is also what keeps the bytes server-side instead of handing the
 * browser a URL it could not reach.
 */
export function qrImageUrl(qrLink: string, baseUrl: string): string | null {
  try {
    const url = new URL(qrLink);
    if (!url.pathname || url.pathname === '/') return null;
    return `${baseUrl.replace(/\/+$/, '')}${url.pathname}`;
  } catch {
    return null;
  }
}

/** `results` of `GET /devices/{id}/login`: `{device_id, qr_link, qr_duration}`. */
export function parseGowaQr(raw: unknown): { qrLink: string; expiresIn: number } | null {
  const rec = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (typeof rec.qr_link !== 'string' || !rec.qr_link) return null;
  const seconds = Number(rec.qr_duration);
  // The QR really stops working after this, and the screen counts it down.
  return { qrLink: rec.qr_link, expiresIn: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 30 };
}

/**
 * Which slot the sender number lives on: the configured one when the server
 * really has it, then a paired device, then anything registered. A stale
 * `GOWA_DEVICE_ID` must not hide the device the owner can actually scan with,
 * so it is only used when the list is empty.
 */
export function pickActiveDevice(devices: Array<{ id: string; jid: string; isLoggedIn?: boolean }>, preferred: string | null): string | null {
  if (preferred && devices.some((device) => device.id === preferred)) return preferred;
  const paired = devices.find((device) => device.isLoggedIn || device.jid);
  return (paired?.id ?? devices[0]?.id ?? preferred) ?? null;
}

async function gowaDeviceView(cfg: GowaConfig, device: GowaDevice): Promise<GowaDeviceView> {
  const status = await gowaJson<unknown>(cfg, `/devices/${encodeURIComponent(device.id)}/status`);
  // The list already says `connected`/`disconnected`; use it only when the
  // per-device status call failed, so a dead slot still renders something.
  const fallback = { isConnected: device.state === 'connected', isLoggedIn: device.state === 'connected' };
  const state = status.ok ? { ...fallback, ...parseGowaDeviceStatus(status.data) } : fallback;
  return { ...device, ...state, phone: jidToPhone(device.jid) };
}

export interface GowaDeviceOverview {
  devices: GowaDeviceView[];
  activeDeviceId: string | null;
  /** Set when the GOWA server itself could not be read. */
  error: string | null;
}

/** Status of every registered device plus which one sends the invoices. */
export async function gowaDeviceOverview(cfg: GowaConfig): Promise<GowaDeviceOverview> {
  const listed = await gowaJson<unknown>(cfg, '/devices');
  if (!listed.ok) return { devices: [], activeDeviceId: cfg.deviceId, error: listed.error };
  // `/devices` is authoritative: a slot only exists once it was registered,
  // so a configured-but-missing id is stale config, not something to invent.
  const views = await Promise.all(parseGowaDevices(listed.data).map((device) => gowaDeviceView(cfg, device)));
  return { devices: views, activeDeviceId: pickActiveDevice(views, cfg.deviceId), error: null };
}

/**
 * One flat shape on purpose, for the same reason as `GowaReply`: `api/**` is
 * also typechecked with `strictNullChecks: false` at deploy time, and a boolean
 * literal discriminant does not narrow without it, so every field has to exist
 * on every branch instead of living on a success/failure union.
 */
export interface GowaLoginQrResult {
  ok: boolean;
  deviceId: string | null;
  /** `data:image/png;base64,…` — renderable straight away, no mixed content. */
  qrDataUrl: string | null;
  expiresIn: number;
  error: string | null;
}

const qrFailure = (error: string): GowaLoginQrResult => ({
  ok: false,
  deviceId: null,
  qrDataUrl: null,
  expiresIn: 0,
  error,
});

/**
 * Ask GOWA for a pairing QR and return its pixels as a data URL. The caller
 * (the owner's browser) never learns the GOWA credentials, and the QR is only
 * valid for `expiresIn` seconds — the screen refreshes it.
 */
export async function gowaLoginQr(cfg: GowaConfig, deviceId?: string | null): Promise<GowaLoginQrResult> {
  let target = deviceId || cfg.deviceId || null;
  if (!target) {
    const overview = await gowaDeviceOverview(cfg);
    if (overview.error) return qrFailure(overview.error);
    target = overview.activeDeviceId;
  }
  if (!target) {
    return qrFailure('Server WhatsApp belum punya perangkat; tambahkan perangkat dulu di GOWA.');
  }

  const login = await gowaJson<unknown>(cfg, `/devices/${encodeURIComponent(target)}/login`);
  if (!login.ok) return qrFailure(login.error ?? 'Server WhatsApp menolak permintaan QR.');
  const qr = parseGowaQr(login.data);
  if (!qr) return qrFailure('Respons QR tidak dikenali dari server WhatsApp.');

  const imageUrl = qrImageUrl(qr.qrLink, cfg.baseUrl);
  if (!imageUrl) return qrFailure('Tautan QR tidak valid.');
  try {
    const image = await fetch(imageUrl, { signal: AbortSignal.timeout(GOWA_TIMEOUT_MS) });
    if (!image.ok) return qrFailure(`qr image: HTTP ${image.status}`);
    const bytes = new Uint8Array(await image.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > GOWA_QR_MAX_BYTES) {
      return qrFailure(`qr image: ukuran tidak wajar (${bytes.byteLength} byte).`);
    }
    const mime = (image.headers.get('content-type') ?? '').split(';')[0];
    const safeMime = mime.startsWith('image/') ? mime : 'image/png';
    return {
      ok: true,
      deviceId: target,
      qrDataUrl: `data:${safeMime};base64,${Buffer.from(bytes).toString('base64')}`,
      expiresIn: qr.expiresIn,
      error: null,
    };
  } catch (error) {
    return qrFailure(`qr image: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** End the WhatsApp session on a slot, so another number can be scanned. */
export async function gowaLogout(cfg: GowaConfig, deviceId: string): Promise<GowaActionReply> {
  const result = await gowaJson<unknown>(cfg, `/devices/${encodeURIComponent(deviceId)}/logout`, 'POST');
  return { ok: result.ok, error: result.error };
}

/** Nudge a device that is logged in but offline to reconnect. */
export async function gowaReconnect(cfg: GowaConfig, deviceId: string): Promise<GowaActionReply> {
  const result = await gowaJson<unknown>(cfg, `/devices/${encodeURIComponent(deviceId)}/reconnect`, 'POST');
  return { ok: result.ok, error: result.error };
}

/* -------------------------------------------------------------------------- */
/* Order-side send (called from createStorefrontOrders)                        */
/* -------------------------------------------------------------------------- */

export interface OrderInvoiceRow {
  orderId: string;
  invoiceNumber: string;
  shopName: string;
  customerName: string;
  customerPhone: string;
  fulfillment: string;
  notes: string | null;
  paymentChannel: string | null;
  lines: InvoiceLine[];
  subtotal: number;
  shipping: number;
  total: number;
  bank: { name: string; accountNumber: string; accountName: string } | null;
  /** Decoded QRIS bytes for the qris channel; null when unavailable. */
  qris: { mime: string; bytes: Uint8Array } | null;
  /** Previous attempt, so a re-confirm never double-sends. */
  waStatus: string | null;
}

async function recordWa(
  client: Client,
  orderId: string,
  patch: { wa_status: string; wa_message_id?: string | null; wa_error?: string | null }
): Promise<void> {
  try {
    await client.execute({
      sql: `UPDATE storefront_orders
              SET wa_status = ?, wa_message_id = COALESCE(?, wa_message_id),
                  wa_error = ?, wa_sent_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?`,
      args: [patch.wa_status, patch.wa_message_id ?? null, patch.wa_error ?? null, orderId],
    });
  } catch (error) {
    // Delivery metadata must never mask the order result.
    console.error('[wa] failed to record send status:', error instanceof Error ? error.message : error);
  }
}

/**
 * Send one seller's invoice to the buyer and record the outcome on the row.
 * NEVER throws: every path ends in `wa_status` + a returned string.
 */
export async function sendOrderInvoice(
  client: Client,
  cfg: GowaConfig,
  order: OrderInvoiceRow
): Promise<'sent' | 'failed' | 'skipped'> {
  if (order.waStatus === 'sent') return 'skipped';
  const phone = normalizeWaPhone(order.customerPhone);
  if (!phone) {
    await recordWa(client, order.orderId, {
      wa_status: 'skipped',
      wa_error: `nomor tidak dapat dinormalisasi: ${order.customerPhone}`,
    });
    return 'skipped';
  }

  const text = buildInvoiceText({
    shopName: order.shopName,
    invoiceNumber: order.invoiceNumber,
    customerName: order.customerName,
    lines: order.lines,
    subtotal: order.subtotal,
    shipping: order.shipping,
    total: order.total,
    fulfillment: order.fulfillment,
    notes: order.notes,
    paymentChannel: order.paymentChannel,
    bank: order.bank,
    qrisComing: order.paymentChannel === 'qris' && !!order.qris,
  });

  const sent = await gowaPost(cfg, '/send/message', { json: { phone, message: text } });
  if (!sent.ok) {
    await recordWa(client, order.orderId, { wa_status: 'failed', wa_error: sent.error });
    return 'failed';
  }

  // QRIS rides as a second message; the text already landed, so a QRIS failure
  // still counts as a sent invoice (the shopper can open the app for the code).
  if (order.paymentChannel === 'qris' && order.qris) {
    const form = new FormData();
    form.set('phone', phone);
    form.set('caption', `QRIS ${order.shopName} — ${rupiah(order.total)}`);
    // Copy into an ArrayBuffer-backed view, the way downloadPrn() does:
    // BlobPart wants ArrayBufferView<ArrayBuffer>, and a plain `Uint8Array` is
    // typed `Uint8Array<ArrayBufferLike>` (its buffer may be a SharedArrayBuffer).
    form.set('file', new Blob([new Uint8Array(order.qris.bytes)], { type: order.qris.mime }), 'qris.png');
    const img = await gowaPost(cfg, '/send/image', { form });
    if (!img.ok) {
      await recordWa(client, order.orderId, {
        wa_status: 'sent',
        wa_message_id: sent.messageId,
        wa_error: `qris: ${img.error}`,
      });
      return 'sent';
    }
  }

  await recordWa(client, order.orderId, { wa_status: 'sent', wa_message_id: sent.messageId });
  return 'sent';
}

/* -------------------------------------------------------------------------- */
/* Webhook ingestion (message.ack + incoming replies)                          */
/* -------------------------------------------------------------------------- */

export interface ParsedWebhookEvent {
  event: string;
  deviceId: string | null;
  messageId: string | null;
  chatJid: string | null;
  senderJid: string | null;
  ack: 'server' | 'delivered' | 'read' | null;
  body: string | null;
}

/**
 * Best-effort read of a GOWA webhook payload
 * (`{ event, device_id, payload: {... } }`). Unknown shapes still store — the
 * raw JSON is kept — they just resolve to NULL fields.
 */
export function parseWebhookEvent(raw: Record<string, unknown>): ParsedWebhookEvent | null {
  const event = typeof raw.event === 'string' ? raw.event : null;
  if (!event) return null;
  const payload = (raw.payload ?? {}) as Record<string, unknown>;
  const messageId =
    (typeof payload.message_id === 'string' && payload.message_id) ||
    (typeof payload.messageId === 'string' && payload.messageId) ||
    null;
  const text = typeof payload.text === 'string' ? payload.text : typeof payload.message === 'string' ? payload.message : null;
  return {
    event,
    deviceId: typeof raw.device_id === 'string' ? raw.device_id : null,
    messageId,
    chatJid: typeof payload.chat_jid === 'string' ? payload.chat_jid : (typeof payload.chatJid === 'string' ? payload.chatJid : null),
    senderJid: typeof payload.sender_jid === 'string' ? payload.sender_jid : (typeof payload.senderJid === 'string' ? payload.senderJid : null),
    ack: event === 'message.ack' ? parseAckStatus(payload.status) : null,
    body: event === 'message' && text ? text.slice(0, 2000) : null,
  };
}

async function withTenantClient<T>(tenant: ActiveTenant, fn: (client: Client) => Promise<T>): Promise<T> {
  const { token } = await mintTenantToken(tenant.db_name, tenant.db_hostname);
  const client = createClient({ url: browserDbUrl(tenant.db_hostname), authToken: token });
  try {
    return await fn(client);
  } finally {
    client.close();
  }
}

interface AckUpdate {
  tenant: string;
  orderId: string;
  invoiceNumber: string;
  customerName: string;
  customerPhone: string;
}

/** The snake_case shape the webhook matcher reads back from `storefront_orders`. */
interface OrderMatchRow {
  id: string;
  invoice_number: string;
  customer_name: string;
  customer_phone: string;
}

/**
 * Fan out one webhook event to every tenant database and project it onto the
 * matching `storefront_orders` row:
 *   * `message.ack`  — match by `wa_message_id`, move `wa_ack` forward;
 *   * `message`      — a buyer reply: match by the sender's phone against the
 *                      customer's number, newest pending order wins, so the
 *                      owner's order screen can show "customer replied".
 * Returns the touched rows so the caller can log a matched outcome.
 */
export async function applyWebhookToOrders(parsed: ParsedWebhookEvent): Promise<AckUpdate[]> {
  const touched: AckUpdate[] = [];
  const wantsAck = parsed.event === 'message.ack' && isProgressAck(parsed.ack) && !!parsed.messageId;
  const replyPhone =
    parsed.event === 'message' && parsed.senderJid
      ? normalizeWaPhone(parsed.senderJid.split('@')[0])
      : null;
  if (!wantsAck && !replyPhone) return touched;

  for (const tenant of await listActiveTenants()) {
    try {
      const hit = await withTenantClient(tenant, async (client) => {
        if (wantsAck) {
          // Monotonic: 'read' never moves back to 'delivered'.
          await client.execute({
            sql: `UPDATE storefront_orders
                    SET wa_ack = CASE
                          WHEN wa_ack = 'read' THEN wa_ack
                          WHEN ? = 'read' OR wa_ack IS NULL OR wa_ack = 'server' THEN ?
                          ELSE wa_ack
                        END
                  WHERE wa_message_id = ?`,
            args: [parsed.ack, parsed.ack, parsed.messageId],
          });
        }
        // Replies never move a row — they only identify the order the raw event
        // in `whatsapp_events` belongs to, newest open order of the sender wins.
        const sql = wantsAck
          ? 'SELECT id, invoice_number, customer_name, customer_phone FROM storefront_orders WHERE wa_message_id = ? LIMIT 1'
          : `SELECT id, invoice_number, customer_name, customer_phone
               FROM storefront_orders
              WHERE status IN ('pending_payment', 'confirmed')
                AND replace(replace(replace(customer_phone, ' ', ''), '-', ''), '+', '') LIKE '%' || ?
              ORDER BY created_at DESC LIMIT 1`;
        // Reply matching uses the local tail (8xxxx) — the webhook gives 62xxxx.
        const args = wantsAck ? [parsed.messageId as string] : [replyPhone ? replyPhone.slice(2) : ''];
        const row = (
          await client.execute({ sql, args })
        ).rows[0] as unknown as OrderMatchRow | undefined;
        if (!row) return null;
        return {
          tenant: tenant.slug,
          orderId: row.id,
          invoiceNumber: row.invoice_number,
          customerName: row.customer_name,
          customerPhone: row.customer_phone,
        };
      });
      if (hit) touched.push(hit);
    } catch (error) {
      console.error(
        `[wa] webhook fan-out skipped tenant "${tenant.slug}":`,
        error instanceof Error ? error.message : error
      );
    }
  }
  return touched;
}

/* -------------------------------------------------------------------------- */
/* QRIS bytes for the invoice (read in the tenant's own database)              */
/* -------------------------------------------------------------------------- */

/** Decode the tenant's stored `qris_image` data URL, or null. */
export async function readTenantQrisImage(client: Client): Promise<{ mime: string; bytes: Uint8Array } | null> {
  try {
    const res = await client.execute('SELECT qris_image FROM tenants LIMIT 1');
    const raw = (res.rows[0] as unknown as { qris_image: string | null } | undefined)?.qris_image;
    if (typeof raw !== 'string' || !raw.trim()) return null;
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/.exec(raw.trim());
    if (!match) return null;
    return { mime: match[1], bytes: new Uint8Array(Buffer.from(match[2], 'base64')) };
  } catch {
    return null;
  }
}

export type { AckUpdate as WebhookOrderHit };
