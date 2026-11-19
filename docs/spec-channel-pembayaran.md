# Spesifikasi: Pengaturan Channel Pembayaran & Integrasi Toko Online

| | |
|---|---|
| Dokumen | `docs/spec-channel-pembayaran.md` |
| Terakhir diperbarui | **2026-11-19** |
| Status | **Beku** (desain dikunci setelah implementasi selesai) |
| Skema | `schema_version = 12` (`db/migrations/012_payment_channels.sql`) |
| Rilis | `[b14f89b]` — lihat [CHANGELOG.md](../CHANGELOG.md) |

---

## 0. Ringkasan keputusan

| # | Keputusan | Alternatif yang ditolak | Alasan |
|---|---|---|---|
| 1 | **Fee = biaya merchant internal** | Surcharge ke customer | Customer membayar total yang sama; nominal fee dihitung saat transaksi dan disimpan di `transactions.fee_amount` untuk laporan bersih |
| 2 | **QRIS statis** | Gateway QRIS dinamis (Midtrans/Xendit) | Satu gambar diunggah owner, ditampilkan di kasir + checkout + halaman order. Overkill untuk tahap ini; kolom `payment_method`/`fee_*`/`source` sudah mengakomodasi perluasan channel tanpa breaking change |
| 3 | **Sinkronisasi penuh toko online** | Konfigurasi saja tanpa sync order | Order dari tokoonline dikirim ke server, dipecah per seller ke `storefront_orders` di DB masing-masing tenant; saat penjual mengonfirmasi pembayaran, sistem menulis baris `transactions` + mengurangi stok gudang dalam satu transaksi atomik |
| 4 | **Sumber kebenaran tunggal: `tenants.settings`** | Tabel `payment_channels` baru di DB tenant | Semua pengaturan tenant sudah menjadi kunci JSON di `tenants.settings`; tabel baru memecah pola dan butuh sinkronisasi dua sumber |
| 5 | **Gambar QRIS di kolom `tenants.qris_image`** | File di filesystem/public | Serverless Vercel tidak punya disk persisten; base64 di kolom sendiri cocok dengan arsitektur Turso |
| 6 | **Order `pending_payment` sampai dikonfirmasi** | Langsung menulis `transactions` saat place order | Uang belum tentu masuk; status `pending_payment` + konfirmasi eksplisit menjaga validitas laporan pendapatan |
| 7 | **Tidak ada impor lintas-app tokoonline → parent** | Shared package | `tokoonline/` aplikasi terpisah (TanStack Router + zustand, tanpa kredensial DB); tipe channel diduplikasi minimal sebagai JSON dari server |

---

## 1. Skema database (v11 → v12)

### 1.1 Migrasi: `db/migrations/012_payment_channels.sql`

```sql
ALTER TABLE transactions ADD COLUMN fee_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN fee_label TEXT;
ALTER TABLE transactions ADD COLUMN source TEXT NOT NULL DEFAULT 'pos';
ALTER TABLE tenants ADD COLUMN qris_image TEXT;

CREATE TABLE IF NOT EXISTS storefront_orders (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  parent_id TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  shop_name TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  customer_address TEXT,
  fulfillment TEXT CHECK(fulfillment IN ('pickup','delivery')),
  slot TEXT,
  notes TEXT,
  payment_channel TEXT,
  payment_bank_id TEXT,
  items TEXT NOT NULL,           -- JSON snapshot
  subtotal INTEGER DEFAULT 0,
  shipping INTEGER DEFAULT 0,
  total INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending_payment'
    CHECK(status IN ('pending_payment','confirmed','packing','shipped','done','cancelled','void')),
  cancel_reason TEXT,
  confirmed_at TEXT,
  confirmed_by TEXT,
  transaction_id TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_sf_orders_parent ON storefront_orders(parent_id);
CREATE INDEX IF NOT EXISTS idx_sf_orders_status ON storefront_orders(status);
CREATE INDEX IF NOT EXISTS idx_sf_orders_created ON storefront_orders(created_at);
```

### 1.2 `db/schema/tenant.sql`

Semua objek di atas ditambahkan dengan `IF NOT EXISTS` sehingga `tenant.sql` tetap idempoten.
`schema_version` di-`INSERT OR IGNORE` ke `12`.

### 1.3 Kolom `storefront_orders.items` (JSON snapshot)

```json
[
  {
    "product_id": "uuid",
    "variant_id": "uuid",
    "unit_name": "kg",
    "conversion_factor": 1.0,
    "qty": 2,
    "unit_price": 15000
  }
]
```

Snapshot harga saat order dibuat; harga dihitung ulang server-side dari `product_units`/`product_variants`
(jangan percaya harga dari browser).

---

## 2. Lib sumber kebenaran: `src/lib/payment-channels.ts`

### 2.1 Tipe data

```ts
type FeeSpec = { type: "flat"; value: number } | { type: "percent"; value: number };

interface PaymentChannel {
  id: string;            // "cash" | "qris" | "transfer"
  label: string;         // Indonesia-first
  enabled: boolean;
  fee?: FeeSpec;         // biaya merchant; tidak mengubah tagihan customer
  bankIds?: string[];    // channel "transfer": id rekening dari settings "bank"
}

interface PaymentChannelsConfig {
  channels: PaymentChannel[];
  updated_at?: string;
}
```

### 2.2 Fungsi

| Fungsi | Perilaku |
|---|---|
| `normalizeChannels(raw)` | Toleran terhadap data rusak/kosong → `DEFAULT_CHANNELS`: `[cash (fee 0), transfer (bankIds dari settings bank), qris]` |
| `computeMerchantFee(channel, total)` | `Math.round`; percent → `total * value/100` |
| `CHANNEL_PAYMENT_METHOD` | Pemetaan channel → nilai `transactions.payment_method`: `cash→'cash'`, `transfer→'transfer'`, `qris→'qris'` |

### 2.3 Konstanta

| Nama | Nilai | Catatan |
|---|---|---|
| `PAYMENT_CHANNELS_SETTING_KEY` | `"payment_channels"` | Kunci di `tenants.settings` |
| `QRIS_MIN_PX` | `600` | Lebar minimum gambar QRIS agar bisa dipindai |
| `QRIS_MAX_DATA_URL_BYTES` | `400_000` | Cap server; klien resize ke 720px → `image/webp, 0.85` |

### 2.4 `PAYMENT_LABELS` (receipt-doc.ts)

```ts
{ cash: 'Tunai', transfer: 'Transfer Bank', qris: 'QRIS', card: 'Kartu', ewallet: 'E-Wallet' }
```

---

## 3. API

### 3.1 Publik (dipakai tokoonline, tanpa sesi)

| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/storefront/channels?slug=` | Baca `settings.payment_channels` + daftar rekening `settings.bank` (hanya `name`, nomor & nama rekening) milik satu tenant; `qris: boolean` (apakah `tenants.qris_image` terisi). `Cache-Control: public, max-age=60` |
| GET | `/api/storefront/channels` | Agregat semua tenant aktif (fans-out sekuensial seperti marketplace, tenant gagal → skip) |
| GET | `/api/storefront/qris?slug=` | Respons `image/webp` biner dari `tenants.qris_image` (strip prefix data URL; 404 bila kosong) |
| POST | `/api/storefront/orders` | Validasi per-seller items + customer + fulfillment; **harga dihitung ulang server-side**; hasil: `201 { parentId, orders: [{tenant, orderId, shopName, total, status, payment}] }`. Tidak mengurangi stok |
| GET | `/api/storefront/orders?parent=` | Status publik per split (`status`, `total`, tanpa data pribadi pembeli) |

### 3.2 Terautentikasi (dipakai back office, `requireTenantSession`)

| Method | Path | Fungsi |
|---|---|---|
| POST | `/api/tenant/qris-image` | `{ dataUrl }` → tolak > `QRIS_MAX_DATA_URL_BYTES`, validasi prefix `data:image/` → `UPDATE tenants SET qris_image` |
| DELETE | `/api/tenant/qris-image` | Set NULL |
| POST | `/api/tenant/orders/confirm` | `{ orderId }` → dalam SATU `runTransaction`: cek stok gudang online, kurangi stok per item, INSERT `transactions` (`source='online'`, `fee_amount` dari config), UPDATE `storefront_orders` → `confirmed` + `transaction_id`. Kegagalan stok → 409 |
| POST | `/api/tenant/orders/status` | `{ orderId, status, reason? }` → transisi `packing\|shipped\|done\|cancel`; cancel butuh alasan |

---

## 4. Alur data

### 4.1 Place order (tokoonline → server)

```
checkout.tsx
  1. simpan order lokal (zustand)
  2. POST /api/storefront/orders
     body: { items: [{tenant, productId, variantId, unitName, qty}],
             customer: {name, phone, address?},
             fulfillment, slot, notes, paymentChannel, paymentBankId }
  3. server: hitung ulang harga dari product_units/product_variants
  4. server: split per seller → INSERT storefront_orders (status = 'pending_payment')
  5. respons: 201 { parentId, orders: [{tenant, orderId, shopName, total, status, payment}] }
  6. klien: patch order lokal dengan parentId
  7. gagal kirim → toast "pesanan belum terkirim ke toko" + tombol coba lagi
```

### 4.2 Konfirmasi pembayaran (back office → DB tenant)

```
StorefrontOrders.tsx → POST /api/tenant/orders/confirm { orderId }
  server:
    1. mintTenantToken(db_name)
    2. BEGIN TRANSACTION
       a. SELECT storefront_orders WHERE id = orderId AND status = 'pending_payment'
       b. parse items JSON
       c. per item: cek stok gudang online (product_batches, warehouse fulfillment)
       d. getStockIssueMethod() → sortBatchesForIssue()
       e. UPDATE product_batches SET quantity_current -= qty * conversion_factor
       f. INSERT transactions (source='online', fee_amount, payment_method dari channel)
       g. INSERT transaction_items
       h. UPDATE storefront_orders SET status='confirmed', transaction_id, confirmed_at, confirmed_by
       i. logAuditTx('checkout', { fee, source, ... })
    3. COMMIT
  → 409 bila stok kurang (tidak ada sebagian yang tertulis)
```

### 4.3 Ongkir marketplace

Ongkir yang dipungut tokoonline **tidak masuk** ke transaksi tenant. Transaksi tenant hanya mencatat
`subtotal` seller (nilai barang yang dijual). Selisih ongkir menjadi pendapatan platform dan dicatat
terpisah di control DB (di luar cakupan rilis ini).

---

## 5. Pengaturan UI (owner)

### 5.1 `PaymentChannelSettings.tsx`

- Satu kartu per channel: **Tunai** / **Transfer Bank** / **QRIS**
- `Switch` aktif/nonaktif; input fee: pilihan tipe (`Flat Rp` | `%`) + nilai
- Cash selalu fee 0 (disabled)
- Transfer Bank: checkbox rekening dari settings `"bank"` (BankSettings tetap sumber nomor rekening)
- QRIS: pratinjau gambar, tombol **Unggah** (validasi tipe + ukuran ≤2 MB → resize canvas 720px → `toDataURL("image/webp", 0.85)` → `POST /api/tenant/qris-image`), tombol **Hapus**
- Simpan via `setTenantSetting(PAYMENT_CHANNELS_SETTING_KEY, cfg)` + `invalidateTenantSettings()`

### 5.2 Tab baru di `Settings.tsx`

```tsx
<TabsTrigger value="payments">
  <QrCode className="size-4" /> Pembayaran
</TabsTrigger>
```

Dibungkus `<EditableSection editable={editable}>`.

---

## 6. Kasir (POS)

### 6.1 `POS.tsx`

- Hapus konstanta `banks` hardcoded → muat `readTenantSetting("bank", [...fallback lama])` +
  `readTenantSetting(PAYMENT_CHANNELS_SETTING_KEY, null)` → `normalizeChannels`, sekali per mount
- `handlePaymentComplete`: terima `fee` + `method` final dari modal; INSERT `transactions` dengan
  `fee_amount, fee_label, source='pos'`; fee masuk `details` audit `checkout`

### 6.2 `PaymentModal.tsx`

- Render tab dari `channels` yang aktif saja (cash / transfer / qris)
- Kartu & e-wallet lama dihapus dari UI; nilai `'debit'/'credit'/'ewallet'` historis tetap tampil
  benar di laporan
- Tab Transfer: dropdown bank dari config + baris "Biaya merchant: Rp X"
- Tab QRIS: `<img src="/api/tenant/qris-image">` (endpoint terautentikasi) + tombol "Perbesar" Dialog
- Jika gambar belum diunggah → placeholder + teks "Gambar QRIS belum diunggah owner"
- Payload `PaymentDetails` bertambah: `{ method, fee, feeLabel, bank? }`

---

## 7. Toko online (`tokoonline/`)

### 7.1 `payment-config.ts`

- `usePaymentConfigs()` — fetch `GET {API_BASE}/api/storefront/channels` (agregat) sekali per load
  dengan module-level cache (pola `catalog.ts`); fail-soft ke `DEFAULT_CONFIG` saat API mati
- `availableChannelsForSellers(configs, slugs)` — channel hanya ditawarkan bila SETIAP seller punya
  channel itu aktif; QRIS tambahan butuh setidaknya satu seller dengan gambar terunggah

### 7.2 `checkout.tsx`

- Daftar metode bayar dirender dari config per seller (union channel)
- Pilih transfer → tampilkan nomor rekening asli dari tenant
- Pilih QRIS → tampilkan `<img src={API_BASE}/api/storefront/qris?slug=...>` per seller
- `placeOrder`: simpan order lokal → `POST /api/storefront/orders` → simpan `parentId`; gagal kirim →
  toast peringatan + tombol coba lagi

### 7.3 `order.$id.tsx` & `orders.tsx`

- Polling `GET /api/storefront/orders?parent=` setiap 15 detik (detail) / 30 detik (daftar)
- Status server menang atas localStorage untuk order yang punya `parentId`
- Instruksi bayar dari config (rekening asli + gambar QRIS statis), bukan `SHOP.banks` hardcoded

### 7.4 `store.ts` (zustand)

- `Order += parentId?: string, sellerSlugs?: string[], paymentBankId?: string`
- `OrderStatus` ditambah `'pending_payment' | 'cancelled' | 'void'`
- `version: 4` + `migrate`: `waiting_payment → pending_payment`

---

## 8. Laporan & rekonsiliasi

### 8.1 Z-report (KS-43)

Bucket `transfer` eksplisit di SQL rincian metode; bucket "Lainnya" dihitung:

```
other = total − (cash + transfer + card + ewallet + qris)
```

Sehingga `transfer` tidak hilang dari Z-report dan rekonsiliasi tetap menutup.

### 8.2 `SalesReport.tsx` / `Reports.tsx`

- Ekspor Excel menambah kolom **"Biaya Merchant"** (`fee_amount`) dan **"Kanal"** (`source`)
- Agregasi pendapatan bersih = `SUM(total_amount − fee_amount)` di kartu ringkasan

### 8.3 `RecentTransactions.tsx`

- Ikon `Landmark` untuk `transfer`, `QrCode` untuk `qris`
- Badge **"Online"** saat `source = 'online'`

---

## 9. UI back office order online

### 9.1 `StorefrontOrders.tsx`

- Route `/backoffice/storefront-orders`, guard `view_finance`
- Daftar order `pending_payment..done`, filter status
- Detail dialog: item JSON, customer info, payment channel, total
- Aksi: **Konfirmasi Pembayaran** → `POST /api/tenant/orders/confirm`; **Kirim/Selesai** → `POST /api/tenant/orders/status`; **Batalkan** (alasan wajib) → `POST /api/tenant/orders/status` dengan `status: 'cancel'`

### 9.2 Sidebar

- Grup baru **"Toko Online"** (ikon `ShoppingBag`, `view_finance`) sebelum "Pengaturan"
- Entri: **"Pesanan Online"** → `/backoffice/storefront-orders`

---

## 10. Batas kepercayaan

### 10.1 Endpoint publik

`POST /api/storefront/orders` tanpa auth tetap: payload tervalidasi ketat, harga dihitung server,
order `pending_payment` tidak mempengaruhi stok/laporan sampai dikonfirmasi; pembatalan massal tersedia.
CORS-wide (seperti katalog) — header Origin tidak diperiksa karena ini endpoint publik.

### 10.2 Order lintas-seller

Split server-side per tenant dengan token mint per tenant (pola marketplace); ongkir platform tidak
masuk transaksi tenant dan dicatat sebagai eksklisit di spec (§4.3).

### 10.3 Gambar QRIS

Cap 400 KB data URL + resize 720px klien; disimpan di kolom `tenants.qris_image` terpisah dari
dokumen `settings` agar tidak membengkak. Endpoint gambar terpisah (`/api/storefront/qris`) menyajikan
biner `image/webp` sehingga `<img>` tidak memerlukan auth di sisi browser.

### 10.4 Fee merchant

Fee **tidak pernah** mengubah total yang dibayar customer. Fee dicatat di `transactions.fee_amount`
saat transaksi dibuat dan dipakai hanya untuk laporan pendapatan bersih (`total − fee`).

---

## 11. Di luar cakupan

- **Gateway QRIS dinamis** (Midtrans/Xendit) — overkill untuk tahap ini; kolom sudah mengakomodasi
- **Surcharge ke customer** — ditolak eksplisit oleh user
- **Multi-currency** — hanya IDR
- **Pembayaran cicilan / kartu kredit angsuran** — di luar cakupan
- **Retur tanpa restock** — masih manual
- **Notifikasi push ke customer** saat status order berubah — belum ada
