import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { CatalogError, CatalogSkeleton } from "@/components/catalog-state";
import { Thumb } from "@/components/thumb";
import { Button } from "@/components/ui/button";
import { Qty } from "@/components/qty";
import { useProduct } from "@/lib/catalog";
import { formatIDR } from "@/lib/format";
import {
  isSoldOut,
  maxQuantity,
  sellableUnits,
  stockLabel,
  unitDetail,
  unitLabel,
} from "@/lib/products";
import { useShop } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/product/$slug")({
  component: ProductPage,
});

function ProductPage() {
  const { slug } = Route.useParams();
  const { state, product, reload } = useProduct(slug);
  const navigate = useNavigate();
  const addToCart = useShop((s) => s.addToCart);
  const [unitName, setUnitName] = useState<string | null>(null);
  const [qty, setQty] = useState(1);

  if (state.status === "loading") {
    return (
      <div className="px-4 pt-4">
        <CatalogSkeleton tiles={2} />
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

  if (!product) {
    return (
      <div className="px-6 py-20 text-center">
        <p className="text-muted">Produk tidak ditemukan.</p>
        <Link to="/katalog" className="mt-3 inline-block text-sm underline">
          Kembali ke katalog
        </Link>
      </div>
    );
  }

  const soldOut = isSoldOut(product);
  // Only units the gudang can fill are offered; a 25 kg sack needs 25 kg on hand.
  const units = soldOut ? product.units : sellableUnits(product);
  const unit = units.find((candidate) => candidate.name === unitName) ?? units[0];
  const max = maxQuantity(product, unit);
  const quantity = Math.min(qty, max);
  const total = unit.price * quantity;

  function add(goCart: boolean) {
    if (!product || soldOut) return;
    addToCart({
      productId: product.id,
      slug: product.slug,
      name: product.name,
      category: product.category,
      unitName: unit.name,
      unitLabel: unitLabel(product, unit),
      qty: quantity,
      unitPrice: unit.price,
    });
    toast.success("Masuk keranjang");
    if (goCart) navigate({ to: "/cart" });
  }

  return (
    <div className="flex flex-col pb-48">
      <div className="relative">
        <Thumb
          name={product.name}
          label={product.category}
          variant="hero"
          className="aspect-[4/5] w-full"
        />
        <Link
          to="/katalog"
          aria-label="Kembali"
          className="absolute top-4 left-4 grid size-11 place-items-center rounded-full bg-bg/80 text-fg backdrop-blur-sm"
        >
          <ChevronLeft className="size-5" strokeWidth={1.75} />
        </Link>
      </div>

      <div className="flex flex-col gap-5 px-5 pt-5">
        <div>
          <p className="text-[11px] tracking-[0.2em] text-muted uppercase">
            {product.category ?? "Produk"} · {product.sku}
          </p>
          <h1 className="font-display mt-1 text-[30px] leading-none font-medium">
            {product.name}
          </h1>
          {product.description && (
            <p className="mt-2 text-[14px] leading-relaxed text-muted">
              {product.description}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between rounded-md bg-surface px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
          <span className="text-[13px] text-muted">Stok gudang</span>
          <span
            className={cn(
              "text-[13px] font-medium tabular-nums",
              soldOut ? "text-accent" : product.lowStock ? "text-accent" : "text-fg",
            )}
          >
            {soldOut ? "Habis" : stockLabel(product)}
            {!soldOut && product.lowStock && (
              <span className="ml-1.5 text-[11px] font-normal">· terbatas</span>
            )}
          </span>
        </div>

        <div>
          <p className="mb-2 text-[13px] font-medium text-muted">Satuan</p>
          <div className="grid grid-cols-2 gap-2">
            {units.map((candidate) => (
              <button
                key={candidate.name}
                type="button"
                onClick={() => {
                  setUnitName(candidate.name);
                  setQty(1);
                }}
                className={cn(
                  "rounded-md px-3 py-3 text-left transition-colors duration-150",
                  unit.name === candidate.name
                    ? "bg-primary text-primary-fg"
                    : "bg-surface text-fg shadow-[inset_0_0_0_1px_var(--color-line)]",
                )}
              >
                <span className="block text-[14px] font-medium">{candidate.name}</span>
                <span
                  className={cn(
                    "mt-0.5 block text-[12px]",
                    unit.name === candidate.name ? "opacity-75" : "text-muted",
                  )}
                >
                  {unitDetail(product, candidate)} · {formatIDR(candidate.price)}
                </span>
              </button>
            ))}
          </div>
        </div>

        {!soldOut && (
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-muted">
              Jumlah
              <span className="ml-1.5 text-[11px] text-subtle">
                maks. {max} {unit.name}
              </span>
            </span>
            <Qty value={quantity} onChange={setQty} max={Math.min(max, 99)} />
          </div>
        )}
      </div>

      <div
        className="fixed bottom-0 left-1/2 z-20 w-full max-w-[430px] -translate-x-1/2 border-t border-line bg-bg/94 px-4 pt-3 backdrop-blur-md"
        style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
      >
        {soldOut ? (
          <div className="pb-3">
            <p className="text-[13px] text-fg">Stok gudang habis</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">
              Titip nomor WhatsApp di chat — kami kabari begitu kiriman supplier
              masuk.
            </p>
            <Link to="/chat" className="mt-3 block">
              <Button variant="outline" className="w-full">
                Tanya ketersediaan
              </Button>
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[12px] text-muted">
                {quantity} {unit.name}
              </span>
              <span className="font-display text-xl tabular-nums">
                {formatIDR(total)}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => add(false)}>
                + Keranjang
              </Button>
              <Button onClick={() => add(true)}>Pesan</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
