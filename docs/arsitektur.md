# Arsitektur Teknis RetailPro

| | |
|---|---|
| Aplikasi | RetailPro — ERP/POS multi-tenant, multi-cabang (pasar Indonesia, IDR) |
| Dokumen | `docs/arsitektur.md` |
| Terakhir diperbarui | **2026-11-19** |
| Versi skema tenant | `schema_version = 12` (`db/schema/tenant.sql` + `db/migrations/`) |
| Status | Berjalan di lokal **dan** di Vercel (back office + toko online) dengan Turso cloud; belum dipakai data produksi nyata |

> Dokumen ini menjelaskan **bagaimana sistem disusun dan mengapa**. Untuk daftar fitur lihat
> [fitur-tenant.md](fitur-tenant.md) dan [fitur-platform.md](fitur-platform.md); untuk detail
> tabel dan endpoint lihat [backend.md](backend.md).

---

## 1. Ringkasan

RetailPro adalah SPA React yang **bicara langsung ke database Turso milik tenant** dengan token
berumur pendek. Server hanya dipakai untuk tiga hal yang tidak boleh ada di browser: membuat
database, menandatangani token, dan menyimpan identitas pengguna.

```
   +----------------------+      +------------------------------------+
   |  Browser (React SPA) |      |  tokoonline (TanStack Start)       |
   |  token 60m di memori |      |  tanpa kredensial database         |
   +----------+-----------+      +----------------+-------------------+
              |                                   |
              | HTTPS /api/*                      | HTTPS GET
              v                                   | /api/storefront/catalog
   +----------+-----------------------------------+-------------------+
   |  Vercel Functions (api/): health, auth, tenant/*, admin, catalog |
   +----------+-----------------------------------+-------------------+
              |                                   |
              | Kysely + libSQL (control DB)      | Turso Platform API
              v                                   v
   +----------------------+          +------------------------------+
   |  Control DB (Turso)  |          |  Turso Platform (organisasi) |
   |  Better Auth +       |          |  buat database, terbit token |
   |  tenant_databases    |          +------------------------------+
   +----------+-----------+
              |
              | terbit JWT (60 menit, 1 database)
              v
   +----------------------+       +----------------------+
   |  Turso DB tenant A   |       |  Turso DB tenant B   |
   |  39 tabel, tanpa     |       |  isolasi fisik       |
   |  kolom tenant_id     |       +----------------------+
   +----------------------+
```

Browser juga membuka koneksi **langsung** ke DB tenant dengan JWT tersebut
(`@libsql/client/web`), tanpa melewati fungsi serverless. Fungsi `api/` hanya dipakai untuk
identitas, provisioning, penerbitan token, dan katalog publik toko.

---

## 2. Prinsip yang dipegang

| # | Prinsip | Konsekuensi |
|---|---|---|
| 1 | **Satu database per perusahaan** | Tidak ada `tenant_id`, tidak ada RLS. Isolasi = batas fisik. Kebocoran satu token dibatasi ke satu perusahaan dan satu jam |
| 2 | **Server setipis mungkin** | Browser memegang koneksi data; server hanya provisioning, identitas, dan token. Tidak ada jalur request aplikasi harian lewat server |
| 3 | **Satu seam akses data** | Semua halaman memakai `query` / `runTransaction` / `batchQuery` dari `@/lib/db`. Transport bisa diganti di satu file |
| 4 | **Skema adalah kode** | `db/schema/*.sql` di repo adalah sumber kebenaran; perubahan bertahap untuk database yang sudah hidup lewat `db/migrations/<nomor>_<slug>.sql`. Tidak ada perubahan skema manual di dashboard |
| 5 | **Uang sebagai integer** | IDR tanpa sen, `INTEGER`. Kuantitas `REAL` karena bisa pecahan (0,5 kg) |
| 6 | **Gagal tertutup** | Route guard menolak bila role tidak diketahui; provisioning melakukan rollback bila satu langkah gagal |

---

## 3. Komponen dan tanggung jawab

| Komponen | Lokasi | Tanggung jawab | Tidak boleh |
|---|---|---|---|
| SPA back office | `src/` | UI, aturan tampilan, query ke DB tenant | Menyimpan kredensial atau token di storage |
| Toko online | `tokoonline/` | Marketplace semua tenant: katalog, keranjang lintas penjual, checkout pengunjung, chat | Menyimpan kredensial database atau menulis ke DB tenant |
| Fungsi API | `api/` | Health, Better Auth handler, bootstrap/token tenant, provisioning, admin user, katalog publik (`/catalog` satu tenant, `/marketplace` gabungan) | Menjalankan logika bisnis POS/inventori |
| Server library | `server/` | Better Auth, control DB, Turso Platform client, provisioning, render seed, generator demo | Diimpor dari `src/` (berisi rahasia) |
| Control DB | Turso | Identitas (Better Auth) + registry tenant | Menyimpan data transaksi/bisnis |
| DB tenant | Turso (1 per tenant) | Seluruh data bisnis | Menyimpan kredensial atau data tenant lain |
| Scripts | `scripts/` | Bootstrap control, apply schema massal, audit SQL, seed demo lokal & cloud | Dipanggil dari browser |
| Harness e2e | `tests/`, `e2e.config.ts` | Menjalankan SPA di Chromium untuk menguji alur UI; langkah yang butuh penilaian dinilai model lewat endpoint OpenAI-compatible | Ikut berjalan di runtime aplikasi, atau menyimpan kunci model di repo |
| Subsistem cetak | `src/lib/print/` | Menyusun dokumen (`document.ts`, `receipt-doc.ts`, `zreport-doc.ts`), merendernya (`html-render.ts`, `escpos.ts`), dan memilih transport (`print-bridges.ts`, `print-service.ts`) | Menyentuh data bisnis selain membaca transaksi/shift; melempar error ke alur penjualan |
| Modul pembatalan | `src/lib/void.ts` | Satu-satunya penulis kolom `void_*` dan pengembalian stok karena void; aturan guard sebagai fungsi murni | Memakai jalur lain untuk membatalkan penjualan, atau menghapus baris transaksi |

---

## 4. Alur kritis

### 4.1 Registrasi tenant (`POST /api/tenant/provision`)

```
RegisterTenant.tsx
  -> provisionTenant()                       server/provision.ts
     1. findTenantByOwner(userId)      -> 409 tenant_exists bila sudah punya
     2. assertUsableSlug()             -> 400 invalid_slug / 409 slug_reserved
     3. countTenantDatabases() >= max  -> 429 tenant_limit_reached
     4. slug sudah dipakai?            -> 409 slug_taken
     5. buildDatabaseName(slug)        -> rp-<slug>-<5 acak>
     6. Turso createDatabase(name, group)
     7. createToken(db, '10m', 'full-access')
     8. applyTenantSchema(BEGIN; tenant.sql + seed.sql; COMMIT;)
     9. insertInto('tenant_databases')
    10. gagal di langkah 6-9 -> deleteDatabase() + lempar error (rollback)
```

Hasilnya satu tenant = satu database + satu baris registry + satu pemilik di control DB.

### 4.2 Login dan bootstrap

```
Login (Better Auth)  ->  session cookie httpOnly (control DB)
   -> TenantProvider:
        GET /api/tenant/bootstrap
            requireTenantSession(headers)      -> cek session + baris registry
            mintTenantToken(db_name)           -> JWT 60 menit, full-access
            kembalikan { dbUrl, token, expiresAt, tenant, user{role,branchId} }
   -> setTenantSession(...)   (memori saja, tidak pernah localStorage)
   -> <RequireTenant> baru melepas render halaman
```

Status bootstrap: `idle → loading → ready | no-tenant | error`. `no-tenant` mengarahkan pemilik
baru ke `/register-tenant`.

### 4.3 Refresh token

`getClient()` memanggil `refreshIfNeeded()`; bila token tinggal < 5 menit, `refreshToken()`
memanggil `POST /api/tenant/token` secara *single-flight* (pemanggil bersamaan berbagi satu
request). `query()` juga mengulang satu kali bila error terlihat seperti token kedaluwarsa.

### 4.4 Checkout POS

```
handlePaymentComplete                       src/pages/POS.tsx
  getStockIssueMethod()                     settings.inventory.stock_issue_method
                                            (dibaca SEBELUM transaksi dibuka)
  runTransaction:
    1. pre-flight stok per baris (warehouse = gudang cabang sesi/switch)
    2. SELECT * FROM product_batches WHERE product_id=$1 AND warehouse_id=$2
              AND quantity_current>0          (tanpa ORDER BY)
       sortBatchesForIssue(rows, method)      fifo | lifo | fefo di memori
    3. UPDATE ... WHERE id=$3 AND quantity_current >= $4   (blind-write guard)
    4. INSERT transaction_items (quantity dalam satuan jual, cost dari batch x konversi)
    5. INSERT transactions (total_amount = nilai jual, amount_paid = uang diterima)
    6. logAuditTx(...)  (detail memuat stock_issue_method)
```

### 4.5 Alur stok: permintaan → pengiriman → rak → penjualan

Satu barang bisa melewati empat dokumen sebelum terjual. Perhatikan bahwa **hanya satu modul yang
boleh menyentuh batch** (`src/lib/stock-movement.ts`); sisanya memanggilnya.

```
Pesanan cabang          Transfer stok            Rak toko              POS
stock_requests    ->    stock_transfers    ->    product_batches   ->  transaction_items
(draft..submitted)      (in_transit)             (type='store')        (stok rak berkurang)
        |                       |                       |
        | approve               | dispatch              | receive
        v                       v                       v
  quantity_approved       stock KELUAR gudang     quantity_received
                           (batch demi batch)      (selisih dicatat)
```

| Tahap | Dokumen | Efek pada stok | Dijaga oleh |
|---|---|---|---|
| Minta | `stock_requests` (draft → submitted) | tidak ada | `src/lib/branch-orders.ts` (`canPerform`, `validateApproval`) |
| Setujui | `stock_requests` (approved) | tidak ada; kuantitas boleh dikurangi | `validateApproval()` — disetujui ≤ diminta |
| Kirim | `stock_transfers` (in_transit) | **stok keluar gudang** per batch, `cost_price`/`expiry_date`/`supplier_id` ikut | `dispatchTransfer()` + `validateDispatch()` + `committedQuantities()` |
| Terima | `stock_transfers` (completed) | tidak ada penambahan; hanya `quantity_received` + selisih | `receiveTransfer()` + `validateReceipt()` |
| Jual | `transactions` | stok rak berkurang sesuai kebijakan FIFO/LIFO/FEFO | `POS.tsx` + `sortBatchesForIssue()` |

Pembuatan transfer (`pending`) tidak mengubah stok. Pengiriman berjalan per batch sesuai kebijakan
pengeluaran tenant: satu baris `transfer_items` menyimpan `source_batch_id`, dan **satu batch tujuan
dibuat per leg** sehingga biaya dan kedaluwarsa ikut berpindah apa adanya.

Rak toko (`warehouses.type = 'store'`, `branch_id` terisi) adalah gudang default cabang, sedangkan
gudang pusat (`branch_id` NULL, `type = 'central'`) menjadi pemasok pesanan dan cadangan. Kanal
online tidak punya rak: pesanannya dikirim langsung keluar dari gudang pusat tanpa membuat dokumen
transfer (tidak ada tujuan internal).

### 4.6 Katalog marketplace (publik) & pesanan toko online

```
tokoonline (browser / SSR)  ->  GET /api/storefront/marketplace
   1. tenant_databases WHERE status = 'active'   -> daftar penjual (sequential)
   2. per tenant: mintTenantToken(db_name, 60m)  -> token hanya di server
   3. readTenantCatalog (server/storefront-catalog.ts, dibagi dengan /catalog):
      branches aktif type 'online' -> gudang pemenuh (bersama -> central -> default,
      rakang cabang itu sendiri dikecualikan) -> products + product_units + SUM(batches)
   4. gabung semua tenant, product.id diberi prefiks "<slug>:" agar UUID tidak bentrok
   -> { shops[], categories[], products[], tenants:{total,live}, skipped[], syncedAt }

GET /api/storefront/catalog?slug=thalia  -> katalog satu tenant (bentuk yang sama,
                                            tanpa `tenant`/`seller`), dipakai klien
                                            yang memang hanya menampilkan satu toko
```

Endpoint katalog sengaja tanpa sesi dan tanpa cache: isinya sama dengan yang bisa dilihat pengunjung
toko, dan setiap permintaan membaca database tenant sehingga perubahan harga/stok dari back office
langsung terlihat. Satu tenant yang gagal (belum punya cabang/gudang, database tidak terbaca)
tidak menggagalkan permintaan: ia masuk `skipped[]` dengan alasan kasar `"unavailable"` sedangkan
pesan error aslinya hanya ke log server — endpoint ini publik, dan pesan libSQL menyebut nama tabel.

**Pesanan online kini masuk database tenant (skema v12):**

```
tokoonline checkout.tsx  ->  POST /api/storefront/orders (publik, CORS)
   1. validasi items per seller: { tenant, productId, variantId?, unitName, qty }
   2. hitung ulang harga server-side dari product_units / product_variants
   3. split per seller -> INSERT storefront_orders (status = 'pending_payment')
   4. respons: 201 { parentId, orders: [{tenant, orderId, shopName, total, status, payment}] }

Back office (StorefrontOrders.tsx)  ->  POST /api/tenant/orders/confirm { orderId }
   1. mintTenantToken(db_name) di server
   2. runTransaction atomik:
      a. cek stok gudang online (product_batches, warehouse fulfillment)
      b. getStockIssueMethod() -> sortBatchesForIssue() (FIFO/LIFO/FEFO)
      c. UPDATE product_batches SET quantity_current -= qty * conversion_factor
      d. INSERT transactions (source='online', fee_amount, payment_method dari channel)
      e. INSERT transaction_items
      f. UPDATE storefront_orders SET status='confirmed', transaction_id
      g. logAuditTx('checkout', { fee, source, ... })
   3. gagal stok -> 409, tidak ada sebagian yang tertulis
```

Ongkir marketplace **tidak masuk** transaksi tenant — transaksi tenant hanya mencatat subtotal
seller. Selisih ongkir menjadi pendapatan platform (di luar cakupan rilis ini).

Aplikasi toko **tidak** memegang kredensial database; pesanan pengunjung disimpan di perangkat
+ dikirim ke server saat checkout. Status order di-poll dari server (`GET /api/storefront/orders?parent=`)
setiap 15–30 detik; status server menang atas localStorage untuk order yang punya `parentId`.

### 4.7 Cetak struk & Z-report

Satu dokumen, dua renderer, empat transport — semuanya di browser, tanpa dependency baru:

```
POS.tsx / POSShifts.tsx / POSTransactions.tsx
  receipt-doc.ts | zreport-doc.ts        menyusun PrintDoc (baris teks / cols rata-kiri-kanan)
        v
  print-service.printDocument(doc)
    loadPrintContext()                   tenants.settings.receipt + .printer + nama toko dari sesi
    pilih transport:
      mode usb  + handle WebUSB hidup    -> escpos.ts (byte) -> print-bridges.printViaWebusb
      mode bluetooth + BLE hidup         -> escpos.ts (byte) -> printViaBle
      selain itu / gagal di tengah tulis -> html-render.ts (iframe tersembunyi + window.print)
                                          -> gagal lagi: unduh berkas .prn
  hasil selalu PrintResult { ok, via, error? }  -> toast, tidak pernah melempar ke alur penjualan
```

Yang membuat alur ini berbeda dari "cetak dari web" biasa: **model dokumen berbasis karakter**, bukan
HTML. Lebar roll menentukan jumlah kolom (58/60mm = 32, 72mm = 42, 76mm = 44, 80mm = 48), jadi layout
dihitung sekali dan kedua renderer tinggal memenuhinya; renderer HTML menyesuaikan ukuran font agar
colom itu benar-benar muat di kertas. Karena cetak terjadi **setelah** transaksi commit, kegagalan
printer hanya menjadi peringatan — penjualan yang sudah tersimpan tidak pernah di-rollback, dan struk
bisa dicetak ulang dari riwayat.

### 4.8 Void transaksi (per item & per bon)

```
POSTransactions.tsx -> VoidDialog.tsx (alasan wajib, pratinjau pengurangan)
  voidGuard(reason, actor, target)         src/lib/void.ts — murni: izin -> alasan -> status -> shift
  runTransaction:
    1. UPDATE transaction_items SET voided=1, void_reason/by/at   (baris TIDAK dihapus)
    2. UPDATE product_batches SET quantity_current = quantity_current + qty*satuan-dasar
       pada batch_id baris itu               (restock ke batch asal, bukan pool global)
    3. UPDATE transactions SET total_amount/amount_paid = nilai baru   (void item: turun sebesar subtotal;
       void bon: total dibiarkan, status='void')
    4. logAuditTx('void_transaction', {kind: 'items'|'bon'})
  -> struk dicetak ulang otomatis bila Cetak Otomatis aktif (baris dicoret, banner TRANSAKSI DIBATALKAN)
```

Keputusan desainnya ada dua, dan keduanya punya konsekuensi ke seluruh aplikasi:

1. **Membatalkan = menandai.** Riwayat, audit, dan struk harus tetap menunjukkan penjualan yang
   dibatalkan, jadi tidak ada `DELETE`. Akibatnya setiap agregasi uang wajib menyaring
   `status = 'completed'` (dan `ti.voided = 0` untuk hitungan per item) — aturan ini menjangkau
   Dashboard, Reports, Cabang, POS/shift, Cashflow, Piutang, dan Z-report, dan dijaga test
   `src/lib/__tests__/void.test.ts` yang memutar ulang SQL-nya ke database sementara.
2. **Total diturunkan, bukan dihitung ulang.** Diskon bon hanya ada sebagai selisih
   `SUM(subtotal) − total_amount`; menghitung ulang dari sisa baris akan diam-diam menghapus diskon
   itu. Maka `nextTotalAfterVoid()` mengurangkan subtotal baris yang dibatalkan (clamp di 0).

Batas waktunya ditegakkan di `voidGuard()`: transaksi pada shift `open` boleh di-void pemegang izin
`void_transaction`, sedangkan shift tertutup hanya owner-tier. Ini menjaga Z-report yang sudah
diserahkan kasir tidak berubah nilai secara diam-diam.

### 4.9 Katalog vendor–produk dan vendor otomatis di PO

```
AddProductModal · Vendors.tsx (?tambah-produk=1) · VendorDetail (tab Produk & Hubungkan Produk)
· impor CSV/Excel · penerimaan barang · seeder demo
  -> src/lib/product-write.ts   saveProductDraft() | insertImportedProduct()   (produk + varian + pack)
  -> src/lib/vendor-catalog.ts  SATU penulis relasi vendor-produk:
       resolveOrCreateVendor()      nama dicocokkan COLLATE NOCASE; kode kosong -> mint VND-####
       upsertVendorCatalogLink()    vendor_products (SKU vendor, last_cost, lead time, min order)
       markPreferredVendor()        is_preferred tepat satu per produk + produk tanpa supplier_id diadopsi
       upsertVendorPrice()          vendor_price_list per (varian, pecahan); mode 'overwrite' | 'gap-only'
       recordVendorLastCost()       last_cost saja (dipakai penerimaan barang)
       defaultVendorFor()           murni: vendor tercih -> vendor utama -> vendor tunggal yang aktif
  -> src/lib/vendor-catalog-sql.ts  pembangun statement-nya ({ sql, args }) agar UI, lib, runner migrasi,
                                     dan seeder tidak bisa punya versi SQL masing-masing
  -> src/lib/vendor-import.ts       carryVendorForward() + expandProductCodes() + groupVendorProductRows()
                                 + planVendorProductImport(rows, universe, { priceMode, mayCreateVariants })
                                 = niat impor tanpa SQL; satu berkas = satu vendor (baris 1 hanya vendor,
                                 baris 2+ produknya); boleh merencanakan varian/pecahan yang belum ada
                                 VendorProductImport.tsx mengeksekusi rencananya,
                                 satu runTransaction() per PRODUK (vendor lebih dulu di transaksinya sendiri)
  -> src/lib/product-import.ts      groupProductRows() + planProductImport(seeds, universe, { priceMode }) —
                                 perencana murni sheet produk kaya (satu baris = varian × pecahan);
                                 Inventory.tsx mengeksekusi rencananya, satu runTransaction() per produk.
                                 Produk existing menjadi 'extend' (hanya yang kurang ditulis), bukan dilewati
PurchaseOrderModal.tsx: pilih produk -> applyVendor(defaultVendorFor(...)) -> vendor + lead time
                        + harga kesepakatan (vendor_price_list) terisi; ganti vendor dengan keranjang
                        berisi = AlertDialog konfirmasi, bukan drop diam-diam
```

Empat keputusan yang membuat alur ini bisa dipercaya:

1. **Satu penulis.** Sebelum rilis ini `find-or-create supplier` muncul di tiga tempat dan tautan
   `vendor_products` di empat tempat, dan tidak satu pun menulis `vendor_price_list` kecuali
   penerimaan barang (mode mengisi celah) — sehingga "template PO" kosong untuk vendor yang
   harganya baru disepakati dan layar PO tidak punya harga kesepakatan untuk dibaca. Sekarang
   semua jalur memanggil modul yang sama, dan kebijakan `ON CONFLICT` (`gap-only` vs `overwrite`)
   hanya ada satu definisi.
2. **Aditif untuk master, boleh untuk harga.** Vendor dan produk yang sudah ada tidak pernah diganti
   nama/kodenya oleh impor; `last_cost` dan `buy_price` **boleh** mengikuti sheet, dan itu dijaga
   izin `manage_vendor_prices` — tanpa izin, tulisannya otomatis `gap-only` sehingga harga kesepakatan
   lama tidak pernah diinjak.
3. **Izin ditegakkan di lib, bukan di UI.** `saveProductDraft()` menolak pemanggil tanpa
   `manage_variants`, dan penulisan harga `overwrite` butuh `manage_vendor_prices`; PermissionGate di
   layar hanya membuat gejalanya terlihat.
4. **Satu PO tetap satu vendor.** Auto-fill hanya memilihkan vendor; setelah vendor terpilih daftar
   produk disaring ke katalog vendor itu. PO multi-vendor ada di luar cakupan (satu header satu
   `supplier_id`).

Rincian keputusan dan bentuk sheet impor ada di
[spec-vendor-produk-terintegrasi.md](spec-vendor-produk-terintegrasi.md); sisi datanya di
[backend.md](backend.md) §5.12, sisi layarnya di [frontend.md](frontend.md) §8.

### 4.10 Chat internal (channel & DM, polling)

Layar `/backoffice/chat` untuk percakapan owner ⇄ karyawan dalam satu tenant. Tidak ada
endpoint baru: seluruh baca/tulis lewat `src/lib/chat.ts` langsung ke DB tenant dengan JWT
yang sama seperti modul domain lain — konsekuensi arsitektur "browser memegang data plane"
sudah dibayar di tempat lain, di sini ia membeli kesederhanaan.

1. **Near-real-time tanpa websocket.** Daftar percakapan di-poll 10 detik, thread yang aktif
   3 detik (`use-chat.ts`); tab latar tidak mem-poll, dan append optimistis menutupi latensi
   kirim. Ini keputusan, bukan keterbatasan: satu-satunya jalur tulis adalah browser.
2. **Mention = teks natural + snapshot.** Body pesan disimpan apa adanya; tiap mention
   (`@`orang, `#`produk/invoice/PO/vendor) juga jadi baris `chat_mentions` berisi label saat
   ditulis, sehingga chip tetap terbaca walau baris sumbernya diganti atau dihapus, dan chip
   entity menaut langsung ke detailnya (`entityRoute`).
3. **Batas kepercayaan eksplisit.** Visibilitas channel/DM ditegakkan di UI, bukan RLS — sama
   seperti seluruh matriks izin app ini (lihat [frontend.md](frontend.md) §9). Chat
   bukan ruang rahasia; itu tercatat di [spec-chat-internal.md](spec-chat-internal.md) §6.
4. **Pane menulis ke apa yang ia tampilkan — jadi identitas dimuat lebih dulu.** Query yang
   key-nya memuat `conversation_id` (`useConversation`, `useMessages`) sengaja tidak memakai
   `placeholderData: keepPreviousData`; yang memakainya hanya query daftar. Harganya: perpindahan
   channel menampilkan skeleton sebentar alih-alih transkrip lama. Alasannya terukur (KS-53):
   dengan placeholder, pesan yang diketik tepat setelah channel baru dibuat ditulis ke channel
   yang sedang tampil di layar, bukan ke channel yang baru dipilih.

---

## 5. Isolasi dan keamanan

| Aspek | Implementasi saat ini |
|---|---|
| Isolasi data | Database terpisah per tenant; `db/schema/tenant.sql` tidak punya `tenant_id` dan test skema memastikannya |
| Identitas | Better Auth di control DB; `role`, `tenantId`, `branchId` adalah `additionalFields` sehingga selalu ada di session. **Peran di session adalah identitas runtime** — baris `users` di DB tenant hanya proyeksi, dan keduanya ditulis dari satu endpoint (`/api/admin/users/[id]`) |
| Otorisasi UI | Satu katalog izin (`src/config/roles.ts`) → satu resolver murni (`src/lib/permission-matrix.ts`) → satu hook (`usePermissions()` di atas TanStack Query). `RoleBasedRoute`, entri sidebar, dan kartu `ModeSelect` menuntut **kunci izin**, bukan daftar peran; peran yang tidak dikenal matriks gagal-tertutup |
| Otorisasi server | `requireAdminSession` pada endpoint admin; `ASSIGNABLE_ROLES` lama diganti `server/roles.ts` (bawaan ∪ `settings.custom_roles`, owner ditolak); `/api/tenant/bootstrap` membaca baris proyeksi sebelum mencetak token sehingga orang yang dihapus/dinonaktifkan tidak lagi dapat akses database |
| Kredensial DB | Tidak ada di bundle. Token 60 menit diterbitkan server, disimpan di memori, tidak di storage |
| Rahasia server | Hanya `server/` dan `api/`; `src/` tidak boleh mengimpornya (aturan tertulis di `server/env.ts`) |
| Audit | `audit_logs` di DB tenant: checkout, produk, stok, transfer, PO, pengeluaran, karyawan, pengaturan, **void transaksi** (`details.kind` = `items`/`bon`) |
| Cetak | Tidak menyentuh database kecuali membaca preferensi (`settings.receipt`/`settings.printer`) dan menyusun dokumen dari data transaksi. WebUSB/Web Bluetooth butuh **secure context** dan satu gesture `requestDevice` per sesi browser; kegagalan cetak tidak pernah memengaruhi data |
| Pembatalan penjualan | `voidGuard()` menuntut izin `void_transaction`, alasan ≥ 3 karakter, bon masih `completed`, dan shift `open` (kecuali owner-tier). Sama seperti izin lain, ini lapis UX — penegakan di server adalah lanjutan terpisah (lihat catatan di bawah) |

**Batas kepercayaan yang jujur:** siapa pun yang memegang token tenant dapat menjalankan SQL apa
pun di database **perusahaannya** selama ≤ 60 menit. Karena itu token sengaja pendek, per-database,
dan tidak pernah dipersist. Endpoint admin tetap mengandalkan sesi, bukan token.

Geofence & pengenal wajah (v8) tunduk pada batas yang sama: karena tidak ada server tenant, jarak GPS
dan kecocokan wajah dihitung di perangkat (`src/lib/geolocation.ts` / `src/lib/face.ts`), di-*hard-block*
di UI `/absen`, lalu disimpan ke `attendance` hanya sebagai jejak audit — satu-satunya paksaan di level
database tetap trigger hari-berjalan `trg_attendance_today_only` (v7). Wajah disimpan sebagai descriptor
128-float, bukan foto. Kamera (`getUserMedia`) dan `navigator.geolocation` menuntut **secure context**,
sehingga jalan di HTTPS dan `http://localhost`, tetapi tidak di `http://<IP-LAN>`.

Konsekuensinya, dan ini sengaja dipertahankan apa adanya: **matriks izin adalah lapis UX untuk
data bisnis, bukan batas keamanan.** Yang ditegakkan di server adalah *identitas* (siapa boleh
masuk, peran apa yang melekat, akun mana yang masih hidup); pintuan aksi (`can('approve_po')`)
mengatur apa yang ditawarkan aplikasi kepada orang tersebut, bukan apa yang secara teknis bisa ia
lakukan dengan tokennya. Memindahkan setiap mutasi bisnis ke endpoint server adalah pekerjaan
terpisah dan tercatat sebagai lanjutan di [spec-purchase-order.md](spec-purchase-order.md) §15.

---

## 6. Model data

38 tabel di DB tenant (v11: 38; v12: 39 dengan `storefront_orders`), dikelompokkan:

| Domain | Tabel |
|---|---|
| Profil | `schema_version`, `tenants`, `branches`, `warehouses`, `branch_warehouses`, `users` |
| Katalog | `categories`, `suppliers`, `products`, **`product_variants`**, `product_units`, `product_batches` — `products` adalah model, `product_variants` adalah SKU yang benar-benar dijual dan distok |
| Vendor | `vendor_products`, `vendor_price_list`, `vendor_payments` — `suppliers` adalah master vendor yang dipakai produk, PO, dan hutang; `vendor_price_list` menyimpan harga beli yang disepakati per varian per pecahan. Kedua tabel katalog hanya ditulis `src/lib/vendor-catalog.ts` (v10), dan `is_preferred` dijaga tepat satu per produk |
| Penjualan | `shifts`, `transactions`, `transaction_items` — kolom `voided`/`void_*` (v9) membuat pembatalan menjadi penanda, bukan penghapusan |
| Persediaan | `stock_requests`, `stock_request_items`, `stock_transfers`, `transfer_items`, `purchase_orders`, `purchase_order_items`, `goods_receipts`, `goods_receipt_items` — PO = niat, penerimaan = kenyataan |
| Keuangan | `expenses`, `payables` |
| SDM | `attendance`, `leaves`, `employees`, `face_enrollments` — `face_enrollments` menyimpan descriptor wajah 128-float per karyawan (bukan foto) untuk verifikasi absensi |
| Jejak | `audit_logs` |
| CRM | `customers` |
| Kolaborasi | `chat_conversations`, `chat_participants`, `chat_messages`, `chat_mentions` (v11) — channel & DM per tenant, satu-satunya penulis `src/lib/chat.ts`; visibilitas adalah aturan UI, bukan batas keamanan (tanpa RLS) |
| Toko online | `storefront_orders` (v12) — satu baris per seller per pesanan online; `status` `pending_payment` → `confirmed` → `packing` → `shipped` → `done` / `cancelled` / `void`. `items` JSON snapshot; `transaction_id` menunjuk baris `transactions` hasil konfirmasi |

Detail kolom, indeks, dan konvensi: [backend.md](backend.md) §5.

---

## 7. Deployment dan lingkungan

Runbook lengkap (langkah deploy, env per proyek, verifikasi, rollback): **[deployment.md](deployment.md)**.

| Item | Nilai |
|---|---|
| Build | `vite build` → `dist/` (SPA statis); `tokoonline/` memakai Nitro preset Vercel → `.vercel/output` |
| Hosting | Vercel, **dua proyek**: `retailpro-thalia` (SPA + `api/*`) dan `thalia-storefront` (`tokoonline/`) |
| URL | https://retailpro-thalia.vercel.app · https://thalia-storefront.vercel.app |
| Runtime API | Node ≥ 20 (Vercel Functions, `node:crypto`) |
| Database | Turso libSQL cloud, grup `ap-southeast-2`; control DB + satu DB per tenant |
| Dev lokal | `npm run dev` (SPA :8080) + `npm run dev:api` (:3000, proxy `VITE_API_PROXY_TARGET`) + `cd tokoonline && npm run dev` (:8082) |
| Verifikasi | `npm run typecheck`, `npm test` (Vitest 33 berkas/547 test, terukur 2026-11-19), `npm run audit:sql`, `npm run docs:check` (bentuk tabel markdown + satu versi skema di tiga tempat + indeks dokumen + anchor `§` antar-dokumen; plus positive control di `scripts/__fixtures__/docs-check` yang wajib melaporkan 8 masalah), dan `npm run test:e2e` (tester.army terhadap SPA :8080) — semuanya manual, belum ada CI. Gerbang lint = `npx eslint <berkas yang disentuh>` (0 masalah); `eslint .` repo-wide masih 25 error `no-explicit-any` + 8 warning warisan di 18 berkas dashboard/laporan/POS (`HEAD` sudah begitu, jadi bukan regresi) |
| Variabel | Lihat tabel env di [backend.md](backend.md) §2 (lokal) dan [deployment.md](deployment.md) §4 (produksi) |
| Kontrak platform | Import relatif `.js` di `api/`+`server/`; route bracket lewat `rewrites` di `vercel.json`; `db/schema/**` ikut ke lambda |

---

## 8. Keputusan arsitektur

| # | Keputusan | Alternatif yang ditolak | Konsekuensi |
|---|---|---|---|
| 1 | 2026-10-27 — Turso libSQL, satu DB per tenant | Neon Postgres + RLS; satu DB + kolom `tenant_id` | Isolasi jadi fisik; tidak bisa query lintas tenant; 1 DB = 1 unit backup/restore |
| 2 | 2026-10-27 — Browser → DB langsung dengan token pendek | Semua query lewat API | Latensi rendah dan kode halaman tidak berubah; keamanan bergantung pada umur token |
| 3 | 2026-10-27 — Better Auth di control DB | Auth di DB tenant | Login tetap satu pintu walau tenant punya database sendiri; identitas harus dicerminkan ke `users` tenant |
| 4 | 2026-10-27 — Mulai dari nol (tanpa ETL) | Migrasi data Neon | Skema bersih dan konsisten; tidak ada data lama yang perlu dipetakan |
| 5 | 2026-10-27 — Keuangan basis kas, AP dari `expenses` | Buku besar penuh (COA + jurnal) | Cepat dan sesuai praktik toko; belum ada tutup buku/trial balance |
| 6 | 2026-10-27 — Dataset demo deklaratif + test integritas | SQL seed statis | Angka konsisten dan bisa diuji; katalog adalah satu-satunya sumber kebenaran |
| 7 | 2026-10-27 — Cabang = lokasi penjualan, gudang = lokasi stok (`branch_warehouses` N:N) | Stok berkunci `branch_id` di `product_batches` | Banyak cabang : 1 gudang dan banyak : banyak sama-sama jalan; kasir, transfer, dan PO memakai `warehouse_id`; setiap kueri "stok cabang" harus lewat pemetaan |
| 8 | 2026-10-27 — Urutan pengeluaran stok = kebijakan tenant (`fifo`/`lifo`/`fefo`), diurutkan di memori | `ORDER BY received_at` dipaku di SQL tiap jalur | Satu aturan untuk kelima jalur stok keluar dan bisa diubah tanpa migrasi; kueri batch tidak lagi punya `ORDER BY`, jadi urutan wajib lewat `sortBatchesForIssue()` |
| 9 | 2026-10-28 — Permintaan (`stock_requests`) dipisah dari eksekusi (`stock_transfers`), dengan `shelves` per cabang dan **satu** modul perpindahan stok | (a) Menambah `branch_id` kembali ke `product_batches`; (b) menaruh logika persetujuan di masing-masing halaman | Permintaan bisa ditolak/disesuaikan tanpa menyentuh stok, dan batch hanya berpindah lewat `src/lib/stock-movement.ts`. Harga: satu dokumen tambahan, dan stok sudah bisa dijual di rak saat gudang mengirim (lihat §9) |
| 10 | 2026-10-28 — Produksi memakai Turso **cloud** + **dua** proyek Vercel, bukan database lokal dan bukan satu deployment | (a) Deploy SPA saja dengan data contoh statis; (b) satu proyek monolit yang juga menyajikan toko; (c) database file dibundel ke fungsi | Kedua aplikasi hidup di origin terpisah dengan kunci sendiri; tidak ada kredensial database di repo maupun di toko. Harga: dua pipeline deploy, dan kode `api/`+`server/` harus patuh pada cara Vercel men-transpile tiap berkas (`.js` eksplisit, route bracket lewat rewrite). Lihat [deployment.md](deployment.md) dan KS-26/KS-27 |
| 11 | 2026-10-31 — Uji UI end-to-end memakai tester.army (`e2e` + `@e2e-dev/web`) dengan model pihak ketiga lewat endpoint OpenAI-compatible (SumoPod) | (a) Menulis semua alur dengan selector Playwright murni; (b) membangun runner sendiri; (c) memakai gateway Vercel bawaan `e2e init` beserta kuncinya | Langkah deterministik tetap murah dan reproducible, sedangkan langkah yang butuh penilaian cukup satu `agent.assert`; menambah berkas uji tanpa menyentuh kode aplikasi. Harga: kunci API model harus ada di mesin operator, model wajib mendukung tool call, dan model tanpa `responseFormat` tidak bisa `agent.extract` (KS-32) |
| 12 | 2026-11-06 — Cetak struk memakai **model dokumen berbasis karakter** dengan encoder ESC/POS yang ditulis sendiri, bukan library pihak ketiga (mis. `esc-pos-encoder`) dan bukan HTML/CSS saja | (a) Satu jalur HTML + `window.print()` untuk semua printer; (b) dependency npm ESC/POS; (c) backend printing (lokal agent/service) | Layout dihitung sekali dari jumlah kolom dan dipakai dua renderer, jadi hasil driver dan printer thermal 58mm konsisten; byte ESC/POS bisa dikontrol (cut, kick drawer, corettan) tanpa menambah ukuran bundle atau proses baru. Harga: code page tidak didukung (rupiah jadi ASCII `"Rp"`, karakter non-ASCII didegradasi), dan dukungan perangkat keras diuji manual per tipe printer (KS-41 s.d. KS-43) |
| 13 | 2026-11-16 — Void = **menandai baris** (`voided`/`status='void'`), bukan menghapus; total **diturunkan** sebesar subtotal baris | (a) `DELETE` baris + hitung ulang total; (b) soft-delete tanpa menyentuh nominal | Audit trail, struk, dan riwayat pembatalan tetap terbaca; diskon bon yang disimpan implisit tidak hilang saat satu baris dibatalkan. Harga: **setiap** agregasi pendapatan wajib menyaring `status='completed'`, dan aturan itu tidak bisa dijaga oleh database — hanya oleh test dan review (lihat §4.8, KS-44) |
| 14 | 2026-11-16 — Batas void mengikuti **window shift**, bukan umur transaksi; override hanya owner-tier | (a) Batas waktu tetap (mis. 24 jam); (b) tombol dinonaktifkan hanya di UI | Aturan yang sama dengan yang dipakai Z-report: angka yang sudah disetorkan kasir tidak berubah kecuali oleh orang yang bertanggung jawab atas buku itu. Harga: transaksi tanpa `shift_id` (data lama) lolos dari batas ini dan hanya dijaga status/izin |

---

## 9. Batasan yang diketahui

1. **Belum ada konsol platform** — pemilik platform belum punya UI untuk daftar/aktifkan/suspend
   tenant, tier, atau fitur. Lihat [fitur-platform.md](fitur-platform.md) §3.
2. **`payables` tidak terbaca UI** — AP dihitung dari `expenses`; tabel `payables` masih ada di
   skema sebagai sisa desain awal (lihat kendala-solusi KS-08).
3. **Belum ada buku besar** — jurnal disusun saat baca dari `transactions` + `expenses`.
4. **Bundle tunggal ±2 MB** — belum di-split per route.
5. **Data bisnis belum lewat TanStack Query** — masih `useEffect` + `query()`; hanya sesi auth
   yang memakai Query.
6. **Tidak ada CI dan tidak ada staging** — typecheck, `npm test`, `npm run test:e2e`, dan `audit:sql` dijalankan manual
   sebelum `vercel --prod`, dan deploy langsung ke produksi (lihat [deployment.md](deployment.md) §9,
   KS-21).
7. **Stok rak sudah bisa dijual saat gudang mengirim, bukan saat barang tiba.** Pengiriman memindahkan
   batch ke rak dalam satu transaksi, sedangkan penerimaan hanya mencatat konfirmasi dan selisih.
   Konsekuensinya rak bisa menjual barang yang secara fisik masih di perjalanan beberapa jam.
8. **Kanal online tidak punya rak.** Pesanannya keluar dari gudang pusat tanpa dokumen transfer,
   sehingga `stock_requests.transfer_id` bernilai NULL untuk sumber `online`. Sejak v12, pesanan
   toko online masuk ke `storefront_orders` dan baru mengurangi stok saat owner mengonfirmasi
   pembayaran (`POST /api/tenant/orders/confirm`, alur atomik dengan `getStockIssueMethod()`).
9. **Pesanan toko online tersimpan di perangkat pengunjung sebagai cadangan.** Keranjang dan pesanan
   `tokoonline/` tetap disimpan di `localStorage` pengunjung; namun saat checkout, pesanan dikirim
   ke server (`POST /api/storefront/orders`) dan `parentId` disimpan lokal. Status order di-poll
   dari server setiap 15–30 detik; status server menang atas localStorage untuk order yang punya
   `parentId`.
10. **Satu region Turso** (`ap-southeast-2`) untuk control DB maupun tenant; belum ada replika baca,
    dan latensi mengikuti jarak ke region itu.
11. **Marketplace membaca tenant satu per satu, tanpa cache.** Setiap permintaan
    `/api/storefront/marketplace` mencetak token + enam query per tenant secara berurutan, jadi
    latensinya naik linear terhadap jumlah penjual dan permintaan pertama pada instance Vercel yang
    baru bisa mendekati batas durasi fungsi. Cukup untuk satu tenant hari ini; bila penjual
    bertambah, urutannya diganti batching atau seluruh respons di-cache `s-maxage` pendek di edge.
12. **Satu pesanan marketplace = satu `parent_id` dengan beberapa baris `storefront_orders`.** Satu
    keranjang, satu ongkir, satu pembayaran (platform sebagai merchant of record); tiap baris
    menyebut penjualnya dan dikirim dari gudangnya sendiri. Ongkir marketplace **tidak masuk**
    transaksi tenant — hanya subtotal seller yang dicatat. Konfirmasi pembayaran menulis
    `transactions` + mengurangi stok dalam satu transaksi atomik (v12).
13. **Cetak hanya diuji pada driver dan ESC/POS generik.** WebUSB/Web Bluetooth menuntut `requestDevice`
    sekali per sesi browser dan hanya jalan di secure context; printer Bluetooth murni di Windows desktop
    tidak punya API serial Bluetooth, jadi jalur resurnya unduh `.prn` lalu drag ke antrean printer.
    Code page ESC/POS tidak diimplementasikan, jadi karakter non-ASCII didegradasi ke `?` dan rupiah
    dicetak sebagai `"Rp"`. Belum ada logo raster di struk (logo hanya teks) dan belum ada cetak
    barcode/QR di struk.
14. **Void tidak membalik uang yang sudah keluar.** Pembayaran gateway (QRIS/kartu) tetap tercatat di
    provider — pengembalian dana dilakukan manual di terminal; laci kas sengaja tidak dibuka saat void.
    Retur tanpa restock (barang rusak) dan alokasi diskon proporsional per item belum ada. Karena
    RBAC ditegakkan di client, tombol void hilang untuk yang tak berhak, tetapi pemegang token tetap
    bisa menulis `voided = 1` dengan SQL langsung (lihat §5).
