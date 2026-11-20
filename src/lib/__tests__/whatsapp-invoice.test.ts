/**
 * Unit tests for the pure half of `server/whatsapp-invoice.ts` — the parts a
 * live GOWA server is not needed for: phone normalization, the buyer-facing
 * invoice text, the webhook HMAC gate, ack mapping, payload parsing, and the
 * device-linking readers behind the owner's QR screen.
 */
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildInvoiceText,
  gowaConfig,
  gowaDeviceConfig,
  isProgressAck,
  jidToPhone,
  normalizeWaPhone,
  parseAckStatus,
  parseGowaDeviceStatus,
  parseGowaDevices,
  parseGowaQr,
  parseWebhookEvent,
  pickActiveDevice,
  qrImageUrl,
  verifyWebhookSignature,
  type InvoiceInput,
} from '../../../server/whatsapp-invoice';

describe('normalizeWaPhone', () => {
  it('converts local Indonesian numbers to the 62… form GOWA wants', () => {
    expect(normalizeWaPhone('0812-3456-7890')).toBe('6281234567890');
    expect(normalizeWaPhone('0812345678')).toBe('62812345678');
    expect(normalizeWaPhone('+62 812 3456 7890')).toBe('6281234567890');
    expect(normalizeWaPhone('6281234567890')).toBe('6281234567890');
    expect(normalizeWaPhone('81234567890')).toBe('6281234567890');
  });

  it('rejects anything that cannot be an ID mobile number', () => {
    expect(normalizeWaPhone('')).toBeNull();
    expect(normalizeWaPhone(null)).toBeNull();
    expect(normalizeWaPhone(undefined)).toBeNull();
    expect(normalizeWaPhone('12345')).toBeNull(); // not 0/62/8 prefixed
    expect(normalizeWaPhone('0812')).toBeNull(); // too short
    expect(normalizeWaPhone('0812345678901234567')).toBeNull(); // too long
  });
});

const baseOrder: InvoiceInput = {
  shopName: 'Toko Thalia',
  invoiceNumber: 'SO/1/ABC',
  customerName: 'Budi',
  lines: [
    { name: 'Tepung Terigu', qty: 2, unitName: 'kg', total: 28000 },
    { name: 'Gula Pasir', qty: 1, unitName: 'karung · 25 kg', total: 350000 },
  ],
  subtotal: 378000,
  shipping: 20000,
  total: 398000,
  fulfillment: 'delivery',
  notes: 'Datang pagi saja',
  paymentChannel: 'transfer',
  bank: { name: 'BCA', accountNumber: '1234567890', accountName: 'Toko Thalia' },
  qrisComing: false,
};

describe('buildInvoiceText', () => {
  it('prints header, every line, and the three money rows', () => {
    const text = buildInvoiceText(baseOrder);
    expect(text).toContain('*Toko Thalia* — Invoice SO/1/ABC');
    expect(text).toContain('Halo Budi');
    expect(text).toContain('• 2× Tepung Terigu · kg — Rp28.000');
    expect(text).toContain('• 1× Gula Pasir · karung · 25 kg — Rp350.000');
    expect(text).toContain('Subtotal : Rp378.000');
    expect(text).toContain('Ongkir   : Rp20.000');
    expect(text).toContain('*TOTAL   : Rp398.000*');
    expect(text).toContain('Catatan: Datang pagi saja');
    expect(text).toContain('Status: Menunggu pembayaran.');
  });

  it('names the chosen rekening for a transfer', () => {
    const text = buildInvoiceText(baseOrder);
    expect(text).toContain('BCA: 1234567890 a.n. Toko Thalia');
    expect(text).toContain('kirim buktinya');
  });

  it('switches the payment block per channel and pickup mode', () => {
    expect(
      buildInvoiceText({ ...baseOrder, paymentChannel: 'qris', bank: null, qrisComing: true })
    ).toContain('pindai QRIS berikut');
    expect(
      buildInvoiceText({ ...baseOrder, paymentChannel: 'cash', bank: null })
    ).toContain('tunai saat pesanan diterima');
    const pickup = buildInvoiceText({
      ...baseOrder,
      fulfillment: 'pickup',
      paymentChannel: 'cash',
      bank: null,
      shipping: 0,
      total: baseOrder.subtotal,
    });
    expect(pickup).toContain('tunai saat ambil di toko');
    expect(pickup).toContain('Ongkir   : —');
  });
});

describe('verifyWebhookSignature', () => {
  const secret = 'test-secret';
  const body = Buffer.from(JSON.stringify({ event: 'message.ack' }));
  const sign = (b: Buffer) => `sha256=${createHmac('sha256', secret).update(b).digest('hex')}`;

  it('accepts its own HMAC and rejects everything else', () => {
    expect(verifyWebhookSignature(body, sign(body), secret)).toBe(true);
    expect(verifyWebhookSignature(body, sign(Buffer.from('other')), secret)).toBe(false);
    expect(verifyWebhookSignature(body, 'sha256=deadbeef', secret)).toBe(false);
    expect(verifyWebhookSignature(body, undefined, secret)).toBe(false);
  });
});

describe('ack mapping', () => {
  it('translates whatsmeow codes and gates progress', () => {
    expect(parseAckStatus(2)).toBe('server');
    expect(parseAckStatus(3)).toBe('delivered');
    expect(parseAckStatus(4)).toBe('read');
    expect(parseAckStatus('read')).toBe('read');
    expect(parseAckStatus(0)).toBeNull();
    expect(parseAckStatus('nope')).toBeNull();
    expect(isProgressAck('delivered')).toBe(true);
    expect(isProgressAck('read')).toBe(true);
    expect(isProgressAck('server')).toBe(false);
    expect(isProgressAck(null)).toBe(false);
  });
});

describe('parseWebhookEvent', () => {
  it('reads the GOWA envelope for an ack', () => {
    const parsed = parseWebhookEvent({
      event: 'message.ack',
      device_id: 'dev@s.whatsapp.net',
      payload: { message_id: 'WA.123', chat_jid: '6281234567890@s.whatsapp.net', status: 3 },
    });
    expect(parsed).toMatchObject({
      event: 'message.ack',
      deviceId: 'dev@s.whatsapp.net',
      messageId: 'WA.123',
      chatJid: '6281234567890@s.whatsapp.net',
      ack: 'delivered',
      body: null,
    });
  });

  it('reads an incoming message and truncates its body', () => {
    const parsed = parseWebhookEvent({
      event: 'message',
      payload: {
        sender_jid: '6281234567890@s.whatsapp.net',
        text: 'x'.repeat(3000),
      },
    });
    expect(parsed?.senderJid).toBe('6281234567890@s.whatsapp.net');
    expect(parsed?.body).toHaveLength(2000);
    expect(parsed?.ack).toBeNull();
  });

  it('returns null without an event name', () => {
    expect(parseWebhookEvent({ payload: {} })).toBeNull();
  });
});

describe('gowaConfig', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('is null unless the flag AND a url are present', () => {
    delete process.env.WHATSAPP_INVOICE_ENABLED;
    delete process.env.GOWA_URL;
    expect(gowaConfig()).toBeNull();
    process.env.WHATSAPP_INVOICE_ENABLED = 'true';
    expect(gowaConfig()).toBeNull();
    process.env.GOWA_URL = 'https://gowa.example/';
    process.env.GOWA_USERNAME = 'u';
    process.env.GOWA_PASSWORD = 'p';
    const cfg = gowaConfig();
    expect(cfg?.baseUrl).toBe('https://gowa.example'); // trailing slash trimmed
    expect(cfg?.authHeader).toBe(`Basic ${Buffer.from('u:p').toString('base64')}`);
  });

  it('lets the owner pair a device while invoice sending is still off', () => {
    delete process.env.WHATSAPP_INVOICE_ENABLED;
    process.env.GOWA_URL = 'https://gowa.example';
    expect(gowaConfig()).toBeNull();
    expect(gowaDeviceConfig()?.baseUrl).toBe('https://gowa.example');
  });
});

// Shapes below are the live `GET /devices*` bodies of the hosted GOWA server.
describe('parseGowaDevices', () => {
  it('reads the device slots', () => {
    const devices = parseGowaDevices([
      { id: 'fakhrahape', display_name: 'F:3', state: 'disconnected', jid: '6281999824806@s.whatsapp.net' },
      { device_id: 'legacy', state: 'connected' },
      { state: 'connected' }, // no id at all → unaddressable, dropped
      null,
    ]);
    expect(devices).toEqual([
      { id: 'fakhrahape', name: 'F:3', state: 'disconnected', jid: '6281999824806@s.whatsapp.net' },
      { id: 'legacy', name: '', state: 'connected', jid: '' },
    ]);
  });

  it('tolerates a missing or non-array results value', () => {
    expect(parseGowaDevices(null)).toEqual([]);
    expect(parseGowaDevices({ id: 'x' })).toEqual([]);
  });
});

describe('parseGowaDeviceStatus', () => {
  it('reads the two booleans and nothing else', () => {
    expect(parseGowaDeviceStatus({ device_id: 'd', is_connected: false, is_logged_in: false })).toEqual({
      isConnected: false,
      isLoggedIn: false,
    });
    expect(parseGowaDeviceStatus({ is_connected: true, is_logged_in: true }).isLoggedIn).toBe(true);
    expect(parseGowaDeviceStatus(null)).toEqual({ isConnected: false, isLoggedIn: false });
    // Only a real `true` counts — the server sends booleans, not strings.
    expect(parseGowaDeviceStatus({ is_logged_in: 'true' }).isLoggedIn).toBe(false);
  });
});

describe('jidToPhone', () => {
  it('keeps plain user JIDs and rejects the rest', () => {
    expect(jidToPhone('6281999824806@s.whatsapp.net')).toBe('6281999824806');
    expect(jidToPhone('6281234567890@lid')).toBe('6281234567890');
    expect(jidToPhone('1203630-group@g.us')).toBeNull(); // broadcast / group
    expect(jidToPhone('')).toBeNull();
    expect(jidToPhone(null)).toBeNull();
    expect(jidToPhone('@s.whatsapp.net')).toBeNull();
  });
});

describe('qrImageUrl', () => {
  it('rebuilds the QR path onto the configured base URL', () => {
    // GOWA answers with its own container host over plain http; neither is
    // usable by the browser, so only the path survives.
    expect(
      qrImageUrl(
        'http://gowa-internal.example/statics/qrcode/scan-qr-2d334efd.png',
        'https://gowa.example'
      )
    ).toBe('https://gowa.example/statics/qrcode/scan-qr-2d334efd.png');
  });

  it('returns null for a link it cannot parse or that has no path', () => {
    expect(qrImageUrl('not-a-url', 'https://gowa.example')).toBeNull();
    expect(qrImageUrl('https://gowa.example', 'https://gowa.example')).toBeNull();
  });
});

describe('parseGowaQr', () => {
  it('reads the link and keeps the expiry sent by the server', () => {
    const qr = parseGowaQr({ device_id: 'd', qr_duration: 30, qr_link: 'http://x/statics/qrcode/a.png' });
    expect(qr).toEqual({ qrLink: 'http://x/statics/qrcode/a.png', expiresIn: 30 });
  });

  it('falls back to 30s and rejects a payload without a link', () => {
    expect(parseGowaQr({ qr_link: 'http://x/a.png' })?.expiresIn).toBe(30);
    expect(parseGowaQr({ qr_link: 'http://x/a.png', qr_duration: 0 })?.expiresIn).toBe(30);
    expect(parseGowaQr({ qr_duration: 30 })).toBeNull();
    expect(parseGowaQr(null)).toBeNull();
  });
});

describe('pickActiveDevice', () => {
  const loggedOut = { id: 'kosong', jid: '', isLoggedIn: false };
  const paired = { id: 'utama', jid: '6281999824806@s.whatsapp.net', isLoggedIn: true };

  it('prefers the configured device, then the paired one', () => {
    expect(pickActiveDevice([loggedOut, paired], 'kosong')).toBe('kosong');
    expect(pickActiveDevice([loggedOut, paired], 'tidak-ada')).toBe('utama');
    expect(pickActiveDevice([loggedOut, paired], null)).toBe('utama');
  });

  it('still answers with something when nothing is paired, and null when empty', () => {
    expect(pickActiveDevice([loggedOut], null)).toBe('kosong');
    expect(pickActiveDevice([], null)).toBeNull();
    expect(pickActiveDevice([], 'konfigurasi-lama')).toBe('konfigurasi-lama');
  });
});
