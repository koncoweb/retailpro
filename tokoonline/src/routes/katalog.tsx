import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CategoryChips } from "@/components/category-chips";
import { CatalogError, CatalogSkeleton } from "@/components/catalog-state";
import { ProductGrid } from "@/components/product-card";
import { useCatalog } from "@/lib/catalog";

export const Route = createFileRoute("/katalog")({ component: Katalog });

function Katalog() {
  const { state, reload } = useCatalog();
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");

  const products = useMemo(() => {
    if (state.status !== "ready") return [];
    const needle = query.trim().toLowerCase();
    return state.catalog.products.filter((product) => {
      if (category !== "all" && product.category !== category) return false;
      if (!needle) return true;
      return [product.name, product.sku, product.category ?? "", product.description ?? ""].some(
        (field) => field.toLowerCase().includes(needle),
      );
    });
  }, [state, category, query]);

  if (state.status === "error") {
    return (
      <div className="px-4 pt-4">
        <CatalogError message={state.message} onRetry={reload} />
      </div>
    );
  }

  return (
    <div className="flex flex-col px-4 pb-6">
      <div className="pt-3 pb-1">
        <h1 className="font-display text-2xl leading-none font-medium">Katalog</h1>
        <p className="mt-1 text-xs text-muted">
          {state.status === "ready"
            ? `${products.length} dari ${state.catalog.products.length} produk · stok gudang`
            : "Memuat katalog dari toko…"}
        </p>
      </div>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Cari tepung, cokelat, loyang…"
        className="mt-3 h-10 w-full rounded-md bg-surface px-3.5 text-sm text-fg shadow-[inset_0_0_0_1px_var(--color-line)] outline-none placeholder:text-subtle focus:shadow-[inset_0_0_0_1.5px_var(--color-accent)]"
      />
      {state.status === "ready" && (
        <CategoryChips
          categories={state.catalog.categories}
          value={category}
          onChange={setCategory}
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
        <ProductGrid products={products} />
      )}
    </div>
  );
}
