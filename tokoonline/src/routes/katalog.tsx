import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Store, X } from "lucide-react";
import { CategoryChips } from "@/components/category-chips";
import { CatalogError, CatalogSkeleton } from "@/components/catalog-state";
import { ProductGrid } from "@/components/product-card";
import { SearchField } from "@/components/search-field";
import { useMarketplace } from "@/lib/catalog";

/**
 * The catalogue page is the marketplace's search-and-filter screen: the term and
 * the category live in the URL (`?q=`, `?kategori=`, `?toko=`) so a category
 * tapped on the home page or a shop tapped on a seller card opens the right
 * list, and so the browser's back button undoes a filter.
 */
export const Route = createFileRoute("/katalog")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { q?: string; kategori?: string; toko?: string } => ({
    q: typeof search.q === "string" && search.q.trim() ? search.q : undefined,
    kategori:
      typeof search.kategori === "string" && search.kategori.trim()
        ? search.kategori
        : undefined,
    toko: typeof search.toko === "string" && search.toko.trim() ? search.toko : undefined,
  }),
  component: Katalog,
});

function Katalog() {
  const { state, reload } = useMarketplace();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [query, setQuery] = useState(search.q ?? "");

  const category = search.kategori ?? "all";
  const seller = search.toko ?? null;

  function selectCategory(name: string) {
    // The term travels with the category so the URL stays the single source of
    // truth: what the shopper sees is always what the address bar says.
    navigate({
      to: "/katalog",
      search: {
        q: query.trim() || undefined,
        kategori: name === "all" ? undefined : name,
        toko: seller ?? undefined,
      },
      replace: true,
    });
  }

  function submitQuery() {
    navigate({
      to: "/katalog",
      search: {
        q: query.trim() || undefined,
        kategori: category === "all" ? undefined : category,
        toko: seller ?? undefined,
      },
      replace: true,
    });
  }

  function clearSeller() {
    navigate({
      to: "/katalog",
      search: {
        q: search.q,
        kategori: search.kategori,
      },
      replace: true,
    });
  }

  const products = useMemo(() => {
    if (state.status !== "ready") return [];
    const needle = query.trim().toLowerCase();
    return state.marketplace.products.filter((product) => {
      if (seller && product.tenant !== seller) return false;
      if (category !== "all" && product.category !== category) return false;
      if (!needle) return true;
      return [
        product.name,
        product.sku,
        product.category ?? "",
        product.description ?? "",
        product.seller,
      ].some((field) => field.toLowerCase().includes(needle));
    });
  }, [state, category, seller, query]);

  if (state.status === "error") {
    return (
      <div className="px-4 pt-4">
        <CatalogError message={state.message} onRetry={reload} />
      </div>
    );
  }

  const shop =
    state.status === "ready"
      ? state.marketplace.shops.find((row) => row.slug === seller) ?? null
      : null;

  return (
    <div className="flex flex-col px-4 pb-6">
      <div className="pt-3">
        <h1 className="font-display text-2xl leading-none font-medium">
          {shop ? shop.name : "Katalog"}
        </h1>
        <p className="mt-1 text-xs text-muted">
          {state.status === "ready"
            ? `${products.length} dari ${state.marketplace.products.length} produk · ${
                state.marketplace.tenants.live
              } toko`
            : "Memuat katalog dari toko…"}
        </p>
      </div>

      <SearchField
        value={query}
        onChange={setQuery}
        onSubmit={submitQuery}
        placeholder="Cari produk, toko, atau SKU…"
        className="mt-3"
      />

      {seller && (
        <button
          type="button"
          onClick={clearSeller}
          className="mt-2 flex w-fit items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-[11px] text-fg shadow-[inset_0_0_0_1px_var(--color-line)]"
        >
          <Store className="size-3" strokeWidth={1.8} />
          {shop?.name ?? seller}
          <X className="size-3 text-muted" strokeWidth={2} />
        </button>
      )}

      {state.status === "ready" && (
        <CategoryChips
          categories={state.marketplace.categories}
          value={category}
          onChange={selectCategory}
        />
      )}

      {state.status === "loading" ? (
        <div className="pt-4">
          <CatalogSkeleton />
        </div>
      ) : products.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted">
          Tidak ada produk yang cocok.{" "}
          <Link to="/chat" className="underline">
            Chat CS
          </Link>{" "}
          untuk pesanan khusus.
        </p>
      ) : (
        <ProductGrid products={products} className="pt-2" />
      )}
    </div>
  );
}
