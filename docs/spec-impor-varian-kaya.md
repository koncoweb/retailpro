# RetailPro — Impor Varian Kaya (sheet produk banyak varian, sheet vendor multi-kode)

| | |
|---|---|
| Dokumen | `docs/spec-impor-varian-kaya.md` |
| Terakhir diperbarui | **2026-11-19** |
| Status | **Beku** (desain dikunci setelah implementasi selesai) |
| Skema | **Tidak ada migrasi.** `schema_version` tetap 12; tidak ada tabel/kolom baru, tidak ada `apply-schema-all` |
| Rilis | `— (working tree)` — lihat [CHANGELOG.md](../CHANGELOG.md) |

Dokumen ini meneruskan [spec-vendor-produk-terintegrasi.md](spec-vendor-produk-terintegrasi.md) §5: sheet vendor+produk
datar 18 kolom dan satu penulis produk sudah ada di sana. Yang ditambah di sini adalah **varian** ke kedua sheet, dan
**perencana murni** untuk sheet produk.

---

## 0. Ringkasan keputusan

| # | Keputusan | Alternatif yang ditolak | Alasan |
|---|---|---|---|
| 1 | **Sheet datar panjang**: satu baris = satu (varian × pecahan) | Banyak kolom lebar (`Varian 1 Harga`, `Varian 2 Harga`, …) | Jumlah varian sebuah produk tidak terbatas; melebar berarti sheet punya batas, memanjang tidak. Atribut cukup satu sel: `Rasa=Susu;Ukuran=250ml` |
| 2 | **Kode menang atas nama** di ketiga tingkat: `SKU` → produk, `Kode Varian` → varian, `Kode Vendor` → vendor | Cocokkan lewat nama produk/nama vendor saja | Nama itu input bebas dan bisa kembar; kode sudah dijamin indeks UNIQUE (`idx_products_sku`, `idx_variants_sku`, `idx_suppliers_code`). Sheet vendor lama sudah menuntut "utamakan kode vendor". |
| 3 | `Kode` **tetap** SKU produk di sheet produk | Meng-alias `Kode` → `Kode Vendor` seperti di sheet vendor | Membayangi alias yang sudah ada akan senyap mengganti sasaran setiap file produk lama. Sheet vendor memang satu-satunya tempat `Kode` berarti vendor |
| 4 | SKU existing tidak lagi dibuang, tapi **`extend`** | Perilaku lama: lewati seluruh produk bila SKU sudah ada | Operator menambah varian ke produk yang sudah jalan lewat berkas. Melewati seluruh produk membuat itu mustahil, dan itulah keluhan awal fitur ini |
| 5 | Impor **tidak pernah** menamai ulang, menghapus, atau menolkan harga | "Samakan dengan sheet" (sheet sebagai cermin) | Master adalah kebenaran bersama; harga beli yang sudah dinegosiasi bukan milik spreadsheet |
| 6 | Harga tetap **per pecahan**, tidak pernah diturunkan | Karton = 24 × harga pcs | `product_units` menyimpan harga per pecahan justru karena margin pack berbeda; menurunkan akan mengarang angka |
| 7 | Baris vendor boleh **melanjutkan** vendor di atasnya (kolom vendor kosong) | Wajib menulis vendor di tiap baris | Katalog 500 baris tidak boleh mengetik vendor 500 kali. Baris pertama tanpa vendor tetap tidak valid dan tetap dihitung `keepValid` |
| 8 | Sel `SKU` multi-kode (`A;B;C`) hanya boleh menautkan produk **existing** | Membuat banyak produk baru dari satu sel | Satu `Nama Produk` yang di-mekar-ke-banyak-kode akan membuat massal produk kembar tanpa niat jelas |
| 9 | Harga beli **tanpa penyebut varian** pada produk multi-varian = **ambigu**, bukan tebakan | Jatuh ke varian pertama yang dikembalikan query | Itulah cacat yang diperbaiki di §7: harga mendarat di rasa yang salah, senyap |
| 10 | Pencetakan SKU pindah ke **satu fungsi bersama** (`mintSkuForCategory`) | Tiap importer menyalin logika sequence | Ketiga importer bisa berjalan pada sesi yang sama; dua penyalin berarti dua angka yang bisa bertabrakan |

---

## 1. Kontrak sheet produk

`PRODUCT_COLUMNS` di `src/lib/bulk-io.ts` adalah **satu-satunya sumber header** — template CSV/Excel, Ekspor, dan
pembaca impor semuanya memakainya. Isinya 16 kolom — delapan yang pertama adalah bentuk datar lama dan urutannya tidak
berubah, sehingga file lama terbaca persis sama.

| # | key | Label | Catatan |
|---|---|---|---|
| 1 | `sku` | SKU | alias `kode`, `kode produk`, `sku produk`. Identitas produk |
| 2 | `name` | Nama Produk | field model: baris non-kosong pertama yang menang |
| 3 | `category` | Kategori | field model; juga menentukan prefix SKU otomatis |
| 4 | `price` | Harga Jual | per pecahan; dipakai oleh baris `Faktor` 1 |
| 5 | `cost` | Harga Modal | per pecahan; dipakai oleh baris `Faktor` 1 |
| 6 | `stock` | Stok | satuan dasar, hanya dari baris `Faktor` 1 |
| 7 | `minStock` | Stok Minimum | field model |
| 8 | `supplier` | Supplier | nama vendor; kalah oleh `Kode Vendor` |
| 9 | `variantSku` | Kode Varian | cocok persis `product_variants.sku`; kosong = diturunkan |
| 10 | `variantAttrs` | Atribut Varian | `Rasa=Susu;Ukuran=250ml`; kosong/`Default` = tanpa sumbu |
| 11 | `barcode` | Barcode Varian | alias `barcode`, `kode batang` |
| 12 | `unit` | Satuan | nama pecahan; kosong = pecahan dasar `Pcs` |
| 13 | `factor` | Faktor | isi dalam satuan dasar; kosong/1 = pecahan dasar |
| 14 | `vendorCode` | Kode Vendor | **tidak** di-alias ke `kode` (lihat keputusan 3) |
| 15 | `minOrder` | Min Order | `vendor_products.min_order_qty` |
| 16 | `vendorSku` | Vendor SKU | SKU versi vendor |

Aturan parsing, semuanya di modul murni dan semuanya diuji unit:

- Sel atribut menerima pemisah berpasangan `;`, `|`, atau baris baru, dan pemisah nama-nilai `=` atau `:`. Urutan
  kemunculan pertama menentukan urutan sumbu — urutan itu yang disimpan di `products.variant_attributes`.
- Satu produk = satu kelompok baris dengan `SKU` (atau `Nama Produk` untuk file tanpa kode) yang sama. Satu varian =
  satu kelompok baris pecahan.
- Baris dengan `Faktor` 1 adalah **pecahan dasar** dan membawa `Harga Jual`/`Harga Modal` varian itu.
- `Atribut Varian` dan `Kode Varian` pada baris yang sama **harus sepakat**. Bila tidak, planner melaporkannya
  (aksi `conflict`) dan tidak pernah menebak.
- `Stok`, `Barcode`, dan atribut ikut aturan *first non-blank wins*, sama seperti `firstText`/`mergePack` di
  `vendor-import.ts`.

## 2. Identitas dan pencocokan varian

Tangga identitas: `Kode Varian` → `variantSku(modelSku, attributes)` (slug deterministik, mis.
`E2E-KPB-01-SUSU-250ML`) → `variantKey(attributes)` sebagai kunci pencocokan yang tahan terhadap penulisan ulang label.
Itu sebabnya `Kode Varian` yang diketik manual dan yang diturunkan bisa dipertukarkan asal bentuknya sama — fixture
e2e sengaja memuat kedua jalur.

Pecahan dicocokkan **di dalam** variannya, bukan di dalam produk: `product_units` unik per `(variant_id,
conversion_factor)`, sehingga "Karton isi 24" milik rasa Susu dan milik rasa Hitam adalah dua baris yang berbeda dan
masing-masing bisa punya harga sendiri.

## 3. Kebijakan aditif: `extend` menggantikan "lewati"

Sebelum perubahan ini, SKU yang sudah ada dibuang dua kali: `ProductImportExport.tsx` melewatinya saat pratinjau, dan
`Inventory.handleImport` membuang lagi sebelum menulis. Sekarang produk existing menjadi **`extend`**: planner
menyelesaikan produk itu lalu menulis **hanya yang kurang** — varian yang belum cocok, pecahan yang belum ada, dan
harga yang bolong.

Jaminan yang ditegakkan planner **dan** penulis, bukan hanya UI:

| Yang ada di DB | Yang dilakukan impor |
|---|---|
| nama produk / label varian | tidak pernah disunting |
| varian yang tidak disebut sheet | tidak pernah dihapus |
| pecahan existing dengan harga | harga tidak dinolkan |
| harga beli yang sudah dinegosiasi | hanya diganti bila `manage_vendor_prices` **dan** centang "Timpa harga beli" |
| `is_preferred` vendor | tidak pernah diturunkan |
| `products.variant_attributes` | **union** stored + baru (append-only, urutan stored dijaga oleh `mergeGroups`) |

SKU otomatis (baris tanpa kode) tetap memakai pola aplikasi `PREFIX-YYYYMMDD-XXX`, tetapi lewat satu fungsi.
`resolveCollisions()` untuk layar vendor/pelanggan master tidak disentuh — keduanya mempertahankan perilaku lama.

## 4. Perencana murni — `src/lib/product-import.ts`

Satu file, tanpa SQL dan tanpa React, gaya sama persis dengan `vendor-import.ts`:

| Fungsi | Tanggung jawab |
|---|---|
| `groupProductRows(rows)` | `BulkRow[]` → `ImportedProductSeed[]`: kelompok produk, kelompok varian, pecahan, niat vendor. Nilai atribut yang benar-benar muncul dirangkai menjadi `variantGroups` lalu dilewat `sanitizeGroups` |
| `planProductImport(seeds, universe, options)` | benih + dunia (produk/variant/pecahan/vendor existing) → rencana bertingkat + ringkasan |
| tipe aksi | produk `create \| extend \| nochange`; varian `create \| match \| conflict`; pecahan/harga `create \| overwrite \| fill \| skip` lewat `options.priceMode` |

`universe` dibawa dari layar: produk berikut varian (`id`, `sku`, `attributeKey`) dan pecahannya (`variantId`,
`unitName`, `conversionFactor`), daftar SKU varian existing, dan vendor per kode/nama. Vocabulary aksi
`PackAction`/`ProductAction` sengaja dipakai ulang dari `vendor-import.ts` supaya kedua sheet punya bahasa yang sama.

## 5. Penulis — `src/lib/product-write.ts`

Tetap **satu penulis produk** untuk form dan sheet (keputusan spec vendor–produk terintegrasi).

- `ImportedProductRow` bertambah `variantGroups` dan `variants[]` — **opsional semua**, sehingga kedua call site lama
  tetap kompil dan bertingkah tidak berubah.
- `insertImportedProduct()` bila `variants` ada: tulis `products.variant_attributes` sebagai union, lalu per varian
  satu baris `product_variants` (`name` dari `variantLabel`, `sku` dari `Kode Varian` atau `variantSku()`), baris
  `product_units` nya (pecahan faktor-1 wajib, selalu di `packs[0]`), `product_batches` stok awal, lalu
  `vendor_products` + satu `vendor_price_list` per (varian, pecahan). Urutan yang sudah didokumentasikan di
  `saveProductDraft` dipertahankan: varian → pecahan → stok → harga vendor.
- `appendImportedVariants(tx, productId, seed, options)` untuk kasus `extend`: hanya menyisipkan varian/pecahan yang
  belum cocok dan mengisi harga yang bolong dengan `priceMode` yang sama.
- **Satu transaksi per produk** — alasan "satu round-trip cloud per baris" masih berlaku.
- Pemintan SKU bersama: `mintSkuForCategory(tx, category, today, seen)` di `src/lib/inventory-utils.ts` dipakai
  `Inventory.handleImport`, `VendorProductImport`, dan penulis produk, jadi sheet tanpa kode tidak bisa bertabrakan
  antar layar.
- Pemintan **kode vendor** ikut satu sumber: `latestVendorCode()` memeringkat angka lewat `highestVendorCode()` +
  `vendorCodeSequence()` (`src/lib/vendor.ts`), dan `resolveOrCreateVendor()` meng-*retry* tabrakan kode hasil minting
  dengan angka berikutnya alih-alih mengadopsi baris yang menang. Dua salinan query minting di `Vendors.tsx` dan
  `VendorFormModal.tsx` dihapus — `ORDER BY code DESC` atas teks membuat satu kode tulisan tangan (`VND-E2E-KOPI` di
  fixture varian) meminta `VND-0001` yang sudah ada. Catatan lengkap di [kendala-solusi.md](kendala-solusi.md) KS-56.

## 6. Sheet vendor: tiga perilaku

`VENDOR_PRODUCT_COLUMNS` bertambah **tepat dua kolom, di-append di ujung** (`Kode Varian`, `Atribut Varian`) sehingga
ekspor lama tetap sebaris dengan header-nya: 18 → 20 kolom. Ketiganya helper murni yang dijalankan layar **sebelum**
`keepValid`, sehingga signature `groupVendorProductRows()` dan berkas uji 570 barisnya tidak berubah.

| Helper | Perilaku |
|---|---|
| `carryVendorForward(rows)` | baris yang `Kode Vendor` **dan** `Nama Vendor`-nya kosong mewarisi vendor baris terakhir yang membawanya (termasuk kolom kontak). Baris pertama tanpa vendor tetap invalid |
| `expandProductCodes(rows)` | sel `SKU` ber-`;` / `\|` / baris baru dipecah menjadi satu baris per kode. Hasil pemecahan **hanya menautkan produk existing**; kode yang tidak selesai menjadi baris error (`unknown-code`) dan tidak pernah membuat produk massal |
| varian di harga beli | `ExistingPack` membawa `sku`/`attributeKey` variannya; pencocokan terjadi **di dalam** varian yang disebut baris. Produk bervarian banyak + baris tanpa varian → rencana mengeluarkan `ambiguousVariants` dan tulisannya dilewati, dihitung di pratinjau |

## 7. Cacat: harga beli mendarat di varian yang salah

**Ini bug, bukan fitur baru.** Sebelum perubahan ini `packsByProduct` merapatkan pecahan setiap varian ke level
produk, dan `planVendorProductImport` mencocokkan hanya pada `unitName`. Akibatnya satu baris sheet untuk produk
bervarian tiga menjatuhkan harga belinya ke varian **yang kebetulan kembali pertama** oleh query — tanpa pesan, tanpa
jejak. Produk tunggal (`Default`) tidak terpengaruh, jadi bug ini tidak kelihatan di data demo.

Perbaikan: identitas varian ikut dibawa ke pencocokan (§6 baris ketiga). Karena kolomnya tidak ada di sheet lama, baris
lama pada produk multi-varian kini menjadi `ambiguousVariants` yang **dilewati dan dilaporkan** — bukan ditebak.
Operator menyebut variannya, lalu harga tertulis ke baris yang benar. Catatan lengkap di
[kendala-solusi.md](kendala-solusi.md) KS-55.

## 8. Ekspor dan round-trip

Ekspor produk menghasilkan kolom kaya yang sama, satu baris per (varian × pecahan), dibangun dari data yang memang
sudah dimuat halaman (`variantGroups`, `variants[].units[]` berisi `variant_id`, `warehouses`). Ekspor katalog vendor
mengikutkan dua kolom baru. Template tetap satu sheet — bentuk yang dipilih di keputusan 1 — dan
`PRODUCT_TEMPLATE_ROWS` adalah **4 baris** yang menceritakan keseluruhan cerita: satu produk tanpa varian, lalu satu
produk dua sumbu dengan salah satu varian punya pecahan `Karton` faktor 24, lengkap dengan `Kode Vendor`.

Konsekuensi yang diuji: **ekspor → ubah → impor** kembali tidak menambah apa pun, karena keduanya memakai bentuk yang
sama dan impornya aditif.

## 9. Pratinjau, izin, dan batas

`src/components/inventory/ProductImportExport.tsx` dibangun ulang mengikuti pola dialog vendor: ringkasan chip
(**produk baru · varian baru · pecahan baru · harga diisi · harga ditimpa · dilewati · SKU otomatis · catatan file**),
baris dikelompokkan per produk beserta varian-varian nya, satu alasan untuk setiap baris yang dilewati, checkbox
**Timpa harga beli** yang hanya aktif dengan `manage_vendor_prices`, pemilih gudang untuk stok awal, dan sebuah blok
terurai **Format kolom & contoh baris** yang **tidak** digate izin (tombol template juga sudah tidak digate, alasan
sama: itu penjelasan, bukan aksi). `Inventory.handleImport` menyusut menjadi: bangun universe → `planProductImport` →
jalankan node rencana lewat dua penulis, satu transaksi per produk.

Gate izin tidak berubah dari release sebelumnya: tombol Import butuh `manage_variants`, ekspor butuh
`export_reports`, penimpaan harga beli butuh `manage_vendor_prices`.

**Pratinjau adalah janji, jadi ia diuji terhadap penulisnya, bukan terhadap tipenya** (KS-57). Tiga aturan yang
menegakkan itu: harga beli hanya direncanakan bila barisnya benar-benar menyebut vendor
(`hasVendor = vendorId !== null || plan.newVendor`), sehingga chip "harga diisi" tidak pernah muncul untuk angka yang
tidak punya jalur tulis; `plan.priceWrites` menghitung harga yang akan masuk (`fill` + `overwrite`) dan ikut
menggerakkan gerbang `nochange` maupun tombol Import, jadi berkas yang **cuma** menambal harga bolong tetap bisa
diimpor; dan baris sheet vendor yang tidak membawa harga sekaligus tidak menyebut varian diperlakukan sebagai tautan
saja, bukan sebagai harga yang hilang. Bentuk dialognya juga ikut dikunci: `DialogContent`
`max-h-[85vh] overflow-y-auto` dengan badan tabel `flex-1 min-h-[200px] max-h-[50vh] overflow-auto` — tanpa `min-h`,
`overflow-auto` membuat tinggi minimum otomatis 0 dan tabel rencana lenyap pada berkas besar.

Batas yang diterima sadar:

- Berkas sampai ±2000 baris tetap interaktif — planner jalan sekali per upload, satu transaksi per produk, sama
  seperti importer vendor.
- Ekspor tetap satu sheet; tidak ada workbook multi-sheet "produk / varian / pecahan".
- Tidak ada migrasi dan tidak ada kolom baru: semua yang dibutuhkan sheet sudah ada di skema v6–v10.

## 10. Cara mengukur ulang (diukur 2026-11-19)

Setiap angka di dokumen ini punya perintah yang membuktikannya.

| Angka | Nilai | Perintah |
|---|---|---|
| kolom sheet produk | 16 | `npx vitest run src/lib/bulk-io.test.ts` (menyebut header lengkap) |
| kolom sheet vendor+produk | 20 (18 + 2 append) | `npx vitest run src/lib/vendor-import.test.ts` (array label terkunci) |
| baris template produk | 4 | `npx vitest run src/lib/bulk-io.test.ts` |
| unit test suite | 33 berkas / 533 test | `npx vitest run` |
| `product-import.test.ts` | 31 test | `npx vitest run src/lib/product-import.test.ts` |
| urutan kode vendor (KS-56) | `vendor.test.ts` 14 · `vendor-catalog.test.ts` 26 | `npx vitest run src/lib/vendor.test.ts src/lib/vendor-catalog.test.ts` |
| `vendor-import.test.ts` | 40 test (HEAD 24) | `npx vitest run src/lib/vendor-import.test.ts` |
| `bulk-io.test.ts` / `variants.test.ts` / `inventory-utils.test.ts` | 24 / 28 / 13 | `npx vitest run src/lib/bulk-io.test.ts src/lib/variants.test.ts src/lib/inventory-utils.test.ts` |
| fixture varian → hasil rencana | 5 baris → 1 produk, 4 varian, 5 pecahan, 5 harga, 0 catatan | `npx vitest run src/lib/product-import.test.ts` (describe "the rich variant e2e fixture") |
| roster e2e | 14 berkas, 74 `test` + 1 `test.setup` → **80** saat dijalankan penuh | `npx e2e run` (terukur: 61 lulus + 2 lulus setelah retry, 14 gagal, 3 di-skip = 80) |
| kasus browser impor varian | 2 baru di `bulk-import.e2e.ts` (5 → 7) | `npx e2e run tests/bulk-import.e2e.ts` |
| kompatibilitas mundur | `tests/vendor-catalog.e2e.ts` jalan **tanpa diubah** terhadap `fixture_vendor_produk.csv` lama | `npx e2e run tests/vendor-catalog.e2e.ts` |
| berkas nyata pengguna (KS-57) | `produk_2026-11-10.xlsx` 282 baris → rencana "274 akan ditulis · 8 tidak ada yang baru"; tabel rencana punya tinggi nyata (badan 199 px, digulir s/d 5.774 px) dan footer "Import 274 Produk" | buka **Import** di `/backoffice/inventory/products`, unggah berkasnya, tekan Batal |
| harga tanpa vendor tidak dijanjikan (KS-57) | chip "harga diisi" hilang, alasan "harga beli butuh Kode Vendor atau Supplier" tampil, tombol mati; tambal-saja (baris yang sama + `Kode Vendor`) justru "1 akan ditulis" + tombol aktif | unggah satu baris `CHC-002` dengan `Harga Modal` terisi tapi `Kode Vendor`/`Supplier` kosong, lalu salinan baris itu dengan `Kode Vendor` VND-0002; keduanya Batal |
| isi 14 kegagalan suite penuh | 9 `MODEL_PROVIDER_FAILED: ExceededBudget` (kuota provider AI) + 5 assertion di berkas yang tidak menyentuh impor; **nol** yang menyebut `suppliers.code` | `npx e2e run` lalu baca blok `Failed Tests`, lihat [kendala-solusi.md](kendala-solusi.md) KS-56 |
| titik berhenti impor lama (KS-58) | baris 1–8 berkas tertulis **kontinu**, `created_at` 08:19:24.090Z → 08:19:36.762Z (±1,7 s per produk); baris penghenti = baris ke-9 `8994592309639`, **tanpa** sebab data (0 dari 274 SKU yang belum punya produk ternyata dipakai sebagai `product_variants.sku`); build sekarang merencanakannya "produk baru · varian baru · harga diisi" | `npm run analyze:import -- produk_2026-11-10.xlsx` (read-only; bagian "JEJAK TULIS") |
| skema | tetap v12 | `npm run docs:check` (menyelaraskan tiga tempat) |

> **Catatan status 2026-11-19 (KS-58).** Baris terakhir di atas ditambahkan setelah pertanyaan pengguna — "berkas 282 baris, kenapa yang masuk cuma 8?" — **diukur**, bukan disimpulkan. Satu hal berubah dari spesifikasi ini: loop yang menjalankan rencana di `Inventory.handleImport` sekarang menangkap exception **per produk** dan menutup laporan dengan `N gagal ditulis`, karena §9 sudah berjanji seluruh rencana dijalankan; sebelumnya satu `try/catch` membungkus seluruh loop sehingga kegagalan di tengah jalan menghapus sisa berkas tanpa angka dan tanpa baris. Tidak ada perubahan kontrak sheet, perencana, penulis, maupun kebijakan `extend` — forensiknya ada di [kendala-solusi.md](kendala-solusi.md) KS-58.
