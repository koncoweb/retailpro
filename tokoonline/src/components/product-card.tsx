import { Link } from "@tanstack/react-router";
import { Thumb } from "@/components/thumb";
import { formatIDR } from "@/lib/format";
import { baseUnit, fromPrice, isSoldOut, type Product } from "@/lib/products";
import { cn } from "@/lib/utils";

export function ProductCard({ product }: { product: Product }) {
  const soldOut = isSoldOut(product);

  return (
    <Link
      to="/product/$slug"
      params={{ slug: product.slug }}
      className="group flex min-w-0 flex-col gap-1.5"
    >
      <div className="relative overflow-hidden rounded-md bg-surface shadow-[var(--shadow-border)]">
        <Thumb
          name={product.name}
          label={product.category}
          className="aspect-square w-full transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.03]"
        />
        {!soldOut && product.lowStock && (
          <span className="absolute top-2 left-2 rounded-full bg-bg/90 px-2 py-0.5 text-[10px] tracking-[0.14em] text-fg uppercase backdrop-blur-sm">
            Terbatas
          </span>
        )}
        {soldOut && (
          <span className="absolute inset-0 grid place-items-center bg-bg/72 text-[11px] tracking-[0.22em] text-fg uppercase backdrop-blur-[1px]">
            Habis
          </span>
        )}
      </div>
      <div className="min-w-0 px-0.5">
        <h3 className="font-display line-clamp-2 min-h-[2.4em] text-[15px] leading-snug font-medium text-fg">
          {product.name}
        </h3>
        <p className="mt-0.5 text-xs font-medium tabular-nums text-muted">
          {formatIDR(fromPrice(product))}
          <span className="font-normal text-subtle"> / {baseUnit(product).name}</span>
        </p>
      </div>
    </Link>
  );
}

export function ProductGrid({
  products,
  className,
}: {
  products: Product[];
  className?: string;
}) {
  if (products.length === 0) return null;
  return (
    <section className={cn("grid grid-cols-2 gap-x-2.5 gap-y-4", className)}>
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </section>
  );
}
