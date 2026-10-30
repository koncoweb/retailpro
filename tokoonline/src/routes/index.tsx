import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { CategoryChips } from "@/components/category-chips";
import { CatalogError, CatalogSkeleton } from "@/components/catalog-state";
import { ProductGrid } from "@/components/product-card";
import { useCatalog } from "@/lib/catalog";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { state, reload } = useCatalog();
  const [category, setCategory] = useState("all");

  if (state.status === "loading") {
    return (
      <div className="flex flex-col px-4 pb-6">
        <div className="pt-3 pb-1">
          <h1 className="font-display text-2xl leading-none font-medium">Bahan kue</h1>
          <p className="mt-1 text-xs text-muted">Memuat katalog dari toko…</p>
        </div>
        <div className="pt-4">
          <CatalogSkeleton />
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="px-4 pt-4">
        <CatalogError message={state.message} onRetry={reload} />
      </div>
    );
  }

  const { catalog } = state;
  const products =
    category === "all"
      ? catalog.products
      : catalog.products.filter((product) => product.category === category);

  return (
    <div className="flex flex-col px-4 pb-6">
      <div className="pt-3 pb-1">
        <h1 className="font-display text-2xl leading-none font-medium">Bahan kue</h1>
        <p className="mt-1 text-xs text-muted">
          {catalog.products.length} produk · dikirim dari {catalog.shop.warehouse}
        </p>
      </div>
      <CategoryChips
        categories={catalog.categories}
        value={category}
        onChange={setCategory}
      />
      <ProductGrid products={products} />
      <Link
        to="/chat"
        className="mt-5 rounded-lg bg-surface px-4 py-3 shadow-[var(--shadow-border)]"
      >
        <p className="font-display text-[17px] text-fg">Butuh jumlah banyak?</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          Chat CS untuk harga karung, dus, atau kiriman rutin ke dapur Anda.
        </p>
      </Link>
    </div>
  );
}
