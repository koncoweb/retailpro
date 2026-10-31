import { Link } from "@tanstack/react-router";
import { Store } from "lucide-react";
import { Thumb } from "@/components/thumb";
import { formatIDR } from "@/lib/format";
import { baseUnit, fromPrice, isProductSoldOut, shelves, type Product } from "@/lib/products";
import { cn } from "@/lib/utils";

/** What a tile needs: a product and, in the marketplace, who sells it. */
export type TileProduct = Product & { tenant?: string; seller?: string };

export function ProductCard({ product }: { product: TileProduct }) {
  // A tile speaks for the whole product: sold out only when no shelf can ship.
  const soldOut = isProductSoldOut(product);
  const [firstShelf, ...otherShelves] = shelves(product);
  const variantCount = otherShelves.length + 1;

  return (
    <Link
      to="/product/$tenant/$slug"
      params={{ tenant: product.tenant ?? "", slug: product.slug }}
      className="group flex min-w-0 flex-col overflow-hidden rounded-lg bg-surface shadow-[var(--shadow-border)]"
    >
      <div className="relative overflow-hidden bg-bg">
        <Thumb
          name={product.name}
          className="aspect-square w-full transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.03]"
        />
        {!soldOut && product.lowStock && (
          <span className="absolute top-1.5 left-1.5 rounded-full bg-bg/90 px-1.5 py-0.5 text-[9px] tracking-[0.12em] text-fg uppercase backdrop-blur-sm">
            Terbatas
          </span>
        )}
        {soldOut && (
          <span className="absolute inset-0 grid place-items-center bg-bg/72 text-[11px] tracking-[0.2em] text-fg uppercase backdrop-blur-[1px]">
            Habis
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1 px-2 pt-1.5 pb-2">
        <h3 className="font-display line-clamp-2 min-h-[2.3em] text-[13px] leading-tight font-medium text-fg">
          {product.name}
        </h3>
        <p className="text-[13px] leading-none font-semibold tabular-nums text-primary">
          {formatIDR(fromPrice(product))}
          <span className="text-[10px] font-normal text-subtle">
            {" "}
            / {baseUnit(firstShelf).name}
          </span>
        </p>
        {product.seller && (
          <p className="flex min-w-0 items-center gap-1 text-[10px] leading-none text-muted">
            <Store className="size-3 shrink-0" strokeWidth={1.6} />
            <span className="truncate">{product.seller}</span>
          </p>
        )}
        <p className="mt-auto text-[10px] leading-none text-subtle">
          {variantCount > 1 ? `${variantCount} pilihan` : "Siap kirim"}
        </p>
      </div>
    </Link>
  );
}

export function ProductGrid({
  products,
  className,
}: {
  products: TileProduct[];
  className?: string;
}) {
  if (products.length === 0) return null;
  return (
    <section className={cn("grid grid-cols-2 gap-2.5", className)}>
      {products.map((product) => (
        <ProductCard key={`${product.tenant ?? ""}:${product.id}`} product={product} />
      ))}
    </section>
  );
}
