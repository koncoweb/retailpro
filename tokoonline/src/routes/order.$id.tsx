import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { buttonVariants } from "@/components/ui/button";
import { formatDateID, formatIDR } from "@/lib/format";
import { SHOP, waLink } from "@/lib/shop";
import {
  API_BASE,
  submitOrderToServer,
  useShop,
  sellerGroups,
  type OrderStatus,
} from "@/lib/store";
import { usePaymentConfigs, type PaymentBank } from "@/lib/payment-config";

export const Route = createFileRoute("/order/$id")({ component: OrderPage });

const STATUS: Record<OrderStatus, string> = {
  pending_payment: "Menunggu pembayaran",
  waiting_payment: "Menunggu pembayaran",
  confirmed: "Dikonfirmasi",
  packing: "Sedang disiapkan dari gudang",
  shipped: "Dikirim",
  done: "Selesai",
  cancelled: "Dibatalkan",
  void: "Dibatalkan",
};

interface ServerOrderStatus {
  tenant: string;
  orderId: string;
  invoiceNumber: string;
  status: string;
  total: number;
  createdAt: string | null;
}

function OrderPage() {
  const { id } = Route.useParams();
  const order = useShop((s) => s.orders.find((o) => o.id === id));
  const [copied, setCopied] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [serverStatuses, setServerStatuses] = useState<ServerOrderStatus[]>([]);
  const paymentConfigs = usePaymentConfigs();
  const parentId = order?.parentId;

  // Poll the server for status updates when we have a parentId.
  useEffect(() => {
    if (!parentId) return;
    let live = true;

    async function poll() {
      if (!parentId) return;
      try {
        const response = await fetch(
          `${API_BASE}/api/storefront/orders?parent=${encodeURIComponent(parentId)}`,
        );
        if (!response.ok) return;
        const data = (await response.json()) as {
          parent: string;
          orders: ServerOrderStatus[];
        };
        if (live) setServerStatuses(data.orders ?? []);
      } catch {
        // Network error — keep showing the last known status.
      }
    }

    poll();
    const interval = setInterval(poll, 15_000);
    return () => {
      live = false;
      clearInterval(interval);
    };
  }, [parentId]);

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

  // Determine the effective status: server wins when available.
  const serverStatus = serverStatuses.find(
    (s) => s.status !== "cancelled" && s.status !== "void"
  ) ?? serverStatuses[0];
  const effectiveStatus: OrderStatus = serverStatus
    ? (serverStatus.status as OrderStatus)
    : order.status;

  // Resolve payment instructions from the config (fallback to SHOP.banks).
  const configs = paymentConfigs.status === "ready" ? paymentConfigs.configs : [];
  const sellerSlug = order.sellerSlugs?.[0] ?? order.items[0]?.tenant ?? "";
  const tenantConfig = configs.find((c) => c.tenant === sellerSlug);
  const transferBanks: PaymentBank[] =
    tenantConfig?.banks ??
    SHOP.banks.map((b) => ({
      id: b.id,
      name: b.name,
      accountNumber: b.account,
      accountName: b.holder,
    }));
  const selectedBank = transferBanks.find((b) => b.id === order.paymentBankId) ?? transferBanks[0];

  // The order was paid once, but each shop ships its own lines from its gudang.
  const groups = sellerGroups(order.items);
  const waText = `Halo CS Toko Bahan Kue, saya sudah memesan ${order.id} a.n. ${order.customer.name}, total ${formatIDR(order.total)}.`;

  async function copyRekening() {
    if (!selectedBank) return;
    await navigator.clipboard.writeText(selectedBank.accountNumber.replace(/\s/g, ""));
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  // The checkout POST failed before — resend the exact same order. Guard:
  // only while no parentId exists, so a retry can never duplicate a row.
  // `order` itself is still `Order | undefined` inside a hoisted function
  // declaration, so the narrowed row is captured first.
  const currentOrder = order;
  async function retrySend() {
    setRetrying(true);
    try {
      await submitOrderToServer(currentOrder);
      toast.success("Pesanan terkirim ke toko.");
    } catch (error) {
      toast.error(
        `Masih belum terkirim. ${error instanceof Error ? error.message : ""}`,
        { duration: 8000 }
      );
    } finally {
      setRetrying(false);
    }
  }

  const isWaitingPayment =
    effectiveStatus === "pending_payment" || effectiveStatus === "waiting_payment";

  return (
    <div className="flex flex-col gap-6 px-4 pt-4 pb-10">
      <div className="text-center">
        <p className="text-[12px] tracking-[0.2em] text-muted uppercase">
          Pesanan
        </p>
        <h1 className="font-display mt-1 text-[30px] leading-none">{order.id}</h1>
        <p className="mt-3 inline-flex rounded-full bg-surface px-3 py-1 text-[12px] text-fg shadow-[inset_0_0_0_1px_var(--color-line)]">
          {STATUS[effectiveStatus] ?? effectiveStatus}
        </p>
        {serverStatus && (
          <p className="mt-1 text-[11px] text-subtle">
            No. invoice: {serverStatus.invoiceNumber}
          </p>
        )}
      </div>

      {selectedBank && isWaitingPayment && order.payment !== "cash" && (
        <section className="rounded-xl bg-surface px-4 py-4 shadow-[var(--shadow-border)]">
          <p className="text-[13px] font-medium">Transfer {selectedBank.name}</p>
          <p className="mt-1 text-[12px] text-muted">a.n. {selectedBank.accountName}</p>
          <div className="mt-3 flex items-center justify-between">
            <p className="font-display text-[26px] tracking-wide tabular-nums">
              {selectedBank.accountNumber}
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
            Nominal {formatIDR(serverStatus?.total ?? order.total)}
          </p>
          <p className="mt-3 text-[12px] leading-relaxed text-subtle">
            Kirim bukti transfer via chat atau WhatsApp. Pembayaran otomatis
            menyusul.
          </p>
        </section>
      )}

      {/* QRIS image when the payment was QRIS */}
      {order.payment === "qris" && isWaitingPayment && tenantConfig?.qrisAvailable && (
        <section className="flex flex-col items-center gap-2 rounded-xl bg-surface px-4 py-4 shadow-[var(--shadow-border)]">
          <p className="text-[13px] font-medium">Pindai QRIS berikut</p>
          <img
            src={paymentConfigs.qrisImageUrl(sellerSlug)}
            alt="QRIS pembayaran"
            className="max-h-64 w-auto rounded-md"
          />
          <p className="text-[13px] tabular-nums">
            Nominal {formatIDR(serverStatus?.total ?? order.total)}
          </p>
        </section>
      )}

      {order.payment === "cash" && (
        <p className="rounded-xl bg-surface px-4 py-3 text-[13px] text-muted shadow-[var(--shadow-border)]">
          Bayar tunai saat ambil di toko penjual. Nomor pesanan menunjukkan
          barang mana yang diambil di toko mana.
        </p>
      )}

      {(effectiveStatus === "cancelled" || effectiveStatus === "void") && (
        <p className="rounded-xl bg-destructive/10 px-4 py-3 text-[13px] text-destructive shadow-[var(--shadow-border)]">
          Pesanan ini telah dibatalkan.
        </p>
      )}

      {!order.synced && (
        <section className="flex flex-col gap-2 rounded-xl bg-destructive/10 px-4 py-3 shadow-[var(--shadow-border)]">
          <p className="text-[13px] text-destructive">
            Pesanan ini belum terkirim ke toko. Cek koneksi lalu kirim ulang,
            atau kabari CS lewat WhatsApp.
          </p>
          <button
            type="button"
            onClick={retrySend}
            disabled={retrying}
            className={buttonVariants({ size: "sm", className: "w-fit" })}
          >
            {retrying ? "Mengirim ulang…" : "Kirim ulang pesanan"}
          </button>
        </section>
      )}

      {order.synced && order.whatsapp === "failed" && (
        <p className="rounded-xl bg-surface px-4 py-3 text-[13px] text-muted shadow-[var(--shadow-border)]">
          Invoice WhatsApp gagal terkirim ke nomor {order.customer.phone}. Tenang,
          pesanan tetap tercatat — kirim manual lewat tombol WhatsApp di bawah.
        </p>
      )}

      <section className="flex flex-col gap-1 text-[14px]">
        {groups.map((group) => (
          <div key={group.seller} className="border-b border-line py-2 last:border-0">
            <p className="text-[11px] tracking-[0.12em] text-subtle uppercase">
              {group.seller}
            </p>
            {group.lines.map((i) => (
              <div key={i.key} className="flex justify-between pt-1">
                <span className="text-muted">
                  {i.qty}× {i.name}
                  {i.variantLabel && ` · ${i.variantLabel}`} · {i.unitLabel}
                </span>
                <span className="tabular-nums">{formatIDR(i.unitPrice * i.qty)}</span>
              </div>
            ))}
          </div>
        ))}
        <div className="mt-2 flex justify-between border-t border-line pt-2">
          <span className="text-muted">Total</span>
          <span className="font-medium tabular-nums">
            {formatIDR(serverStatus?.total ?? order.total)}
          </span>
        </div>
      </section>

      <section className="text-[13px] leading-relaxed text-muted">
        <p>
          {order.fulfillment === "delivery" ? "Diantar ke" : "Ambil sendiri"}{" "}
          {order.fulfillment === "delivery"
            ? order.customer.address
            : "di toko penjual — alamat dikonfirmasi lewat chat"}
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
