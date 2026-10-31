import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronRight, Store } from "lucide-react";
import { CatalogError, CatalogSkeleton } from "@/components/catalog-state";
import { CategoryGrid } from "@/components/category-grid";
import { HeroSlider, type HeroSlide } from "@/components/hero-slider";
import { ProductGrid } from "@/components/product-card";
import { SearchField } from "@/components/search-field";
import { useMarketplace } from "@/lib/catalog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({ component: Home });

/** How many tiles the home page shows before handing over to the catalogue. */
const FEATURED = 8;

/**
 * The banner row is artwork, not data: the two TokoBahanKue banners drawn for
 * the marketplace, kept as files in `public/slider/` so the copy can change
 * without touching this component.
 */
const SLIDES: HeroSlide[] = [
  {
    id: "marketplace",
    src: "/slider/banner-marketplace.png",
    alt: "TokoBahanKue.com — pusat kebutuhan industri roti dan kue Indonesia. Aneka tepung, mentega, telur, dan gula di atas meja marmer.",
  },
  {
    id: "bahan-kue",
    src: "/slider/banner-bahan-kue.png",
    alt: "TokoBahanKue.com — pusat kebutuhan industri roti dan kue Indonesia. Tepung, mentega, telur, dan gula di atas meja kayu.",
  },
];

function Home() {
  const { state, reload } = useMarketplace();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  function search() {
    const q = query.trim();
    navigate({ to: "/katalog", search: q ? { q } : {} });
  }

  if (state.status === "loading") {
    return (
      <div className="flex flex-col gap-3 px-4 pt-3 pb-6">
        <div className="h-10 animate-pulse rounded-full bg-surface" />
        <div className="aspect-[16/9] animate-pulse rounded-xl bg-surface" />
        <div className="h-28 animate-pulse rounded-xl bg-surface" />
        <CatalogSkeleton />
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

  const { marketplace } = state;
  const featured = marketplace.products.slice(0, FEATURED);

  return (
    <div className="flex flex-col gap-3 px-4 pt-3 pb-6">
      <SearchField value={query} onChange={setQuery} onSubmit={search} />
      <HeroSlider slides={SLIDES} />
      <CategoryGrid categories={marketplace.categories} />

      {marketplace.shops.length > 0 && (
        <section aria-label="Toko di marketplace">
          <header className="flex items-baseline justify-between px-0.5 pb-2">
            <h2 className="font-display text-[15px] font-medium text-fg">Toko di marketplace</h2>
            <span className="text-[11px] text-muted">
              {marketplace.tenants.live} dari {marketplace.tenants.total} toko
            </span>
          </header>
          <ul className="flex snap-x snap-mandatory gap-2.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {marketplace.shops.map((shop) => (
              <li key={shop.slug} className="w-[236px] shrink-0 snap-start">
                <Link
                  to="/katalog"
                  search={{ toko: shop.slug }}
                  className="flex h-full items-center gap-2.5 rounded-lg bg-surface p-2.5 shadow-[var(--shadow-border)]"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-bg text-fg">
                    <Store className="size-[18px]" strokeWidth={1.5} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-fg">
                      {shop.name}
                    </span>
                    <span className="block truncate text-[10px] leading-tight text-muted">
                      {shop.productCount} produk · {shop.inStock} siap kirim
                    </span>
                    <span className="block truncate text-[10px] leading-tight text-subtle">
                      {shop.warehouse}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Produk">
        <header className="flex items-baseline justify-between px-0.5 pb-2">
          <h2 className="font-display text-[15px] font-medium text-fg">Untuk kamu</h2>
          <Link to="/katalog" className="flex items-center text-[11px] text-muted">
            Lihat semua <ChevronRight className="size-3.5" strokeWidth={1.8} />
          </Link>
        </header>
        <ProductGrid products={featured} />
        {marketplace.products.length > featured.length && (
          <Link
            to="/katalog"
            className="mt-3 grid h-10 place-items-center rounded-full bg-surface text-[12px] font-medium text-fg shadow-[var(--shadow-border)]"
          >
            Lihat {marketplace.products.length} produk
          </Link>
        )}
      </section>

      <Link
        to="/chat"
        className={cn(
          "mt-1 flex items-center justify-between rounded-lg bg-surface px-4 py-3 shadow-[var(--shadow-border)]",
        )}
      >
        <span>
          <span className="font-display block text-[15px] text-fg">Butuh jumlah banyak?</span>
          <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">
            Chat CS untuk harga karung, dus, atau kiriman rutin ke dapur Anda.
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-subtle" strokeWidth={1.8} />
      </Link>
    </div>
  );
}
