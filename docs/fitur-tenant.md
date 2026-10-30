# Fitur Tenant (aplikasi yang dipakai pelanggan)

| | |
|---|---|
| Dokumen | `docs/fitur-tenant.md` |
| Terakhir diperbarui | **2026-10-30** |
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

### 2026-10-28 — kategori trader, akses vendor, dan demo satu gudang (belum di-commit)

| Waktu | Ref | Modul | Perubahan | Status |
|---|---|---|---|---|
| 2026-10-28 | — (working tree) | Vendor | Kategori vendor bertambah **Trader** (membeli lalu menjual kembali tanpa memproduksi) di samping Supplier, Distributor, Pabrikan, Penyedia Jasa, dan Lainnya; kolomnya teks bebas sehingga tidak perlu migrasi | Baru |
| 2026-10-28 | — (working tree) | Navigasi | Layar mode-select menampilkan kartu **Vendor & Supplier** yang langsung membuka `/backoffice/vendors` | Baru |
| 2026-10-28 | — (working tree) | Navigasi | Grup menu sidebar otomatis terbuka mengikuti halaman yang sedang dibuka, sehingga Data Vendor/Hutang Vendor tidak lagi tersembunyi saat halaman vendor dimuat langsung | Perbaikan |
| 2026-10-28 | — (working tree) | Layout | Sidebar back office menampilkan nama dan peran pengguna dari sesi, bukan lagi teks tetap "Admin / Super Admin" | Perbaikan |
| 2026-10-28 | — (working tree) | Dashboard | Stok minimum dihitung per **gudang**, bukan per cabang (menggantikan baris perhitungan per cabang di atas): cabang-cabang yang menarik stok dari gudang yang sama tidak lagi memunculkan baris peringatan ganda, dan badge menampilkan nama gudangnya | Perbaikan |
| 2026-10-28 | — (working tree) | Demo | Tenant contoh Thalia memakai **satu** gudang — Gudang Pusat Depok, Jl. Arif Rahman Hakim No. 96 dekat Toko Pusat — yang melayani ketiga cabang; stok tiap produk menjadi satu angka, dua batch FIFO tetap ada di gudang itu, dan tidak ada transfer karena tidak ada lokasi kedua | Ubah |
| 2026-10-28 | — (working tree) | Demo/Auth | Owner Thalia bernama **Surya** dengan email `owner@tokobahankue.com`; email staf dan cabang ikut pindah ke domain `tokobahankue.com` | Ubah |

### 2026-10-28 — pesanan cabang ke gudang, rak toko, dan akses staf gudang (belum di-commit)

**Menggantikan** baris "Tenant contoh Thalia memakai **satu** gudang … tidak ada transfer karena
tidak ada lokasi kedua" di bagian sebelumnya: sekarang ada satu gudang pusat **dan** satu rak per
toko, sehingga transfer memang terjadi.

| Waktu | Ref | Modul | Perubahan | Status |
|---|---|---|---|---|
| 2026-10-28 | — (working tree) | Pesanan Cabang | Dokumen **pesanan cabang ke gudang** (`stock_requests` + `stock_request_items`), nomor `REQ/YYYYMMDD-<KODE>-####` per cabang per hari. Alur status: `draft → submitted → approved/rejected → in_transit → received`, batal dari `draft`/`submitted`/`approved`. Kuantitas per baris dalam satuan dasar | Baru |
| 2026-10-28 | — (working tree) | Pesanan Cabang | Halaman `/backoffice/branches/orders`: kartu statistik, tab **Semua / Menunggu / Disiapkan / Dikirim / Selesai**, filter cabang (manajer toko terkunci ke cabangnya), pencarian, pagination, export Excel | Baru |
| 2026-10-28 | — (working tree) | Pesanan Cabang | Form pesanan: banyak baris, satuan jual + faktor konversi, kolom **stok gudang** dan **stok minimum**, aksi "Isi dari stok minimum", simpan sebagai draft atau langsung kirim | Baru |
| 2026-10-28 | — (working tree) | Pesanan Cabang | Modal detail: linimasa status, kuantitas **diminta / disetujui / dikirim / diterima** per baris, aksi sesuai status & peran (**Setujui & sesuaikan**, **Tolak + alasan**, **Siapkan & Kirim**, **Terima**, **Batalkan**), serta tautan ke dokumen transfer yang dihasilkan | Baru |
| 2026-10-28 | — (working tree) | Pesanan Cabang | Guard kuantitas: disetujui ≤ diminta, dikirim ≤ disetujui, diterima ≤ dikirim (selisih disimpan, tidak dibetulkan diam-diam); kirim ditolak bila `stok - terkomit < jumlah kirim` di gudang itu | Baru |
| 2026-10-28 | — (working tree) | Pesanan Cabang | Setiap transisi menulis audit log (`create`/`submit`/`approve`/`reject`/`dispatch`/`receive`/`cancel_stock_request`) | Baru |
| 2026-10-28 | — (working tree) | Gudang | **Rak toko per cabang**: gudang bertipe `store` milik cabang, ditandai badge **Rak Toko** di halaman Gudang, jadi gudang pusat bisa memenuhi pesanan tanpa kehilangan stok yang sudah dijanjikan ke kanal lain. Kanal online tidak punya rak dan tetap dilayani dari gudang pusat | Baru |
| 2026-10-28 | — (working tree) | Inventori | Tombol **Buat Pesanan Cabang** di tampilan stok menipis, dan aksi **Pesan ke Gudang** per baris di panel stok menipis dashboard (sudah terisi produk + saran kuantitas) | Baru |
| 2026-10-28 | — (working tree) | Inventori | Persetujuan transfer dipusatkan ke satu modul (`src/lib/stock-movement.ts`); status transfer menerima `in_transit` sehingga pengiriman dan penerimaan bisa dipisah dan selisihnya tercatat. Halaman Inventori tidak lagi punya salinan logika sendiri (lihat KS-25) | Perbaikan |
| 2026-10-28 | — (working tree) | Cabang | Modal detail cabang mendapat tab **Pesanan** (10 pesanan terakhir + jumlah yang masih berjalan) | Baru |
| 2026-10-28 | — (working tree) | Akses | Peran **warehouse** bisa masuk back office, terbatas pada menu stok: Dashboard tidak ditampilkan, dan Kartu Back Office di layar mode-select mengarahkannya ke **Pesanan Cabang** agar tidak terlempar balik ke mode-select | Baru |
| 2026-10-28 | — (working tree) | Navigasi | Menu sidebar punya `allowedRoles` per item dan pesanan cabang membawa badge jumlah pesanan yang menunggu | Baru |
| 2026-10-28 | — (working tree) | Pengaturan | Matriks role bertambah izin `request_stock`, `approve_stock_request`, `dispatch_stock` (bawaan: store_manager meminta; warehouse meminta/menyetujui/mengirim; owner/admin semuanya) | Baru |
| 2026-10-28 | — (working tree) | Demo | Thalia: 1 gudang pusat + **2 rak toko** (Rak Toko Pusat, Rak Toko 2), stok katalog dipecah per lokasi, dan **4 pesanan** contoh — 1 draft, 1 submitted (urgent), 1 `in_transit` dengan transfer tertaut, 1 `received` dari kanal online | Ubah |

### 2026-10-28 — toko online, katalog publik, dan data plane cloud (belum di-commit)

| Waktu | Ref | Modul | Perubahan | Status |
|---|---|---|---|---|
| 2026-10-28 | — (working tree) | Toko Online | Aplikasi kedua `tokoonline/` (TanStack Start) menjadi etalase cabang **Thalia Online**: beranda, katalog dengan pencarian & kategori, halaman produk dengan pilihan satuan, keranjang, checkout, riwayat pesanan, dan chat CS | Baru |
| 2026-10-28 | — (working tree) | Toko Online | Seluruh produk, harga per satuan, dan stok diambil dari back office lewat `GET /api/storefront/catalog`; tidak ada produk hardcoded dan tidak ada kredensial database di browser pengunjung | Baru |
| 2026-10-28 | — (working tree) | Toko Online | Gudang pemenuh dipilih server (gudang bersama → pusat → default) dan rak cabang toko dikecualikan, sehingga angka stok di web sama dengan stok yang benar-benar bisa dikirim | Baru |
| 2026-10-28 | — (working tree) | Toko Online | Merek toko menjadi **Thalia — Toko Bahan Kue** (judul, logo, warna, kode pesanan `THL-…`, rekening atas nama Thalia) | Ubah |
| 2026-10-28 | — (working tree) | Toko Online | Keranjang dan pesanan pengunjung **masih** disimpan di perangkat (`localStorage`); belum masuk ke database tenant | Baru (prototype) |
| 2026-10-28 | — (working tree) | Operasional | Penyiapan data plane cloud dalam satu perintah: `npm run demo:cloud` membuat control DB + DB tenant di Turso, menerapkan skema, mendaftarkan pemilik, dan mengisi data Thalia | Baru |
| 2026-10-28 | — (working tree) | Operasional | Back office + API berjalan di https://retailpro-thalia.vercel.app dan toko di https://thalia-storefront.vercel.app, keduanya membaca Turso cloud (bukan database file) | Baru |
| 2026-10-28 | — (working tree) | Operasional | Login produksi, bootstrap token tenant, dashboard, dan katalog toko sudah diverifikasi end-to-end di domain tersebut | Baru |

### 2026-10-30 — pengadaan berjenjang: PO, persetujuan, dan penerimaan barang (belum di-commit)

**Menggantikan** baris "Purchase order tersimpan sebagai dokumen (draft/ordered/received) dan
penerimaannya membuat hutang" serta "Penerimaan PO menulis hutang ke `expenses`" di log
2026-10-27: purchase order kini punya persetujuan, dan barang masuk lewat dokumen penerimaan
sendiri (`docs/spec-purchase-order.md`).

| Waktu | Ref | Modul | Perubahan | Status |
|---|---|---|---|---|
| 2026-10-30 | — (working tree) | Inventori | Status purchase order menjadi `draft → submitted → approved → partially_received → received`, ditambah `rejected` dan `cancelled` (keduanya final). Status `ordered` dipensiunkan dan dipindahkan ke `approved` oleh migrasi. Tidak ada stok yang bergerak sebelum `approved` | Ubah |
| 2026-10-30 | — (working tree) | Inventori | Tab **Purchase Order** berisi daftar sebenarnya: kartu statistik (PO terbuka, menunggu persetujuan, terlambat, nilai bulan ini), filter status/vendor/periode/pencarian, pagination, dan tombol aksi per baris yang mengikuti status **dan** izin pengguna | Baru |
| 2026-10-30 | — (working tree) | Inventori | Sheet detail PO: identitas vendor & gudang tujuan, total, baris pesanan dengan kolom **dipesan / sudah diterima / sisa**, daftar dokumen penerimaan, alasan penolakan/pembatalan, dan tombol aksi yang sama dengan daftar | Baru |
| 2026-10-30 | — (working tree) | Inventori | Editor PO hanya menyimpan **draf** (tombol *Simpan Draf* / *Simpan & Ajukan*); nomor dokumen `PO-YYYYMMDD-NNNN` dibuat di dalam transaksi penyimpanan sehingga percobaan ulang tidak membakar nomor baru; kuantitas menerima desimal sampai 3 angka (0,5 kg) | Ubah |
| 2026-10-30 | — (working tree) | Inventori | **Penerimaan barang** menjadi dokumen sendiri (`goods_receipts` + `goods_receipt_items`, nomor `GRN-YYYYMMDD-NNNN`): satu PO bisa diterima berkali-kali, tiap baris mencatat jumlah yang datang, harga yang benar-benar dibayar, nomor batch, dan tanggal kedaluwarsa. Stok hanya bertambah di sini | Baru |
| 2026-10-30 | — (working tree) | Inventori | Penerimaan dijaga: tidak boleh melebihi sisa pesanan, gudang tujuan harus masih aktif, dan untuk metode stok **FEFO** tanggal kedaluwarsa wajib diisi serta harus setelah tanggal terima. Satu transaksi menulis dokumen, batch, status, dan tagihan — gagal di tengah berarti tidak ada yang tersimpan | Baru |
| 2026-10-30 | — (working tree) | Keuangan | **Satu tagihan per penerimaan**, bukan per PO: nominal dan tanggal mengikuti barang yang benar-benar datang, jatuh tempo mengikuti termin yang disalin ke PO saat dibuat (perubahan termin vendor tidak menggeser tagihan lama). Pembelian tunai (termin 0) langsung tercatat lunas | Ubah |
| 2026-10-30 | — (working tree) | Keuangan | Tagihan pembelian menyimpan `purchase_order_id` dan `goods_receipt_id`, menggantikan tautan lewat teks keterangan; pembayaran hutang menyalin `purchase_order_id` ke `vendor_payments` sehingga riwayat pembayaran bisa ditelusuri sampai PO-nya | Ubah |
| 2026-10-30 | — (working tree) | Vendor | Tab Purchase Order memakai label status baru (Diterima Sebagian, Ditolak), kolom **Nilai diterima** diambil dari dokumen penerimaan alih-alih total PO, dan tiap baris bisa diklik untuk membuka dokumen PO-nya | Ubah |
| 2026-10-30 | — (working tree) | Pengaturan | Izin baru `create_po`, `approve_po`, `receive_po`, `cancel_po` dan peran **purchasing**: pembuat PO tidak otomatis boleh menyetujuinya; menyetujui PO buatan sendiri hanya boleh untuk owner, dan staf gudang kini bisa mencatat barang datang | Baru |
| 2026-10-30 | — (working tree) | Pengaturan | Matriks role yang sudah pernah disimpan tenant tidak lagi menghapus izin yang terbit belakangan: nilai tersimpan ditumpuk di atas bawaan, jadi izin baru tetap aktif sementara `false` eksplisit tetap menang. Sebelumnya tenant yang pernah menekan Simpan di layar Role kehilangan **semua** izin sesudahnya (tombol Buat PO tidak muncul untuk owner) | Perbaikan |
| 2026-10-30 | — (working tree) | Gudang | Pemilih gudang pada PO, penerimaan, dan transfer hanya menampilkan gudang **aktif**; label dokumen lama tetap bisa menyebut gudang yang sudah dinonaktifkan | Perbaikan |
| 2026-10-30 | — (working tree) | Demo | Thalia punya 7 purchase order contoh yang mencakup semua status (draft, submitted, approved, partially_received, 2× received, rejected) berikut dokumen penerimaan dan tagihannya, termasuk satu PO yang baru datang sebagian | Ubah |
| 2026-10-30 | — (working tree) | Skema | Versi skema **5**: migrasi `005_procurement_lifecycle` menambah kolom siklus PO, tabel penerimaan, dan tautan PO/GRN pada batch serta biaya | Baru |
| 2026-10-30 | — (working tree) | Inventori | Kolom **Diterima** pada daftar PO memakai total PO untuk pesanan yang sudah `received` tetapi tidak punya dokumen penerimaan (sisa kode satu-langkah lama), sehingga tidak lagi tampil Rp 0 untuk barang yang sudah ada di rak | Perbaikan |

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

## 2. Katalog fitur saat ini (per 2026-10-28)

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
| Gudang & pemetaan ke cabang | Ada | `/backoffice/warehouses`; gudang pusat/regional/toko, satu gudang default per cabang, gudang bersama (`branch_id` NULL) boleh melayani banyak cabang. Gudang bertipe toko tampil dengan badge **Rak Toko** |
| Peringatan stok minimum | Ada | Dari `min_stock_level`, dihitung per gudang (gudang pusat adalah pemasok pesanan cabang); tiap baris punya aksi **Pesan ke Gudang** |
| Pesanan cabang ke gudang | Ada | `/backoffice/branches/orders`; `draft → submitted → approved/rejected → in_transit → received`, kuantitas disetujui/dikirim/diterima per baris, audit per transisi |
| Stock opname | Ada | Penyesuaian positif/negatif dengan alasan |
| Transfer antar gudang | Ada | `pending → in_transit → completed`, per batch, simpan expiry & HPP; gudang asal/tujuan dipilih dari `warehouses`; menampilkan nomor pesanan asal bila tertaut |
| Transfer bertahap (terima sebagian) | Sebagian | Pengiriman dan penerimaan sudah terpisah dan selisih dicatat; belum ada penerimaan bertahap dalam beberapa kedatangan |
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

### 2.10 Toko online (`tokoonline/`)

Aplikasi terpisah untuk cabang online; dibuka pengunjung, bukan staf. Data berasal dari back office.

| Fitur | Status | Catatan |
|---|---|---|
| Katalog dari database tenant | Ada | `GET /api/storefront/catalog?slug=thalia`; 7 kategori, 28 produk, teks "dikirim dari Gudang Pusat Depok" |
| Harga & satuan jual per produk | Ada | Mengikuti `product_units`; satuan dasar bisa pecahan (mis. 0,5 kg) |
| Stok yang bisa dikirim | Ada | `SUM(product_batches)` di gudang pemenuh; diperbarui setiap permintaan, tanpa cache |
| Pencarian & filter kategori | Ada | Di `/katalog` |
| Keranjang, checkout, riwayat pesanan | Ada | Disimpan di perangkat pengunjung (kunci `thalia-storefront`), bukan di DB tenant |
| Pesanan masuk ke back office | Belum | Prototype; menulis ke DB tenant harus lewat `src/lib/stock-movement.ts` |
| Akun pelanggan / login pembeli | Belum | Checkout tanpa akun; autentikasi toko dimatikan (`VITE_AUTH_ENABLED=false`) |
| Pembayaran online | Belum | Metode bayar dipilih di checkout, belum ada integrasi gateway |
| Chat CS | Sebagian | Menjawab dari katalog yang sama; bukan kanal pesan tersimpan |

---

## 3. Peran dan akses menu

Sumber: `src/App.tsx` (`allowedRoles`), `src/config/roles.ts`, dan `allowedRoles` per item di
`src/components/layout/BackOfficeLayout.tsx`.

| Menu | platform_owner | tenant_owner | tenant_admin | store_manager | cashier | warehouse | staff |
|---|---|---|---|---|---|---|---|
| `/pos` | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| `/pos/transactions` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/pos/shifts` | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| `/backoffice` (dashboard) | ✓ | ✓ | ✓ | ✓ | – | – | – |
| CRM supplier & pelanggan | ✓ | ✓ | ✓ | ✓ | – | – | – |
| Daftar cabang & dashboard cabang | ✓ | ✓ | ✓ | ✓ | – | – | – |
| Pesanan cabang (`/backoffice/branches/orders`) | ✓ | ✓ | ✓ | ✓ | – | ✓ | – |
| Gudang (`/backoffice/warehouses`) | ✓ | ✓ | ✓ | ✓ | – | ✓ | – |
| Transfer stok (`/backoffice/branches/transfer`) | ✓ | ✓ | ✓ | ✓ | – | ✓ | – |
| Produk (`/backoffice/inventory/products`) | ✓ | ✓ | ✓ | ✓ | – | ✓ | – |
| Stok opname (`/backoffice/inventory/opname`) | ✓ | ✓ | ✓ | ✓ | – | ✓ | – |
| Stok masuk & purchase order | ✓ | ✓ | ✓ | ✓ | – | – | – |
| Keuangan (jurnal, AP/AR, cashflow, pengeluaran) | ✓ | ✓ | ✓ | ✓ | – | – | – |
| SDM (karyawan, presensi, jadwal, payroll) | ✓ | ✓ | ✓ | – | – | – | – |
| Laporan | ✓ | ✓ | ✓ | ✓ | – | – | – |
| Pengaturan | ✓ | ✓ | ✓ | – | – | – | – |

Catatan:
- `admin` masih diterima di beberapa guard sebagai nama peran lama; peran resmi yang dipakai hari
  ini adalah tujuh di atas.
- **warehouse** mendapat potongan back office khusus dokumen stok. Karena `/backoffice` tetap
  manager-only, entri back office untuk peran ini diarahkan ke **Pesanan Cabang**
  (`src/pages/ModeSelect.tsx`); menu lain tidak ditampilkan agar tidak ada tautan yang berujung
  pengalihan.
- Transfer stok dan opname dijaga `STOCK_DOCS` (manager + warehouse), sedangkan stok masuk dan PO
  tetap `BACK_OFFICE` — staf gudang menerima barang lewat pesanan cabang, bukan lewat PO.
