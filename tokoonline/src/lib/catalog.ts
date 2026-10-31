/**
 * The storefront's connection to the RetailPro back office.
 *
 * `/api/storefront/marketplace` lives in the back office app: it walks every
 * active tenant, picks each one's online channel, reads the stock of the gudang
 * that ships web orders and returns one merged list with the seller attached to
 * every product. This app therefore never holds a database credential, and
 * anything a tenant's staff change in their back office (new product, new price,
 * stock received) shows up here on the next load.
 */
import { useEffect, useState } from "react";
import type { Product } from "./products";

/** One seller in the marketplace: a whole tenant and its online channel. */
export interface ShopInfo {
  /** Tenant slug — the seller's stable identity in URLs. */
  slug: string;
  /** Registered company name, e.g. "Thalia Toko Bahan Kue". */
  name: string;
  /** The online branch this seller ships from, e.g. "Thalia Online". */
  branch: string;
  /** Warehouse web orders are picked from. */
  warehouse: string;
  address: string | null;
  phone: string | null;
  productCount: number;
  /** Every category this seller sells, for the seller page. */
  categories: string[];
  /** Products with stock on hand right now. */
  inStock: number;
}

export interface CategoryInfo {
  name: string;
  count: number;
}

/** A catalogue product plus who sells it. */
export interface MarketProduct extends Product {
  /** Tenant slug, used together with `slug` in product URLs. */
  tenant: string;
  /** Shop name rendered on the tile. */
  seller: string;
  branch: string;
}

export interface Marketplace {
  shops: ShopInfo[];
  categories: CategoryInfo[];
  products: MarketProduct[];
  /** How many registered tenants answered, out of those registered. */
  tenants: { total: number; live: number };
  syncedAt: string;
}

export type MarketplaceState =
  | { status: "loading" }
  | { status: "ready"; marketplace: Marketplace }
  | { status: "error"; message: string };

/**
 * Where the back-office API listens. In development that is `npm run dev:api`
 * on :3000; a deployment sets `VITE_CATALOG_API_URL` to its own public origin.
 */
const API_BASE = (
  (import.meta.env.VITE_CATALOG_API_URL as string | undefined) ?? "http://localhost:3000"
).replace(/\/+$/, "");

let cached: Marketplace | null = null;

async function fetchMarketplace(): Promise<Marketplace> {
  const response = await fetch(`${API_BASE}/api/storefront/marketplace`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Katalog tidak bisa dimuat (HTTP ${response.status}).`);
  }
  return (await response.json()) as Marketplace;
}

/**
 * Loads the marketplace once per page load, sharing one request across routes.
 *
 * The first render is always `loading` — including on the server — because
 * seeding state from the module cache would make hydration disagree with the
 * HTML the server just produced.
 */
export function useMarketplace() {
  const [state, setState] = useState<MarketplaceState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    if (cached) setState({ status: "ready", marketplace: cached });

    fetchMarketplace()
      .then((marketplace) => {
        cached = marketplace;
        if (live) setState({ status: "ready", marketplace });
      })
      .catch((error: unknown) => {
        if (!live) return;
        // A reload that fails keeps showing the last good catalogue.
        if (cached) return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Katalog tidak bisa dimuat.",
        });
      });

    return () => {
      live = false;
    };
  }, [attempt]);

  return { state, reload: () => setAttempt((value) => value + 1) };
}

/**
 * The product behind a URL, plus the marketplace state to render around it.
 * A slug is only unique inside one tenant, so the seller is part of the key.
 */
export function useProduct(tenant: string, slug: string) {
  const marketplace = useMarketplace();
  const product =
    marketplace.state.status === "ready"
      ? (marketplace.state.marketplace.products.find(
          (item) => item.tenant === tenant && item.slug === slug,
        ) ?? null)
      : null;
  const shop =
    marketplace.state.status === "ready"
      ? (marketplace.state.marketplace.shops.find((item) => item.slug === tenant) ?? null)
      : null;

  return { ...marketplace, product, shop };
}
