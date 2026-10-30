import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { formatIDR, todayPlus } from "@/lib/format";
import { SHOP, type Fulfillment, type PaymentMethod } from "@/lib/shop";
import { cartTotal, useShop } from "@/lib/store";
import { cn } from "@/lib/utils";

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
  const [payment, setPayment] = useState<PaymentMethod>("bca");
  const [notes, setNotes] = useState("");

  const deliveryFee = fulfillment === "delivery" ? SHOP.deliveryFee : 0;
  const total = subtotal + deliveryFee;
  const minDate = todayPlus(SHOP.leadDays);

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

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) {
      toast.error("Nama dan WhatsApp wajib diisi");
      return;
    }
    if (fulfillment === "delivery" && !address.trim()) {
      toast.error("Alamat pengantaran wajib diisi");
      return;
    }
    const order = placeOrder({
      customer: { name: name.trim(), phone: phone.trim(), address: address.trim() },
      fulfillment,
      date,
      slot,
      payment,
      notes: notes.trim(),
    });
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
            {SHOP.atelier}. Tunjukkan nomor pesanan saat mengambil di toko.
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

      <section className="flex flex-col gap-3">
        <h2 className="text-[13px] font-medium tracking-wide text-muted">
          Pembayaran
        </h2>
        <p className="text-[12px] leading-relaxed text-subtle">
          Gateway otomatis (QRIS, kartu, VA) menyusul. Sementara transfer manual
          atau tunai di toko.
        </p>
        {(
          [
            ["bca", "Transfer BCA"],
            ["mandiri", "Transfer Mandiri"],
            ["qris", "QRIS — segera"],
            ["cash", "Tunai saat ambil"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            disabled={id === "qris"}
            onClick={() => setPayment(id)}
            className={cn(
              "flex h-12 items-center justify-between rounded-md px-3.5 text-left text-[14px]",
              payment === id
                ? "bg-primary text-primary-fg"
                : "bg-surface shadow-[inset_0_0_0_1px_var(--color-line)]",
              id === "qris" && "opacity-45",
            )}
          >
            {label}
            {id === "qris" && (
              <span className="text-[11px] tracking-wide">SOON</span>
            )}
          </button>
        ))}
        {fulfillment === "delivery" && payment === "cash" && (
          <p className="text-[12px] text-muted">
            Tunai hanya untuk ambil di toko. Ganti ke transfer untuk pengantaran.
          </p>
        )}
      </section>

      <Field label="Catatan">
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Catatan kirim, jam kantor, atau permintaan lain"
        />
      </Field>

      <div className="rounded-xl bg-surface px-4 py-4 shadow-[var(--shadow-border)]">
        {cart.map((i) => (
          <div
            key={i.key}
            className="flex justify-between py-1 text-[13px] text-muted"
          >
            <span>
              {i.qty}× {i.name} · {i.unitLabel}
            </span>
            <span className="tabular-nums">{formatIDR(i.unitPrice * i.qty)}</span>
          </div>
        ))}
        <div className="mt-2 flex justify-between border-t border-line pt-2 text-[13px]">
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
      </div>

      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={fulfillment === "delivery" && payment === "cash"}
      >
        Buat pesanan
      </Button>
    </form>
  );
}
