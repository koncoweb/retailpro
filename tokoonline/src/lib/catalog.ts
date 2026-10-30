/**
 * The shop's connection to the back office.
 *
 * `/api/storefront/catalog` belongs to the RetailPro backend: it resolves the
 * Thalia tenant, picks the online branch and reads the stock of the gudang that
 * ships web orders. The storefront therefore never holds a database
 * credential, and anything the shop staff change in the back office (new
 * product, new price, stock received) shows up here on the next load.
 */
import { useEffect, useState } from "react";
import type { Product } from "./products";

export interface ShopInfo {
  /** Registered company name, e.g. "Thalia Toko Bahan Kue". */
  tenant: string;
  /** The online branch this storefront stands for, e.g. "Thalia Online". */
  branch: string;
  code: string | null;
  address: string | null;
  phone: string | null;
  /** Warehouse web orders are picked from. */
  warehouse: string;
}

export interface CategoryInfo {
  name: string;
  count: number;
}

export interface Catalog {
  shop: ShopInfo;
  categories: CategoryInfo[];
  products: Product[];
  syncedAt: string;
}

export type CatalogState =
  | { status: "loading" }
  | { status: "ready"; catalog: Catalog }
  | { status: "error"; message: string };

/**
 * Where the back-office API listens. In development that is `npm run dev:api`
 * on :3000; a deployment sets `VITE_CATALOG_API_URL` to its own public origin.
 */
const API_BASE = (
  (import.meta.env.VITE_CATALOG_API_URL as string | undefined) ?? "http://localhost:3000"
).replace(/\/+$/, "");

let cached: Catalog | null = null;

async function fetchCatalog(): Promise<Catalog> {
  const response = await fetch(`${API_BASE}/api/storefront/catalog`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Katalog tidak bisa dimuat (HTTP ${response.status}).`);
  }
  return (await response.json()) as Catalog;
}

/**
 * Loads the catalogue once per page load, sharing one request across routes.
 *
 * The first render is always `loading` — including on the server — because
 * seeding state from the module cache would make hydration disagree with the
 * HTML the server just produced.
 */
export function useCatalog() {
  const [state, setState] = useState<CatalogState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    if (cached) setState({ status: "ready", catalog: cached });

    fetchCatalog()
      .then((catalog) => {
        cached = catalog;
        if (live) setState({ status: "ready", catalog });
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

/** The product behind a URL, plus the catalogue state to render around it. */
export function useProduct(slug: string) {
  const catalog = useCatalog();
  const product =
    catalog.state.status === "ready"
      ? (catalog.state.catalog.products.find((item) => item.slug === slug) ?? null)
      : null;

  return { ...catalog, product };
}
