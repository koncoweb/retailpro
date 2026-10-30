/**
 * Storefront identity and the few settings that live on this side.
 *
 * Everything that belongs to the business — products, prices, stock, the
 * branch name and the gudang that ships — comes from the API. What stays here
 * is what the back office does not model yet: opening hours, the delivery fee
 * and the bank accounts printed on the payment page.
 */
export const SHOP = {
  name: "Thalia",
  tagline: "Toko bahan kue di Depok.",
  city: "Depok",
  atelier: "Thalia Toko Pusat, Jl. Arif Rahman Hakim No. 88, Depok",
  hours: "Senin–Sabtu, 08.00–20.00",
  closed: "Minggu 09.00–17.00",
  whatsapp: "6281210002277",
  /** Days between ordering and the parcel leaving the gudang. */
  leadDays: 1,
  deliveryArea: "Depok & Jabodetabek",
  deliveryFee: 20_000,
  /** Placeholders until the finance module owns payment instructions. */
  banks: [
    { id: "bca" as const, name: "BCA", account: "123 456 7890", holder: "Thalia Toko Bahan Kue" },
    { id: "mandiri" as const, name: "Mandiri", account: "987 654 3210", holder: "Thalia Toko Bahan Kue" },
  ],
};

export type BankId = (typeof SHOP.banks)[number]["id"];
export type PaymentMethod = BankId | "qris" | "cash";
export type Fulfillment = "delivery" | "pickup";

export function waLink(text?: string) {
  const base = `https://wa.me/${SHOP.whatsapp}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}
