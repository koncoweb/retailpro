# Fitur Tenant (aplikasi yang dipakai pelanggan)

| | |
|---|---|
| Dokumen | `docs/fitur-tenant.md` |
| Terakhir diperbarui | **2026-10-27** |
| Cakupan | Semua fitur yang tersedia di dalam satu tenant (POS + back office) |

## Cara memakai log ini

1. Log bersifat **tambah-baris**. Baris lama tidak diubah; bila sebuah fitur berubah, tambah baris
   baru yang menyebut baris sebelumnya.
2. Satu baris = satu perubahan fitur yang terasa oleh pengguna, dengan **tanggal dan jam** commit.
3. Kolom `Ref` memakai hash pendek git. `— (working tree)` berarti perubahan **belum di-commit**.
4. Status: `Baru`, `Ubah`, `Perbaikan`, `Hapus`.

---

## 1. Log perubahan fitur

### 2026-10-27 — migrasi Turso + tenant contoh Thalia (belum di-commit)

| Waktu | Ref | Modul | Perubahan | Status |
|---|---|---|---|---|
| 2026-10-27 | — (working tree) | Fondasi | Seluruh akses data dipindah dari Postgres/Neon ke Turso libSQL; `query`/`runTransaction` tetap sama sehingga halaman tidak ditulis ulang | Ubah |
| 2026-10-27 | — (working tree) | Auth | Login/registrasi memakai Better Auth; `role`, `tenantId`, `branchId` ada di session sehingga guard role berfungsi | Ubah |
| 2026-10-27 | — (working tree) | Onboarding | Registrasi tenant benar-benar membuat tenant: database Turso + skema + seed + baris registry + cabang utama | Perbaikan |
| 2026-10-27 | — (working tree) | POS | Cabang transaksi mengikuti cabang kasir (bisa diganti untuk peran yang berhak), bukan cabang pertama | Perbaikan |
| 2026-10-27 | — (working tree) | POS | Uang diterima (`amount_paid`) disimpan terpisah dari nilai transaksi (`total_amount`), kembalian dihitung benar | Perbaikan |
| 2026-10-27 | — (working tree) | POS | Pengurangan stok FIFO dijaga: `ORDER BY received_at, id` + guard `quantity_current >= qty` agar tidak oversell | Perbaikan |
| 2026-10-27 | — (working tree) | POS/Shift | Shift dibuka/ditutup dari POS dan tersimpan ke database; kas awal, kas akhir, kas seharusnya, selisih tercatat | Perbaikan |
| 2026-10-27 | — (working tree) | Inventori | Transfer stok menyimpan `expiry_date`, `cost_price`, dan `supplier_id` per batch (tidak lagi rata-rata) | Perbaikan |
| 2026-10-27 | — (working tree) | Inventori | Opname negatif menguras batch tertua lebih dulu, bukan membuat batch bernilai negatif | Perbaikan |
| 2026-10-27 | — (working tree) | Inventori | Purchase order tersimpan sebagai dokumen (draft/ordered/received) dan penerimaannya membuat hutang | Perbaikan |
| 2026-10-27 | — (working tree) | Inventori | Penerimaan PO menulis hutang ke `expenses` sehingga muncul di Hutang/Piutang, Cashflow, dan Jurnal | Perbaikan |
| 2026-10-27 | — (working tree) | Inventori | Hapus produk berjalan dalam satu transaksi (batch + satuan + produk) agar tidak ada sisa data menggantung | Perbaikan |
| 2026-10-27 | — (working tree) | Keuangan | Hutang/Piutang bisa mencatat pembayaran; angka aging dan cashflow ikut berubah | Baru |
| 2026-10-27 | — (working tree) | Laporan | Filter periode (hari/minggu/bulan/tahun) memakai batas UTC eksplisit + koreksi zona waktu lokal | Baru |
| 2026-10-27 | — (working tree) | Laporan | Pagination pada daftar transaksi, karyawan, produk, dan pengeluaran | Baru |
| 2026-10-27 | — (working tree) | Dashboard | Filter periode dan filter cabang pada statistik | Baru |
| 2026-10-27 | — (working tree) | Pengaturan | Pengaturan struk, pajak/diskon, bank, dan role benar-benar tersimpan ke `tenants.settings` | Perbaikan |
| 2026-10-27 | — (working tree) | Karyawan | Tambah karyawan & reset password lewat endpoint server; password sementara ditampilkan sekali | Perbaikan |
| 2026-10-27 | — (working tree) | Audit | Audit log diperluas: checkout, produk, stok, transfer, PO, pengeluaran, karyawan, pengaturan | Baru |
| 2026-10-27 | — (working tree) | Demo | Perintah `npm run demo:tenant` mengisi tenant contoh "Thalia Toko Bahan Kue" | Baru |

#### 2026-10-27 — cabang vs gudang dan kebijakan pengeluaran stok (belum di-commit)

| Waktu | Ref | Modul | Perubahan | Status |
|---|---|---|---|---|
| 2026-10-27 | — (working tree) | Cabang/Gudang | **Cabang dipisah dari gudang**: cabang = lokasi penjualan (`type` toko/online/hybrid, satu kantor pusat), gudang = lokasi stok (`type` pusat/regional/toko), dihubungkan tabel `branch_warehouses` sehingga banyak cabang ↔ banyak gudang sama-sama sah | Ubah |
| 2026-10-27 | — (working tree) | Gudang | Menu **Gudang** (`/backoffice/warehouses`): CRUD gudang, penanda gudang default, dan pemetaan gudang mana yang melayani cabang mana | Baru |
| 2026-10-27 | — (working tree) | Inventori | Stok disimpan per gudang (`product_batches.warehouse_id`); transfer memakai gudang asal/tujuan dan purchase order menyimpan `warehouse_id` tujuan penerimaan | Ubah |
| 2026-10-27 | — (working tree) | POS | Kasir memotong stok dari gudang default cabangnya (hasil pemetaan `branch_warehouses`), bukan memotong "stok cabang" | Ubah |
| 2026-10-27 | — (working tree) | Dashboard | Stok menipis dan jumlah produk berstok per cabang dihitung dari gudang yang melayani cabang itu — gudang bersama ikut dihitung untuk cabang yang dilayaninya | Perbaikan |
| 2026-10-27 | — (working tree) | Pengaturan/Inventori | Metode pengeluaran stok bisa dipilih per tenant: **FIFO** (bawaan), **LIFO**, atau **FEFO** (`expiry_date` terdekat dulu); menggantikan urutan FIFO yang dipaku di SQL pada baris POS dan opname di atas, dan berlaku di kelima jalur stok keluar | Baru |
| 2026-10-27 | — (working tree) | Pengaturan | Tombol "Simpan Pengaturan" tanpa handler dihapus; panel yang tersambung database (struk, pajak/diskon, bank, role, metode stok) menyimpan otomatis dan menampilkan status simpan | Perbaikan |
| 2026-10-27 | — (working tree) | Audit | Detail audit checkout, opname negatif, dan persetujuan transfer mencatat `stock_issue_method` yang berlaku, sehingga urutan pengeluaran bisa direkonstruksi | Perbaikan |

### 2026-10-27 — modul vendor (belum di-commit)

| Waktu | Ref | Modul | Perubahan | Status |
|---|---|---|---|---|
| 2026-10-27 | — (working tree) | Vendor | `suppliers` menjadi master vendor: kode `VND-0001`, badan usaha, kategori, NPWP, alamat terurai, termin, limit kredit, rekening bank, lead time, rating, dan status aktif/nonaktif/blacklist (skema v3) | Baru |
| 2026-10-27 | — (working tree) | Vendor | Daftar vendor `/backoffice/vendors`: kartu statistik (total, aktif, hutang, tagihan jatuh tempo), pencarian, filter status/kategori, pagination, export Excel | Baru |
| 2026-10-27 | — (working tree) | Vendor | Halaman detail vendor: kartu ringkasan, info kontak/bank/termin, tab Produk, Purchase Order, serta Hutang & Pembayaran | Baru |
| 2026-10-27 | — (working tree) | Vendor | Katalog vendor↔produk (`vendor_products`): tautkan/lepas produk, SKU vendor, harga beli terakhir, lead time, minimum order, penanda vendor utama | Baru |
| 2026-10-27 | — (working tree) | Vendor | Hutang usaha per vendor: catat tagihan manual, bayar sebagian/penuh, riwayat pembayaran (`vendor_payments`) dengan metode dan nomor referensi | Baru |
| 2026-10-27 | — (working tree) | Inventori | Form produk & import Excel menautkan produk ke katalog vendor; PO wajib memilih vendor dari master (bukan nama bebas), tanggal jatuh tempo hutang mengikuti termin vendor, harga beli terakhir vendor ikut diperbarui | Ubah |
| 2026-10-27 | — (working tree) | Keuangan | Pembayaran Hutang/AP menulis `vendor_payments` dalam transaksi yang sama dengan saldo `expenses.amount_paid`, sehingga riwayat vendor dan Hutang/Piutang selalu cocok | Ubah |
| 2026-10-27 | — (working tree) | Navigasi | Menu **Vendor** (Data Vendor, Hutang Vendor); route lama `/backoffice/crm/suppliers` tetap bekerja dan menampilkan daftar vendor | Ubah |

Detail teknis setiap baris di atas: [kendala-solusi.md](kendala-solusi.md) dan
[backend.md](backend.md).
### Riwayat commit (aplikasi sebelum migrasi)

| Waktu | Ref | Modul | Perubahan | Status |
|---|---|---|---|---|
| 2026-02-11 21:28 | `827940b` | POS/Inventori | Perbaikan pointer event di layar POS dan koreksi perhitungan stok | Perbaikan |
| 2026-02-11 21:01 | `3edb914` | Inventori | Import produk dan penanganan purchase order dirapikan | Ubah |
| 2026-02-11 20:28 | `7dbe846` | Transfer | Hapus kode auto-migration saat memuat daftar transfer | Perbaikan |
| 2026-02-10 00:37 | `7e1950f` | Shift | Manajemen shift kasir (buka/tutup kas) | Baru |
| 2026-02-02 03:44 | `2d16c16` | Infra | Konfigurasi deploy Vercel + penanganan sesi database | Baru |
| 2026-02-01 20:19 | `33b3fff` | Auth | Peran admin dan penanganan sesi | Baru |
| 2026-02-01 17:59 | `25e7d4d` | Karyawan | Pembuatan karyawan lewat admin API agar sesi admin tidak tertimpa | Perbaikan |
| 2026-02-01 17:43 | `4fb3b46` | Karyawan/Cabang | Pembuatan user terhubung ke layanan auth | Ubah |
| 2026-02-01 17:16 | `b02aa92` | Laporan | Export Excel dan halaman laporan baru | Baru |
| 2026-01-30 01:14 | `7007d47` | Dashboard | Modal dashboard memuat data nyata | Ubah |
| 2026-01-30 01:04 | `8a699a6` | Keuangan | Akuntansi basis kas + dashboard real-time | Baru |
| 2026-01-29 23:56 | `840dbd9` | Inventori/CRM | Barcode, SKU otomatis, modul CRM pelanggan & supplier | Baru |
| 2026-01-26 04:42 | `d2b8c65` | Produk | Dukungan multi-satuan + audit log | Baru |
| 2026-01-26 03:14 | `a7f5a00` | Inventori | Transfer stok dan opname tersimpan ke database | Baru |
| 2026-01-25 21:41 | `5c15c51` | Inventori | Inventori terhubung database + manajemen role | Baru |
| 2026-01-24 20:31 | `c297355` | Cabang | Edit karyawan dari modal detail cabang | Baru |
| 2026-01-24 19:44 | `43d1df7` | Data | `tenant_id` pada item transaksi (model multi-tenant lama) | Ubah |
| 2026-01-24 19:02 | `6a6936a` | Auth | Perbaikan penanganan sesi RLS dan routing berbasis role | Perbaikan |
| 2026-01-23 19:27 | `0d46d02` | Auth | Autentikasi multi-tenant + dashboard per cabang | Baru |
| 2026-01-23 12:03 | `76c5954` | Data | Integrasi layanan auth + model data multi-tenant | Baru |
| 2026-01-20 02:21 | `c87e434` | Shell | Pemisahan area back office dari POS | Ubah |
| 2026-01-20 02:16 | `9fc47ee` | POS | Larangan menjual produk dengan stok nol | Perbaikan |
| 2026-01-20 02:13 | `a08f82a` | POS | Kuantitas keranjang dan peringatan stok | Ubah |
| 2026-01-03 04:52 | `b45c534` | Cabang/Inventori | Penyempurnaan modul cabang dan inventori | Ubah |
| 2025-12-22 01:26 | `b0a93a9` | Inventori | Import Excel | Baru |
| 2025-12-21 05:08 | `dab39f6` | POS/SDM | Penyempurnaan modul POS dan HR | Ubah |
| 2025-12-20 01:09 | `4159e7a` | Inti | Kerangka ERP multi-cabang | Baru |
| 2025-12-14 06:15 | `8afd945` | Shell | Perbaikan route yang rusak | Perbaikan |
| 2025-12-14 06:03 | `2554ede` | Inti | Rancangan awal ERP multi-cabang | Baru |

> Commit "Changes" (`64a1b91`, `f1cd41e`, `6b1659d`, `00149ef`, `7384b90`, `f3c1b96`,
> `04d7230`, `11b64d2`, `276c81f`) adalah pasangan otomatis dari commit fitur di atas dan tidak
> menambah fitur.

---

## 2. Katalog fitur saat ini (per 2026-10-27)

Keterangan: **Ada** = berfungsi penuh • **Sebagian** = berjalan dengan batasan yang disebut •
**Belum** = belum tersedia di UI.

### 2.1 Autentikasi & onboarding

| Fitur | Status | Catatan |
|---|---|---|
| Login email/password | Ada | Better Auth, cookie httpOnly |
| Registrasi tenant mandiri | Ada | Membuat DB + skema + cabang utama + pemilik |
| Pemilihan mode (POS / Back Office) | Ada | `/mode-select`, mengarah ke cabang tugas |
| Lupa password | Belum | Tautan ada, halaman belum dirutekan |
| Ganti password mandiri | Belum | Reset dilakukan admin lewat endpoint |
| Undang/aktifkan/nonaktifkan karyawan | Sebagian | Buat & reset password ada; belum ada alur undangan email |

### 2.2 POS (front office)

| Fitur | Status | Catatan |
|---|---|---|
| Katalog produk + pencarian | Ada | Kategori diambil dari tabel `categories` |
| Keranjang, ubah qty, hapus baris | Ada | |
| Multi-satuan (kg, karung, dus, pcs) | Ada | Harga & konversi per satuan jual |
| Diskon & pajak saat bayar | Ada | Diskon dihitung di transaksi; belum disimpan sebagai kolom tersendiri |
| Metode bayar tunai/kartu/e-wallet | Ada | `cash` / `card` / `ewallet` |
| Kembalian tunai | Ada | `amount_paid - total_amount` |
| Pilih pelanggan (member) | Belum | `customer_id` sudah ada di skema |
| Scan barcode | Sebagian | Barcode bisa dibuat & dicetak; input scanner belum ditangani |
| Cetak struk | Belum | Pengaturan struk sudah tersimpan, renderer belum ada |
| Shift: buka/tutup kas | Ada | Kas awal, kas akhir, kas seharusnya, selisih |
| Riwayat transaksi & detail | Ada | Dengan pagination |
| Void/refund transaksi | Belum | Status `void` ada di skema, belum ada aksi UI |

### 2.3 Inventori & pengadaan

| Fitur | Status | Catatan |
|---|---|---|
| CRUD produk + kategori + supplier | Ada | Combobox bisa menambah kategori/supplier baru |
| SKU otomatis | Ada | Format `PREFIX-YYYYMMDD-SEQ` |
| Barcode per satuan | Ada | `react-barcode`, unduh PNG |
| Multi-satuan & konversi | Ada | Unik per `(product_id, conversion_factor)` |
| Batch + expiry + HPP | Ada | Batch menyimpan `cost_price`, `expiry_date`, `received_at` |
| Metode pengeluaran stok | Ada | `fifo` (bawaan) / `lifo` / `fefo` di `tenants.settings.inventory.stock_issue_method`, diubah di Pengaturan → Inventori; hanya owner/admin |
| Gudang & pemetaan ke cabang | Ada | `/backoffice/warehouses`; gudang pusat/regional/toko, satu gudang default per cabang, gudang bersama (`branch_id` NULL) boleh melayani banyak cabang |
| Peringatan stok minimum | Ada | Dari `min_stock_level` |
| Stock opname | Ada | Penyesuaian positif/negatif dengan alasan |
| Transfer antar gudang | Ada | `pending → completed`, per batch, simpan expiry & HPP; gudang asal/tujuan dipilih dari `warehouses` |
| Transfer bertahap (in-transit, terima sebagian) | Belum | Hanya dua status |
| Purchase order | Ada | draft/ordered/received, item + total |
| Import/Export produk (Excel) | Ada | `xlsx` |
| Hapus produk | Sebagian | Tetap menghapus permanen; transaksi lama kehilangan referensi produk |

### 2.4 Vendor

| Fitur | Status | Catatan |
|---|---|---|
| Master vendor | Ada | Kode otomatis `VND-0001`, badan usaha, kategori, NPWP, website, alamat (kota/provinsi/kodepos), kontak |
| Termin & kebijakan pembelian | Ada | Termin 0/7/14/30/45/60/90 hari, limit kredit, lead time, rating 0–5 bintang |
| Rekening bank vendor | Ada | Dipakai sebagai tujuan transfer saat membayar hutang |
| Status vendor | Ada | Aktif / nonaktif / blacklist; status tampil sebagai badge di daftar & detail |
| Katalog produk per vendor | Ada | `vendor_products`: SKU vendor, harga beli terakhir, lead time, minimum order, penanda vendor utama |
| Purchase order per vendor | Ada | PO memilih vendor dari master; daftar produk disaring ke katalog vendor tersebut (vendor utama + tautan `vendor_products`) |
| Hutang & pembayaran vendor | Ada | Tagihan manual, bayar sebagian/penuh, metode bayar + nomor referensi, riwayat pembayaran |
| Statistik & export | Ada | Total vendor, aktif, total hutang, tagihan lewat jatuh tempo; export Excel |
| Hapus vendor | Sebagian | Ditolak bila masih dipakai produk/PO/tagihan; gunakan status nonaktif |
| Penilaian otomatis (on-time delivery) | Belum | Rating diisi manual |

### 2.5 Keuangan

| Fitur | Status | Catatan |
|---|---|---|
| Pengeluaran (expenses) | Ada | Kategori, tanggal, jatuh tempo, status, jumlah dibayar |
| Hutang usaha (AP) | Ada | Dibaca dari `expenses` yang belum lunas + pembayaran |
| Piutang usaha (AR) | Ada | Dari `transactions` dengan `total_amount > amount_paid` + penerimaan |
| Cashflow | Ada | Pemasukan penjualan vs pengeluaran |
| Jurnal umum | Sebagian | Disusun saat baca (basis kas), bukan tabel jurnal |
| Tutup buku / neraca saldo | Belum | Butuh COA + jurnal persisten |

### 2.6 CRM

| Fitur | Status | Catatan |
|---|---|---|
| Data pelanggan | Ada | Termasuk `total_spent`, `points` |
| Data supplier | Ada | Sudah dipindah ke modul **Vendor** (§2.4): master lengkap, katalog produk, hutang & pembayaran |
| Riwayat transaksi per pelanggan | Belum | Bergantung pada pemilihan pelanggan di POS |

### 2.7 SDM

| Fitur | Status | Catatan |
|---|---|---|
| Data karyawan + role | Ada | 7 peran (lihat §3) |
| Gaji pokok | Ada | Dipakai laporan payroll |
| Presensi (check-in/out) | Sebagian | Tercatat di `attendance`, tapi input manual bukan jam otomatis |
| Lembur | Sebagian | Kolom `overtime` ada, input manual |
| Cuti | Ada | Pengajuan + status; approval belum berjejak audit |
| Slip gaji | Belum | Laporan payroll berupa tabel, bukan slip |

### 2.8 Laporan

| Fitur | Status | Catatan |
|---|---|---|
| Laporan penjualan | Ada | Filter periode + cabang, export Excel |
| Laporan inventori | Ada | Nilai stok, stok minimum |
| Laporan keuangan | Ada | Basis kas |
| Laporan karyawan/payroll | Ada | Jadwal & presensi berbagi halaman |
| Dashboard | Ada | KPI, grafik penjualan, performa cabang, stok menipis, transaksi terbaru |

### 2.9 Pengaturan & audit

| Fitur | Status | Catatan |
|---|---|---|
| Struk (footer, logo) | Ada | Tersimpan di `tenants.settings.receipt` |
| Pajak & diskon default | Ada | Belum dipakai otomatis di POS |
| Rekening bank | Ada | Untuk tampilan di struk |
| Matriks role & izin | Ada | Tersimpan di `settings.role_permissions`, dipakai sebagian |
| Metode pengeluaran stok | Ada | Tab **Inventori**; `settings.inventory.stock_issue_method` (`fifo`/`lifo`/`fefo`) |
| Profil perusahaan | Sebagian | Nama/slug tenant; alamat ada di cabang |
| Audit log | Sebagian | Tercatat, tetapi belum ada layar penjelajah audit |

---

## 3. Peran dan akses menu

Sumber: `src/App.tsx` (`allowedRoles`) dan `src/config/roles.ts`.

| Menu | platform_owner | tenant_owner | tenant_admin | store_manager | cashier | warehouse | staff |
|---|---|---|---|---|---|---|---|
| `/pos` | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| `/pos/transactions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/pos/shifts` | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| `/backoffice` (dashboard) | ✓ | ✓ | ✓ | ✓ | – | – | – |
| CRM supplier & pelanggan | ✓ | ✓ | ✓ | ✓ | – | – | – |
| Cabang & transfer | ✓ | ✓ | ✓ | ✓ | – | – | – |
| Gudang (`/backoffice/warehouses`) | ✓ | ✓ | ✓ | ✓ | – | – | – |
| Inventori (produk, stok masuk, opname, PO) | ✓ | ✓ | ✓ | ✓ | – | – | – |
| Keuangan (jurnal, AP/AR, cashflow, pengeluaran) | ✓ | ✓ | ✓ | ✓ | – | – | – |
| SDM (karyawan, presensi, jadwal, payroll) | ✓ | ✓ | ✓ | – | – | – | – |
| Laporan | ✓ | ✓ | ✓ | ✓ | – | – | – |
| Pengaturan | ✓ | ✓ | ✓ | – | – | – | – |

Catatan: `admin` masih diterima di beberapa guard sebagai nama peran lama; peran resmi yang
dipakai hari ini adalah tujuh di atas.
