import { createFileRoute, Link } from "@tanstack/react-router";
import { buttonVariants } from "@/components/ui/button";
import { Qty } from "@/components/qty";
import { Thumb } from "@/components/thumb";
import { formatIDR } from "@/lib/format";
import { cartTotal, useShop } from "@/lib/store";

export const Route = createFileRoute("/cart")({ component: CartPage });

function CartPage() {
  const cart = useShop((s) => s.cart);
  const setQty = useShop((s) => s.setQty);
  const remove = useShop((s) => s.remove);
  const total = cartTotal(cart);

  if (cart.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-8 py-20 text-center">
        <p className="font-display text-2xl">Keranjang kosong</p>
        <p className="mt-2 max-w-[28ch] text-[14px] text-muted">
          Pilih bahan kue dari katalog. Harga dan stok mengikuti toko.
        </p>
        <Link to="/katalog" className={buttonVariants({ className: "mt-6" })}>
          Lihat katalog
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col px-4 pt-2 pb-8">
      <h1 className="font-display text-[28px] leading-none font-medium">
        Keranjang
      </h1>
      <ul className="mt-5 flex flex-col gap-4">
        {cart.map((item) => (
          <li key={item.key} className="flex gap-3">
            {item.tenant ? (
              <Link
                to="/product/$tenant/$slug"
                params={{ tenant: item.tenant, slug: item.slug }}
                className="size-[88px] shrink-0 overflow-hidden rounded-[16px] bg-surface"
              >
                <Thumb name={item.name} className="size-full" />
              </Link>
            ) : (
              // A basket saved before sellers existed has no tenant to link to;
              // the line still renders so the shopper can finish the order.
              <div className="size-[88px] shrink-0 overflow-hidden rounded-[16px] bg-surface">
                <Thumb name={item.name} className="size-full" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-display text-[17px] leading-tight">
                    {item.name}
                  </p>
                  <p className="mt-0.5 text-[12px] text-muted">
                    {item.variantLabel && (
                      <span className="text-fg">{item.variantLabel} · </span>
                    )}
                    {item.unitLabel}
                  </p>
                  {item.seller && (
                    <p className="mt-0.5 truncate text-[11px] text-subtle">{item.seller}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => remove(item.key)}
                  className="text-[12px] text-muted"
                >
                  Hapus
                </button>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <p className="text-[13px] font-medium tabular-nums">
                  {formatIDR(item.unitPrice * item.qty)}
                </p>
                <Qty
                  value={item.qty}
                  min={0}
                  onChange={(n) => setQty(item.key, n)}
                />
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-8 rounded-xl bg-surface px-4 py-4 shadow-[var(--shadow-border)]">
        <div className="flex items-center justify-between text-[14px]">
          <span className="text-muted">Subtotal</span>
          <span className="tabular-nums">{formatIDR(total)}</span>
        </div>
        <p className="mt-2 text-[12px] text-subtle">
          Ongkir dihitung di checkout jika pilih diantar.
        </p>
      </div>

      <Link to="/checkout" className={buttonVariants({ size: "lg", className: "mt-5 w-full" })}>
        Checkout · {formatIDR(total)}
      </Link>
    </div>
  );
}
