import { createFileRoute, Link } from "@tanstack/react-router";
import { formatDateID, formatIDR } from "@/lib/format";
import { useShop, type OrderStatus } from "@/lib/store";
import { buttonVariants } from "@/components/ui/button";

export const Route = createFileRoute("/orders")({ component: OrdersPage });

const STATUS: Record<OrderStatus, string> = {
  waiting_payment: "Menunggu bayar",
  confirmed: "Dikonfirmasi",
  packing: "Disiapkan",
  shipped: "Dikirim",
  done: "Selesai",
};

function OrdersPage() {
  const orders = useShop((s) => s.orders);

  if (orders.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-8 py-20 text-center">
        <p className="font-display text-2xl">Belum ada pesanan</p>
        <p className="mt-2 text-[14px] text-muted">
          Pesanan tersimpan di perangkat ini.
        </p>
        <Link to="/katalog" className={buttonVariants({ className: "mt-6" })}>
          Lihat katalog
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-4 pt-2 pb-8">
      <h1 className="font-display text-[28px] leading-none font-medium">
        Pesanan
      </h1>
      <ul className="mt-3 flex flex-col gap-3">
        {orders.map((o) => (
          <li key={o.id}>
            <Link
              to="/order/$id"
              params={{ id: o.id }}
              className="block rounded-xl bg-surface px-4 py-4 shadow-[var(--shadow-border)]"
            >
              <div className="flex items-baseline justify-between">
                <p className="font-display text-lg">{o.id}</p>
                <span className="text-[12px] text-muted">
                  {STATUS[o.status]}
                </span>
              </div>
              <p className="mt-1 text-[13px] text-muted">
                {o.items.map((i) => i.name).join(", ")}
              </p>
              <div className="mt-2 flex justify-between text-[13px]">
                <span className="text-subtle">{formatDateID(o.date)}</span>
                <span className="tabular-nums">{formatIDR(o.total)}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
