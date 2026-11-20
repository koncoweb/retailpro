// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { WhatsAppSettings } from './WhatsAppSettings';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/** Mirrors `GET/POST /api/tenant/whatsapp-device`, shapes from the live GOWA server. */
const device = (overrides: Record<string, unknown> = {}) => ({
  id: 'fakhrahape',
  name: 'F:3',
  state: 'disconnected',
  jid: '',
  isConnected: false,
  isLoggedIn: false,
  phone: null,
  ...overrides,
});

const paired = {
  state: 'connected',
  jid: '6281999824806@s.whatsapp.net',
  isConnected: true,
  isLoggedIn: true,
  phone: '6281999824806',
};

const overview = (overrides: Record<string, unknown> = {}) => ({
  configured: true,
  sendEnabled: true,
  serverHost: 'gowa.example',
  devices: [device()],
  activeDeviceId: 'fakhrahape',
  error: null,
  ...overrides,
});

const QR_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const QR_ALT = 'QR kode untuk menautkan perangkat WhatsApp';

const fetchMock = vi.fn();

/** Queue one answer per call; a function inspects the request first. */
function answer(...replies: Array<unknown | ((url: string, init?: RequestInit) => unknown)>) {
  let index = 0;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const reply = replies[Math.min(index, replies.length - 1)];
    index += 1;
    const payload = typeof reply === 'function' ? reply(url, init) : reply;
    const failed = payload instanceof Error;
    return {
      ok: !failed,
      status: failed ? 502 : 200,
      json: async () => (failed ? { message: (payload as Error).message } : payload),
    };
  });
}

function mount() {
  return render(<WhatsAppSettings />);
}

function lastBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return JSON.parse(String(call[1].body)) as Record<string, unknown>;
}

beforeEach(() => {
  vi.resetAllMocks();
  global.fetch = fetchMock;
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

describe('WhatsAppSettings device linking', () => {
  it('reports the paired sender number and offers to re-scan it', async () => {
    answer(overview({ devices: [device(paired)] }));
    mount();

    await screen.findByText('Nomor Pengirim WhatsApp');
    expect(screen.getByText('+62 819-9982-4806')).toBeTruthy();
    expect(screen.getByText('Tertaut')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pindai ulang' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tampilkan QR' })).toBeNull();
  });

  it('asks the server for a pairing QR and shows the proxied image', async () => {
    answer(
      overview(),
      { ok: true, action: 'qr', deviceId: 'fakhrahape', qrDataUrl: QR_DATA_URL, expiresIn: 30 }
    );
    mount();

    fireEvent.click(await screen.findByRole('button', { name: 'Tampilkan QR' }));
    const image = await screen.findByAltText(QR_ALT);
    expect(image.getAttribute('src')).toBe(QR_DATA_URL);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toContain('/api/tenant/whatsapp-device');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(lastBody()).toMatchObject({ action: 'qr', deviceId: 'fakhrahape' });

    fireEvent.click(screen.getByRole('button', { name: 'Tutup QR' }));
    await waitFor(() => expect(screen.queryByAltText(QR_ALT)).toBeNull());
  });

  it('surfaces a GOWA server it cannot reach instead of a fake status', async () => {
    answer(overview({ devices: [], activeDeviceId: null, error: '/devices: fetch failed' }));
    mount();

    await screen.findByText('Server WhatsApp tidak terjangkau');
    expect(screen.getByText('/devices: fetch failed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tampilkan QR' })).toBeNull();
  });

  it('explains what to configure when the deployment has no GOWA URL', async () => {
    answer(overview({ configured: false, sendEnabled: false, serverHost: '' }));
    mount();

    await screen.findByText('Server WhatsApp belum dikonfigurasi');
    expect(screen.getByText('GOWA_URL')).toBeTruthy();
  });

  it('keeps the invoice kill-switch visible after the device is paired', async () => {
    answer(overview({ sendEnabled: false, devices: [device(paired)] }));
    mount();

    await screen.findByText('Pengiriman invoice masih mati');
    expect(screen.getByText('WHATSAPP_INVOICE_ENABLED=true')).toBeTruthy();
  });

  it('shows the server error when the QR request fails', async () => {
    answer(overview(), new Error('Login session sedang berjalan'));
    mount();

    fireEvent.click(await screen.findByRole('button', { name: 'Tampilkan QR' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(vi.mocked(toast.error).mock.calls.at(-1)?.[0]).toContain('Login session sedang berjalan');
    expect(screen.queryByAltText(QR_ALT)).toBeNull();
  });

  it('offers to pick a device when the server hosts several numbers', async () => {
    answer(
      overview({
        devices: [device(), device({ id: 'lainnya', ...paired })],
        activeDeviceId: 'lainnya',
      })
    );
    mount();

    await screen.findByText('+62 819-9982-4806');
    expect(screen.getByRole('combobox')).toBeTruthy();
  });
});
