# Fitur Tenant (aplikasi yang dipakai pelanggan)

| | |
|---|---|
| Dokumen | `docs/fitur-tenant.md` |
| Terakhir diperbarui | **2026-11-06** |
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

### 2026-10-31 — varian produk, harga beli per pecahan, dan pricelist vendor (belum di-commit)

Rancangan, alasan, dan yang sengaja ditolak: `docs/spec-varian-harga-vendor.md`.

**Menggantikan** baris "Harga jual tidak ada di `products`; harga ada di `product_units.price`"
di [backend.md](backend.md) §5.3: sekarang ada tiga lapis — produk (model), varian (SKU), pecahan
(varian × satuan jual) — dan harga beli per pecahan disimpan apa adanya.

| Waktu | Ref | Modul | Perubahan | Status |
|---|---|---|---|---|
| 2026-10-31 | — (working tree) | Skema | Versi skema **6**: migrasi `006_variants_pricing` menambah `product_variants` (SKU, barcode, atribut, harga beli/jual), `vendor_price_list`, `products.variant_attributes`, `product_units.cost`/`variant_id`, dan `variant_id` di enam tabel stok/uang. Setiap produk lama memperoleh satu varian `Default` | Baru |
| 2026-10-31 | — (working tree) | Inventori | Produk kini **model**, bukan SKU: editor produk menyusun grup atribut (Rasa, Warna, Ukuran…), membangkitkan matriks varian × pecahan, dan menyimpan harga beli **dan** harga jual per pecahan. Dua rasa punya stok, barcode, dan harga sendiri; menghapus varian yang masih berstok ditolak | Ubah |
| 2026-10-31 | — (working tree) | Inventori | Harga beli karton tidak lagi dipaksa `harga_pcs × faktor`: kolom `product_units.cost` menyimpan angka yang disepakati vendor (Rp 260.000 per karton tetap Rp 260.000), dan satuan dasar hanya diturunkan untuk laporan | Ubah |
| 2026-10-31 | — (working tree) | Vendor | Dua tab baru di detail vendor: **Harga Beli** (pricelist per varian × pecahan, harga terakhir dibayar, aktif/nonaktif) dan **Riwayat Harga** (harga yang benar-benar ditagihkan per penerimaan). Harga jual **tidak** ada di sini — itu milik produk | Baru |
| 2026-10-31 | — (working tree) | Inventori | Editor PO memilih varian per baris dan mengambil harga dengan urutan **pricelist vendor → `product_units.cost` → harga dasar × faktor**. Mengubah pecahan tidak lagi mengubah harga satuan secara diam-diam, dan baris tanpa kesepakatan ditandai *harga belum disepakati* tetapi tetap bisa disimpan | Ubah |
| 2026-10-31 | — (working tree) | Inventori | Penerimaan barang menulis `variant_id` ke batch dan dokumennya; bila harga tagihan berbeda dari pricelist, selisihnya dicatat di `audit_logs` dan pecahan yang belum punya kesepakatan diisi dari harga yang benar-benar dibayar (tanpa pernah menimpa harga yang sudah disepakati) | Ubah |
| 2026-10-31 | — (working tree) | Kasir | Layar kasir memilih **varian lalu pecahan**: stok yang ditekan, pra-cek sebelum bayar, dan pemotongan batch (FIFO/LIFO/FEFO) semuanya per varian, sehingga menjual Cokelat tidak mengurangi stok Putih. `transaction_items.variant_id` terisi sejak transaksi pertama | Ubah |
| 2026-10-31 | — (working tree) | Gudang | Transfer dan stok opname menghitung per varian: satu baris opname per varian dengan stok sistemnya sendiri, dan transfer memindahkan paket milik varian yang dipilih. Selisih satu rasa tidak lagi tertutup oleh rasa lain | Ubah |
| 2026-10-31 | — (working tree) | Pengaturan | Izin baru `manage_variants`, `manage_vendor_prices`, `manage_sell_prices`, ketiganya **tertutup** untuk `store_manager`, `warehouse`, dan `purchasing` secara bawaan; owner/admin mendapatkannya lewat daftar izin penuh | Baru |
| 2026-11-01 | — (working tree) | Pengaturan | Wewenang kelola **template produk** dan **template vendor** kini benar-benar di-gate di layar: tombol "Tambah Produk"/"Edit"/"Hapus" (Inventory) dan "Tambah Vendor"/"Edit"/"Hapus"/"Hubungkan Produk" (Vendor) hanya muncul untuk pemegang `manage_variants`/`manage_vendor_prices`; peran lain tetap bisa membaca. Guard defensif ditambahkan di jalur tulis agar tab basi tidak bisa menyimpan | Ubah |
| 2026-11-01 | — (working tree) | Inventori | Daftar **satuan ritel Indonesia** kanonis (`src/lib/units.ts`: Pcs, Sachet, Stick, Renceng, Dus, Karton, Kaleng, Botol, Lusin=12, Gross=144, Rim, Kg, Liter, Meter, …) ditawarkan lewat `<datalist>` di input nama pecahan — hanya saran, data lama tidak dinormalisasi/di-rename. Label turunan **"Isi 40 pcs"** (`unitLabel`) tampil konsisten di editor produk, harga vendor, dan kasir untuk pack besar | Baru |
| 2026-11-01 | — (working tree) | Pembelian | PO dapat **diisi dari template harga vendor**: satu tombol memetakan seluruh baris `vendor_price_list` aktif vendor terpilih menjadi baris draft (jumlah = `min_qty`, harga = `buy_price`) tanpa query/tabel baru; baris yang sudah ada tidak ditimpa, dan order tetap `draft` | Baru |
| 2026-11-01 | — (working tree) | Kasir | **Harga karton otomatis saat jual satuan** (opt-in `tenants.settings.pricing.auto_pack_price`, default mati): bila jumlah pcs sudah memenuhi sebuah pack besar yang lebih murah per satuan, harga baris diturunkan ke harga pack itu — **hanya `item.price`**, satuan/faktor/jumlah dan pengurasan batch tidak berubah — dengan badge "harga Dus otomatis (hemat …)". Floor `cost` mencegah harga di bawah modal. Demo Thalia menyalakannya | Baru |
| 2026-10-31 | — (working tree) | Demo | Thalia punya dua produk bervarian: **Susu Kental Manis** (Rasa Putih/Cokelat) dan **Pewarna Makanan** (Warna Merah/Kuning/Hijau/Biru), masing-masing dengan harga beli, harga jual pecahan, pricelist vendor, dan stok sendiri di gudang maupun rak | Ubah |
| 2026-10-31 | — (working tree) | Toko Online | `GET /api/storefront/catalog` menambah `variants[]` (SKU, label, atribut, stok gudang pemenuh, pecahan + harga). Bentuk lama `units`/`stock` per produk tetap dikirim supaya etalase yang sudah berjalan tidak perlu berubah | Ubah |

### 2026-11-01 — toko online menjadi marketplace lintas tenant

| Waktu | Ref | Modul | Perubahan | Status |
|---|---|---|---|---|
| 2026-11-01 | `6cd3e9b` | Toko Online | Etalase menjadi **marketplace semua tenant**, bukan etalase Thalia saja: `GET /api/storefront/marketplace` membaca control DB, memilih setiap tenant `active`, meminjam token pendek per tenant, lalu menggabungkan katalognya. Thalia turun menjadi salah satu penjual di dalamnya | Baru |
| 2026-11-01 | `6cd3e9b` | Toko Online | Beranda disusun ulang mengikuti pola marketplace: kolom pencarian, **slider** yang bisa digeser di ponsel (scroll-snap, autoplay 5,2 detik, berhenti begitu disentuh), **baris ikon kategori satu warna**, strip penjual, lalu grid "Untuk kamu" | Ubah |
| 2026-11-01 | `6cd3e9b` | Toko Online | Ikon kategori dipetakan dari nama kategori (`src/lib/category-icons.ts`): kategori baru buatan tenant langsung mendapat ikon tanpa ubah kode, dan semua ikon memakai satu warna teks badan agar tetap tenang | Baru |
| 2026-11-01 | `6cd3e9b` | Toko Online | Produk, halaman produk, dan baris keranjang kini **membawa penjualnya**: route menjadi `/product/$tenant/$slug`, kartu produk menampilkan nama toko, dan kunci baris keranjang menyertakan tenant sehingga dua tenant dengan SKU sama tidak saling menimpa | Ubah |
| 2026-11-01 | `6cd3e9b` | Toko Online | Filter beranda dan katalog bisa dibagikan sebagai tautan (`/katalog?q=&kategori=&toko=`); chip kategori dan filter penjual menulis ke URL, bukan state lokal | Ubah |
| 2026-11-01 | `6cd3e9b` | Toko Online | Merek etalase menjadi **Toko Bahan Kue** dengan sub-baris **Marketplace** (wordmark header `TOKO BAHAN KUE / MARKETPLACE`, monogram `T`, judul tab, deskripsi meta, halaman info, tagline, pemilik rekening, teks CS/WhatsApp). Kata "RetailPro" hanya tersisa sebagai nama back office di dalam kode, bukan di layar pembeli | Ubah |
| 2026-11-01 | `6cd3e9b` | Toko Online | Aksen etalase menjadi **rose**: `styles.css` memakai `#9d3455` untuk isi tombol/chip aktif/gelembung chat dan `#b04a68` untuk teks penekanan, netralnya diberi rona pink tipis, dan mode gelap memakai rose terang `#eaa4ba`. Harga produk di kartu dan halaman produk ikut rose supaya warna aksen terbaca di tempat yang paling penting | Ubah |
| 2026-11-01 | `6cd3e9b` | Toko Online | Membersihkan sisa cara pikir satu-toko setelah marketplace jadi: checkout & halaman pesanan **mengelompokkan barang per penjual** (subtotal per toko bila lebih dari satu), ongkir dan pembayaran tetap satu untuk seluruh pesanan (platform sebagai merchant of record), dan teks "ambil sendiri" tidak lagi menunjuk satu alamat | Ubah |
| 2026-11-01 | `6cd3e9b` | Toko Online | Tautan produk lama `/product/<slug>` dialihkan ke `/product/<tenant>/<slug>` (atau `/katalog?q=<slug>` bila sudah tidak ada), jadi tautan yang sudah beredar di chat/WhatsApp tetap hidup — lihat KS-34 | Baru |
| 2026-11-01 | `6cd3e9b` | API | `GET /api/storefront/marketplace` tidak lagi mengirim pesan error database ke pengunjung: tenant yang gagal masuk `skipped[]` sebagai `{slug, reason:"unavailable"}` dan detailnya hanya ke log server — lihat KS-33 | Ubah |
| 2026-11-01 | — (working tree) | Toko Online | Banner beranda memakai **gambar** yang disiapkan untuk etalase (`public/slider/`): dua banner TokoBahanKue 16:9, tiap banner menaut ke `/katalog`, teksnya sudah ada di dalam gambar sehingga tidak ada lapisan teks tambahan. Tiga slide teks lama (jumlah toko, jumlah produk, asal gudang) dihapus; angka yang sama tetap tampil di strip penjual dan grid produk | Ubah |

### 2026-11-05 — sistem role & izin (belum di-commit)

| Waktu | Ref | Modul | Perubahan | Status |
|---|---|---|---|---|
| 2026-11-05 | — (working tree) | Akses | **Satu identitas, satu penulis**: perubahan peran/cabang/aktif karyawan ditulis ke control DB lalu dicerminkan ke proyeksi tenant lewat endpoint `PATCH`/`DELETE /api/admin/users/[id]`; halaman Karyawan/Cabang tidak lagi menulis proyeksi secara langsung sehingga perubahan benar-benar berlaku saat login berikutnya | Perbaikan |
| 2026-11-05 | — (working tree) | Akses | Karyawan nonaktif/terhapus tidak lagi menerima token: `api/tenant/bootstrap` membaca proyeksi dan menolak `403 account_inactive`, dan `PATCH {active:false}` set `status=inactive` + `banned=1` agar Better Auth menolak login | Baru |
| 2026-11-05 | — (working tree) | Izin | **Satu katalog & satu resolver**: `PERMISSION_CATALOG` (kunci + label + hint) di `src/config/roles.ts` dan `src/lib/permission-matrix.ts` menggantikan tiga mesin izin yang berbeda; guard rute memakai kunci izin (`can(...)`), bukan daftar peran | Baru |
| 2026-11-05 | — (working tree) | Izin | `usePermissions()` dibaca lewat TanStack Query (kunci `['tenant-settings']`), di-seed dari bootstrap agar render pertama tidak berkedip, dan di-invalidasi tiap matriks disimpan | Ubah |
| 2026-11-05 | — (working tree) | Pengaturan | **Role custom + scope lokasi** milik owner disimpan di dokumen `tenants.settings` (`custom_roles`, `role_scopes`) tanpa migrasi skema: buat/duplikat/hapus role, editor matriks master/detail dengan pencarian izin, dan penerapan "dimana" (cabang/gudang) di Dashboard, Pesanan Cabang, Inventori, POS, dan badge | Baru |
| 2026-11-05 | — (working tree) | UI/UX | Editor matriks dan halaman Karyawan responsif (kartu di layar kecil, tabel di `md`+), target sentuh `min-h-11`, primitif `permission-row` dan varian tombol `touch`, serta panel "Hubungi owner" saat tak ada layar yang bisa dibuka | Baru |
| 2026-11-05 | — (working tree) | Akses | Peran `purchasing` kini benar-benar bisa dibuat dan punya kartu mode-select serta akses `/backoffice/inventory/po` (selama ini dideklarasikan tapi tak bisa dibuat) | Perbaikan |
| 2026-11-05 | — (working tree) | Karyawan | **Absensi terkunci hari berjalan**: field Tanggal pada modal Tambah Absensi di-read-only-kan ke tanggal hari ini (WIB) dan skema v7 menambahkan trigger `trg_attendance_today_only` yang menolak insert `attendance` bertanggal lain di level database (SPA menulis langsung ke Turso, jadi guard UI saja tidak cukup); hapus/koreksi histori tetap boleh | Baru |
| 2026-11-05 | — (working tree) | Karyawan | **Tab Libur dinamis per tahun**: daftar hari libur nasional + cuti bersama tidak lagi array statis 2026 — dimuat dari API Tanggal Merah per tahun terpilih (default tahun berjalan, `/api/years` untuk daftar tahun), dengan fallback daftar bawaan saat offline | Baru |
| 2026-11-05 | — (working tree) | Skema | Versi skema **8**: migrasi `008_attendance_geo_face` — `branches`/`warehouses` berkoordinat (`latitude`/`longitude`/`geo_radius_m`/`require_geo`/`require_face`), kolom audit geolokasi (`location_*`, `check_in/out_lat/lng/acc/dist`), wajah (`face_score`/`face_verified`), dan `source` di `attendance`, plus tabel baru `face_enrollments` (34 tabel) | Baru |
| 2026-11-05 | — (working tree) | Karyawan | **Absensi self-service ber-geolokasi & wajah (`/absen`)**: karyawan ambil GPS + scan wajah, submit di-*hard-block* bila di luar radius workplace atau wajah tidak cocok. `@vladmandic/face-api` jalan penuh di browser; hanya descriptor 128-float yang disimpan, bukan foto | Baru |
| 2026-11-05 | — (working tree) | Karyawan | **Pendaftaran wajah oleh owner (`/backoffice/hr/face`, izin baru `manage_attendance`)**: 4 sampel sudut per karyawan, re-enroll menimpa, hapus data. Laporan absensi (`EmployeeReports`) menambah kolom Sumber/Lokasi/Geo/Wajah (tabel + ekspor XLSX) dan capture GPS opsional pada jalur override owner | Baru |
| 2026-11-05 | — (working tree) | Cabang/Gudang | Pengaturan titik geofence per cabang & gudang: input lat/lng + radius meter + tombol "Pakai GPS sekarang" + switch `require_geo`/`require_face` pada dialog tambah/edit | Baru |

### 2026-11-06 — pengecualian izin per karyawan & tab Role responsif (belum di-commit)

| Waktu | Ref | Modul | Perubahan | Status |
|---|---|---|---|---|
| 2026-11-06 | — (working tree) | Karyawan/Izin | **Izin khusus per karyawan (hanya mengurangi / restrict-only)**: owner dapat **mencabut** sebagian izin yang role berikan kepada satu orang lewat aksi "Izin khusus" (ikon Shield) di `/backoffice/hr/employees` — misalnya seorang cashier kehilangan Akses POS sementara cashier lain tidak. Pengecualian disimpan di `tenants.settings.user_permissions` (peta `userId → { izin: false }`), tanpa migrasi skema. Sifatnya **hanya mengurangi**: izin yang tidak diberikan role tidak ditawarkan sama sekali, sehingga penugasan individu tidak pernah melangkahi sistem role general di Pengaturan → Role; aturan ini ditegakkan di resolver, bukan hanya UI |
| 2026-11-06 | — (working tree) | Karyawan | Editor per individu merinci izin role per grup (dialog di desktop, `Sheet` layar penuh di ponsel), ringkasan "X dari Y izin role aktif, N dikecualikan" + "Kembalikan semua ke role"; daftar Karyawan menampilkan badge "N pengecualian", dan menghapus karyawan ikut membersihkan pengecualiannya. Setiap perubahan tercatat di audit (`update_employee_permissions`) |
| 2026-11-06 | — (working tree) | Pengaturan | **Tab Role responsif**: daftar role yang semula menumpuk vertikal dan melewati tinggi layar pendek kini menjadi **strip geser horizontal** pada tablet/desktop kecil (`md`/`lg`); tata letak master-detail berdampingan tetap hanya di monitor besar (`xl`), dan `Sheet` layar penuh di ponsel tidak berubah |

### 2026-11-06 — input/output massal CSV & Excel (belum di-commit)

| Waktu | Ref | Modul | Perubahan | Status |
|---|---|---|---|---|
| 2026-11-06 | — (working tree) | Inventori / Vendor / Pelanggan | **Buat massal lewat berkas yang mudah diedit**: setiap layar menambah **Import** (menerima `.csv`, `.xlsx`, `.xls`), **Export CSV** (bentuk siap-impor kembali), dan **unduh template CSV & Excel**. Parser, pencocokan header longgar (label Indonesia + alias Inggris), dan CSV ber-BOM agar Excel Indonesia tidak mojibake, berpusat di `src/lib/bulk-io.ts` (murni, unit-tested) |
| 2026-11-06 | — (working tree) | Inventori | **Impor produk kini aditif, bukan menimpa** (`handleImport`): SKU yang sudah ada atau kembar dalam file **dilewati** (tidak lagi meng-`UPDATE` produk owner), dan baris **tanpa SKU dibuat otomatis** meneruskan penomoran aplikasi (`KAT-YYYYMMDD-XXX` lewat `generateNextSku`/`skuPrefixForCategory`, dibaca MAX per kategori lalu dinaikkan dalam batch). Preview menampilkan jumlah ditambah / dibuat otomatis / dilewati | Ubah |
| 2026-11-06 | — (working tree) | Vendor | Import vendor aditif: bentrok bila `code` **atau** `name` sudah ada (`idx_suppliers_code`/`idx_suppliers_name`) atau kembar → dilewati; `Kode` kosong dibuat otomatis meneruskan `VND-####` (`nextVendorCode`). Kategori/status menerima nilai Inggris maupun label; Termin menerima "30 hari" | Baru |
| 2026-11-06 | — (working tree) | Pelanggan | Import pelanggan aditif dengan **dedup** (telepon, fallback nama) terhadap database + dalam file; tanpa ID otomatis karena pelanggan tidak punya kode manusia | Baru |
| 2026-11-06 | — (working tree) | Izin | Tombol Import digate mengikuti tombol Tambah entitasnya: produk `manage_variants`, vendor `manage_vendor_prices`, pelanggan `view_finance`. Export tetap `export_reports`; template tidak digate (hanya baris contoh). `handleImport` produk menolak tulis tanpa `manage_variants` di sisi data, bukan hanya UI | Baru |

### 2026-11-06 — POS: satu sumber cabang, absensi otomatis dari shift, kasir transaksi-saja (belum di-commit)

| Waktu | Ref | Modul | Perubahan | Status |
|---|---|---|---|---|
| 2026-11-06 | — (working tree) | POS/Shift | **Satu sumber cabang untuk seluruh POS** (`src/hooks/use-pos-branch.ts`): till, meja shift, dan header memakai cabang yang sama hasil prioritas `session.branchId → user.assigned_branch_id → cabang pertama in-scope → baris pertama`, dengan pilihan manual dibagikan per user (bukan localStorage) sehingga shift yang baru dibuka selalu terlihat oleh till. Bug "sudah buka shift tapi POS bilang belum dibuka" hilang; pesan buntu "Sesi tidak lengkap" diganti keadaan kosong yang menjelaskan + tombol Muat Ulang | Perbaikan |
| 2026-11-06 | — (working tree) | POS/SDM | **Buka/tutup shift mencatat absensi otomatis** (`src/lib/shift-attendance.ts`): buka shift menulis baris `attendance` hari berjalan (WIB) `status='present'`, `source='self'`, `location_type='branch'`, `notes='Otomatis dari buka shift'` bila belum ada baris hari itu; tutup shift mengisi `check_out` hanya yang masih NULL. Best-effort: kegagalan absensi hanya menjadi toast peringatan dan tidak membatalkan shift. `/absen` menampilkan catatan sumber baris tersebut | Baru |
| 2026-11-06 | — (working tree) | POS/Shift | **Petty cash 0 sah** di kedua jalur (modal POS & layar shift): kosong/`0` berarti "tanpa uang tunai awal", ada tombol cepat `Rp0`, dan toast "berhasil" baru muncul setelah tulisannya benar-benar dieksekusi (sebelumnya modal menutup dengan toast kemenangan lebih dulu) | Perbaikan |
| 2026-11-06 | — (working tree) | Izin | **Kasir dibatasi ke transaksi saja**: `view_dashboard` dicabut dari default `cashier` di `src/config/roles.ts` **dan** dari snapshot `role_permissions` di `db/schema/seed.sql` (seed menulis matriks penuh, jadi default lama tenant ikut terbaca kalau hanya kode yang diubah). Guard `/pos/transactions` kini menerima `access_pos` sehingga buku transaksi till sendiri tetap terbuka. Owner masih bisa mengaktifkan dashboard per role/per karyawan lewat matriks izin | Ubah |
| 2026-11-06 | — (working tree) | POS | **Pesan error yang bisa ditindaklanjuti**: kegagalan muat produk/cabang menampilkan banner "Gagal memuat data" + tombol Coba lagi (bukan `console.error` saja), belum buka shift menjadi banner blocking di atas grid dengan tombol Buka Shift, dan pesan stok saat bayar menyebut nama produk + sisa/kebutuhan dalam Bahasa Indonesia | Baru |
| 2026-11-06 | — (working tree) | POS | **Responsif ponsel/tablet/desktop**: grid produk `2/3/4/5` kolom per breakpoint, keranjang menjadi baris ringkas lengket + dialog isi di bawah `lg`, riwayat shift & daftar transaksi jadi kartu di bawah `md` (tabel tetap di `md`+), dialog POS `max-w-[95vw]`, input pencarian `text-base` (tanpa zoom paksa di iOS), target sentuh `size="pos"` dipertahankan | Ubah |
| 2026-11-06 | — (working tree) | Uji | Unit baru `src/hooks/use-pos-branch.test.ts` (7 kasus prioritas cabang) dan `src/lib/db/__tests__/shift-attendance.test.ts` (7 kasus, replay SQL aslinya ke database v8 sementara); `db/__tests__/seed.test.ts` menambah penjaga bahwa seed tidak boleh membantah matriks kode. E2E `tests/kasir.e2e.ts` menambah alur "drawer kosong tetap bisa buka shift + absensi tercatat otomatis" | Baru |
| 2026-11-06 | — (working tree) | Uji | **Perbaikan locator e2e yang sudah usang**: 4 tes di `owner.e2e.ts` dan `admin.e2e.ts` diperbarui menyusul redesign `EmployeeRoleSettings` (dialog → inline editor, tanpa `agent.act`), penghapusan `view_dashboard` dari default cashier, dan opsi Radix Select yang accessible name-nya kini menyertakan deskripsi. Pola baru `getByRole('table').getByText(...)` dipakai untuk menghindari ambiguitas dual-render (KS-40) | Perbaikan |

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
| Shift: buka/tutup kas | Ada | Kas awal (0 = tanpa uang tunai), kas akhir, kas seharusnya, selisih |
| Satu sumber cabang POS | Ada | `use-pos-branch`: till, layar shift, dan header selalu cabang yang sama; pemilih cabang bila role melintas beberapa cabang |
| Absensi otomatis dari shift | Ada | Buka shift = check-in, tutup shift = check-out (`source='self'`, `notes='Otomatis dari buka shift'`), best-effort tanpa membatalkan shift |
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
| Import/Export produk (CSV & Excel) | Ada | `xlsx`; import **aditif** (SKU existing/kembar dilewati, SKU kosong dibuat otomatis), template CSV/Excel siap-impor (parser `src/lib/bulk-io.ts`) |
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
| Statistik & export | Ada | Total vendor, aktif, total hutang, tagihan lewat jatuh tempo; export Excel (report) & CSV (siap-impor) |
| Import massal vendor | Ada | CSV/Excel; aditif — `code`/`name` sudah ada atau kembar dilewati, `Kode` kosong auto `VND-####`; template CSV/Excel |
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
| Import massal pelanggan | Ada | CSV/Excel; aditif dengan dedup telepon/nama (tanpa ID manusia); template CSV/Excel |
| Data supplier | Ada | Sudah dipindah ke modul **Vendor** (§2.4): master lengkap, katalog produk, hutang & pembayaran |
| Riwayat transaksi per pelanggan | Belum | Bergantung pada pemilihan pelanggan di POS |

### 2.7 SDM

| Fitur | Status | Catatan |
|---|---|---|
| Data karyawan + role | Ada | 7 peran (lihat §3) |
| Gaji pokok | Ada | Dipakai laporan payroll |
| Presensi (check-in/out) | Ada | Self-service di `/absen` (GPS + wajah) **dan** otomatis dari siklus shift POS (`src/lib/shift-attendance.ts`: buka shift mencatat check-in hari WIB berjalan bila belum ada baris, tutup shift mengisi `check_out` yang masih NULL). Input owner/HR di laporan absensi tetap ada. Modal absensi mengunci tanggal hari berjalan (UTC+7) dan trigger `trg_attendance_today_only` (skema v7) menolak insert bertanggal lain — back/forward-dating lewat payload tidak bisa lagi |
| Lembur | Sebagian | Kolom `overtime` ada, input manual |
| Cuti | Ada | Pengajuan + status; approval belum berjejak audit |
| Hari libur nasional | Ada | Tab Libur memuat libur nasional + cuti bersama per tahun dari API Tanggal Merah (`src/lib/holidays.ts`), otomatis mengikuti tahun berjalan; offline jatuh ke daftar bawaan tahun aktif |
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
| Matriks role & izin | Ada | Tersimpan di `settings.role_permissions`, dipakai penuh sebagai satu-satunya tempat **memberi** izin |
| Izin khusus per karyawan | Ada | **Hanya mengurangi** (restrict-only): owner mencabut sebagian izin role seorang karyawan di `/backoffice/hr/employees`, disimpan di `settings.user_permissions`; tidak bisa menambah di luar role |
| Metode pengeluaran stok | Ada | Tab **Inventori**; `settings.inventory.stock_issue_method` (`fifo`/`lifo`/`fefo`) |
| Profil perusahaan | Sebagian | Nama/slug tenant; alamat ada di cabang |
| Audit log | Sebagian | Tercatat, tetapi belum ada layar penjelajah audit |

### 2.10 Toko online (`tokoonline/`)

Aplikasi terpisah berperan sebagai **marketplace lintas tenant**; dibuka pengunjung, bukan staf.
Data berasal dari back office setiap tenant yang berstatus `active`.

| Fitur | Status | Catatan |
|---|---|---|
| Katalog marketplace | Ada | `GET /api/storefront/marketplace` (semua tenant aktif, produk membawa `tenant`/`seller`); `GET /api/storefront/catalog?slug=` tetap ada untuk klien satu toko |
| Harga & satuan jual per produk | Ada | Mengikuti `product_units` per varian; satuan dasar bisa pecahan (mis. 0,5 kg) |
| Stok yang bisa dikirim | Ada | `SUM(product_batches)` di gudang pemenuh tiap tenant; dibaca setiap permintaan, tanpa cache |
| Pencarian & filter kategori/penjual | Ada | Di `/katalog`, state di URL (`?q=&kategori=&toko=`) |
| Keranjang, checkout, riwayat pesanan | Ada | Disimpan di perangkat pengunjung (kunci `thalia-storefront`), bukan di DB tenant. Satu pesanan boleh berisi beberapa penjual; ringkasan dikelompokkan per toko |
| Pesanan masuk ke back office | Belum | Prototype; menulis ke DB tenant harus lewat `src/lib/stock-movement.ts` |
| Akun pelanggan / login pembeli | Belum | Checkout tanpa akun; autentikasi toko dimatikan (`VITE_AUTH_ENABLED=false`) |
| Pembayaran online | Belum | Metode bayar dipilih di checkout, belum ada integrasi gateway |
| Chat CS | Sebagian | Menjawab dari katalog yang sama; bukan kanal pesan tersimpan |

---

## 3. Peran dan akses menu

Sumber: kunci izin per rute di `src/App.tsx` (`guarded`/`guardedAny`), nilai bawaan
`DEFAULT_ROLE_PERMISSIONS` di `src/config/roles.ts`, dan kunci `permission` tiap item di
`src/components/layout/nav-items.ts`. Guard tidak lagi membaca daftar peran; peran custom dan
override owner dihormati lewat resolver `src/lib/permission-matrix.ts`. Tabel di bawah adalah
*jangkauan keluaran* (bukan konfigurasi), dijaga identik dengan `tests/rbac.e2e.ts`.

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
- `admin` adalah alias lama untuk `tenant_admin` yang dipetakan resolver (`src/lib/permission-matrix.ts`),
  bukan peran terpisah; tujuh peran resmi di atas adalah kunci katalog yang sebenarnya.
- **warehouse** memakai `view_inventory` untuk dokumen stok dan diarahkan ke **Pesanan Cabang** di
  layar mode-select, karena `/backoffice` menuntut `view_analytics` yang tidak dipegang peran ini; menu
  tanpa kuncinya tidak ditampilkan agar tidak ada tautan yang berujung pengalihan.
- Transfer stok, opname, gudang, produk, dan PO dijaga `view_inventory`; stok masuk dijaga
  `add_stock` dan hanya tampil untuk peran yang memegangnya — staf gudang menerima barang lewat
  pesanan cabang, bukan lewat PO.
