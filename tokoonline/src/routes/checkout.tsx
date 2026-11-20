import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { formatIDR, todayPlus } from "@/lib/format";
import { SHOP, type Fulfillment, type PaymentMethod } from "@/lib/shop";
import { cartTotal, sellerGroups, submitOrderToServer, useShop } from "@/lib/store";
import { cn } from "@/lib/utils";
import {
  availableChannelsForSellers,
  usePaymentConfigs,
  type PaymentChannelView,
} from "@/lib/payment-config";

export const Route = createFileRoute("/checkout")({ component: Checkout });

const SLOTS = ["10.00–12.00", "12.00–15.00", "15.00–18.00", "18.00–20.00"];

function Checkout() {
  const cart = useShop((s) => s.cart);
  const placeOrder = useShop((s) => s.placeOrder);
  const navigate = useNavigate();
  const subtotal = cartTotal(cart);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [fulfillment, setFulfillment] = useState<Fulfillment>("delivery");
  const [date, setDate] = useState(todayPlus(SHOP.leadDays));
  const [slot, setSlot] = useState(SLOTS[1]);
  const [payment, setPayment] = useState<PaymentMethod>("transfer");
  const [selectedBankId, setSelectedBankId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const deliveryFee = fulfillment === "delivery" ? SHOP.deliveryFee : 0;
  const total = subtotal + deliveryFee;
  const minDate = todayPlus(SHOP.leadDays);
  // One basket, one payment — but the goods leave from more than one shop.
  const groups = sellerGroups(cart);
  const paymentConfigs = usePaymentConfigs();
  const configs = paymentConfigs.status === "loading" ? [] : paymentConfigs.configs;

  // Determine which sellers are in this basket.
  const sellerSlugs = [...new Set(cart.map((item) => item.tenant))];
  const availableChannels = availableChannelsForSellers(configs, sellerSlugs);

  // Ensure the selected payment method is still available.
  const availableIds = availableChannels.map((ch) => ch.id);
  const effectivePayment: PaymentMethod = availableIds.includes(payment) ? payment : ((availableIds[0] ?? "transfer") as PaymentMethod);
  const transferChannel = availableChannels.find((ch) => ch.id === "transfer");
  const transferBanks = transferChannel?.banks ?? [];

  // Ensure selected bank is valid.
  const effectiveBankId =
    selectedBankId && transferBanks.some((b) => b.id === selectedBankId)
      ? selectedBankId
      : transferBanks[0]?.id ?? "";

  if (cart.length === 0) {
    return (
      <div className="px-6 py-20 text-center">
        <p className="text-muted">Keranjang kosong.</p>
        <Link to="/katalog" className="mt-3 inline-block text-sm underline">
          Lihat katalog
        </Link>
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) {
      toast.error("Nama dan WhatsApp wajib diisi");
      return;
    }
    if (fulfillment === "delivery" && !address.trim()) {
      toast.error("Alamat pengantaran wajib diisi");
      return;
    }
    if (effectivePayment === "transfer" && !effectiveBankId) {
      toast.error("Pilih rekening bank untuk transfer");
      return;
    }

    // Save the local order first so the shopper has a reference even if the
    // server call fails.
    const order = placeOrder({
      customer: { name: name.trim(), phone: phone.trim(), address: address.trim() },
      fulfillment,
      date,
      slot,
      payment: effectivePayment,
      paymentBankId: effectivePayment === "transfer" ? effectiveBankId : undefined,
      notes: notes.trim(),
      sellerSlugs,
    });

    setSubmitting(true);
    try {
      // One payload shape for submit + retry, shared with the order page.
      // On success the local row gets its parentId/`synced`; on failure it
      // stays local-only and the order page offers a retry button.
      const synced = await submitOrderToServer(order);
      toast.success(
        synced.whatsapp === "sent"
          ? "Pesanan terkirim ke toko. Invoice juga dikirim ke WhatsApp Anda."
          : "Pesanan terkirim ke toko."
      );
    } catch (error) {
      toast.error(
        `Pesanan tersimpan lokal, tapi belum terkirim ke toko. Buka pesanan lalu ketuk Kirim ulang. ${error instanceof Error ? error.message : ""}`,
        { duration: 8000 }
      );
    } finally {
      setSubmitting(false);
    }

    navigate({ to: "/order/$id", params: { id: order.id } });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6 px-4 pt-2 pb-10">
      <div>
        <Link to="/cart" className="text-[13px] text-muted">
          ← Keranjang
        </Link>
        <h1 className="font-display mt-2 text-[28px] leading-none font-medium">
          Checkout
        </h1>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-[13px] font-medium tracking-wide text-muted">
          Pemesan
        </h2>
        <Field label="Nama">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            required
          />
        </Field>
        <Field label="WhatsApp">
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            placeholder="08…"
            required
          />
        </Field>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[13px] font-medium tracking-wide text-muted">
          Pengiriman
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["delivery", "Diantar"],
              ["pickup", "Ambil sendiri"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFulfillment(id)}
              className={cn(
                "h-11 rounded-md text-[14px] font-medium",
                fulfillment === id
                  ? "bg-primary text-primary-fg"
                  : "bg-surface shadow-[inset_0_0_0_1px_var(--color-line)]",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {fulfillment === "delivery" ? (
          <Field label={`Alamat (${SHOP.deliveryArea})`}>
            <Textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Nama jalan, nomor, patokan"
              required
            />
          </Field>
        ) : (
          <p className="rounded-md bg-surface px-3.5 py-3 text-[13px] leading-relaxed text-muted shadow-[inset_0_0_0_1px_var(--color-line)]">
            {SHOP.pickupNote}
          </p>
        )}
        <Field label="Tanggal">
          <Input
            type="date"
            min={minDate}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </Field>
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-muted">Jam</p>
          <div className="grid grid-cols-2 gap-2">
            {SLOTS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSlot(s)}
                className={cn(
                  "h-10 rounded-md text-[13px]",
                  slot === s
                    ? "bg-primary text-primary-fg"
                    : "bg-surface shadow-[inset_0_0_0_1px_var(--color-line)]",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </section>

      <PaymentSection
        channels={availableChannels}
        payment={effectivePayment as PaymentMethod}
        setPayment={setPayment}
        selectedBankId={effectiveBankId}
        setSelectedBankId={setSelectedBankId}
        transferBanks={transferBanks}
        sellerSlugs={sellerSlugs}
        qrisImageUrl={(slug: string) => paymentConfigs.qrisImageUrl(slug)}
        qrisAvailable={paymentConfigs.qrisAvailable()}
        fulfillment={fulfillment}
      />

      <Field label="Catatan">
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Catatan kirim, jam kantor, atau permintaan lain"
        />
      </Field>

      <div className="rounded-xl bg-surface px-4 py-4 shadow-[var(--shadow-border)]">
        {groups.map((group) => (
          <div key={group.seller} className="border-b border-line py-2 first:pt-0">
            <p className="text-[11px] tracking-[0.12em] text-subtle uppercase">
              Dikirim oleh {group.seller}
            </p>
            {group.lines.map((i) => (
              <div
                key={i.key}
                className="flex justify-between pt-1 text-[13px] text-muted"
              >
                <span>
                  {i.qty}× {i.name}
                  {i.variantLabel && ` · ${i.variantLabel}`} · {i.unitLabel}
                </span>
                <span className="tabular-nums">{formatIDR(i.unitPrice * i.qty)}</span>
              </div>
            ))}
            {groups.length > 1 && (
              <div className="flex justify-between pt-1 text-[12px] text-subtle">
                <span>Subtotal toko</span>
                <span className="tabular-nums">{formatIDR(group.subtotal)}</span>
              </div>
            )}
          </div>
        ))}
        <div className="mt-2 flex justify-between text-[13px]">
          <span className="text-muted">Ongkir</span>
          <span className="tabular-nums">
            {deliveryFee ? formatIDR(deliveryFee) : "—"}
          </span>
        </div>
        <div className="mt-2 flex items-baseline justify-between">
          <span className="text-[13px] text-muted">Total</span>
          <span className="font-display text-2xl tabular-nums">
            {formatIDR(total)}
          </span>
        </div>
        {groups.length > 1 && (
          <p className="mt-2 text-[12px] leading-relaxed text-subtle">
            Barang dari {groups.length} toko dikirim dari gudang masing-masing,
            dibayar sekali ke {SHOP.name}.
          </p>
        )}
      </div>

      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={(fulfillment === "delivery" && payment === "cash") || submitting}
      >
        {submitting ? "Mengirim pesanan…" : "Buat pesanan"}
      </Button>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Payment section — dynamic channels from the config                          */
/* -------------------------------------------------------------------------- */

function PaymentSection(props: {
  channels: PaymentChannelView[];
  payment: PaymentMethod;
  setPayment: (m: PaymentMethod) => void;
  selectedBankId: string;
  setSelectedBankId: (id: string) => void;
  transferBanks: { id: string; name: string; accountNumber: string; accountName: string }[];
  sellerSlugs: string[];
  qrisImageUrl: (slug: string) => string;
  qrisAvailable: boolean;
  fulfillment: Fulfillment;
}) {
  const {
    channels,
    payment,
    setPayment,
    selectedBankId,
    setSelectedBankId,
    transferBanks,
    sellerSlugs,
    qrisImageUrl,
    qrisAvailable,
    fulfillment,
  } = props;

  const channelLabel = (ch: PaymentChannelView) => {
    if (ch.id === "cash") return "Tunai saat ambil";
    if (ch.id === "transfer") return "Transfer Bank";
    if (ch.id === "qris") return "QRIS";
    return ch.label;
  };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[13px] font-medium tracking-wide text-muted">
        Pembayaran
      </h2>
      {channels.length === 0 && (
        <p className="text-[12px] text-subtle">
          Memuat metode pembayaran…
        </p>
      )}
      {channels.map((ch) => (
        <button
          key={ch.id}
          type="button"
          onClick={() => setPayment(ch.id as PaymentMethod)}
          className={cn(
            "flex h-12 items-center justify-between rounded-md px-3.5 text-left text-[14px]",
            payment === ch.id
              ? "bg-primary text-primary-fg"
              : "bg-surface shadow-[inset_0_0_0_1px_var(--color-line)]",
          )}
        >
          {channelLabel(ch)}
        </button>
      ))}

      {/* Transfer: bank selection */}
      {payment === "transfer" && transferBanks.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md bg-surface px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
          <p className="text-[12px] font-medium text-muted">Pilih rekening</p>
          {transferBanks.map((bank) => (
            <button
              key={bank.id}
              type="button"
              onClick={() => setSelectedBankId(bank.id)}
              className={cn(
                "flex items-center justify-between rounded-md px-3 py-2 text-left text-[13px]",
                selectedBankId === bank.id
                  ? "bg-primary/10 text-fg"
                  : "text-muted hover:bg-muted/10",
              )}
            >
              <span>
                {bank.name} — {bank.accountNumber}
              </span>
              <span className="text-[11px] text-subtle">{bank.accountName}</span>
            </button>
          ))}
        </div>
      )}

      {/* QRIS: show image from the first seller that has one */}
      {payment === "qris" && qrisAvailable && sellerSlugs.length > 0 && (
        <div className="flex flex-col items-center gap-2 rounded-md bg-surface px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
          <p className="text-[12px] font-medium text-muted">Pindai QRIS berikut</p>
          <img
            src={qrisImageUrl(sellerSlugs[0])}
            alt="QRIS pembayaran"
            className="max-h-64 w-auto rounded-md"
          />
        </div>
      )}
      {payment === "qris" && !qrisAvailable && (
        <p className="text-[12px] text-subtle">
          QRIS belum tersedia. Pilih transfer atau tunai.
        </p>
      )}

      {fulfillment === "delivery" && payment === "cash" && (
        <p className="text-[12px] text-muted">
          Tunai hanya untuk ambil di toko. Ganti ke transfer untuk pengantaran.
        </p>
      )}
    </section>
  );
}
