import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { formatDateID, formatIDR } from "@/lib/format";
import { SHOP } from "@/lib/shop";
import { useShop, type OrderStatus } from "@/lib/store";
import { buttonVariants } from "@/components/ui/button";

export const Route = createFileRoute("/orders")({ component: OrdersPage });

/** Where the back-office API listens (same origin logic as `catalog.ts`). */
const API_BASE = (
  (import.meta.env.VITE_CATALOG_API_URL as string | undefined) ?? "http://localhost:3000"
).replace(/\/+$/, "");

const STATUS: Record<OrderStatus, string> = {
  pending_payment: "Menunggu bayar",
  waiting_payment: "Menunggu bayar",
  confirmed: "Dikonfirmasi",
  packing: "Disiapkan",
  shipped: "Dikirim",
  done: "Selesai",
  cancelled: "Dibatalkan",
  void: "Dibatalkan",
};

interface ServerStatus {
  parentId: string;
  statuses: Map<string, string>; // orderId → status
}

function OrdersPage() {
  const orders = useShop((s) => s.orders);
  const [serverStatuses, setServerStatuses] = useState<Map<string, string>>(new Map());

  // Poll server status for every order that has a parentId.
  useEffect(() => {
    const parentIds = [...new Set(orders.filter((o) => o.parentId).map((o) => o.parentId!))];
    if (parentIds.length === 0) return;
    let live = true;

    async function poll() {
      const merged = new Map<string, string>();
      for (const parentId of parentIds) {
        try {
          const response = await fetch(
            `${API_BASE}/api/storefront/orders?parent=${encodeURIComponent(parentId)}`,
          );
          if (!response.ok) continue;
          const data = (await response.json()) as {
            parent: string;
            orders: { orderId: string; status: string }[];
          };
          for (const o of data.orders ?? []) {
            merged.set(o.orderId, o.status);
          }
        } catch {
          // Network error — keep showing local status.
        }
      }
      if (live) setServerStatuses(merged);
    }

    poll();
    const interval = setInterval(poll, 30_000);
    return () => {
      live = false;
      clearInterval(interval);
    };
  }, [orders]);

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
        {orders.map((o) => {
          // Server status wins over localStorage for orders with a parentId.
          const serverStatus = o.parentId
            ? serverStatuses.get(o.id)
            : undefined;
          const displayStatus = (serverStatus ?? o.status) as OrderStatus;
          return (
          <li key={o.id}>
            <Link
              to="/order/$id"
              params={{ id: o.id }}
              className="block rounded-xl bg-surface px-4 py-4 shadow-[var(--shadow-border)]"
            >
              <div className="flex items-baseline justify-between">
                <p className="font-display text-lg">{o.id}</p>
                <span className="text-[12px] text-muted">
                  {STATUS[displayStatus] ?? displayStatus}
                </span>
              </div>
              <p className="mt-1 text-[13px] text-muted">
                {o.items
                  .map((i) => (i.variantLabel ? `${i.name} (${i.variantLabel})` : i.name))
                  .join(", ")}
              </p>
              <div className="mt-2 flex justify-between text-[13px]">
                <span className="text-subtle">
                  {formatDateID(o.date)} ·{" "}
                  {new Set(o.items.map((i) => i.seller ?? SHOP.name)).size} toko
                </span>
                <span className="tabular-nums">{formatIDR(o.total)}</span>
              </div>
            </Link>
          </li>
          );
        })}
      </ul>
    </div>
  );
}
