import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { SHOP, waLink } from "@/lib/shop";
import { useShop } from "@/lib/store";

export const Route = createFileRoute("/info")({ component: InfoPage });

function InfoPage() {
  const orders = useShop((s) => s.orders);
  const theme = useShop((s) => s.theme);
  const toggleTheme = useShop((s) => s.toggleTheme);

  return (
    <div className="flex flex-col px-4 pt-4 pb-10">
      <div className="flex flex-col items-center pt-4 pb-8 text-center">
        <LogoMark className="size-28" />
        <h1 className="font-display mt-4 text-[28px] tracking-[0.18em]">
          THALIA
        </h1>
        <p className="mt-2 max-w-[30ch] text-[14px] leading-relaxed text-muted">
          Toko Bahan Kue di Depok. Bahan, cokelat, kemasan, dan perlengkapan
          dapur untuk dapur rumahan maupun usaha.
        </p>
      </div>

      <ul className="overflow-hidden rounded-xl bg-surface shadow-[var(--shadow-border)]">
        <Row to="/orders" label="Pesanan saya" hint={String(orders.length)} />
        <a
          href={waLink("Halo Thalia Toko Bahan Kue.")}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-between border-t border-line px-4 py-3.5"
        >
          <span className="text-[15px]">WhatsApp CS</span>
          <ChevronRight className="size-4 text-subtle" />
        </a>
        <button
          type="button"
          onClick={toggleTheme}
          className="flex w-full items-center justify-between border-t border-line px-4 py-3.5 text-left"
        >
          <span className="text-[15px]">Tampilan</span>
          <span className="text-[13px] text-muted">
            {theme === "dark" ? "Gelap" : "Terang"}
          </span>
        </button>
      </ul>

      <section className="mt-6 space-y-3 text-[14px] leading-relaxed text-muted">
        <p>
          <span className="font-medium text-fg">Jam</span>
          <br />
          {SHOP.hours}. {SHOP.closed}.
        </p>
        <p>
          <span className="font-medium text-fg">Toko</span>
          <br />
          {SHOP.atelier}
        </p>
        <p>
          <span className="font-medium text-fg">Pengiriman</span>
          <br />
          {SHOP.deliveryArea}. Pesanan online disiapkan dari gudang pusat,
          estimasi kirim H+{SHOP.leadDays} hari kerja.
        </p>
        <p>
          <span className="font-medium text-fg">Pembayaran</span>
          <br />
          Transfer BCA / Mandiri. QRIS dan gateway otomatis menyusul.
        </p>
        <p>
          <span className="font-medium text-fg">Katalog</span>
          <br />
          Produk, harga, dan stok di aplikasi ini dibaca langsung dari sistem
          toko Thalia Online. Perubahan dari back office langsung tampil di
          sini.
        </p>
      </section>
    </div>
  );
}

function Row({
  to,
  label,
  hint,
}: {
  to: "/orders";
  label: string;
  hint?: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center justify-between px-4 py-3.5"
    >
      <span className="text-[15px]">{label}</span>
      <span className="flex items-center gap-2 text-[13px] text-muted">
        {hint}
        <ChevronRight className="size-4 text-subtle" />
      </span>
    </Link>
  );
}
