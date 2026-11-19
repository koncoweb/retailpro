/**
 * Server-side reader for a tenant's payment channels.
 *
 * The public storefront endpoints (`/api/storefront/channels`, `/orders`) and the
 * authenticated cashier preview all need the same thing: the normalized channel
 * list, the bank accounts a transfer may name, and whether a static QRIS image
 * exists — computed from `tenants.settings` + `tenants.qris_image`, never from a
 * hardcoded list. The normalization + fee types come from the shared
 * `src/lib/payment-channels` module so the till, the API and the storefront can
 * never disagree about what a channel means.
 *
 * Deliberately lean: only the fields a stranger's browser needs are returned.
 * The QRIS *bytes* are served by `/api/storefront/qris` (a binary route) so this
 * JSON stays small and the image never travels through a settings document.
 */
import type { Client } from '@libsql/client';
import { getControlDb } from './control-db.js';
import { HttpError } from './http.js';
import { normalizeChannels, type PaymentChannel } from '../src/lib/payment-channels.js';
import { parseJson } from '../src/lib/db/json.js';

/** A bank account a transfer can name, as the shopper sees it. */
export interface StorefrontBank {
  id: string;
  name: string;
  accountNumber: string;
  accountName: string;
}

/** One payment channel in the wire shape the storefront + cashier render. */
export interface StorefrontChannelView {
  id: string;
  label: string;
  enabled: boolean;
  /** Merchant fee type; `null` when the channel costs us nothing. */
  feeType: 'flat' | 'percent' | null;
  feeValue: number;
  /** Only for `transfer`: the accounts this channel accepts. */
  banks?: StorefrontBank[];
}

export interface StorefrontPaymentConfig {
  tenant: string;
  shopName: string;
  channels: StorefrontChannelView[];
  /** Union of every enabled transfer bank, for a shopper picking one. */
  banks: StorefrontBank[];
  qrisAvailable: boolean;
}

/** A control-plane tenant row the storefront readers are allowed to touch. */
export interface ActiveTenant {
  id: string;
  slug: string;
  company_name: string;
  db_name: string;
  db_hostname: string;
  status: string;
}

const TENANT_COLUMNS = [
  'id',
  'slug',
  'company_name',
  'db_name',
  'db_hostname',
  'status',
] as const;

/** Resolve a slug to its active tenant, or the same 404/409 the catalogue uses. */
export async function findActiveTenantBySlug(slug: string): Promise<ActiveTenant> {
  const row = await getControlDb()
    .selectFrom('tenant_databases')
    .select(TENANT_COLUMNS)
    .where('slug', '=', slug)
    .executeTakeFirst();
  if (!row) {
    throw new HttpError(404, 'tenant_not_found', `No tenant with slug "${slug}".`);
  }
  if (row.status !== 'active') {
    throw new HttpError(409, 'tenant_inactive', `Tenant "${slug}" is ${row.status}.`);
  }
  return row as ActiveTenant;
}

/** Every active tenant, oldest first — the marketplace fan-out order. */
export async function listActiveTenants(): Promise<ActiveTenant[]> {
  const rows = await getControlDb()
    .selectFrom('tenant_databases')
    .select(TENANT_COLUMNS)
    .where('status', '=', 'active')
    .orderBy('created_at', 'asc')
    .execute();
  return rows as unknown as ActiveTenant[];
}

function readBanks(settings: Record<string, unknown>): StorefrontBank[] {
  const raw = settings.bank;
  if (!Array.isArray(raw)) return [];
  const banks: StorefrontBank[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const bank = item as Record<string, unknown>;
    const id = String(bank.id ?? '').trim();
    if (!id) continue;
    banks.push({
      id,
      name: String(bank.name ?? '').trim(),
      accountNumber: String(bank.accountNumber ?? '').trim(),
      accountName: String(bank.accountName ?? '').trim(),
    });
  }
  return banks;
}

function toView(channel: PaymentChannel, banks: StorefrontBank[]): StorefrontChannelView {
  const view: StorefrontChannelView = {
    id: channel.id,
    label: channel.label,
    enabled: channel.enabled,
    feeType: channel.fee?.type ?? null,
    feeValue: channel.fee?.value ?? 0,
  };
  if (channel.id === 'transfer') {
    // An unset bank list means "accept any configured account" (the default
    // channel), so the shopper still sees the tenant's real accounts.
    const wanted = channel.bankIds?.length ? new Set(channel.bankIds) : null;
    view.banks = wanted ? banks.filter((bank) => wanted.has(bank.id)) : banks;
  }
  return view;
}

/**
 * Build the public payment config from a tenant's stored row.
 *
 * Exported separately from `readPaymentConfig` so it can be unit tested with a
 * fabricated settings document — the same pure normalization the endpoints run.
 */
export function buildPaymentConfig(input: {
  slug: string;
  shopName: string;
  settingsRaw: unknown;
  qrisImageRaw: unknown;
}): StorefrontPaymentConfig {
  const settings = parseJson<Record<string, unknown>>(input.settingsRaw, {});
  const banks = readBanks(settings);
  const channels = normalizeChannels(settings.payment_channels).map((channel) =>
    toView(channel, banks)
  );
  const enabledTransferBanks = channels
    .filter((channel) => channel.id === 'transfer' && channel.enabled)
    .flatMap((channel) => channel.banks ?? []);
  const seen = new Set<string>();
  const unionBanks = enabledTransferBanks.filter((bank) => {
    if (seen.has(bank.id)) return false;
    seen.add(bank.id);
    return true;
  });
  return {
    tenant: input.slug,
    shopName: input.shopName,
    channels,
    banks: unionBanks,
    qrisAvailable:
      typeof input.qrisImageRaw === 'string' && input.qrisImageRaw.trim().length > 0,
  };
}

export interface DecodedImage {
  mime: string;
  bytes: Buffer;
}

/**
 * Turn a stored `data:<mime>;base64,<...>` QRIS column back into bytes.
 *
 * Returns `null` for an empty column or a value that is not a base64 image data
 * URL, so callers answer 404 rather than serving a corrupt image. The mime is
 * read from the prefix (the client resizes to webp, but a value uploaded by any
 * path is served as whatever it actually is).
 */
export function decodeQrisDataUrl(raw: unknown): DecodedImage | null {
  if (typeof raw !== 'string') return null;
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/.exec(raw.trim());
  if (!match) return null;
  try {
    return { mime: match[1], bytes: Buffer.from(match[2], 'base64') };
  } catch {
    return null;
  }
}

/** Read + build the config for one already-open tenant client. */
export async function readPaymentConfig(
  client: Client,
  tenant: { slug: string; company_name: string }
): Promise<StorefrontPaymentConfig> {
  const res = await client.execute('SELECT settings, qris_image FROM tenants LIMIT 1');
  const row = res.rows[0] as unknown as
    | { settings: string | null; qris_image: string | null }
    | undefined;
  return buildPaymentConfig({
    slug: tenant.slug,
    shopName: tenant.company_name,
    settingsRaw: row?.settings ?? null,
    qrisImageRaw: row?.qris_image ?? null,
  });
}
