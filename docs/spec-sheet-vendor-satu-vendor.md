# RetailPro — Sheet Vendor Satu Vendor (baris pertama vendor, baris berikutnya produk)

| | |
|---|---|
| Dokumen | `docs/spec-sheet-vendor-satu-vendor.md` |
| Terakhir diperbarui | **2026-11-19** |
| Status | **Beku** (desain dikunci setelah implementasi selesai) |
| Skema | **Tidak ada migrasi.** `schema_version` tetap 12; tidak ada tabel/kolom baru, tidak ada `apply-schema-all` |
| Rilis | `— (working tree)` — lihat [CHANGELOG.md](../CHANGELOG.md) |

Dokumen ini meneruskan [spec-impor-varian-kaya.md](spec-impor-varian-kaya.md) §6: sheet vendor+produk datar,
`carryVendorForward`, dan harga beli yang ditarget ke varian sudah ada di sana. Yang diubah di sini adalah **bentuk
penulisan** sheet itu — satu berkas kini bercerita tentang **satu vendor** — plus haknya untuk **membuat varian dan
pecahan** yang belum ada, dan sebuah **ekspor per vendor** yang bisa dikembalikan apa adanya.

---

## 0. Ringkasan keputusan

| # | Keputusan | Alternatif yang ditolak | Alasan |
|---|---|---|---|
| 1 | **Satu berkas = satu vendor**, ditulis sekali pada baris pertama; baris berikutnya produk vendor itu dengan kolom vendor dibiarkan kosong | Memaksakan vendor diulang di setiap baris (bentuk ekspor lama) | Yang diterima purchasing orang dari pemasok adalah satu lembar miliknya. Menulis vendor 200 kali membuat berkas sulit dibaca dan mudah salah salin |
| 2 | Aturannya **mengikat yang kita hasilkan**, bukan menolak yang dibaca | Menolak berkas multi-vendor saat impor | Ekspor semua vendor, `tests/vendor-catalog.e2e.ts`, dan berkas lama pengguna harus tetap jalan. Menolak = merusak yang sudah ada demi bentuk baru |
| 3 | Baris produk di sheet vendor **sekaya** sheet produk: boleh membuat varian dan pecahan yang belum ada | Sheet vendor hanya boleh menautkan yang sudah ada | Pemasok mengirim harga untuk rasa yang baru lahir; menolkan harga itu berarti berkasnya tidak bisa dipakai untuk yang paling butuh |
| 4 | Pembuatan varian/pecahan digate **`manage_variants`** — flag yang sama dengan pembuatan produk (`mayCreateVariants = mayCreateProducts`) | Kunci izin baru | "boleh menyunting template produk" adalah tepat izin yang dibutuhkan untuk menambah varian pada produk. Kunci baru berarti izin baru yang harus diberikan orang |
| 5 | **Satu transaksi per produk**, bukan per blok vendor | Transaksi per vendor seperti sebelumnya | Bentuk baru membuat satu blok vendor sebesar mungkin; satu baris nakal tidak boleh membatalkan 199 yang sudah benar (pola KS-58) |
| 6 | Kolom baru **di-append di ujung** (`Barcode Varian`, 20 → 21) | Menyisipkan di tengah | Urutan kolom adalah kontrak berkas; menyisipkan membuat setiap berkas lama salah kolom |
| 7 | **Satu daftar** kolom yang diwarisi (`VENDOR_SHEET_KEYS` di `bulk-io.ts`) dipakai perencana, ekspor, dan uji | Dua daftar + satu uji yang menuntut keduanya sama | Test yang membandingkan dua salinan hanya membuktikan salinannya sinkron; satu salinan membuat soal itu tidak ada |
| 8 | Ekspor per vendor **wajib** impor-balik nol tulis | Ekspor bentuk bebas yang "cukup bisa dibaca" | Berkas itu dikirim ke pemasok untuk diisi lalu dikembalikan. Kalau kembaliannya menambah baris, setiap putaran email merusak master |

---

## 1. Kontrak sheet

`VENDOR_PRODUCT_COLUMNS` di `src/lib/bulk-io.ts` tetap **satu-satunya sumber header** untuk template CSV/Excel,
ekspor katalog, ekspor per vendor, dan pembaca impor. Kini **21 kolom**; yang ke-21 adalah

| # | key | Label | Alias | Catatan |
|---|---|---|---|---|
| 21 | `barcode` | Barcode Varian | `barcode`, `kode batang`, `barcode varian` | barcode milik varian yang disebut baris ini, bukan milik produk |

Dua puluh kolom pertama tidak berubah urutan maupun labelnya, jadi setiap berkas yang ditulis sebelum perubahan ini
terbaca persis sama. `PackSeed` menerima `barcode` (dan `attributes`) dan meneruskannya ke `VariantSeed` — penulis
varian sudah menerima barcode varian, jadi tidak ada satu pun jalur tulis baru yang perlu dibuat.

## 2. Bentuk baku yang ditulis template dan ekspor

1. **Baris header** — 21 label.
2. **Baris 1 = hanya data vendor.** `Kode Vendor`, `Nama Vendor`, `Kategori Vendor`, `Kontak`, `Telepon`, `Email`,
   `Termin (hari)` terisi; **setiap kolom produk kosong**. Baris ini tidak menyentuh satu produk pun dan dihitung
   `summary.vendorOnlyRows`.
3. **Baris 2 dan seterusnya = baris produk**, kolom vendor kosong dan diwarisi oleh `carryVendorForward()` yang sudah
   ada. Satu baris = satu (varian × pecahan). `SKU` selalu terisi supaya mengimpor berkas yang sama dua kali tidak
   menambah apa pun; sebuah varian disebut lewat `Kode Varian` **atau** `Atribut Varian`; `Faktor` 1 adalah pecahan
   dasar.

`VENDOR_PRODUCT_TEMPLATE_ROWS` adalah **6 baris** yang menceritakan bentuk itu seluruhnya: baris vendor saja; produk
biasa pecahan dasar; produk yang sama dengan pecahan `Karton` faktor 24; produk dengan `Atribut Varian`; varian yang
disebut `Kode Varian` + `Barcode Varian`; lalu varian kedua pada produk yang sudah ada — baris yang terakhir inilah
yang mengajarkan kasus "tambah varian ke produk yang sudah jalan".

Bentuk yang **diterima tapi tidak dihasilkan**: setiap baris mengulang vendor (ekspor katalog semua vendor), dan
berkas yang memuat beberapa vendor (berkas lama).

## 3. Aturan ini tidak menolak apa pun

Sebuah berkas multi-vendor tetap direncanakan, tetap bisa diimpor, dan hanya diberi **banner informasi** di dialog:
"Sheet ini memuat N vendor — format barunya satu vendor per file. Import tetap jalan; setiap vendor diproses
sendiri-sendiri…". `tests/vendor-catalog.e2e.ts` dan `tests/fixtures/fixture_vendor_produk.csv` tidak disentuh sama
sekali dan dijalankan sebagai bukti kompatibilitas mundur, bukan sebagai sesuatu yang perlu disesuaikan.

## 4. Perencana — varian dan pecahan yang boleh dibuat

`planVendorProductImport(groups, universe, { priceMode, mayCreateVariants })`.

Sebelum perubahan ini, baris yang menyebut varian yang tidak dimiliki produk tersimpan jatuh ke `ambiguousVariants`
dan harganya **dibuang**. Sekarang:

| Kondisi | `mayCreateVariants: false` | `mayCreateVariants: true` |
|---|---|---|
| Varian disebut, produk punya varian lain | `ambiguousVariants`, harga dilewati, nama varian masuk `blockedVariantWrites` | direncanakan sebagai `newVariants` — **harga menempel pada varian baru itu**, bukan hilang |
| Pecahan baru pada varian yang **sudah** cocok | `skippedPacks` | pack itu ditambahkan ke varian existing (`matchedVariantId` terisi), dihitung `newPacks` |
| Baris **tidak** menyebut varian pada produk multi-varian | `ambiguousVariants` | **tetap** `ambiguousVariants` |
| Produk baru dengan beberapa varian disebut | satu varian `Default` (perilaku lama) | `variants` + `variantGroups` dibangun dari sheet dan diteruskan ke `insertImportedProduct()` |

Baris ketiga adalah yang terpenting: **izin menambah varian tidak pernah memberi izin menebak varian.** Jaminan KS-55
tetap utuh untuk kedua pengaturan, dan itu dikunci uji dengan memutar baris yang sama melalui perencana dua kali
(`bothWays()` di `src/lib/vendor-import.test.ts`).

Bentuk baru di tipe: `ProductPlan` menambah `newVariants: VariantSeed[]`, `blockedVariantWrites: string[]`, `variants`
dan `variantGroups`; `ImportPlanSummary` menambah `newVariants` dan `newPacks` (`unknownCodes`, `ambiguousVariants`,
`skippedPacks` tetap berarti lama). Pack di dalam `newVariants[].packs` selalu ber-aksi `"create"` — hanya penulis
varian yang mengeksekusinya, sehingga tidak ada harga yang ditulis dua kali.

Sumbu varian untuk varian yang dibuat diambil dari **jalur `sanitizeGroups` yang sama** dengan perencana produk, jadi
hanya ada satu implementasi "sumbu apa yang diiklankan produk ini". `products.variant_attributes` tetap append-only
dan tetap menjaga urutan yang tersimpan.

## 5. Penulis — satu transaksi per produk

Satu berkas kini berarti satu vendor dengan produk tak terbatas, sehingga blok vendor terlalu besar untuk dijadikan
satu hal atomik. `applyVendorBlock` disusun ulang:

1. **Satu transaksi** untuk master vendor (`resolveOrCreateVendor`) yang mengembalikan `vendorId`.
2. Lalu **satu transaksi per produk**, masing-masing dibungkus `try/catch` sendiri dan menghitung
   `created` / `linked` / `prices` / `variants` / `packs` / `failed` — persis pola yang dipakai importer produk setelah
   KS-58. Satu produk yang gagal hanya menunda produk itu.
3. `try/catch` per vendor di luarnya **tetap ada**, supaya berkas lama multi-vendor tetap mengisolasi kegagalan per
   vendor.
4. Array SKU hasil minting (`minted`) dan `today` diangkat ke lingkup vendor, ke luar closure transaksi, sehingga dua
   baris tanpa SKU tidak mungkin mencetak nomor yang sama antar transaksi.
5. Untuk produk existing yang punya `newVariants`: **`appendImportedVariants(tx, productId, seed, options)`** jalan
   lebih dulu (ia pemilik baris `product_units` dan harga di atasnya), lalu `upsertVendorCatalogLink` →
   `markPreferredVendor` (bila `claimPreference`) → `upsertVendorPrice` per pack yang tersisa, semuanya di transaksi
   yang sama dan tanpa ada baris yang ditulis dua kali.

Master tetap menambah: vendor dan produk yang sudah ada tidak pernah ditamai ulang atau dihapus, dan harga beli yang
sudah dinegosiasi hanya diganti bila pemegangnya `manage_vendor_prices` **dan** mencentang "Timpa harga beli". Stok
awal tidak pernah jadi efek samping lembar harga — varian yang ditambahkan ke produk yang sudah ada lahir dengan stok
0.

## 6. Ekspor sheet per vendor dan jaminan round-trip

Pembangun baris katalog yang tadinya inline di dialog dipindah ke `src/lib/vendor-catalog.ts` sebagai
**`vendorCatalogSheetRows(vendorId?)`** dengan `WHERE ($1 IS NULL OR v.id = $1)` di join yang sudah ada, dan
`pv.barcode AS variant_barcode` ikut dibaca. Kedua pemanggil sekarang memakai satu fungsi itu:

| Pemanggil | Keluaran |
|---|---|
| Ekspor katalog semua vendor (`Ekspor Katalog` di dialog) **tidak berubah** | satu baris per (vendor, produk, varian, pecahan) dengan vendor diulang di setiap baris; nama berkas tidak berubah |
| **Sheet per vendor** — tombol **Ekspor Sheet** di toolbar `pages/vendors/VendorDetail.tsx`, dan **Sheet per Vendor (Excel/CSV)** di footer dialog impor | baris 1 hanya vendor, baris 2+ produk/varian/pecahan vendor itu dengan kolom vendor dikosongkan; nama berkas `sheet_vendor_<KODE>_<tanggal>.<csv\|xlsx>` |

Jaminannya: **berkas yang diekspor untuk satu vendor, diimpor kembali tanpa disunting, tidak menulis apa pun.** Itu
mungkin karena setiap barisnya menyebut `SKU` yang ada, varian yang ada lewat kode varian yang benar-benar tersimpan,
dan pecahan yang ada lewat nama satuannya; dan karena ekspor menutup kolom vendor hanya bila ia sedang mempersempit
ke satu vendor. Uji e2e-nya benar-benar menangkap berkas hasil unduh (`browser.waitForDownload`), membacanya sebagai
teks, lalu menyerahkannya kembali ke input impor.

Satu hal yang **tidak** diekspor sebagai kolom varian: pada produk berisi tepat satu varian tanpa sumbu,
`Kode Varian` / `Atribut Varian` / `Barcode Varian` dibiarkan kosong, sehingga katalog produk biasa keluar persis
seperti dulu.

## 7. Pratinjau

Dialog menambahkan dua chip rencana, **`varian baru`** dan **`pecahan baru`**, baris ringkasan
`… · N varian baru · M pecahan baru` (hanya muncul bila bukan nol), satu alasan khusus untuk baris yang tidak bisa
ditulis karena izin — `butuh izin kelola varian untuk menambah varian` — dan satu baris penjelasan bentuk baru di blok
"Format kolom & contoh baris" yang tetap **tidak** digate izin. Banner multi-vendor §3 bersifat informasi saja:
tombol Import tidak ikut dimatikan.

**Status 2026-11-19 (KS-60)** — janji di atas ternyata belum berlaku untuk berkas yang **paling** ingin diajarkan format
ini. Kedua chip itu harus terbaca sebagai **baris tabel rencana**, bukan hanya sebagai angka di baris ringkasan: cabang
`catalogue saja (tanpa harga)` di `describe()` menelan seluruh produk yang tidak membawa satu baris harga pun untuk
pecahan yang sudah tersimpan — persis bentuk sheet penambah varian/pecahan — sehingga ringkasannya bilang
`· 1 varian baru · 3 pecahan baru` sementara tabelnya hanya menampilkan satu baris tanpa chip dan tanpa alasan.
Placeholder itu sekarang hanya dipakai bila `newVariants`, `skippedPacks`, **dan** `ambiguousVariants` ikut kosong.
Diukur ulang di browser terhadap data nyata (detail VND-0001, produk `PGR-004` yang hanya jual `pcs ×1` per warna):
**tiga baris ber-chip** — `Merah`/`Dus ×12`/`Rp 300.000`/`pecahan baru` dan dua baris varian `PGR-004-UNGU`
(`pcs`/`Rp 22.000`, `Dus ×12`/`Rp 250.000`)/`varian baru`, masing-masing dengan alasannya — nol baris `catalogue saja`,
dan kedua sesi ditutup **Batal** sehingga tidak ada yang tertulis. Assertion e2e ikut dipindah dari ringkasan ke
`getByRole('row')` supaya bentuk kegagalan ini tidak bisa lagi lolos sebagai hijau.

## 8. Batas yang diterima sadar

- Impor tetap interaktif sampai ±2000 baris, satu transaksi per produk, sama seperti importer produk.
- Tidak ada penolakan berkas multi-vendor, tidak ada pemecahan otomatis per vendor, tidak ada kunci izin baru, dan
  `npm run analyze:import` tidak mendapat mode vendor pada perubahan ini.
- Sheet layar produk (`PRODUCT_COLUMNS`) tetap bentuknya sendiri, termasuk kolom `Kode Vendor`-nya yang multi-vendor;
  `VENDOR_COLUMNS` / `VENDOR_TEMPLATE_ROWS` (impor master vendor) tidak disentuh.

## 9. Cara mengukur ulang (diukur 2026-11-19)

| Angka | Nilai | Perintah |
|---|---|---|
| kolom sheet vendor+produk | **21** (20 + `Barcode Varian` di ujung) | `npx vitest run src/lib/vendor-import.test.ts src/lib/bulk-io.test.ts` (array label terkunci) |
| baris template vendor | **6**, satu vendor, baris pertama tanpa kolom produk | `npx vitest run src/lib/bulk-io.test.ts` (describe "one vendor per file") |
| `vendor-import.test.ts` | **51** test (sebelumnya 40) | `npx vitest run src/lib/vendor-import.test.ts` |
| `bulk-io.test.ts` | **27** test (sebelumnya 24) | `npx vitest run src/lib/bulk-io.test.ts` |
| suite penuh | 33 berkas / **547** test | `npx vitest run` |
| fixture satu vendor | `fixture_vendor_produk_satu_vendor.csv` 9 baris data; `…_varian_baru.csv` 3 baris (menambah rasa ke produk yang sudah ada) | dibaca kedua kasus browser di bawah |
| kasus browser baru | **4** dalam `describe('one vendor per file')` di `tests/bulk-import.e2e.ts` (7 → 11); seluruh berkas lulus 11/11 | `npx e2e run tests/bulk-import.e2e.ts` |
| baris rencana di pratinjau (KS-60, diukur 2026-11-19) | sheet satu-vendor nyata yang menambah pecahan + varian menghasilkan **3 baris ber-chip** (1 `pecahan baru`, 2 `varian baru`) dan **0** baris `catalogue saja`; ringkasan `1 varian baru · 3 pecahan baru`; assertion kini mengikat `getByRole('row')`, bukan teks dialog | blok `one vendor per file` dengan `--retries 0`: **3 lulus (3) · 80,86s**; blok penuh `--retries 2`: **`Tests 4 passed \| 1 flaky (5)` · 364,11s** |
| tombol Ekspor Sheet di browser | aktif di toolbar detail vendor (gate `export_reports`) dan melepas toast **`25 baris sheet vendor diekspor`**, tanpa toast error dan tanpa pesan konsol | `/backoffice/vendors` → VND-0001 (12 produk), dibuka lewat agen browser |
| round-trip ekspor | berkas unduhan `sheet_vendor_VND-E2E-SATU_<tanggal>.csv`: 21 header, baris 1 hanya vendor, 12 baris total, diimpor balik tanpa satu baris baru pun | kasus keempat di atas (menangkap unduhan lewat `browser.waitForDownload`, lalu Batal) |
| kompatibilitas mundur | `tests/vendor-catalog.e2e.ts` **tidak diubah** dan tetap lulus 4/4 terhadap `fixture_vendor_produk.csv` lama; kedua berkas bersama sama sekali = **17 lulus** (`Test Files 3 passed`, 21m 35s) | `npx e2e run tests/bulk-import.e2e.ts tests/vendor-catalog.e2e.ts` |
| satu berkas penuh, diulang sesudah KS-60 (diukur 2026-11-19) | **11/11** kasus `bulk-import.e2e.ts` lulus: `Test Files 2 passed (2)` · `Tests 12 passed \| 1 flaky (13)` · 434,74s; flake-nya kelas KS-59 (`GET /api/auth/get-session 500` → `/login`, sebelum ada yang ditulis), bukan assertion | `npx e2e run tests/bulk-import.e2e.ts --retries 2` |
| tidak ada migrasi | `schema_version` tetap 12 | `npm run docs:check` |
