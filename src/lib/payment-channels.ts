/**
 * Payment channels: how a customer may pay, and what each channel costs the
 * merchant.
 *
 * The owner picks this in Settings → Pembayaran. Every money path reads it from
 * here — the till (PaymentModal), the online storefront checkout, and the
 * vendor/partner payment screens — so "which channels are on", "what fee do we
 * absorb on QRIS", and "which bank accounts do we accept transfers into" have
 * exactly one answer instead of a hardcoded list in each screen.
 *
 * Deliberately dependency-free (like `stock-issue.ts`): the fee math and the
 * normalizer are pure so they can be unit tested and reused by the serverless
 * API that renders the public storefront payload.
 *
 * IMPORTANT — the fee is a MERCHANT cost, never a customer surcharge. A sale's
 * `total_amount`/`amount_paid` are what the customer paid; `fee_amount` is the
 * cost WE absorb for taking that payment method. Reports show net as
 * `total_amount − fee_amount`. Adding the fee to what the customer pays would
 * silently overstate revenue and change the receipt.
 */

/** What a channel costs the merchant: a flat rupiah amount or a % of the sale. */
export type FeeSpec =
  | { type: "flat"; value: number }
  | { type: "percent"; value: number };

export type PaymentChannelId = "cash" | "transfer" | "qris";

export interface PaymentChannel {
  id: string;
  /** Indonesian-first name shown to staff and shoppers. */
  label: string;
  enabled: boolean;
  /** Merchant fee. Absent / zero means "free to us". Never charged to customer. */
  fee?: FeeSpec;
  /** Only for `transfer`: the ids from the stored `bank` settings it accepts. */
  bankIds?: string[];
}

/** Top-level shape stored under `tenants.settings.payment_channels`. */
export interface PaymentChannelsConfig {
  channels: PaymentChannel[];
  updated_at?: string;
}

/** Top-level key inside `tenants.settings`. */
export const PAYMENT_CHANNELS_SETTING_KEY = "payment_channels";

/** Channel id → the value written to `transactions.payment_method`. */
export const CHANNEL_PAYMENT_METHOD: Record<string, string> = {
  cash: "cash",
  transfer: "transfer",
  qris: "qris",
};

/** The three channels this build ships with. Order is the POS tab order. */
export const BUILTIN_CHANNEL_META: Array<{
  id: PaymentChannelId;
  label: string;
  description: string;
  /** Whether the owner may set a merchant fee for it. Cash is always free. */
  feeEditable: boolean;
}> = [
  {
    id: "cash",
    label: "Tunai",
    description: "Uang fisik di laci kasir. Tidak menimbulkan biaya gateway.",
    feeEditable: false,
  },
  {
    id: "transfer",
    label: "Transfer Bank",
    description: "Transfer ke rekening toko. Biaya admin mengikuti kebijakan bank.",
    feeEditable: true,
  },
  {
    id: "qris",
    label: "QRIS",
    description:
      "Pelanggan memindai QRIS statis toko. Merchant Discount Rate (MDR) biasanya sekitar 0,7%.",
    feeEditable: true,
  },
];

/** A fresh copy of the default set; callers may mutate the result freely. */
export function defaultChannels(): PaymentChannel[] {
  return [
    { id: "cash", label: "Tunai", enabled: true },
    { id: "transfer", label: "Transfer Bank", enabled: true },
    { id: "qris", label: "QRIS", enabled: true },
  ];
}

/** Upload + storage limits for the static QRIS image. */
export const QRIS_MAX_SOURCE_BYTES = 2 * 1024 * 1024; // reject files > 2 MB before encode
export const QRIS_RESIZE_MAX_PX = 720; // longest edge after client resize
export const QRIS_OUTPUT_QUALITY = 0.85;
/** Hard cap the server accepts, so a browser bypassing the resize cannot bloat the row. */
export const QRIS_MAX_DATA_URL_BYTES = 400_000;

function clampNumber(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

/** A fee is only real when it is positive; anything else reads as "free". */
export function normalizeFee(value: unknown): FeeSpec | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as { type?: unknown; value?: unknown };
  if (raw.type === "flat") {
    const n = clampNumber(raw.value, 0, Number.MAX_SAFE_INTEGER);
    return n && n > 0 ? { type: "flat", value: Math.round(n) } : undefined;
  }
  if (raw.type === "percent") {
    const n = clampNumber(raw.value, 0, 100);
    return n && n > 0 ? { type: "percent", value: n } : undefined;
  }
  return undefined;
}

function normalizeChannel(item: unknown): PaymentChannel | null {
  if (!item || typeof item !== "object") return null;
  const raw = item as Record<string, unknown>;
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : null;
  if (!id) return null;
  const meta = BUILTIN_CHANNEL_META.find((entry) => entry.id === id);
  const channel: PaymentChannel = {
    id,
    label: typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : meta?.label ?? id,
    // Absent means on: a tenant that never saw this screen still sells how it
    // always did. Only an explicit `false` turns a channel off.
    enabled: raw.enabled !== false,
  };
  const fee = normalizeFee(raw.fee);
  // Cash has no gateway, so a stray fee on it is dropped rather than trusted.
  if (fee && meta?.feeEditable !== false) channel.fee = fee;
  if (Array.isArray(raw.bankIds)) {
    channel.bankIds = raw.bankIds.filter((x): x is string => typeof x === "string");
  }
  return channel;
}

/**
 * Coerce a stored value (a `{channels}` object or a bare array) into the full
 * channel list. The three built-in channels are always present, in the POS tab
 * order, so a partial or corrupt document never hides a way to pay; unknown
 * channels a newer build stored are kept at the end.
 */
export function normalizeChannels(raw: unknown): PaymentChannel[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as PaymentChannelsConfig).channels)
      ? (raw as PaymentChannelsConfig).channels
      : [];

  const byId = new Map<string, PaymentChannel>();
  for (const item of list) {
    const channel = normalizeChannel(item);
    if (channel) byId.set(channel.id, channel);
  }

  const result: PaymentChannel[] = [];
  for (const def of defaultChannels()) {
    result.push(byId.get(def.id) ?? def);
    byId.delete(def.id);
  }
  for (const extra of byId.values()) result.push(extra);
  return result;
}

/** Channels the till / storefront should actually offer for a sale. */
export function enabledChannels(raw: unknown): PaymentChannel[] {
  return normalizeChannels(raw).filter((channel) => channel.enabled);
}

/**
 * Merchant fee for a sale on `channel`. Rounded to whole rupiah (IDR has no
 * cents). Zero for cash, for a disabled fee, and never negative.
 *
 * Accepts either a `PaymentChannel` (its `fee` is read) or a bare `FeeSpec`, so
 * a caller holding just the fee doesn't have to fabricate a channel.
 */
export function computeMerchantFee(
  channel: PaymentChannel | FeeSpec | undefined,
  total: number
): number {
  let fee: FeeSpec | undefined;
  if (channel && typeof channel === "object") {
    if ("type" in channel) fee = channel as FeeSpec;
    else fee = (channel as PaymentChannel).fee;
  }
  if (!fee || !(total > 0)) return 0;
  if (fee.type === "flat") return Math.max(0, Math.round(fee.value));
  // Guard binary float noise before the whole-rupiah round: 0.7% of 10.500 is
  // mathematically 73.5 but computes to 73.4999…, which must still round up to
  // 74. Rounding at six decimals first absorbs the ~1e-13 error.
  const percent = Math.round(((total * fee.value) / 100) * 1e6) / 1e6;
  return Math.max(0, Math.round(percent));
}

/** A compact, storable description of the fee taken at sale time. */
export function feeLabel(channel: PaymentChannel): string | null {
  const fee = channel.fee;
  if (!fee) return null;
  if (fee.type === "flat") {
    return `${channel.label} · Rp ${new Intl.NumberFormat("id-ID").format(fee.value)}`;
  }
  return `${channel.label} · ${fee.value}%`;
}

/** `transactions.payment_method` for a channel id (falls back to the id). */
export function paymentMethodForChannel(id: string): string {
  return CHANNEL_PAYMENT_METHOD[id] ?? id;
}
