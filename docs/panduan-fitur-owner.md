# Bagian & Fitur Aplikasi — Ringkasan untuk Owner

| | |
|---|---|
| Dokumen | `docs/panduan-fitur-owner.md` |
| Untuk siapa | Owner dan manajemen toko. Bukan dokumen teknis — tidak ada kode, hanya bagian, fitur, dan batasan. |
| Terakhir diperbarui | **2026-11-19** |
| Sumber | Menu aplikasi (`src/components/layout/nav-items.ts`), katalog fitur [fitur-tenant.md](fitur-tenant.md) §2–§3, peta layar [frontend.md](frontend.md) §3–§4 |
| Cara membaca | Setiap **Bagian** = satu menu di sidebar. Di bawahnya ada **sub-bagian** (layar di dalam menu itu), lalu daftar **fitur** per sub-bagian. Tanda ⚠️ berarti fiturnya berjalan dengan batasan, tanda ✖ berarti belum ada. |

---

## 1. Peta besar: aplikasi ini punya 4 pintu + 1 toko online

Setelah login, setiap orang memilih mode. Kartu yang muncul berbeda sesuai hak akses orang itu —
karyawan gudang tidak akan melihat kartu yang sama dengan kasir.

| Pintu | Isinya | Siapa |
|---|---|---|
| **Absensi / Presensi** | Check-in & check-out mandiri, verifikasi wajah + lokasi | Semua karyawan aktif |
| **POS & Kasir** | Jualan, pembayaran, struk, shift & tutup kas, riwayat transaksi, void | Kasir, manajer, owner/admin |
| **Back Office** | Semua manajemen: cabang, stok, keuangan, karyawan, laporan, pengaturan | Owner, admin, manajer (sebagian hanya layar stok untuk gudang/purchasing) |
| **Vendor & Supplier** | Data vendor, katalog produk vendor, purchase order, hutang & pembayaran | Owner, admin, manajer |
| **Toko online (Toko Thalia)** | Marketplace lintas toko yang dipakai pelanggan, bukan staf | Pengunjung web (aplikasi terpisah) |

Struktur menu Back Office yang terlihat di layar:

```
Dashboard                 → ringkasan angka
Chat                      → pesan internal dengan karyawan
Cabang                    → Daftar Cabang · Gudang · Pesanan Cabang · Transfer Stok
Inventory                 → Produk · Stok Masuk · Stok Opname · Purchase Order
Vendor                    → Data Vendor · Hutang Vendor
CRM                       → Pelanggan
Keuangan                  → Jurnal · Hutang/Piutang · Cash Flow · Pengeluaran
Karyawan                  → Data Karyawan · Absensi · Wajah & Lokasi Absensi · Jadwal Shift · Payroll
Laporan                   → 5 jenis laporan
Pengaturan                → Umum · Perusahaan · Karyawan & Role · Inventori · Notifikasi · Keamanan
```

---

## 2. Dashboard — kondisi toko hari ini

Layar pertama setelah masuk Back Office. Semua angka bisa diklik untuk melihat rinciannya.

- **4 kartu utama**, semuanya bisa diklik untuk membuka rinciannya: **Total Penjualan**, **Transaksi**,
  **Produk Terjual** (tiga-tiganya mengikuti periode yang dipilih) dan **Karyawan Aktif**.
- **3 papan antrean kerja** yang langsung menuju layarnya: **PO menunggu persetujuan**,
  **Permintaan cabang menunggu**, **Siap dikirim ke cabang** — angka di papan ini juga muncul
  sebagai penghitung di menu samping.
- **Grafik penjualan** per periode dan **performa cabang** yang membandingkan tiap cabang,
  bukan hanya total gabungan.
- **Stok menipis** — produk di bawah batas minimum, lengkap dengan aksi pesan ke gudang.
- **Transaksi terbaru** — bon terakhir, termasuk yang di-void (diberi tanda, tidak disembunyikan).
- Filter **periode** dan **cabang** di semua bagian.
- Transaksi yang di-void **tidak dihitung** di semua angka dashboard; laporan tetap menampilkan
  barisnya supaya pembatalan bisa dibaca.

---

## 3. Chat internal — komunikasi dengan karyawan

Percakapan di dalam satu toko saja (bukan kanal ke pelanggan — itu toko online, §12).

- **Pesan langsung (DM)** ke karyawan mana pun; tidak bisa dibuat dobel.
- **Channel bernama** untuk satu tim (mis. `operasional-toko`); boleh privat atau umum.
- **Panggil (@) orang** dan **panggil (#) produk / invoice / purchase order / vendor**. Hasil
  pemanggilan jadi "chip" yang bisa diklik dan langsung membuka detail barang/struk/PO tersebut.
- **Edit & hapus pesan** milik sendiri; pemilik toko bisa menghapus pesan orang lain (moderasi).
  Pesan yang dihapus diganti tulisan "Pesan ini telah dihapus" — riwayat tidak hilang diam-diam.
- **Kelola anggota** channel (tambah/keluar) dan **arsip** channel yang sudah tidak dipakai;
  isi dan riwayat channel yang diarsip tetap utuh.
- **Hampir real-time**: daftar diperbarui tiap 10 detik, percakapan yang sedang dibuka tiap 3 detik.
- ✖ **Belum ada**: badge "belum dibaca", notifikasi push ke ponsel, lampiran gambar/file, reaksi emoji.
- ⚠️ **Penting owner tahu**: aturan siapa melihat channel apa ditegakkan di tampilan, bukan di
  database. Chat dipakai untuk koordinasi, bukan untuk menyimpan data rahasia.

---

## 4. Cabang — struktur toko fisik

### 4.1 Daftar Cabang
- Buat dan ubah cabang: nama, alamat, koordinat (dipakai untuk batas lokasi absensi), status aktif.
- Cabang tempat seorang karyawan ditugaskan menentukan stok dan laporan yang ia lihat.
- **Dashboard Percabangan**: total cabang, penjualan bulan ini, total karyawan, rata-rata penjualan.

### 4.2 Gudang
- Gudang bertipe **pusat**, **regional**, atau **toko**; satu gudang **default** per cabang.
- Gudang bersama (tidak terikat satu cabang) boleh melayani banyak cabang.
- Gudang bertipe toko ditandai badge **Rak Toko** agar tidak tertukar dengan gudang penyimpanan.

### 4.3 Pesanan Cabang (cabang minta stok ke gudang pusat)
- Alur jelas: **draft → diajukan → disetujui/ditolak → dalam pengiriman → diterima**.
- Jumlah **disetujui**, **dikirim**, dan **diterima** dicatat terpisah per baris — jadi selisih
  terlihat, bukan hilang.
- Ada **penghitung** jumlah pesanan menunggu di menu samping, dan filter rentang tanggal.
- Setiap perpindahan status tercatat (siapa, kapan).

### 4.4 Transfer Stok Antar Gudang
- Alur **menunggu → dalam pengiriman → selesai**, dihitung **per batch**, sehingga harga pokok
  dan tanggal kedaluwarsa ikut pindah dengan benar.
- Menampilkan nomor pesanan asal bila transfer itu dibuat dari pesanan cabang.
- ⚠️ Penerimaan **bertahap** (satu kiriman diterima beberapa kali) belum didukung penuh;
  selisihnya dicatat, tapi belum bisa diterima cicil.

---

## 5. Inventory — barang dagangan

Menu ini punya 4 tab: **Produk · Transfer · Opname · PO**.
Catatan nama: menu samping berbunyi "Stok Masuk", tab yang terbuka bernama "Transfer Stok" —
layar yang sama, satu pintu untuk mencatat barang masuk/pindah.

### 5.1 Produk
- **Cari** nama/SKU, saring per **gudang** dan **kategori**; daftar menampilkan stok per gudang,
  batas minimum, harga jual dan beli.
- **Buat produk baru** — sekali isi langsung terhubung ke semua bagian:
  - nama, kategori (kategori baru bisa dibuat dari form yang sama);
  - **vendor/supplier** — nama vendor yang diketik dan belum ada langsung menjadi master vendor
    sungguhan bernomor `VND-0001` dan seterusnya, bukan teks yatim;
  - harga beli & harga jual, **satuan jual ganda** (kg, gram, pcs, pack, dus, karung) lengkap
    dengan angka konversinya — misal 1 dus = 24 pcs, harga per satuan boleh beda;
  - **varian** (mis. rasa × ukuran): setiap kombinasi menjadi baris sendiri dengan SKU, barcode,
    satuan/pecahan, harga, dan **stok sendiri**;
  - **batch** beserta tanggal kedaluwarsa dan harga pokok per batch;
  - batas stok minimum per gudang untuk peringatan.
- **SKU otomatis** berpola `PREFIX-YYYYMMDD-SEQ`; **barcode per satuan** bisa dibuat dan diunduh.
- **Impor/ekspor massal** CSV & Excel, kini **mengenal varian**. Satu baris berkas = satu varian ×
  satu pecahan, jadi produk dengan banyak varian cukup ditulis banyak baris — jumlahnya tidak
  ada batasnya. Kolomnya: **SKU**, Nama Produk, Kategori, Harga Jual, Harga Modal, Stok, Stok
  Minimum, Supplier, lalu **Kode Varian**, **Atribut Varian** (ditulis `Rasa=Susu;Ukuran=250ml`),
  Barcode Varian, **Satuan**, **Faktor** (isi dalam satuan dasar; 1 = satuan dasar), **Kode
  Vendor**, Min Order, Vendor SKU. Baris-baris dengan **SKU yang sama** otomatis dibaca sebagai satu
  produk, dan atribut yang sama sebagai satu varian.
- Impor bersifat **menambah dan memperluas**: SKU baru dibuat (SKU kosong dinomori otomatis), dan
  SKU yang **sudah ada tidak lagi dilewati** — varian, pecahan, atau harga yang belum ada ditambahkan.
  Sistem tidak pernah mengganti nama, menghapus, atau menolkan harga barang yang sudah ada; harga
  beli dari vendor hanya ditimpa bila mencentang **Timpa harga beli**. Pratinjau menunjukkan apa saja
  yang akan ditulis — termasuk **alasan setiap baris yang dilewati** — sebelum ada yang tersimpan.
  Kolom template dan hasil ekspor memakai bentuk yang sama, jadi **ekspor → ubah di Excel → impor
  balik** aman dan tidak menghasilkan duplikat.
- ⚠️ **Hapus produk** masih menghapus permanen, sehingga transaksi lama kehilangan nama barangnya.
  Menyimpan produk dengan status nonaktif lebih aman.

### 5.2 Produk per vendor (satu barang, beberapa pemasok)
- Setiap produk menyimpan **daftar vendor** yang menyuplainya, dengan data per vendor:
  SKU versi vendor, harga beli terakhir, lead time, minimum order, dan penanda **vendor utama**.
- Dikelola di **detail vendor**, tab **Produk** (daftar + "Tambah Produk Baru" + dialog
  **Hubungkan Produk** dengan sakelar "jadikan vendor utama").
- Tab **Harga Beli** = "template PO": harga kesepakatan per vendor × varian × pecahan, beserta
  jumlah minimum. Diisi otomatis oleh form produk, impor, dan penerimaan barang.
- Tab **Riwayat Harga** menunjukkan pergerakan harga beli dari waktu ke waktu.
- Semua jalur penulisan (form, impor, penerimaan barang, seeder demo) menulis ke **satu modul yang
  sama**, jadi katalog vendor tidak bisa berbeda isi tergantung dari mana barang diinput.

### 5.3 Stok Opname
- Penyesuaian stok **naik/turun** dengan alasan wajib — selisih hitungan fisik vs sistem.

### 5.4 Purchase Order (beli ke vendor)
- **Satu PO untuk satu vendor.** Bila vendor belum dipilih, daftar menampilkan semua produk dengan
  nama vendornya, dan **memilih produk otomatis memilih vendor** (vendor pilihan → vendor utama →
  vendor tunggal yang aktif; vendor nonaktif dilewati, dan kalau ambigu sistem tidak menebak).
  Setelah vendor terpilih, daftar disaring ke katalog vendor itu saja.
- Harga baris diambil dari template PO vendor tersebut; bila vendor diganti dan barang sudah terlanjur
  masuk keranjang, aplikasi meminta konfirmasi lebih dulu.
- Alur dokumen: **draft → diajukan → disetujui/ditolak → diterima sebagian → diterima**,
  plus **dibatalkan** dan **duplikasi PO**.
- **Yang mengajukan, yang menyetujui, dan yang menerima barang adalah tiga hak berbeda** — pemisahan
  ini bawaan, dan role purchasing sengaja bisa mengajukan & menerima tapi tidak bisa menyetujui.
- **Penerimaan barang** membuat dokumen terima (GRN), memasukkan stok sebagai batch baru
  (harga pokok + kedaluwarsa tercatat), dan otomatis menjadi **hutang vendor**.

---

## 6. Vendor — pemasok dan kewajibannya

### 6.1 Data Vendor
- Master lengkap: kode otomatis `VND-0001`, nama & badan usaha, kategori, NPWP, situs web,
  alamat (kota/provinsi/kode pos), kontak.
- Kebijakan pembelian: **termin** 0/7/14/30/45/60/90 hari, **limit kredit**, lead time, rating 0–5.
- **Rekening bank vendor** — dipakai sebagai tujuan transfer saat membayar hutang.
- Status **aktif / nonaktif / blacklist**, tampil sebagai tanda di daftar dan detail.
- Ringkasan & ekspor: total vendor, yang aktif, total hutang, tagihan lewat jatuh tempo.
- **Impor massal vendor** (CSV/Excel, aditif) dan **impor vendor + produk dalam satu sheet**
  (**21 kolom**) dengan pratinjau status per baris sebelum ditulis ke sistem.
- **Lembar vendor ditulis untuk SATU vendor per berkas** — persis seperti lembar harga yang dikirim pemasok:
  - **baris pertama hanya berisi data vendor** (kode, nama, kategori, kontak, telepon, email, termin). Semua kolom
    produk di baris itu dibiarkan kosong;
  - **baris kedua dan seterusnya adalah produk-produk vendor itu**, dengan kolom vendor dibiarkan kosong — sistem
    mengikuti vendor dari baris di atasnya. Jumlah produk tidak terbatas: yang bertambah adalah baris, bukan kolom;
  - satu baris = satu varian × satu pecahan. Varian disebut lewat **Kode Varian** atau **Atribut Varian**
    (`Rasa=Susu;Ukuran=250ml`), dan barcode varian punya kolom sendiri (**Barcode Varian**);
  - **lembar vendor boleh menambah varian dan pecahan** yang belum ada di katalog, misalnya rasa baru yang dikirim
    pemasok beserta harga kartonnya. Yang boleh melakukan ini hanya peran yang berhak mengelola template produk
    (pemilik/admin); kalau tidak berhak, barisnya dilaporkan, bukan ditebak. Yang akan dibuat tampil sebagai
    **baris tersendiri di pratinjau** berlabel **varian baru** / **pecahan baru** beserta alasannya — jadi bukan
    cuma angka di baris ringkasan;
  - **varian tidak pernah ditebak**: satu baris tanpa menyebut varian pada produk yang punya beberapa varian ditandai
    **varian ambigu** dan harganya tidak ditulis;
  - satu sel `SKU` boleh memuat beberapa kode dipisah titik-koma (`KODE-A;KODE-B`) untuk menautkan beberapa produk
    yang **sudah ada** sekaligus;
  - berkas lama yang mengulang vendor di setiap baris, atau memuat beberapa vendor dalam satu berkas, **tetap bisa
    diimpor** — hanya diberi catatan bahwa format barunya satu vendor per file. Setiap vendor diproses sendiri, dan
    **satu produk yang gagal hanya membatalkan produk itu**, bukan seluruh berkas;
  - Master bersifat menambah: vendor dan produk yang sudah ada **tidak pernah** ditamai ulang atau dihapus; harga beli
    hanya diganti bila pemegangnya berhak mengelola harga **dan** mencentang "Timpa harga beli".
- **Ekspor sheet per vendor** — tombol **Ekspor Sheet** (Excel/CSV) di halaman detail vendor, dan **Sheet per Vendor**
  di dialog impor, mengeluarkan berkas `sheet_vendor_<KODE>_<tanggal>` dengan bentuk satu vendor itu. Berkasnya memang
  untuk dikirim ke pemasok: **"isi harga ini lalu kirim balik"** — berkas yang diimpor kembali apa adanya **tidak
  menambah satu baris pun**. Ekspor katalog semua vendor tetap seperti dulu.
- Pencarian vendor memakai **kode lebih dulu**, baru nama.
- ⚠️ Vendor yang sudah dipakai produk/PO/tagihan **tidak bisa dihapus** — gunakan nonaktif.
- ✖ Penilaian otomatis (ketepatan kirim) belum ada; rating diisi manual.

### 6.2 Hutang Vendor
Terhubung ke menu Keuangan → Hutang/Piutang (§8) dan ke penerimaan barang PO (§5.4).
- Tagihan bisa dibuat manual atau lahir dari penerimaan barang.
- **Bayar sebagian atau penuh**, dengan metode bayar dan nomor referensi; riwayat pembayaran tersimpan.

---

## 7. CRM — pelanggan

- **Data pelanggan**: tambah/ubah, total belanja (`total_spent`) dan **poin** mengikuti transaksi.
- **Impor massal** CSV/Excel dengan penggabungan berdasarkan telepon/nama.
- ✖ Riwayat transaksi per pelanggan belum ditampilkan.
- ✖ Kasir belum bisa memilih pelanggan/member saat menjual (kolomnya sudah disiapkan di database).

---

## 8. Keuangan

| Sub-bagian | Fitur | Catatan |
|---|---|---|
| **Jurnal** | Susunan transaksi kas yang tersusun otomatis saat dibuka | ⚠️ Basis kas, belum ada tabel jurnal tetap |
| **Hutang/Piutang** | Hutang usaha dari pengeluaran belum lunas + pembayaran; piutang dari penjualan belum lunas | Bon yang di-void **tidak** menjadi piutang |
| **Cash Flow** | Pemasukan penjualan vs pengeluaran per periode | |
| **Pengeluaran** | Kategori, tanggal, jatuh tempo, status, jumlah dibayar | Penerimaan barang dari PO juga dibukukan di sini |
| ✖ **Tutup buku / neraca saldo** | Belum tersedia | Butuh bagan akun (COA) + jurnal tetap |

---

## 9. Karyawan

### 9.1 Data Karyawan
- Peran bawaan yang bisa diberikan: **admin, manajer toko, kasir, gudang, purchasing, staf**,
  ditambah **role buatan sendiri** (`cust_*`) milik toko.
- Penugasan cabang, **buat akun**, dan **buat password baru** untuk karyawan.
- **Izin khusus per orang**: hanya bisa **mencabut** sebagian izin role, tidak pernah menambah.
  Contoh: seorang manajer boleh dicabut hak "Ekspor laporan" saja.
- ⚠️ Undangan aktifasi lewat email belum ada — akun dibuat owner/admin lalu password awal diberikan.

### 9.2 Absensi
- Karyawan absen sendiri di layar **Absensi** (satu pintu di §1) dengan **lokasi GPS + wajah**.
- **Otomatis dari shift POS**: buka shift mencatat check-in, tutup shift mengisi check-out.
- Tanggal yang boleh dicatat hanya hari berjalan — tidak bisa mundur/ maju lewat jalur apa pun.
- Input/koreksi owner atau HR tetap tersedia; **lembur** masih isian manual.
- Tab **Libur** memuat hari libur nasional + cuti bersama tahun berjalan (sumber resmi; bila luring
  jatuh ke daftar bawaan).

### 9.3 Wajah & Lokasi Absensi
- Pendaftaran data wajah karyawan dan daftar lokasi kerja beserta radius toleransinya.

### 9.4 Jadwal Shift & Payroll
- Kalender shift per karyawan/cabang; siklus shift menggerakkan absensi otomatis.
- **Payroll** memakai gaji pokok dari data karyawan + kehadiran; ⚠️ berupa tabel laporan, bukan slip gaji.

---

## 10. POS & Kasir (front office)

### 10.1 Penjualan
- Katalog produk + pencarian, kategori, **keranjang** (ubah jumlah, hapus baris).
- **Multi-satuan** saat menjual (kg / gram / pcs / pack / dus / karung) mengikuti harga per satuan.
- Diskon dan pajak dihitung pada saat bayar; metode **tunai / kartu / e-wallet**, kembalian dihitung otomatis.
- Satu cabang sumber yang konsisten: till, layar shift, dan judul halaman selalu cabang yang sama,
  dengan pemilih cabang bila peran orang itu mencakup beberapa cabang.
- ✖ Input dari **scanner barcode** belum ditangani (barcode sudah bisa dicetak).

### 10.2 Struk & printer
- Struk 80mm sebagai prioritas (48 karakter), opsi **58 / 60 / 72 / 76 / 80mm**; ukuran huruf
  disesuaikan otomatis agar tidak meluber.
- **Cetak otomatis** setelah transaksi, dan **cetak ulang** dari riwayat.
- Tiga mode printer, dipilih di Pengaturan → Struk: **driver** (printer biasa USB/jaringan/Bluetooth
  yang sudah dikenali sistem), **USB langsung**, **Bluetooth**. Bila perangkat belum tersambung,
  otomatis kembali ke mode driver — cetak gagal tidak pernah membatalkan transaksi.
- Baris yang di-void dicetak **dicoret** dengan alasan; bon yang di-void total mencetak banner
  "TRANSAKSI DIBATALKAN".

### 10.3 Shift & tutup kas
- Buka/tutup kas dengan kas awal (boleh 0), kas akhir, **kas seharusnya**, dan **selisih**.
- **Laporan tutup shift (Z-report)** tercetak di struk: identitas shift, penjualan per metode bayar,
  kas seharusnya vs fisik, dan bagian void tidak dihitung.
- Buka/tutup shift sekaligus mencatat absensi kasir (§9.2).

### 10.4 Riwayat transaksi & pembatalan (void)
- Daftar transaksi dengan halaman, **filter status** (Semua / Selesai / Void), dan detail lengkap.
- **Void per baris barang**: stok kembali ke batch asal, nilai struk turun sebesar baris itu, diskon
  bon tidak ikut berubah, baris dicoret — **tidak pernah dihapus**.
- **Void per bon**: seluruh baris dicoret, bon menjadi status void, dan otomatis keluar dari semua
  laporan angka.
- **Alasan wajib** (minimal 3 huruf) + jejak siapa dan kapan, tercatat di log audit.
- Batas: hanya pada shift yang masih **berjalan**; shift yang sudah ditutup hanya bisa dibatalkan
  owner/admin. ✖ Pengembalian dana lewat terminal (QRIS/kartu) masih manual.

---

## 11. Laporan

Lima jenis, semuanya bisa disaring periode + cabang dan diekspor (Excel/CSV):

| Laporan | Isi |
|---|---|
| Penjualan | Ringkasan per cabang dan periode, produk terlaris, kontribusi per kategori |
| Inventory | Status stok, nilai stok, stok di bawah minimum, pergerakan barang |
| Karyawan | Absensi, jadwal, payroll — hadir dalam satu halaman laporan |
| Keuangan | Basis kas: jurnal, cash flow, pengeluaran per kategori |
| Pengadaan | Purchase order per vendor dan permintaan cabang ke gudang pusat |

Bon/baris yang di-void tetap muncul di daftar dan lembar ekspor dengan penanda Void;
angka totalnya sudah mengecualikan yang dibatalkan.

---

## 12. Toko online — Toko Thalia (aplikasi terpisah)

Dipakai pengunjung, bukan staf. Menampilkan katalog **semua toko yang aktif** (marketplace).

- Katalog, harga dan satuan jual ikut seperti di back office, termasuk satuan pecahan (mis. 0,5 kg).
- Stok yang ditampilkan adalah stok **bisa dikirim** di gudang pemenuh tiap toko, dibaca langsung
  (tidak ada angka basi hasil cache).
- Pencarian dan filter kategori / penjual; status filter tersimpan di URL jadi bisa dibagikan.
- Keranjang, checkout tanpa akun, riwayat pesanan tersimpan di perangkat pengunjung.
  **Satu pesanan boleh berisi beberapa toko**, dan ringkasannya dikelompokkan per penjual.
- **Channel pembayaran** (Tunai / Transfer Bank / QRIS) mengikuti konfigurasi owner per tenant di
  Pengaturan → Pembayaran. Gambar QRIS statis yang diunggah owner ditampilkan di checkout + halaman
  order; instruksi transfer memakai rekening asli dari settings tenant.
- **Pesanan masuk ke back office**: saat pengunjung checkout, pesanan dikirim ke server dan dipecah
  per penjual ke database masing-masing tenant (status `Menunggu pembayaran`). Owner mengonfirmasi
  pembayaran di `/backoffice/storefront-orders` → sistem mencatat transaksi + mengurangi stok gudang
  secara atomik.
- ✖ **Belum**: akun/`login` pelanggan, pembayaran gateway otomatis (konfirmasi masih manual),
  riwayat chat CS yang tersimpan, notifikasi push ke customer saat status berubah.

---

## 13. Pengaturan

| Tab | Yang bisa diatur | Tersimpan? |
|---|---|---|
| Umum | Bahasa, zona waktu, format tanggal, mata uang; mode gelap, sidebar kecil, animasi | ⚠️ Hanya mode gelap yang benar-benar bekerja; sisanya masih tampilan |
| Perusahaan | Identitas perusahaan (nama, NPWP, alamat, telepon, email) + **Struk** (footer, logo, **Printer & Koneksi**, Cetak Tes), **Pajak & diskon default**, **Rekening bank** | ⚠️ Struk, pajak/diskon, dan bank tersimpan; kolom identitas perusahaan masih isian tampilan (nama toko aslinya diatur saat toko dibuat, alamat lengkap ada di cabang) |
| Karyawan & Role | **Matriks izin** per peran (7 grup, 33 hak), **role buatan sendiri**, dan **pratinjau menu** — daftar menu yang akan dilihat tiap peran, diambil dari menu asli sehingga tidak bisa "berbohong" | ✓ Tersimpan, langsung berlaku tanpa muat ulang |
| Inventori | **Metode pengeluaran stok**: FIFO (bawaan) / LIFO / FEFO — menentukan batch mana yang dipakai lebih dulu saat penjualan | ✓ Tersimpan |
| Pembayaran | **Channel pembayaran**: aktifkan/nonaktifkan Tunai, Transfer Bank, QRIS per tenant; **biaya merchant** per channel (Flat Rp atau % dari total — dicatat internal, tidak menambah tagihan customer); **rekening bank** yang ditampilkan untuk channel Transfer (dari Pengaturan → Perusahaan → Rekening Bank); **gambar QRIS** statis (unggah ≤2 MB, resize 720px → webp) yang ditampilkan di kasir + checkout toko online | ✓ Tersimpan di `settings.payment_channels` + `tenants.qris_image` |
| Notifikasi | Sakelar preferensi: stok minimum, transaksi baru, laporan harian, update sistem | ⚠️ Belum mengirim notifikasi apa pun |
| Keamanan | Verifikasi 2 langkah, logout otomatis saat diam + durasinya, backup otomatis, unduhan/pemulihan data | ⚠️ Belum terhubung ke sistem — masa berlaku sesi mengikuti pengaturan bawaan login |

- Aplikasi sendiri menampilkan catatan di bagian bawah layar: yang tersambung ke database hanyalah
  **pajak/diskon, struk, bank, metode pengeluaran stok, dan channel pembayaran** — semuanya tersimpan otomatis saat diubah.
- Bila peran hanya boleh melihat, seluruh tab memunculkan banner **"Hanya baca"** dan isian dikunci.
- ⚠️ Pajak & diskon default **belum** dipakai otomatis di POS — masih dihitung saat transaksi.
- ⚠️ Jejak audit tercatat di database, tapi **belum ada layar** untuk menelusuri siapa mengubah apa.
- Mengubah siapa boleh membuka layar apa dilakukan **di tab Karyawan & Role**, tidak perlu mengubah aplikasi.

---

## 14. Siapa bisa membuka apa (bawaan)

Angka di kurung = jumlah hak aktif bawaan. Owner/admin dapat mengubah semua ini lewat
Pengaturan → Karyawan & Role tanpa menyentuh teknis.

| Area | Owner | Admin | Manajer | Kasir | Gudang | Purchasing | Staf |
|---|---|---|---|---|---|---|---|
| Absensi mandiri | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| POS (jualan & shift) | ✓ | ✓ | ✓ | ✓ | – | – | – |
| Riwayat transaksi | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| Dashboard | ✓ | ✓ | ✓ | – | – | – | – |
| Chat internal | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Daftar cabang (buat/ubah cabang) | ✓ | ✓ | ✓ | – | – | – | – |
| Gudang | ✓ | ✓ | ✓ | – | ✓ | ✓ | – |
| Pesanan cabang & transfer | ✓ | ✓ | ✓ | – | ✓ | ✓ | – |
| Produk, opname, stok masuk | ✓ | ✓ | ✓ | – | ✓ | ✓ | – |
| Purchase order | ✓ | ✓ | ✓ | – | ✓ | ✓ (ajukan & terima, **tidak** setujui) | – |
| Vendor, CRM, keuangan | ✓ | ✓ | ✓ | – | – | – | – |
| Karyawan & payroll | ✓ | ✓ | ✓ | – | – | – | – |
| Pendaftaran wajah | ✓ | ✓ | ✓ | – | – | – | – |
| Laporan | ✓ | ✓ | ✓ | – | – | – | – |
| Pengaturan | ✓ | ✓ | – | – | – | – | – |
| (jumlah hak bawaan) | 33 | 33 | 18 | 2 | 9 | 7 | 1 |

- **Staf** sengaja hanya dapat chat + absen: setiap karyawan bisa dijangkau lewat channel/DM tanpa
  diberi akses angka apa pun.
- Peran **warehouse/purchasing** diarahkan ke Pesanan Cabang saat login karena dashboard angka
  bukan hak mereka.

---

## 15. Hal yang perlu owner ketahui sebelum bergantung penuh

| Batasan | Dampak praktis |
|---|---|
| Belum ada lupa password / ganti password mandiri | Karyawan lupa password → minta owner/admin buatkan |
| Hak akses ditegakkan di tampilan, bukan di server | Jangan mengandalkan aplikasi sebagai penjaga data sensitif antar peran; atur matriks dengan benar |
| Scanner barcode belum diterima di POS | Barang tetap dicari lewat nama/SKU saat menjual |
| Pelanggan belum bisa dipilih di kasir | Poin & total belanja belum tertaut per transaksi |
| Pesanan toko online masuk ke back office | Owner mengonfirmasi pembayaran di `/backoffice/storefront-orders`; stok berkurang otomatis setelah konfirmasi |
| Belum ada tutup buku / neraca saldo | Pembukuan formal masih di luar aplikasi |
| Hapus produk bersifat permanen | Lebih aman dinonaktifkan supaya riwayat transaksi tidak kehilangan nama barang |
| Penilaian vendor (ketepatan kirim) masih manual | Rating diisi owner, bukan dihitung dari data penerimaan |

---

## 16. Glosarium singkat

| Istilah | Artinya |
|---|---|
| SKU | Kode unik barang (dan kode per varian) untuk mencari dan menelusuri stok |
| HPP | Harga pokok — modal barang itu, ikut berpindah saat barang dijual atau ditransfer |
| Batch | Satu penerimaan barang; menyimpan harga pokok dan tanggal kedaluwarsa |
| Opname | Menghitung stok fisik lalu menyesuaikan catatan sistem dengan alasan |
| PO / Purchase Order | Pesanan beli ke satu vendor |
| GRN | Dokumen terima barang saat PO dikirim masuk gudang |
| Z-report | Laporan tutup kas: penjualan per metode bayar, kas seharusnya vs fisik, selisih |
| Void | Pembatalan yang **dicatat**, bukan dihapus — stok kembali, angka laporan keluar |
| FIFO / LIFO / FEFO | Aturan batch mana dipakai lebih dulu: tertua / terbaru / yang paling cepat kedaluwarsa |
| Termin | Jangka waktu pembayaran ke vendor (mis. 30 hari setelah barang diterima) |
| DM / Channel | Percakapan pribadi dua orang / ruang obrolan sekelompok orang di chat internal |

---

## 17. Kalau butuh detail lanjutan

| Pertanyaan | Baca |
|---|---|
| Status setiap fitur (Ada / Sebagian / Belum) beserta riwayat per tanggal | [fitur-tenant.md](fitur-tenant.md) §2 dan §1 |
| Aturan void, struk, dan printer sampai level teknis | [fitur-tenant.md](fitur-tenant.md) §2.2 dan [frontend.md](frontend.md) |
| Alur data, skema, dan penjagaan stok | [backend.md](backend.md), [arsitektur.md](arsitektur.md) |
| Riwayat rilis & masalah yang sudah diselesaikan | [CHANGELOG.md](../CHANGELOG.md), [kendala-solusi.md](kendala-solusi.md) |
