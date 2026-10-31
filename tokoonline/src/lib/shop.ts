/**
 * Storefront identity and the few settings that live on this side.
 *
 * Everything that belongs to a business — products, prices, stock, the seller's
 * name and the gudang that ships — comes from the API, per tenant. What stays
 * here is what no tenant models yet: opening hours, the delivery fee and the
 * bank accounts printed on the payment page.
 *
 * Those last two belong to the marketplace rather than to a seller: one basket
 * can hold goods from several shops, yet the shopper pays once and is charged
 * one ongkir, so the platform is the merchant of record and settles with each
 * seller afterwards. Pickup cannot work that way — nobody can hand over another
 * shop's parcel — which is why it points at the seller instead of an address.
 */
export const SHOP = {
  name: "Toko Bahan Kue",
  tagline: "Bahan kue, kemasan, dan kebutuhan dapur dari semua toko.",
  city: "Depok",
  /** The operator's own counter: CS, and pickup for the goods it sells itself. */
  atelier: "Thalia Toko Pusat, Jl. Arif Rahman Hakim No. 88, Depok",
  hours: "Senin–Sabtu, 08.00–20.00",
  closed: "Minggu 09.00–17.00",
  whatsapp: "6281210002277",
  /** Days between ordering and the parcel leaving the seller's gudang. */
  leadDays: 1,
  deliveryArea: "Jabodetabek",
  deliveryFee: 20_000,
  /** Where a shopper collects goods that another shop ships. */
  pickupNote:
    "Ambil di toko penjual. Alamat dan jam ambil dikonfirmasi lewat chat setelah pesanan dibuat.",
  /** Placeholders until the finance module owns payment instructions. */
  banks: [
    { id: "bca" as const, name: "BCA", account: "123 456 7890", holder: "Toko Bahan Kue" },
    { id: "mandiri" as const, name: "Mandiri", account: "987 654 3210", holder: "Toko Bahan Kue" },
  ],
};

export type BankId = (typeof SHOP.banks)[number]["id"];
export type PaymentMethod = BankId | "qris" | "cash";
export type Fulfillment = "delivery" | "pickup";

export function waLink(text?: string) {
  const base = `https://wa.me/${SHOP.whatsapp}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}
