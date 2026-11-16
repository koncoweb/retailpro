# Changelog

Semua perubahan penting pada RetailPro didokumentasikan di sini.
Format mengikuti [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1de90d2] — 17 November 2026 — Verifikasi produksi satu perintah (`npm run verify:prod`)

Runbook §7 `docs/deployment.md` yang tadinya enam perintah `curl` di sana sekarang dijalankan satu skrip terhadap deployment yang hidup. Lahir dari kekeliruan saat verifikasi pasca-push: sign-in menjawab **403** dan menyeret lima pemeriksaan lain ikut gagal, terbaca seperti "build CI produksi rusak".

### Added

- **`scripts/verify-production.mjs`** + `npm run verify:prod` — tujuh pemeriksaan tetap (health + control DB, bootstrap tanpa sesi harus **401 bukan 500**, marketplace, katalog, sign-in, token tenant termasuk cek `https`/panjang token/TTL, grants per peran) ditambah satu pemeriksaan per kunci yang lewat `--require-perm`. Satu baris `ok`/`FAIL` per pemeriksaan **beserta detailnya**, karena "OK" tanpa angka yang diukur tidak bisa dibedakan dari pemeriksaan yang tidak membaca apa pun.
- **Tiga jalur keluar**: `0` semua lolos · `1` ada yang gagal (namanya disebut) · **`2` pemeriksaan sesi dilewati** karena `DEMO_PASSWORD` tidak dipasang — hijau tidak boleh berarti "belum dicek". `--base <url>` mengarahkan ke deployment tertentu (mis. URL `dpl_…` hasil build GitHub, bukan alias); `--require-perm k1,k2` menampung kunci izin rilis berjalan sehingga skripnya tidak perlu diedit tiap rilis.
- **KS-50 + pelajaran umum no. 17** di `docs/kendala-solusi.md`, dan §7.0 di `docs/deployment.md`.

### Fixed

- **Bug di skripnya sendiri, ketahuan dari outputnya sendiri**: `boot.status` dibaca padahal helper mengembalikan `{ res, body }` → tampil `HTTP undefined` di tengah payload yang sempurna. Tepat karena baris cek selalu mencetak detailnya, kekeliruan itu terlihat alih-alih lolos sebagai "ok".
- **Penyebab 403 dijawab dengan eksperimen, bukan simpulan**: Better Auth memeriksa `Origin` hanya pada request yang membawa `Sec-Fetch-Mode`; `fetch` Node mengirim `Sec-Fetch-Mode: cors` tanpa `Origin`, `curl` tidak mengirim keduanya. Itu berarti **langkah 4 `curl` di runbook sudah benar** dan justru tidak boleh "diperbaiki" — hipotesis pertama saya salah dan hampir masuk ke dokumen.

### Catatan

- Kredensial hanya dibaca dari environment; nilai demo tetap tinggal di blok credentials `e2e.config.ts` dan tidak diduplikasi ke berkas baru.

## [dabf287] — 17 November 2026 — Vendor–Produk Terintegrasi (satu penulis, vendor otomatis di PO)

Input vendor (form **atau** sheet) sekaligus bisa input produk, dan PO memilih vendor sendiri begitu produk dipilih. Skema **v10** — **tabel dan kolom tidak ada yang baru**, migrasi `010` hanya menambah dua indeks. 14 berkas diubah (±1.054 baris ditambah, 634 dihapus) + 11 berkas baru (±4.163 baris, termasuk 1.449 baris test).

> Model datanya sudah lengkap sejak v3 (`vendor_products`) dan v6 (`vendor_price_list`); yang bocor adalah **jalur penulisnya**: tiga salinan "find-or-create supplier" dan empat salinan tautan katalog yang sudah saling berbeda, `is_preferred` tidak pernah disetel siapa pun, dan form produk tidak pernah menulis harga beli. Memperbaiki UI saja akan meninggalkan enam cara menulis tiga baris yang sama — perubahan ini membuat satu modul jadi satu-satunya penulis, lalu merutekan semua layar, sheet, dan seeder lewatnya. Desain beku di [docs/spec-vendor-produk-terintegrasi.md](docs/spec-vendor-produk-terintegrasi.md).

### Added — satu penulis relasi vendor⇄produk

- **`src/lib/vendor-catalog.ts`** (296 baris) — `resolveOrCreateVendor()` (nama → master sungguhan: kode `VND-####` di-mint dari `MAX(code) LIKE 'VND-%'` **di dalam** transaksi, kategori/kontak/telepon/email ikut tersimpan, dan **tidak pernah** menimpa baris yang ada), `findVendorByName/ByCode()` lewat `WHERE name = $1 COLLATE NOCASE`, `upsertVendorCatalogLink()` (`last_cost` selalu ikut pemanggil, `is_preferred` tidak pernah turun karena `MAX()`), `markPreferredVendor()` (tepat satu vendor utama per produk), `recordVendorLastCost()`, `upsertVendorPrice(mode)` dua mode (`overwrite` vs `gap-only` = `DO NOTHING`; harga ≤ 0 tidak pernah ditulis), dan `defaultVendorFor()` sebagai resolver murni. `src/lib/goods-receipt.ts` L317-330 ikut dialihkan ke `upsertVendorPrice(mode: 'gap-only')` supaya kebijakan penerimaan barang punya satu definisi.
- **`src/lib/vendor-catalog-sql.ts`** (201 baris, **nol import**) — statement builder tempat keempat tulis di atas hidup. Alasannya struktural: seeder demo (`server/demo/ledger.ts`) hanya *menyusun* statement dan tidak boleh mengimpor `src/lib/db`, jadi berbagi builder — bukan berbagi helper async — adalah satu-satunya cara agar katalog hasil seed tidak bisa lagi datang tanpa baris `vendor_price_list`. Provenance ditulis di `vendor_price_list.notes` (`import`, `form produk`, `katalog vendor`, `penerimaan barang`, `seed demo`) alih-alih menambah kolom.
- **`src/lib/product-write.ts`** (660 baris) — ekstraksi badan `handleSaveProduct` dan blok per-baris `handleImport` dari `Inventory.tsx` menjadi `saveProductDraft()` + `insertImportedProduct()`. `Inventory.tsx` kini pemanggil tipis dan `VendorDetail.tsx` memakai fungsi yang sama: tidak ada penulis produk kedua. Dua aturan tulis baru di dalamnya menutup kebocoran utama: (1) vendor yang diketik sebagai teks menjadi master + tautan katalog `isPreferred: true` + `markPreferredVendor` + `products.supplier_id`; (2) tiap (varian, pecahan) dengan `cost > 0` menulis `vendor_price_list` — `overwrite` hanya bila pemegang `manage_vendor_prices`, selain itu `gap-only`, sehingga form produk tidak bisa menginjak harga kesepakatan. Semuanya tetap satu `runTransaction()` + satu `logAuditTx()`.
- **`src/lib/vendor-import.ts`** (542 baris) — `groupVendorProductRows()` dan `planVendorProductImport()` murni (rencana dipisah dari eksekusi supaya bisa diuji tanpa browser). Kunci vendor = `Kode Vendor` (uppercase) bila ada, jika tidak nama ternormalisasi; kunci produk = `SKU` bila diisi, SKU kosong + nama sudah dikenal → **tautkan** (jangan duplikat, jangan bikin SKU), SKU terisi yang sudah ada → lewati produknya tapi baris harganya tetap jalan; satu baris = satu pecahan, `Satuan` kosong = pecahan dasar, dan tiap produk wajib punya faktor 1 (`PackAction` = `create`/`overwrite`/`fill`/`skip`).
- **`VENDOR_PRODUCT_COLUMNS`** (18 kolom) + `VENDOR_PRODUCT_TEMPLATE_ROWS` di `src/lib/bulk-io.ts` menjadi satu-satunya sumber header untuk template, ekspor, dan impor.
- **`src/components/vendors/VendorProductImport.tsx`** (766 baris) — dialog **Import Vendor + Produk** mengikuti pola `ProductImportExport.tsx`: pratinjau `"2 vendor baru · 3 produk baru · 4 harga beli (4 diperbarui)"` + status per baris sebelum ada yang ditulis, satu kali baca universe yang sudah ada (`suppliers`, `products`, `vendor_products` untuk vendor di sheet), lalu **satu `runTransaction()` per blok vendor** — koneksi cloud tidak boleh membatalkan 2.000 baris karena baris 1.900 rusak, dan satu vendor buruk tidak membatalkan tetangganya. Toolbar `pages/vendors/Vendors.tsx` kini punya `Import Vendor + Produk`, `Ekspor Katalog`, `Template Vendor + Produk (CSV)`, `Template Vendor + Produk (Excel)`; bentuk ekspor = bentuk impor, jadi file hasil ekspor bisa diimpor balik.
- **Vendor → produk dalam satu alur.** `onSaved` dari form tambah vendor kini melempar ke `/backoffice/vendors/<id>?tambah-produk=1`; `VendorDetail.tsx` membaca flag itu **sekali** lalu membersihkannya lewat `setSearchParams` (jebakan lama: prefill hilang karena efek yang menunggu katalog kosong), dan membuka `<AddProductModal mode="add" defaultSupplier={{ id, name }} />` — prop baru di `AddProductModal.tsx` yang diterapkan pada efek reset add-mode sehingga tidak tertimpa, payload-nya ikut mengirim `supplierId`, dan tombol "Tambah Supplier Baru" diganti `resolveOrCreateVendor`. Tab Produk vendor mendapat **Tambah Produk Baru**, dan dialog **Hubungkan Produk** mendapat switch **Jadikan vendor utama** (`is_preferred` + isi `products.supplier_id` bila kosong) yang juga mengisi `vendor_price_list` mode `gap-only` dari `last_cost`. `VendorDetail` kini memuat `WAREHOUSES_SQL` yang sebelumnya tidak dibacanya.

### Changed — purchase order: pilih produk, vendor ikut terpilih

- `PRODUCTS_SQL` menambah proyeksi `(SELECT vendor_id FROM vendor_products WHERE product_id = p.id AND is_preferred = 1 LIMIT 1) AS preferred_vendor_id`; `VendorOption` membawa `status`. `defaultVendorFor()` = **preferred → `supplierId` → vendor tunggal yang terkait**, vendor `status !== 'active'` selalu dilewati, dan dua vendor tanpa preferensi menjawab `null` — itu keputusan pembeli, bukan tebak-tebakan aplikasi.
- Selama vendor belum terpilih, picker menampilkan **semua** produk dengan caption vendornya per baris; memilih satu menjalankan `applyVendor()` yang menyetel vendor, memprefill `expectedDate` dari `lead_time_days`, dan memuat harga kesepakatan yang sudah ada. Field vendor menampilkan caption **"Vendor (otomatis dari produk)"** + tombol **Ubah** supaya hasil auto-fill jelas bisa disetel manual. Setelah vendor terpilih, produk difilter seperti sebelumnya (satu PO satu vendor, `validatePurchaseOrder` tetap menuntut satu `supplierId`).
- **Ganti vendor tidak lagi menghapus diam-diam.** `AlertDialog` (menggantikan drop senyap di `PurchaseOrderModal.tsx` L706-713) menyebut vendor tujuan dan menghitung baris vendor lain yang akan dibuang; **Batal** meninggalkan draf persis seperti semula.
- `handleAutoFillLowStock` dan `handleFillFromTemplate` mengelompokkan barisnya per `defaultVendorFor`; lebih dari satu vendor berarti tidak ada baris yang ditulis dan pembeli diberi tahu vendor mana yang butuh PO terpisah.

### Fixed

- **Impor produk tidak lagi membuat vendor yatim.** Jalur lama menulis `INSERT INTO suppliers (name)` tanpa kode/kategori (dua tempat) dan tanpa `vendor_price_list`; sekarang semua lewat `resolveOrCreateVendor()` + `upsertVendorCatalogLink(isPreferred: true)`.
- **Seeder demo tidak lagi membuat katalog tanpa harga.** `server/demo/ledger.ts` membangun baris `vendor_products`/`vendor_price_list`/preferensi dari statement builder yang sama (`notes = 'seed demo'`), bukan literal SQL sendiri.
- **Assertion database e2e mengikuti plane aplikasi.** `tests/support/db.ts` membaca `CONTROL_DB_URL` dari `.env` (Turso cloud) sementara SPA yang berjalan menulis ke plane demo lokal (`local-thalia` → shim `:8090` → `.data/demo/thalia.db`), sehingga tes "berhasil di layar, gagal di database". `tenantClient()` kini mengenali `file:`/loopback lewat `isLocalDatabase()` dan connect tanpa token platform untuk itu. Catatan lingkungan: `npm run schema:apply-all` hanya tahu cara mint token Turso, jadi plane lokal di-apply ulang lewat `npm run demo:local` (`tenant.sql` sudah membawa kedua indeks v10).
- **Aksesibilitas yang dibutuhkan tes, dan berguna bagi pembaca layar**: `htmlFor`/`id` pada `#product-category` dan `#product-supplier` (`AddProductModal.tsx`), `id="po-product-picker"` (`PurchaseOrderModal.tsx`), `id="vendor-product-import-file"`. `<Button role="combobox">` menampilkan isinya sebagai **value**, bukan **name**, jadi `getByRole('combobox', { name: 'Pilih produk...' })` tidak akan pernah cocok.

### Tooling — refleksi pasca-rilis: dokumen dan auditor dapat penjaganya

Rilis ini sendiri yang menghasilkan tiga cacat kelas sama — tabel markdown terbelah, angka lama selamat dari re-sync, dan temuan `audit:sql` yang ternyata kalimat di dalam komentar. Ketiganya ketahuan **oleh tangan**, jadi kelasnya diangkat menjadi gerbang, tanpa satu baris pun perubahan pada kode aplikasi:

- **`scripts/check-docs.mjs` + `npm run docs:check`** (baru) — empat pemeriksaan: jumlah sel setiap baris tabel markdown harus sama dengan header-nya (blok kode di-*skip*, `\|` dihitung teks), versi skema harus satu angka di tiga tempat (stamp `tenant.sql`, `CURRENT_SCHEMA_VERSION`, prefiks tertinggi `db/migrations`), indeks dokumentasi README harus menutup setiap `docs/*.md`, dan anchor `§N` setelah tautan `[berkas.md](berkas.md)` harus menunjuk heading yang benar-benar ada. Keluarannya mencetak cakupannya sendiri (berapa berkas, baris tabel, dan anchor yang benar-benar dibaca) — "OK" tanpa angka cakupan tidak bisa dibedakan dari gerbang yang tidak membaca apa pun.
- **Positive control** di `scripts/__fixtures__/docs-check/`: satu cacat ditanam per pemeriksaan, dan `node scripts/check-docs.mjs --root scripts/__fixtures__/docs-check` **wajib** keluar 1 dengan tepat 8 masalah. Yang diperiksa anchor-nya adalah **nomor bagian** — `§15.10` di spec baru sempat ditulis tangan dan isinya benar, hanya bentuknya menyalahi konvensi KS-48 (`§15 poin 10`); ia diperbaiki manual, dan header `check-docs.mjs` mencatat dengan jujur bahwa sub-poin memang **tidak** bisa dibuktikan oleh sebuah heading, jadi aturan itu tinggal konvensi, bukan gerbang.
- **`scripts/audit-sql.mjs`** — `commentRanges()` memisahkan rentang `//` dan `/* … */` sebelum mengumpulkan literal (string di-step-over supaya `//` di dalam URL tidak membuka komentar): **538 → 530** literal, **477 → 471** diperiksa, 61 → 59 dinamik, dan **3 → 2** kelas temuan — seluruh kelas `SYNTAX \| incomplete input` hilang karena memang bukan panggilan kode. Flag baru `-- --show-comments` mendaftarkan 8 situs yang dibuang beserta baris sumbernya, jadi klaim "itu cuma dokumentasi" bisa diverifikasi ulang kapan saja.
- **Enam tabel markdown lama diperbaiki**: empat baris `docs/fitur-tenant.md` kehilangan sel **Status** terakhir, satu `\|\|` di dalam code span `docs/frontend.md`, dan satu nilai absolut di tabel validasi `docs/spec-varian-harga-vendor.md` §4.2 di-escape (hanya format; dicatat di catatan status bertanggal spec itu supaya pembekuannya tetap bisa diaudit).
- **Dokumentasi disinkronkan ulang**: `docs/backend.md` §10 (baris `audit:sql` + `docs:check`), `README.md`, `docs/arsitektur.md` §7, `docs/spec-vendor-produk-terintegrasi.md` menambah **§9 How to re-verify** (setiap angka yang spec itu kutip punya perintahnya), dan `docs/kendala-solusi.md` mencatat **KS-49** + pelajaran umum no. 16 ("gerbang wajib membuktikan dirinya bisa gagal").

### Testing

- Unit baru `src/lib/vendor-catalog.test.ts` (25) — resolve-or-create NOCASE, mint kode di dalam transaksi, preferred tunggal, dua mode `upsertVendorPrice`, `defaultVendorFor`; `src/lib/vendor-import.test.ts` (24) — grouping, taut-by-nama, skip-by-SKU, harga tetap jalan, pecahan dasar wajib, dan fixture e2e itu sendiri ikut diputar. `bulk-io.test.ts` (19) menjaga header 18 kolom; `db/__tests__/schema.test.ts` (29) menjaga versi 10 + kedua indeks; `db/__tests__/demo-tenant.test.ts` (15) menambah tiga invarian: seluruh `vendor_price_list.notes = 'seed demo'`, tidak ada `vendor_products` tanpa harga pecahan dasar, dan `SUM(is_preferred) = 1` per produk.
- e2e baru `tests/vendor-catalog.e2e.ts` (4 kasus; run terakhir 19,7 s, dan 27,7 s untuk file ini bersama `auth.setup` = 5 tes — durasinya ikut bervariasi antar-run karena koneksinya ke Turso cloud) + `tests/fixtures/fixture_vendor_produk.csv`: sheet flat menulis vendor+produk+katalog+harga; impor ulang tidak menambah apa pun tapi mengembalikan harga ke angka sheet (master aditif, telepon hasil edit tidak ditimpa); tambah vendor → form produk terisi vendor → produk muncul di tab Produk **dan** Harga Beli; PO memilih produk → vendor + harga kesepakatan muncul, dan konfirmasi ganti vendor tampil (bukan hilang diam-diam). `purgeFixtureRows()` menyapu universe fixture di awal supaya file bisa dijalankan berulang.
- Gerbang: `npx tsc -p tsconfig.app.json` dan `npx tsc -p tsconfig.node.json` 0 error, **vitest 30 berkas / 419 tes** lulus, `npm run build` lulus, `npx eslint` atas 20 berkas yang rilis ini ubah: **0 error** (1 warning lama `react-hooks/exhaustive-deps` di `AddProductModal.tsx`). `eslint .` repo-wide masih 25 error `no-explicit-any` di dashboard/laporan/`src/lib/db/json.ts` — jumlahnya sama dengan di `HEAD`, bukan regresi rilis ini.
- Verifikasi browser pada `http://localhost:8080`: vendor hasil sheet diberi kode oleh `resolveOrCreateVendor` (**VND-0006** pada run terakhir; nomornya di-mint dari `MAX(code) LIKE 'VND-%'` sehingga berubah antar-run), tab `Produk (2)` + `Harga Beli (3)` (Pcs Rp 9.000; **Karton (isi 24) Rp 205.000 → Rp 8.542 per satuan**; Gula Pcs Rp 11.000), dan PO menampilkan `VND-0006 · PT E2E Katalog Sumber` + "Harga kesepakatan vendor: Rp 9.000 (min. 5)" dengan `Harga Satuan` terisi `9000`. Sesi browser langsung di layar PO (vendor masih `Pilih vendor`) membuktikan bentuk auto-fill di DOM: daftar produk menampilkan **31 opsi** tanpa filter dengan caption vendornya (`Minyak Goreng E2E BUM-20261116-001 · CV E2E Distribusi`), dan setelah satu produk dipilih vendor berubah sendiri menjadi **`VND-0007 · CV E2E Distribusi`** dengan keterangan "Vendor (otomatis dari produk)" + tombol **Ubah**, satuan `Default/Pcs`, `Harga Satuan` **15000** — angka itu berasal dari `vendor_price_list` yang ditulis impor, bukan dari `products.cost_price`. Tangkapan layar (artefak lokal di `.data/evidence/`, tidak ikut di-commit): `01-vendors-toolbar.png`, `02-vendor-detail-produk.png`, `03-vendor-harga-beli.png`, `04-po-auto-vendor.png`.
- Migrasi diterapkan ke tenant cloud `rp-thalia`: **v8 → v10** (`npm run schema:apply-all -- --apply`).

### Docs

- **Baru**: `docs/spec-vendor-produk-terintegrasi.md` (221 baris) — tabel kebocoran dengan bukti berkas/baris, empat keputusan yang dikunci, kenapa tidak ada tabel & tidak ada kolom, API satu penulis, aturan `product-write.ts`, kebijakan sheet 18 kolom, prioritas auto-fill PO, izin, dan di luar scope.
- **Re-sync**: `docs/backend.md` (§5.12 katalog vendor + §8.1 modul penulis domain + invariant 16 + riwayat skema v10), `docs/frontend.md` (§2 peta modul baru, §8 tiga fitur baru, §10 log, §12 aturan e2e 14–16 + hitungan berkas uji + keadaan lint sebenarnya), `docs/fitur-tenant.md` (§1 log 2026-11-17, §2.3 & §2.4), `docs/arsitektur.md` (alur kritis baru **§4.9** katalog vendor–produk + versi skema + angka verifikasi), `docs/spec-varian-harga-vendor.md` dan `docs/spec-purchase-order.md` (catatan status bertanggal, isinya tetap beku), `docs/deployment.md` (contoh naik versi jadi v9 → v10 + perbedaan "indeks saja" di runbook), serta versi skema di `README.md` dan `requirement.md` dinaikkan ke v10 (`README.md` ikut menambah alur vendor–produk, paragraf demo, dan baris spec baru di indeks dokumen).
- **Di luar scope** (ditulis eksplisit di spec): PO multi-vendor, impor varian/atribut, tier harga per qty, PPN/landed cost, otorisasi sisi server, dan dedup vendor yang sudah terlanjur punya dua ejaan.

## [dabf287] — 16 November 2026 — Void Transaksi (per Item & per Bon)

Pembatalan penjualan di Riwayat Kasir, skema **v9**. ±991 baris ditambah, 170 dihapus; 41 berkas diubah + 5 berkas baru.

### Added — Pembatalan tanpa penghapusan

- **Kolom void** — migrasi baru `db/migrations/009_transaction_voids.sql` (31 baris) + baseline `db/schema/tenant.sql`: `transactions.void_reason/voided_by/voided_at` (bon batal ditandai `status='void'`, nominal awal tetap tersimpan) dan `transaction_items.voided INTEGER NOT NULL DEFAULT 0` dengan trio audit yang sama per baris. `CURRENT_SCHEMA_VERSION` dinaikkan 8 → 9 (`scripts/apply-schema-all.mjs`), dijaga `src/lib/db/__tests__/schema.test.ts`.
- **`src/lib/void.ts`** (273 baris, murni + satu jalur tulis) — `voidTransactionItems()` untuk per baris, `voidTransactionBon()` untuk satu bon penuh; keduanya selalu di dalam satu `runTransaction()` dan menulis `logAuditTx('void_transaction', { kind: 'items' | 'bon' })`. Guard `voidGuard()` dievaluasi sebelum query apa pun: izin `void_transaction` → alasan minimal 3 karakter → transaksi `status='completed'` → shift masih `open`, kecuali pemanggil owner-tier (owner/admin boleh membatalkan buku yang sudah ditutup).
- **Matematika void** — `nextTotalAfterVoid()` menurunkan `total_amount` **dan** `amount_paid` sebesar subtotal baris yang dibatalkan (dijepit di 0), bukan menghitung ulang dari sisa baris; inilah satu-satunya operasi yang mempertahankan diskon bon, karena diskon bon tidak disimpan sebagai kolom. `baseQtyForRestock()` mengembalikan `quantity × conversion_factor` tepat ke **`batch_id` baris itu**, jadi FIFO/LIFO/FEFO tenant tidak ikut berubah dan HPP batch tidak tercampur.
- **UI** — `src/components/pos/VoidDialog.tsx` (211 baris) + titik masuk di `POSTransactions.tsx`: aksi "Void" per baris dan per bon pada daftar & dialog detail, alasan wajib, pratinjau nominal sesudah–sebelum, badge `DIBATALKAN`, dan tombol yang hanya dirender bila `can('void_transaction')`. Kunci izin ini menyetujui sebuah **aksi di layar**, bukan menu — jadi ia tidak muncul di daftar menu ModeSelect.
- **Nota ikut terbaca** — `print/document.ts` menerima penanda baris dicoret, `print/escpos.ts` mengirim `ESC G 1`, `print/html-render.ts` memakai `line-through`, dan `print/receipt-doc.ts` + `print/receipt-printer.ts` menghitung subtotal/diskon dari **baris aktif saja** serta menempel banner `TRANSAKSI DIBATALKAN` untuk bon yang dibatalkan. Cetak ulang dari riwayat memakai aturan yang sama (`print/zreport-doc.ts` menyesuaikan rincian shift).

### Fixed

- **Agregasi pendapatan kini menyaring `status = 'completed'`** — sebelum perubahan ini, omzet, margin, dan laporan kas masih menghitung bon yang dibatalkan; jalur yang tersentuh: `src/pages/Dashboard.tsx`, `branches/Dashboard.tsx`, `Branches.tsx`, `Reports.tsx`, `SalesReport.tsx`, `POSShifts.tsx`, `finance/ApAr.tsx`, `finance/Cashflow.tsx`, `src/components/dashboard/{BranchPerformance,SalesChart,SalesDetailModal,RecentTransactions,ProductSalesModal,TransactionDetailModal}.tsx`, plus `src/types/index.ts` dan label aksi di `src/lib/audit.ts`. Agregasi yang menjumlah per baris juga menyaring `transaction_items.voided = 0` — dua filter itu wajib berpasangan, dan hanya bisa dijaga oleh test/review (lihat `docs/kendala-solusi.md` KS-44).

### Testing

- Unit baru `src/lib/__tests__/void.test.ts` (496 baris): empat kondisi guard + pesan teksnya, invarian "diskon bon awet", clamp 0, restock ke batch asal per satuan `conversion_factor`, dan bentuk audit. `schema.test.ts` menjaga versi 9 + kolom void; test print diperbarui untuk corettan.
- Gerbang: `tsc` app + node 0 error, **vitest 28 berkas / 365 tes** lulus. Verifikasi browser (bukan sekadar render): void 1 baris `Rp 50.000` pada bon berdiskon menampilkan baris dicoret dengan total tetap `Rp 154.500`; void per bon memasang banner dan mengeluarkan bon dari omzet; cashier pada shift tertutup ditolak; jumlah baris riwayat tidak berubah (308 baris tetap).

### Docs — audit menyeluruh seluruh dokumentasi

Setiap angka di dokumen **diukur**, bukan diingat: tenant demo di-seed ulang ke database buang-sementara lalu di-query (`libSQL`), dan matriks peran dirender dari `DEFAULT_ROLE_PERMISSIONS` + kunci guard rute di `src/App.tsx`. Tiga belas berkas dokumen disentuh (12 diubah, 1 baru), semuanya di luar `src/`: `README.md`, `CHANGELOG.md`, `requirement.md`, `docs/{arsitektur,backend,frontend,deployment,fitur-tenant,fitur-platform,kendala-solusi,ringkasan-fitur-2026-11-05-06,spec-purchase-order,spec-varian-harga-vendor}.md`.

- **Disinkronkan ke kode** — skema v9 / 34 tabel di mana pun versi disebut; modul `src/lib/void.ts` dan `src/lib/print/*` masuk `arsitektur.md`/`backend.md`/`frontend.md`; angka dataset demo mengikuti hasil ukur (9 pengguna / 6 peran, 28 produk / 55 satuan jual / 32 varian, 189 batch, 304 transaksi + 60 penjualan lama tanpa shift, 63 shift pada 21 hari, 7 PO mencakup seluruh siklus + 3 penerimaan barang); klaim lama "cetak hanya bisa lewat dialog browser" dihapus karena salah (`frontend.md`).
- **Diperbaiki karena salah (KS-47)** — tabel peran×menu `fitur-tenant.md` §3 kehilangan peran `purchasing` dan menandai `warehouse`/`staff` dengan salah; `frontend.md` §13 + `backend.md` §5.11 menyebut snapshot `role_permissions` di `db/schema/seed.sql` "matriks penuh" padahal parsial (18/10/4/2/0 dari 31 kunci); `requirement.md` menjanjikan `staff` akses baca back office padahal `staff: {}`. Kunci `stock_opname` terbukti tanpa konsumen → ditulis sebagai aturan baru "Deklarasi ≠ penegakan".
- **Diperbaiki karena menyesatkan (KS-48)** — `spec-purchase-order.md` dan `spec-varian-harga-vendor.md` masih berstatus *Proposed, no code written yet* padahal terpasang lewat migrasi `005`/`006`; keduanya kini berheader **Shipped** + catatan status bertanggal yang membekukan §0–§15 sebagai rekaman titik waktu. Satu anchor mati (§15.1) diperbaiki, dan `README.md` §Documentation kini mengindeks kedua spec, ringkasan sprint, dan CHANGELOG.
- Rentang rujukan KS di `README.md` dan `deployment.md` dinaikkan ke **KS-48**; seluruh header dokumen diberi tanggal 2026-11-16; hasil render matriks: owner-tier 31/31, `store_manager` 16, `warehouse` 8, `purchasing` 6, `cashier` 1, `staff` 0.

## [1340350] — 6 November 2026 — Sistem Cetak Struk & Z-Report

### Added — Sistem Cetak Struk & Z-Report Thermal

- **Document model + dua renderer + tiga transport** di `src/lib/print/*` (modul baru, tanpa dependency baru):
  - `document.ts` — `PrintDoc` murni berbasis karakter: satu baris berupa teks (`text`) atau pasangan rata-kiri/rata-kanan (`cols`). Lebar kertas menentukan jumlah kolom: **58mm & 60mm = 32 kolom, 72mm = 42, 76mm = 44, 80mm = 48** (prioritas/default). Nilai tersimpan tak-valid di-`normalizePaperWidth` ke 80mm agar layout tidak rusak.
  - `html-render.ts` — renderer HTML dengan `window.print()` di iframe tersembunyi (`@page size:{width}mm auto`). Ukuran font **dihitung otomatis** dari jumlah kolom × lebar cetak (Courier 0.6em, faktor aman 0.98, dijepit 4–11pt) sehingga 48 kolom (80mm) dan roll 72/76mm tidak lagi meluber horizontal. Jalur universal untuk printer USB/kabel, jaringan, dan Bluetooth yang sudah di-pair via driver OS.
  - `escpos.ts` — encoder byte ESC/POS in-house: `ESC @` init, `ESC a` alignment, `ESC E` bold, `GS !` ukuran 1/2, `GS V B 0` cut (bila autoCut), `ESC p 0 25 250` kick drawer (bila openDrawer + penjualan tunai). Rupiah ASCII `"Rp"` agar tidak bergantung code page; karakter non-ASCII didegradasi ke `?` supaya stream tidak desync.
  - `print-bridges.ts` + `print-service.ts` — transport mode `driver` (HTML), `usb` (WebUSB, vendor 0x0483/0x1244/0x28E9, class 7), `bluetooth` (Web Bluetooth, service 49572fc4…/FFF1/FFE0), plus fallback unduh file `.prn`. Aturan fallback: mode `usb`/`bluetooth` tetapi perangkat belum tersambung → otomatis pakai `driver`, bukan error.
- **Auto-print struk pelanggan setelah checkout** (`receipt-doc.ts` + `POS.tsx`): setelah transaksi commit, struk 80mm direkonstruksi dari `transactions`/`transaction_items` (item + varian + satuan, kembalian, metode, kasir/cabang/pelanggan, footer "TERIMA KASIH") lalu dicetak bila toggle **Cetak Otomatis** aktif. Fire-and-forget — printer mati tidak memblokir penjualan yang sudah tersimpan.
- **Cetak Z-report langsung saat tutup shift** (`zreport-doc.ts` + `POS.tsx`/`POSShifts.tsx`): nota 80mm terstruktur berisi identitas shift, durasi, penjualan per metode (tunai/kartu/e-wallet/QRIS) + total, kas awal/seharusnya/fisik/selisih, dan catatan shift.
- **Cetak ulang struk & Z-report dari riwayat**: tombol Printer per baris + tombol "Cetak Struk" di dialog detail `POSTransactions.tsx` (rekomposisi struk dari data invoice via `receipt-printer.ts`, query by id agar label varian dan nama member sama dengan struk awal); reprint Z-report per shift tertutup di `POSShifts.tsx` (desktop dan kartu mobile).
- **Seksi "Printer & Koneksi"** di Pengaturan → Struk (`ReceiptSettings.tsx`): pilih mode driver/USB/Bluetooth, picker "Lebar Kertas" (58/60/72/76/80mm dibaca dari `PAPER_WIDTHS`), tombol Sambungkan Printer (gesture `requestDevice`) + status terhubung, dan Cetak Tes. Preferensi disimpan di `tenants.settings.printer` — **tanpa perubahan skema DB**.

### Fixed

- **Rekonsiliasi penjualan per metode pada Z-report**: POS menyimpan pembayaran kartu sebagai `payment_method='debit'/'credit'` dan e-wallet (termasuk QRIS via e-wallet) sebagai `'ewallet'`, tetapi SQL Z-report sebelumnya hanya menghitung `'card'/'ewallet'/'qris'` sehingga kolom "Kartu" selalu Rp 0 dan penjualan debit/credit hilang. SQL di `receipt-printer.ts` kini mem-bucket `card→{card,debit,credit}` dan `ewallet→{ewallet,e-wallet,ovo,gopay,dana,shopeepay}` plus bucket **Lainnya** (`total − keempatnya`, tampil hanya bila > 0) sehingga rincian **selalu** sama dengan TOTAL PENJUALAN.
- **Overflow horizontal renderer HTML** untuk roll 72/76/80mm (font terpaku 9pt) — diatasi dengan perhitungan font-size dinamis (lihat Added); terverifikasi di browser: 58/76/80mm nihil overflow.
- **Kolom "Customer" di ekspor Excel & daftar riwayat transaksi** kini menampilkan nama pelanggan (`customer_name` di-join via `LEFT JOIN customers`), bukan lagi mentah `customer_id`; fallback "Walk-in"/"Walk-in Customer" dipertahankan (`POSTransactions.tsx`, `src/types/index.ts`).

### Testing

- Unit vitest pure-node untuk jalur cetak: `escpos.test.ts` (init, Rp ASCII, cut/drawer kondisional, degradasi non-ASCII), `receipt-doc.test.ts`, `zreport-doc.test.ts` (baris `cols` rata-kanan muat dalam lebar, selisih nol & tidak nol), `html-render.test.ts` (+7 kasus font scaling), +1 unit tes rekonsiliasi Others-bucket — 18 tes lulus.
- E2E baru `tests/pos-printing.e2e.ts` untuk alur cetak.
- Gates: `tsc` app+node bersih, `eslint` bersih.

## [2026-11-06] — 6 November 2026

### `1f820ac` fix(e2e): refresh locator usang untuk role settings, opsi Radix, dual-render responsif

- **owner.e2e**: alur dialog diganti tap inline role-card (mengikuti redesign `EmployeeRoleSettings`); `getByText` di-scope ke `getByRole('table')` menghindari duplikasi render mobile/desktop.
- **admin.e2e**: opsi Radix Select dicocokkan dengan regex prefix (accessible name kini menyertakan deskripsi); assert "Lihat Dashboard" tersembunyi (`view_dashboard` dicabut dari default cashier).
- **docs**: KS-40 (pitfall dual-render) di `kendala-solusi.md`, aturan frontend #11 diperluas dengan pola scoping, jumlah tes 58→59, kredensial manager yang hilang ditambahkan.

### `1769684` feat(pos): absensi berbasis shift, satu sumber cabang, kasir hanya-transaksi

Rilis gabungan hardening POS/shift + perubahan in-flight sesi sebelumnya (vendor/CRM, bulk import, pricing/units, purchase order). Gerbang: tsc app+node 0 error, eslint 0 error, vitest 23 berkas/316 tes, e2e kasir 6/6, e2e rbac 21/21. ±3.155 baris ditambah, 42 berkas.

- **Satu sumber cabang POS** (`src/hooks/use-pos-branch.ts`, 182 baris + 7 unit tes): till, layar shift, dan header selalu cabang yang sama — prioritas `session.branchId → assigned_branch_id → cabang in-scope pertama`; pemilih cabang bersama; pesan buntu "Sesi tidak lengkap" hilang.
- **Absensi otomatis dari shift** (`src/lib/shift-attendance.ts` + 7 unit tes replay SQL ke DB v8): buka shift = check-in hari berjalan WIB (`source='self'`, notes tetap, tanpa duplikat), tutup shift = check-out hanya baris yang masih `NULL`; best-effort — kegagalan absensi hanya `toast.warning`, tidak membatalkan shift. Drawer kosong (petty cash 0) tetap bisa membuka shift.
- **Kasir dibatasi ke transaksi**: `view_dashboard` dicabut dari default **di kode dan di snapshot seed** (`db/schema/seed.sql`); guard `/pos/transactions` menerima `access_pos`; `seed.test.ts` menjaga kode dan seed tidak saling membantah.
- **Notifikasi & state error**: toast "berhasil" hanya setelah tulis DB, banner "Gagal memuat data" + tombol Coba lagi, banner blocking sebelum shift dibuka, pesan stok menyebut nama produk.
- **Responsif POS**: grid produk 2/3/4/5 kolom, bar keranjang lengket + sheet di `<lg`, kartu di `<md`, header `POSLayout` tidak lagi melebar melewati viewport, tabel transaksi scroll sendiri, kartu statistik tidak terpotong di ponsel.
- **use-permissions**: query grants yang masih disable (sebelum bootstrap menjawab) tidak lagi dibaca "role tidak dikenali" — tampil "Memuat hak akses…" sehingga ModeSelect tidak menyinggung karyawan saat hard reload, dan `RoleBasedRoute` tidak memantul untuk layar yang boleh dibuka.
- **Dibawa serta dari sesi sebelumnya**: bulk IO CSV/Excel terpusat (`src/lib/bulk-io.ts` + 130 baris tes, `ProductImportExport.tsx` rewrite), pricing & units murni (`pricing.ts`, `units.ts` + tes), PO modal dengan referensi vendor (`PurchaseOrderModal.tsx`), Vendors/VendorDetail dan CRM Customers diperluas, `docs/spec-varian-harga-vendor.md` baru, e2e `bulk-import.e2e.ts` baru + perluasan `kasir.e2e.ts`/`permissions.e2e.ts`.

### `f7ffb7d` feat(rbac): pengecualian permission per karyawan + tab role responsif

- **Exception restrict-only**: owner boleh **mencabut** permission yang diberikan role dari satu orang (tidak pernah memberi ekstra), disimpan di `tenants.settings.user_permissions` dan ditegakkan di resolver tunggal.
- `permission-matrix.ts`: `effectiveUserPermissions` + `roleGrantedKeys`; cache baru `tenant-user-permissions` di-seed oleh bootstrap (`readTenantAccess`).
- `use-permissions.ts`: merge override ke granted; mengekspos `roleGranted` dan `removedKeys`.
- **UI**: editor pengecualian per orang `IndividualPermissionEditor.tsx` (270 baris, switch restrict-only) di halaman Employees, dengan audit `update_employee_permissions` + invalidasi cache.
- Tab Role di Settings menjadi strip horizontal yang dapat digeser di md/lg; master/detail berdampingan hanya di xl.
- `vercel.json`: CSP Google Fonts + origin API tanggal merah, Permissions-Policy kamera/geolokasi (menyusul dari kerja absensi).
- Tes: `permission-matrix.test.ts` (+44 baris), `permissions.e2e.ts` (+57 baris).

## [2026-11-05] — 5 November 2026

### `a94ace4` feat(rbac): satu katalog/resolver permission, identitas ditegakkan server, custom role + scope

Konsolidasi tiga mesin permission yang saling berbeda menjadi satu rantai; menutup lubang sinkronisasi identitas. ±5.902 baris ditambah, 71 berkas.

- **Satu katalog**: `PERMISSION_CATALOG` di `src/config/roles.ts` jadi sumber tunggal; `PERMISSION_GROUPS/LABELS/HINTS/ALL_KEYS` diturunkan darinya.
- **Satu resolver murni**: `src/lib/permission-matrix.ts` — merge `defaults < role_permissions < custom_roles`; key tak dikenal **fail closed**.
- **Satu hook**: `use-permissions` via TanStack Query (`['tenant-settings']`), di-seed oleh `/api/tenant/bootstrap`; konsumen (branch-orders, procurement, Inventory, BranchTransfers, POS, Reports, Settings) pindah ke `can(...)`.
- **Guard per key permission**: `RoleBasedRoute permission/anyOf`, App `guarded/guardedAny`; nav dari `nav-items.ts` bersama; kartu ModeSelect diturunkan dari `can()`.
- **Identitas satu penulis**: endpoint baru `api/admin/users/[id].ts` (PATCH/DELETE) + `server/roles.ts` + `server/tenant-client.ts`; bootstrap menolak `account_inactive`. Halaman Employees/Branches/BranchDetailModal berhenti menulis proyeksi langsung.
- **Custom role + scope cabang/gudang** di `tenants.settings` JSON (tanpa migrasi); `EmployeeRoleSettings` ditulis ulang (matriks, pencarian, baris 44px, scope chips, create/duplicate/delete dengan penolakan saat masih dipakai, live preview).
- **Role purchasing terpasang penuh** (`access.ts`, roles, assignable, mode-select) + halaman `ProcurementReport.tsx` (463 baris).
- Tes: `permission-matrix.test.ts` (286 baris), roles/branch-orders/procurement diperbarui; blok purchasing di `rbac.e2e`; `permissions.e2e.ts` baru (siklus identitas + custom role). Verifikasi: typecheck bersih, vitest 238 lulus, rbac.e2e 21 lulus, permissions.e2e 6 lulus terhadap tenant cloud.

### `dbe44eb` fix(rbac): 500 bootstrap di Vercel — impor relatif, bukan alias `@/`

- `permission-matrix.ts` mengimpor `../config/roles.js` secara relatif; fungsi Vercel tidak mem-resolve alias `@/` sehingga bootstrap 500 di produksi.
- `permissions.e2e.ts` disesuaikan; catatan KS-39 menyusul di `c37cdc5` (`docs/deployment.md` + `kendala-solusi.md`: aturan platform deploy).

### `a6b1e2c` feat(attendance): check-in mandiri dengan geofence GPS + pengenalan wajah (schema v7–v8)

±3.627 baris ditambah, 38 berkas.

- **Migrasi 007**: trigger DB-only "absen hari berjalan" (today-only, ditegakkan di database) + lookup hari libur (`src/lib/holidays.ts`, API Tanggal Merah dengan fallback bundled).
- **Migrasi 008**: kolom geo + wajah di `attendance/branches/warehouses`, tabel `face_enrollments`; replay 007/008 + baseline `tenant.sql` idempotent.
- **Halaman self-service `/absen`** (`AttendanceCheckIn.tsx`, 674 baris): hard-block geofence GPS, pencocokan wajah client-side (`@vladmandic/face-api`, model di-vendor ke `public/models/`, hanya deskriptor 128-float disimpan — **tanpa foto**), override owner selalu bisa.
- **Halaman enrollment wajah owner** `/backoffice/hr/face` (`FaceEnrollment.tsx`, permisi `manage_attendance`) + pengaturan lat/lng/radius/require_geo/require_face di Branches & Warehouses.
- **Laporan absensi**: kolom audit Sumber/Geo/Wajah; seed demo menghasilkan sampel geo + wajah realistis; waktu punch disimpan sebagai HH:MM.
- Docs tersinkron (backend/frontend/arsitektur/fitur/deployment/requirement); 263 unit tes lulus.

## [2026-11-04] dan sebelumnya

Untuk riwayat hari per hari yang lebih detail (termasuk pra-migrasi Turso), lihat tabel riwayat di
[docs/fitur-tenant.md](docs/fitur-tenant.md) dan pasangan dokumen `docs/*` ber-tanggal.
