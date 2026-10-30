import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { formatDateID, formatIDR } from "@/lib/format";
import { SHOP, waLink } from "@/lib/shop";
import { useShop, type OrderStatus } from "@/lib/store";

export const Route = createFileRoute("/order/$id")({ component: OrderPage });

const STATUS: Record<OrderStatus, string> = {
  waiting_payment: "Menunggu pembayaran",
  confirmed: "Dikonfirmasi",
  packing: "Sedang disiapkan dari gudang",
  shipped: "Dikirim",
  done: "Selesai",
};

function OrderPage() {
  const { id } = Route.useParams();
  const order = useShop((s) => s.orders.find((o) => o.id === id));
  const [copied, setCopied] = useState(false);

  if (!order) {
    return (
      <div className="px-6 py-20 text-center">
        <p className="text-muted">Pesanan tidak ditemukan di perangkat ini.</p>
        <Link to="/orders" className="mt-3 inline-block text-sm underline">
          Riwayat pesanan
        </Link>
      </div>
    );
  }

  const bank = SHOP.banks.find((b) => b.id === order.payment);
  const waText = `Halo Thalia Toko Bahan Kue, saya sudah memesan ${order.id} a.n. ${order.customer.name}, total ${formatIDR(order.total)}.`;

  async function copyRekening() {
    if (!bank) return;
    await navigator.clipboard.writeText(bank.account.replace(/\s/g, ""));
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="flex flex-col gap-6 px-4 pt-4 pb-10">
      <div className="text-center">
        <p className="text-[12px] tracking-[0.2em] text-muted uppercase">
          Pesanan
        </p>
        <h1 className="font-display mt-1 text-[30px] leading-none">{order.id}</h1>
        <p className="mt-3 inline-flex rounded-full bg-surface px-3 py-1 text-[12px] text-fg shadow-[inset_0_0_0_1px_var(--color-line)]">
          {STATUS[order.status]}
        </p>
      </div>

      {bank && order.status === "waiting_payment" && (
        <section className="rounded-xl bg-surface px-4 py-4 shadow-[var(--shadow-border)]">
          <p className="text-[13px] font-medium">Transfer {bank.name}</p>
          <p className="mt-1 text-[12px] text-muted">a.n. {bank.holder}</p>
          <div className="mt-3 flex items-center justify-between">
            <p className="font-display text-[26px] tracking-wide tabular-nums">
              {bank.account}
            </p>
            <button
              type="button"
              onClick={copyRekening}
              className="grid size-11 place-items-center text-fg"
              aria-label="Salin rekening"
            >
              {copied ? (
                <Check className="size-4" />
              ) : (
                <Copy className="size-4" />
              )}
            </button>
          </div>
          <p className="mt-2 text-[13px] tabular-nums">
            Nominal {formatIDR(order.total)}
          </p>
          <p className="mt-3 text-[12px] leading-relaxed text-subtle">
            Kirim bukti transfer via chat atau WhatsApp. Pembayaran otomatis
            menyusul.
          </p>
        </section>
      )}

      {order.payment === "cash" && (
        <p className="rounded-xl bg-surface px-4 py-3 text-[13px] text-muted shadow-[var(--shadow-border)]">
          Bayar tunai saat ambil di {SHOP.atelier}.
        </p>
      )}

      <section className="flex flex-col gap-1 text-[14px]">
        {order.items.map((i) => (
          <div key={i.key} className="flex justify-between py-1">
            <span className="text-muted">
              {i.qty}× {i.name} · {i.unitLabel}
            </span>
            <span className="tabular-nums">{formatIDR(i.unitPrice * i.qty)}</span>
          </div>
        ))}
        <div className="mt-2 flex justify-between border-t border-line pt-2">
          <span className="text-muted">Total</span>
          <span className="font-medium tabular-nums">{formatIDR(order.total)}</span>
        </div>
      </section>

      <section className="text-[13px] leading-relaxed text-muted">
        <p>
          {order.fulfillment === "delivery" ? "Diantar ke" : "Ambil di toko"}{" "}
          {order.fulfillment === "delivery"
            ? order.customer.address
            : SHOP.atelier}
        </p>
        <p className="mt-1">
          {formatDateID(order.date)} · {order.slot}
        </p>
        <p className="mt-1">{order.customer.name} · {order.customer.phone}</p>
      </section>

      <div className="grid gap-2">
        <a
          href={waLink(waText)}
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ size: "lg", className: "w-full" })}
        >
          WhatsApp CS
        </a>
        <Link
          to="/chat"
          className={buttonVariants({
            variant: "outline",
            size: "lg",
            className: "w-full",
          })}
        >
          Chat di aplikasi
        </Link>
        <Link
          to="/"
          className={buttonVariants({ variant: "ghost", className: "w-full" })}
        >
          Kembali ke beranda
        </Link>
      </div>
    </div>
  );
}
