import { SHOP } from "./shop";
import { formatIDR } from "./format";
import { fromPrice, isSoldOut, type Product } from "./products";

export const QUICK = [
  "Jam buka",
  "Stok barang",
  "Pengiriman",
  "Cara bayar",
  "Status pesanan",
];

function has(question: string, words: string[]) {
  return words.some((word) => question.includes(word));
}

/**
 * Canned replies for the chat panel. `products` is the live catalogue, so a
 * question about stock or price answers with what the gudang actually holds
 * instead of a hard-coded menu.
 */
export function replyTo(raw: string, products: Product[] = []): string {
  const q = raw.toLowerCase();

  if (has(q, ["halo", "hai", "hi", "hello", "pagi", "siang", "sore", "malam"])) {
    return "Halo, terima kasih sudah menghubungi Thalia Toko Bahan Kue. Mau cari bahan, kemasan, atau perlengkapan?";
  }

  if (has(q, ["jam", "buka", "tutup", "operasional"])) {
    return `Kami buka ${SHOP.hours}, ${SHOP.closed.toLowerCase()}. Pesanan online diproses hari kerja dan dikirim dari Gudang Pusat Depok.`;
  }

  if (has(q, ["stok", "tersedia", "kosong", "habis", "ready"])) {
    if (products.length === 0) {
      return "Katalog sedang dimuat. Coba buka lagi halaman katalog sebentar lagi.";
    }
    const out = products.filter(isSoldOut);
    const thin = products.filter((product) => product.lowStock && !isSoldOut(product));
    if (out.length > 0) {
      return `Saat ini kosong: ${out
        .slice(0, 4)
        .map((product) => product.name)
        .join(", ")}. Stok gudang bertambah tiap kiriman supplier — titip nomor WhatsApp untuk kabar masuknya.`;
    }
    if (thin.length > 0) {
      return `Stok gudang tinggal sedikit untuk ${thin
        .slice(0, 4)
        .map((product) => product.name)
        .join(", ")}. Sisanya tersedia hari ini.`;
    }
    return `Semua ${products.length} produk tersedia di Gudang Pusat Depok hari ini.`;
  }

  if (has(q, ["kirim", "antar", "delivery", "ongkir", "alamat", "pickup", "ambil"])) {
    return `Pengantaran ${SHOP.deliveryArea}, ongkir ${formatIDR(SHOP.deliveryFee)}. Bisa juga ambil sendiri di ${SHOP.atelier}.`;
  }

  if (has(q, ["bayar", "transfer", "qris", "rekening", "payment", "va", "tunai"])) {
    return `Sementara transfer BCA ${SHOP.banks[0].account} a.n. ${SHOP.banks[0].holder} atau Mandiri ${SHOP.banks[1].account}, atau tunai saat ambil di toko. QRIS dan pembayaran otomatis menyusul.`;
  }

  if (has(q, ["status", "pesanan", "order", "lacak", "tracking"])) {
    return "Cek halaman Pesanan di aplikasi untuk nomor THL-…. Jika sudah transfer, kirim bukti ke chat ini atau WhatsApp — pesanan langsung kami siapkan dari gudang.";
  }

  if (has(q, ["harga", "price", "berapa", "katalog", "menu", "produk"])) {
    if (products.length === 0) return "Katalog sedang dimuat, sebentar lagi ya.";
    const low = Math.min(...products.map(fromPrice));
    return `Katalog lengkap ada di halaman Katalog: ${products.length} produk, harga mulai ${formatIDR(low)}. Harga per kg, per karung, atau per dus tergantung satuannya.`;
  }

  if (has(q, ["grosir", "partai", "banyak", "diskon"])) {
    return "Untuk pembelian partai (karung 25 kg, dus, atau loyang banyak) harga satuannya lebih murah dan sudah tertera di halaman produk. Order di atas 20 karung, hubungi WhatsApp untuk penawaran.";
  }

  if (has(q, ["lokasi", "mana", "maps", "toko", "gudang", "alamat"])) {
    return `Toko kami di ${SHOP.atelier}. Gudang pusatnya di Depok, jadi pesanan online dikirim dari sana.`;
  }

  if (has(q, ["terima kasih", "makasih", "thanks", "ok", "oke", "siap"])) {
    return "Sama-sama. Kalau sudah siap, pilih bahannya di katalog — kami siapkan dan kirim dari gudang.";
  }

  return `Kami catat pesan Anda. Untuk jawaban lebih cepat, lanjutkan ke WhatsApp Thalia atau pilih salah satu topik di atas. Tim kami membalas pada ${SHOP.hours}.`;
}
