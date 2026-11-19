/**
 * Payment configuration for the online storefront.
 *
 * Mirrors the server's `StorefrontPaymentConfig` shape so the tokoonline app
 * can render per-seller payment channels (cash, transfer, QRIS) without
 * importing from the parent `src/` — the two apps are deliberately decoupled.
 *
 * Fetched once per page load from `GET /api/storefront/channels` (the aggregate
 * fan-out), cached at the module level, and fail-soft to a sensible default
 * when the API is unreachable. The checkout and order pages read from this
 * module instead of the hardcoded `SHOP.banks`.
 */
import { useEffect, useState } from "react";

/** Where the back-office API listens (same origin logic as `catalog.ts`). */
const API_BASE = (
  (import.meta.env.VITE_CATALOG_API_URL as string | undefined) ?? "http://localhost:3000"
).replace(/\/+$/, "");

/* -------------------------------------------------------------------------- */
/* Public wire types (mirror server/storefront-payments.ts)                    */
/* -------------------------------------------------------------------------- */

export interface PaymentBank {
  id: string;
  name: string;
  accountNumber: string;
  accountName: string;
}

export interface PaymentChannelView {
  id: string;
  label: string;
  enabled: boolean;
  feeType: "flat" | "percent" | null;
  feeValue: number;
  banks?: PaymentBank[];
}

export interface PaymentConfig {
  tenant: string;
  shopName: string;
  channels: PaymentChannelView[];
  banks: PaymentBank[];
  qrisAvailable: boolean;
}

export interface PaymentConfigsResponse {
  shops: PaymentConfig[];
  tenants: { total: number; live: number };
  skipped: { slug: string; reason: string }[];
  syncedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Default fallback (when the API is unreachable)                              */
/* -------------------------------------------------------------------------- */

const DEFAULT_CHANNELS: PaymentChannelView[] = [
  { id: "cash", label: "Tunai", enabled: true, feeType: null, feeValue: 0 },
  {
    id: "transfer",
    label: "Transfer Bank",
    enabled: true,
    feeType: null,
    feeValue: 0,
    banks: [
      { id: "bca", name: "BCA", accountNumber: "123 456 7890", accountName: "Toko Bahan Kue" },
      { id: "mandiri", name: "Mandiri", accountNumber: "987 654 3210", accountName: "Toko Bahan Kue" },
    ],
  },
  { id: "qris", label: "QRIS", enabled: true, feeType: null, feeValue: 0 },
];

const DEFAULT_CONFIG: PaymentConfig = {
  tenant: "__default__",
  shopName: "Toko Bahan Kue",
  channels: DEFAULT_CHANNELS,
  banks: DEFAULT_CHANNELS[1].banks ?? [],
  qrisAvailable: false,
};

/* -------------------------------------------------------------------------- */
/* Module cache (one fetch per page load, shared across routes)                */
/* -------------------------------------------------------------------------- */

type State =
  | { status: "loading" }
  | { status: "ready"; configs: PaymentConfig[] }
  | { status: "error"; message: string; configs: PaymentConfig[] };

let cached: PaymentConfig[] | null = null;

async function fetchConfigs(): Promise<PaymentConfig[]> {
  const response = await fetch(`${API_BASE}/api/storefront/channels`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Konfigurasi pembayaran tidak bisa dimuat (HTTP ${response.status}).`);
  }
  const data = (await response.json()) as PaymentConfigsResponse;
  return data.shops ?? [];
}

/**
 * Loads every tenant's payment config once per page load.
 *
 * The first render is always `loading` (including SSR) because seeding from
 * the module cache would disagree with the HTML the server produced. If the
 * fetch fails, the last good cache is kept so a flaky API never blanks out
 * the checkout.
 */
export function usePaymentConfigs() {
  const [state, setState] = useState<State>(() =>
    cached ? { status: "ready", configs: cached } : { status: "loading" },
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    if (cached) setState({ status: "ready", configs: cached });

    fetchConfigs()
      .then((configs) => {
        cached = configs;
        if (live) setState({ status: "ready", configs });
      })
      .catch((error: unknown) => {
        if (!live) return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Konfigurasi pembayaran tidak bisa dimuat.",
          configs: cached ?? [DEFAULT_CONFIG],
        });
      });

    return () => {
      live = false;
    };
  }, [attempt]);

  return {
    ...state,
    configs: state.status === "loading" ? (cached ?? [DEFAULT_CONFIG]) : state.configs,
    reload: () => setAttempt((value) => value + 1),
    /** Convenience: look up a single tenant's config by slug. */
    forTenant(slug: string): PaymentConfig | undefined {
      const list = state.status === "loading" ? (cached ?? [DEFAULT_CONFIG]) : state.configs;
      return list.find((c: PaymentConfig) => c.tenant === slug);
    },
    /** Convenience: union of every enabled channel id across all tenants. */
    unionChannelIds(): string[] {
      const list = state.status === "loading" ? (cached ?? [DEFAULT_CONFIG]) : state.configs;
      const seen = new Set<string>();
      for (const config of list) {
        for (const channel of config.channels) {
          if (channel.enabled) seen.add(channel.id);
        }
      }
      return [...seen];
    },
    /** Convenience: union of every enabled transfer bank across all tenants. */
    unionBanks(): PaymentBank[] {
      const list = state.status === "loading" ? (cached ?? [DEFAULT_CONFIG]) : state.configs;
      const seen = new Map<string, PaymentBank>();
      for (const config of list) {
        for (const bank of config.banks) {
          if (!seen.has(bank.id)) seen.set(bank.id, bank);
        }
      }
      return [...seen.values()];
    },
    /** QRIS is available when at least one tenant has uploaded an image. */
    qrisAvailable(): boolean {
      const list = state.status === "loading" ? (cached ?? [DEFAULT_CONFIG]) : state.configs;
      return list.some((c: PaymentConfig) => c.qrisAvailable);
    },
    /** The QRIS image URL for a specific tenant. */
    qrisImageUrl(slug: string): string {
      return `${API_BASE}/api/storefront/qris?slug=${encodeURIComponent(slug)}`;
    },
  };
}

/**
 * Build the union of payment options across every seller in a basket.
 *
 * The checkout shows one set of buttons (cash / transfer / QRIS) for the
 * whole order; a channel is offered only when EVERY seller that ships in
 * this basket has it enabled. QRIS additionally needs at least one seller
 * to have uploaded an image.
 */
export function availableChannelsForSellers(
  configs: PaymentConfig[],
  sellerSlugs: string[],
): PaymentChannelView[] {
  if (sellerSlugs.length === 0) return DEFAULT_CHANNELS;
  const relevant = configs.filter((c) => sellerSlugs.includes(c.tenant));
  if (relevant.length === 0) return DEFAULT_CHANNELS;

  // A channel is available when every relevant seller has it enabled.
  const allChannelIds = new Set(relevant.flatMap((c) => c.channels.map((ch) => ch.id)));
  const channels: PaymentChannelView[] = [];
  for (const id of allChannelIds) {
    const enabled = relevant.every((config) =>
      config.channels.some((ch) => ch.id === id && ch.enabled),
    );
    if (!enabled) continue;

    // Merge banks from every seller for the transfer channel.
    if (id === "transfer") {
      const bankMap = new Map<string, PaymentBank>();
      for (const config of relevant) {
        const transferChannel = config.channels.find((ch) => ch.id === "transfer");
        for (const bank of transferChannel?.banks ?? config.banks) {
          if (!bankMap.has(bank.id)) bankMap.set(bank.id, bank);
        }
      }
      channels.push({
        id,
        label: "Transfer Bank",
        enabled: true,
        feeType: null,
        feeValue: 0,
        banks: [...bankMap.values()],
      });
    } else {
      // Use the first seller's label for non-transfer channels.
      const first = relevant.flatMap((c) => c.channels).find((ch) => ch.id === id);
      channels.push({
        id,
        label: first?.label ?? id,
        enabled: true,
        feeType: first?.feeType ?? null,
        feeValue: first?.feeValue ?? 0,
      });
    }
  }

  // QRIS needs at least one seller to have uploaded an image.
  const qrisChannel = channels.find((ch) => ch.id === "qris");
  if (qrisChannel) {
    const anyQris = relevant.some((c) => c.qrisAvailable);
    if (!anyQris) {
      return channels.filter((ch) => ch.id !== "qris");
    }
  }

  return channels;
}
