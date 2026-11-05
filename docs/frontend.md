# Frontend RetailPro

| | |
|---|---|
| Dokumen | `docs/frontend.md` |
| Terakhir diperbarui | **2026-11-01** |
| Stack | React 18 + Vite 5 + TypeScript, shadcn/ui, Tailwind, React Router 6 |
| Bahasa UI | Indonesia (label, pesan, format Rupiah) |

> Dokumen ini tentang **lapisan tampilan** back office. Alur data lintas lapisan ada di
> [arsitektur.md](arsitektur.md), detail query di [backend.md](backend.md), dan aplikasi toko
> terpisah (`tokoonline/`) diringkas di §11 serta [deployment.md](deployment.md).

---

## 1. Konfigurasi & build

| Item | Nilai |
|---|---|
| Dev server | `npm run dev` → port **8080**, host `::` |
| Proxy API | `/api` → `VITE_API_PROXY_TARGET` (default `http://localhost:3000`, dari `npm run dev:api`) |
| Alias | `@` → `src` |
| Tema | `ThemeProvider` dari `hooks/use-theme`, default **dark**, key `erp-theme` |
| Build | `vite build` → `dist/` (satu bundle ±2 MB, ada peringatan ukuran chunk) |
| Typecheck | `npx tsc --noEmit -p tsconfig.app.json` (terpisah dari build) |
| Lint | `npm run lint` (ESLint 9, config datar) |
| Test | `npm run test` (Vitest; **17 file, 238 test**) |
| Test E2E | `npm run test:e2e` (tester.army; `tests/**/*.e2e.ts`, butuh dev server `:8080` dan kunci model di `.env` — lihat §12) |
| Toko online | `cd tokoonline && npm run dev` → port **8082**, `VITE_CATALOG_API_URL` (bawaan `http://localhost:3000`) |

---

## 2. Struktur folder

```
src/
  App.tsx                  Tabel route + guard per izin
  main.tsx                 Bootstrap React
  contexts/TenantContext.tsx  Bootstrap tenant, RequireTenant
  hooks/                   use-auth, use-mobile, use-theme, use-toast, use-permissions
  config/roles.ts          Katalog izin (satu sumber), peran bawaan, izin default
  types/index.ts           Tipe domain
  lib/
    db/                    query, runTransaction, batchQuery, translate, json
    tenant-session.ts      Penyimpan token di memori
    tenant-settings.ts     Baca/merge settings tenant (+ getStockIssueMethod, replaceTenantSetting)
    permission-matrix.ts   Resolusi peran → izin + scope (murni, tanpa React/SQL)
    warehouse.ts           Gudang cabang: resolveBranchWarehouse, resolveWarehouseBranch
    stock-issue.ts         Kebijakan FIFO/LIFO/FEFO: comparator + sortBatchesForIssue
    stock-movement.ts      Satu-satunya penulis perpindahan stok (transfer, kirim, terima, batal)
    branch-orders.ts       Mesin status pesanan cabang: canPerform, validate*, nextOrderNumber
    procurement.ts         Mesin purchase order: status, nomor, hak setuju
    vendor.ts              Kode vendor, termin, kategori, saldo hutang
    audit.ts               logAudit / logAuditTx
    date-range.ts          Rentang periode laporan + koreksi zona waktu
    formatters.ts          formatRupiah, formatTanggal
    inventory-utils.ts     SKU otomatis, validasi barcode
  components/
    auth/{RoleBasedRoute,PermissionGate}.tsx
    layout/{POSLayout,BackOfficeLayout,Header,Sidebar}.tsx, nav-items.ts
    dashboard/*            Kartu statistik, grafik, modal detail
    inventory/*            AddProduct, StockTransfer, StockOpname, PurchaseOrder, Import/Export
    pos/{PaymentModal,ShiftModal}.tsx
    branches/BranchDetailModal.tsx
    vendors/*              Daftar & detail vendor
    settings/{Receipt,TaxDiscount,Bank,EmployeeRole,Inventory}Settings.tsx
    ui/*                   shadcn/ui (51 komponen, termasuk pagination-bar.tsx, permission-row.tsx)
  pages/                   Satu file per layar (lihat §3)
```

Di luar SPA ini ada aplikasi kedua, `tokoonline/` (TanStack Start, React 19, Tailwind v4), yang
punya `package.json` dan `node_modules` sendiri — lihat §11.

---

## 3. Peta route

Semua route terautentikasi dibungkus dua lapis: `RequireTenant` (database tenant siap atau
belum) dan `RoleBasedRoute` (matriks izin memberi kunci layar itu atau tidak). Urutannya
sengaja: guard izin membaca dokumen `tenants.settings`, jadi ia harus berjalan **di dalam**
`RequireTenant`, dan ia menunggu hasil baca itu alih-alih langsung mengalihkan — tautan
langsung (`/backoffice/hr/employees`) tidak boleh dibuang hanya karena settingnya belum selesai
dimuat.

Guard tidak lagi menyebut nama peran. Setiap route menuntut **satu kunci izin** dari katalog
(`src/config/roles.ts`), dan kunci yang sama dipakai entri sidebar serta kartu `ModeSelect`,
sehingga tidak ada tautan yang berujung pengalihan. Mengubah siapa boleh masuk layar mana
adalah perubahan di Pengaturan → Role, bukan perubahan kode.

| Path | Komponen | Kunci izin |
|---|---|---|
| `/login` | `auth/Login` | publik |
| `/register-tenant` | `auth/RegisterTenant` | publik (butuh sesi) |
| `/mode-select` | `ModeSelect` | semua (kartu dibuat dari `can(...)`) |
| `/pos`, `/pos/shifts` | `POS`, `POSShifts` | `access_pos` |
| `/pos/transactions` | `POSTransactions` | `view_dashboard` **atau** `view_inventory` (`anyOf`) |
| `/backoffice` | `Dashboard` | `view_analytics` |
| `/backoffice/vendors`, `/vendors/:id`, `/crm/suppliers`, `/crm/customers` | `vendors/*`, `crm/Customers` | `view_finance` |
| `/backoffice/branches`, `/branches/dashboard` | `Branches`, `branches/Dashboard` | `manage_branches` |
| `/backoffice/warehouses` | `Warehouses` | `view_inventory` |
| `/backoffice/branches/{orders,transfer}` | `BranchOrders`, `BranchTransfers` | `view_inventory` (tindak lanjut per aksi) |
| `/backoffice/inventory/{products,opname,po}` | `Inventory` | `view_inventory` |
| `/backoffice/inventory/stock-in` | `Inventory` | `add_stock` |
| `/backoffice/finance/{journal,ap-ar,cashflow,expenses}` | `finance/*` | `view_finance` |
| `/backoffice/hr/{employees,schedule}` | `Employees` | `view_employees` |
| `/backoffice/hr/{attendance,payroll}` | `EmployeeReports` | `view_employees` |
| `/backoffice/reports` + `/{sales,inventory,finance,procurement}` | `Reports`, `*Report` | `view_reports`; tombol unduh `export_reports` |
| `/backoffice/settings` | `Settings` | `view_settings`; simpan butuh `edit_settings`, tab Role butuh `manage_roles` |
| `*` | `NotFound` | – |

Cara kunci itu dihitung (`src/lib/permission-matrix.ts`, lihat §13): default bawaan →
override tenant di `settings.role_permissions` → definisi role kustom di `settings.custom_roles`
di atas `clone_of`-nya. Peran yang tidak dikenal matriks (misalnya role kustom yang terlanjur
dihapus) mendapat grant kosong sehingga **semua** guard menolak — gagal-tertutup, dan
`ModeSelect` menampilkan panel "Hubungi owner untuk pengaturan akses" alih-alih layar kosong.

Catatan: empat route inventori memakai satu komponen yang sama (`Inventory`) dan memilih tab dari
path; `attendance`/`payroll` juga berbagi satu halaman, begitu pula `employees`/`schedule`.
Izin `manage_branches` dan `view_finance` baru — keduanya diberi nilai `true` untuk
`store_manager` agar layar yang dulu terbuka untuk manajer tetap terbuka.

---

## 4. Shell & navigasi

| Komponen | Peran |
|---|---|
| `POSLayout` | Layar kasir: katalog + keranjang, tanpa sidebar back office |
| `BackOfficeLayout` | Sidebar + header + area konten |
| `Sidebar` | Menu per seksi (POS, Dashboard, Cabang, Gudang, Inventori, Keuangan, SDM, Laporan, Pengaturan) |
| `Header` | Judul halaman, indikator pengguna, pemilih cabang (hanya untuk peran yang boleh lintas cabang) |
| `ModeSelect` | Pintu masuk setelah login: kartunya dibuat dari `can('access_pos')` / `can('view_dashboard')` / `can('view_inventory')`; bila tidak ada yang bisa dibuka, tampil panel "Hubungi owner" |
| `nav-items.ts` | Daftar menu + kunci izin per item, diimpor `BackOfficeLayout` **dan** pratinjau di layar Role agar preview tidak bisa bohong |
| `pagination-bar.tsx` | Komponen pagination bersama (halaman, ukuran, jumlah) |

---

## 5. Alur identitas di UI

```
Login → authClient (cookie) → useAuth() ambil session (peran = kolom `user.role` di control plane)
      → TenantProvider.bootstrap  → status: idle | loading | ready | no-tenant | error
            ready      → buka libSQL client (token di memori) + simpan grants dari respons
            no-tenant  → arahkan ke /register-tenant
            error      → tampilkan layar gagal + tombol coba lagi
      → RequireTenant: belum ready → spinner, halaman tidak pernah mount tanpa client
      → RoleBasedRoute: matriks tidak memberi kunci (atau peran tidak dikenal) → /login (gagal-tertutup)
```

`useAuth()` memetakan field session Better Auth (`tenantId`, `branchId`, `role`) ke nama field
lama yang dibaca halaman (`tenant_id`, `assigned_branch_id`), sehingga kode halaman lama tetap
jalan tanpa diubah.

**Satu identitas, satu penulis.** Session `useAuth()` dan baris `users` di database tenant
dulu bisa berbeda (halaman Karyawan hanya menulis proyeksi tenant), sehingga mengganti peran
terlihat sukses tetapi tidak berubah. Sekarang `/api/admin/users/[id]` (PATCH/DELETE) yang
menulis control plane lebih dulu lalu mencerminkan ke proyeksi, dan
`api/tenant/bootstrap` menolak memberi token kalau baris proyeksi tidak ada atau
`is_active = 0` (`403 account_inactive`).

**Satu jalur baca izin.** `usePermissions()` (`src/hooks/use-permissions.ts`) membaca
dokumen settings **satu kali** lewat TanStack Query (`queryKey: ['tenant-settings']`,
`staleTime` 60 detik) dan mengembalikan `{ can, granted, scope, loading, role, roleLabel }`.
Cache-nya disemai dari respons bootstrap sehingga paint pertama tidak berkedip `loading`,
dan setiap simpanan di layar Role memanggil `useInvalidateTenantSettings()` sehingga edit
matriks langsung berlaku tanpa reload. Nomor `SELECT settings FROM tenants LIMIT 1` per
komponen yang dulu ada sudah hilang.

---

## 6. Pola data di halaman

| Pola | Penggunaan |
|---|---|
| `useEffect` + `query()` + `useState` | Pola utama semua halaman data (belum dimigrasi ke TanStack Query) |
| `batchQuery()` | Halaman yang butuh beberapa hasil sekaligus (hemat round-trip) |
| `runTransaction()` | Semua penulisan multi-tabel: checkout, produk, transfer, opname, PO, pengeluaran |
| Refetch manual | Setelah mutasi berhasil (`fetchX()` dipanggil ulang) |
| `parseJson*` | Membaca kolom JSON (`settings`, `preferences`, `details`) |

Halaman terbesar (perlu kehati-hatian saat mengubah): `Inventory.tsx` (~1.462 baris),
`EmployeeReports.tsx` (~986), `Branches.tsx` (~896), `Employees.tsx` (~861), `POS.tsx` (~792).

---

## 7. Format & waktu

- **Rupiah**: `formatRupiah()` di `lib/formatters.ts` (`Rp 1.234.567`). Beberapa halaman masih
  punya salinan lokal — kandidat konsolidasi.
- **Periode laporan**: `getPeriodRange(period)` mengembalikan `[start, endExclusive)` ISO **UTC**
  dari tengah malam **lokal** browser. Ini disengaja: `created_at` disimpan UTC, jadi filter
  "Hari Ini" harus memakai batas hari lokal.
- **Bucketing bulan**: `strftime('%Y-%m', created_at, sqliteTzModifier())` supaya penjualan
  malam hari tidak jatuh ke bulan sebelumnya.
- `startOfMonthOffset(n)` untuk perbandingan periode.

---

## 8. Komponen & fitur UI yang khas

| Fitur | Letak | Catatan |
|---|---|---|
| SKU otomatis | `lib/inventory-utils.ts` + `AddProductModal` | Format `PREFIX-YYYYMMDD-SEQ`; prefix 3 huruf dari nama kategori |
| Combobox kategori/supplier | `AddProductModal` | Bisa menambah entri baru; disimpan saat submit |
| Barcode | `components/ui/BarcodeGenerator.tsx` | `react-barcode`, unduh PNG |
| Import/Export Excel | `inventory/ProductImportExport.tsx` | `xlsx`; template + validasi baris |
| Pembayaran | `pos/PaymentModal.tsx` | Validasi tunai, hitung kembalian, pilih metode |
| Shift | `pos/ShiftModal.tsx` → `POSShifts` | Buka/tutup kas, ringkasan per metode bayar |
| Detail cabang | `branches/BranchDetailModal.tsx` | Daftar karyawan cabang + edit |
| Gudang & pemetaan | `pages/Warehouses.tsx` | CRUD gudang pusat/regional/toko, penanda gudang default, pemetaan ke cabang |
| Metode pengeluaran stok | `settings/InventorySettings.tsx` | Tab **Inventori**; kartu radio FIFO/LIFO/FEFO, simpan saat diklik |
| Pesanan cabang | `pages/BranchOrders.tsx` + `lib/branch-orders.ts` | Form banyak baris dengan stok gudang & stok minimum, linimasa status, aksi Setujui/Siapkan & Kirim/Terima/Tolak/Batalkan |
| Perpindahan stok | `lib/stock-movement.ts` | Satu modul untuk transfer & pengiriman; halaman inventori, transfer, dan pesanan cabang memanggilnya di dalam `runTransaction` |
| Pemotongan stok | `lib/stock-issue.ts` | Kelima jalur stok keluar: `getStockIssueMethod()` → `sortBatchesForIssue()` |
| Pengaturan | `settings/*` | Tulis ke `tenants.settings` lewat `mergeTenantSettings()` dengan indikator simpan; tidak ada tombol simpan global |
| Varian & pecahan | `inventory/AddProductModal.tsx`, `POS.tsx`, `inventory/StockTransferModal.tsx`, `inventory/StockOpnameModal.tsx` | Produk = model, varian = SKU. Pemilih dua langkah (**varian lalu pecahan**) di kasir dan transfer, tetapi hanya untuk produk yang benar-benar punya >1 SKU; varian `Default` hasil migrasi dipilih otomatis sehingga kasir tidak ditanya "Default" untuk setiap produk. Label varian dirakit `lib/variants.ts` (`parseVariantAttributes` + `parseVariantGroups` → `variantLabel`). Stok yang ditekan selalu stok varian yang sedang dipilih |
| Harga beli per pecahan | `lib/pricing.ts`, `AddProductModal`, `inventory/PurchaseOrderModal.tsx`, `vendors/VendorDetail.tsx` | Tabel varian × pecahan dengan harga beli **dan** harga jual; `resolveBuyPrice` mengambil pricelist vendor dulu; `packEconomics`/`priceIssues` memberi margin dan peringatan (hanya `cost_above_price` yang memblokir simpan) |
| Audit | `lib/audit.ts` | `logAudit` (best effort) dan `logAuditTx` (ikut rollback) |
| Notifikasi | `ui/toast`, `ui/sonner` | Dua jalur toast; pesan sukses/gagal berbahasa Indonesia |
| Matriks izin | `settings/EmployeeRoleSettings.tsx` | Master/detail: daftar role di kiri, editor izin di kanan (di layar kecil jadi `Sheet` dari bawah). Kolom pencarian "Cari izin…", "Pilih semua / Kosongkan" per grup, tiap baris `min-h-11` dengan label + hint + Switch, bilah Simpan lengket dengan penanda "Belum disimpan", dan Pratinjau yang dirender dari `nav-items.ts` |
| Role kustom | `settings/EmployeeRoleSettings.tsx` | Buat / duplikat / hapus (`cust_*`, disimpan di `settings.custom_roles`). Menghapus ditolak selama masih dipakai karyawan, dengan daftar namanya; id tidak pernah diganti, hanya label |
| Scope lokasi | `settings/EmployeeRoleSettings.tsx` + `useBranchScope` / `useWarehouseScope` | "Terapkan di" Cabang/Gudang berupa chip; layar yang kena scope menampilkan kalimat penjelas ("Anda hanya melihat cabang: …") dan baris di luar scope **tidak ditampilkan**, bukan sekadar-disabled |
| Tombol berizin | `auth/PermissionGate.tsx` | Pembungkus standar aksi yang butuh izin: tersembunyi saat `loading`, tersembunyi/`fallback` saat ditolak, supaya aturan "jangan tampilkan tombol yang pasti gagal" tidak ditulis ulang per halaman |
| Baris izin | `ui/permission-row.tsx` | Label + hint + Switch setinggi 44 px — dipakai matriks dan layar pengaturan berikutnya |
| Sasaran sentuh | `ui/button.tsx` | `size="touch"` / `"iconTouch"` (tinggi 44 px); sidebar, kartu karyawan, dan editor role memakainya sehingga konsistensi tidak per-halaman |

Konvensi destruktif: gunakan `AlertDialog`, bukan `window.confirm()`.

---

## 9. Batasan frontend saat ini

1. **Belum ada renderer struk** — pengaturan struk tersimpan, cetak belum ada.
2. **Belum ada scanner barcode** — barcode bisa dibuat, input scanner belum ditangani.
3. **Pemilihan pelanggan di POS belum ada** — `customer_id` sudah disiapkan di skema.
4. **Belum ada error boundary** — kegagalan render memutihkan halaman.
5. **Belum ada layar audit log** — data ada, penjelajahnya belum.
6. **Data bisnis belum lewat TanStack Query** — tidak ada cache/invalidasi otomatis.
7. Bundle tunggal ±2 MB; pemecahan per route belum dilakukan.
8. **Toko online belum punya spec E2E** — `tokoonline/` (marketplace, varian, pengalihan tautan
   lama) hanya diuji di level helper (`tokoonline/src/lib/products.test.ts`, 39 test) dan lewat
   pemeriksaan browser manual; belum ada spec E2E storefront.
9. **Matriks izin masih lapis UI untuk data bisnis** — `server/provision.ts` memberi token
   full-access ke database tenant, jadi seorang yang login masih bisa menulis baris apa pun di
   tenantnya lewat konsol. Yang ditegakkan di server adalah **identitas** (bootstrap + endpoint
   admin); pintuan aksi bisnis (`can(...)`) mengatur apa yang ditawarkan aplikasi. Lihat
   §13 dan [arsitektur.md](arsitektur.md).

---

## 10. Log perubahan frontend

| Waktu | Ref | Perubahan |
|---|---|---|
| 2026-11-05 | — (working tree) | Sistem izin ditulis ulang jadi **satu katalog → satu resolver → satu identitas**. `config/roles.ts` menyimpan key+label+hint dalam satu `PERMISSION_CATALOG` (label/hint/grup diturunkan, bukan ditulis tangan lagi); `lib/permission-matrix.ts` yang baru menghitung grant per peran (default < override tenant < role kustom di atas `clone_of`) dan scope-nya; `usePermissions()` pindah ke TanStack Query satu baca per halaman. Semua guard route, entri sidebar, dan kartu `ModeSelect` menuntut kunci izin, bukan daftar peran — grup `ALL_ROLES`/`FRONT_OFFICE`/`BACK_OFFICE`/`MANAGERS`/`STOCK_DOCS`/`PROCUREMENT_ROLES`/`HR_ROLES` dihapus. Kunci yang dulu ada tetapi tidak menjaga apa pun kini ditegakkan (`apply_discount`, `void_transaction` di POS, `export_reports` di 21 tombol ekspor, `view_settings`/`edit_settings`/`manage_roles` di Pengaturan). Lihat §13 |
| 2026-11-05 | — (working tree) | Layar **Pengaturan → Role** ditulis ulang (`EmployeeRoleSettings.tsx`): editor master/detail + `Sheet` di layar kecil, pencarian izin, pilih-semua/kosongkan per grup, baris 44 px dengan hint, bilah Simpan lengket, dan hanya menyimpan **selisih** dari default per peran (sebelumnya snapshot semua peran dibekukan ke dokumen settings). Ditambah role kustom (buat/duplikat/hapus dengan penolakan bila masih dipakai) dan editor scope Cabang/Gudang, serta Pratinjau yang dirender dari `nav-items.ts` yang sama |
| 2026-11-05 | — (working tree) | Scope diterapkan ke layar: `Dashboard` (hanya cabang in-scope, satu cabang in-scope dipaksa, kalimat penjelas, hitungan pesanan menunggu ikut difilter), `BranchPerformance`, `Inventory` (gudang di luar scope hilang dari daftar & pemilih), `BranchOrders` (kunci cabang manajer umum jadi "role ber-scope terkunci ke daftar cabang"), `POS` (cabang pilihan harus in-scope), dan badge sidebar |
| 2026-11-01 | — (working tree) | Banner beranda menjadi **gambar**, bukan kartu teks: `hero-slider.tsx` menerima `{ id, src, alt }` dan merender banner 16:9 dari `public/slider/` (dua banner TokoBahanKue), tiap banner menaut ke `/katalog`. Tiga slide teks yang dulu dihitung dari katalog (`N toko`, `N produk`, `Dikirim dari gudang`) dihapus karena tulisan itu sudah ada di banner dan angka hidupnya sudah tampil di strip penjual serta grid produk. Slide pertama `eager` + `fetchPriority="high"`, sisanya `lazy`. Kedua berkas di-encode ulang ke **WebP 1400×788** (115 KB + 137 KB) dari master PNG 1672×941 (676–700 KB): kartu banner hanya ~400 px lebar, jadi 1400 px sudah cukup untuk layar 3× dan total berat turun dari 1,3 MB ke 253 KB |
| 2026-11-01 | — (working tree) | Penyisiran ulang setelah etalase menjadi marketplace: pesanan yang berisi barang beberapa toko kini dikelompokkan per penjual (`sellerGroups()` di `lib/store.ts`) di summary checkout dan halaman pesanan, dengan subtotal per toko bila tokonya lebih dari satu. Kalimat yang masih mengandaikan satu toko diperbaiki: ambil sendiri lewat `SHOP.pickupNote` (bukan alamat satu toko), `deliveryArea` menjadi `Jabodetabek`, halaman info menyebut ongkir per pesanan & pengiriman dari gudang masing-masing toko, dan jawaban CS tidak lagi mengklaim "Gudang Pusat Depok" untuk semua barang. Tautan `/product/<slug>` lama dialihkan ke URL berpenjual (KS-34). Baris bertanggal sama yang menyebut "merek etalase pindah ke RetailPro" sudah digantikan: nama akhirnya **Toko Bahan Kue** dengan sub-baris **Marketplace** |
| 2026-11-01 | — (working tree) | Tema toko online memakai aksen **rose**: `styles.css` mengganti token `--thalia-*` (primary `#9d3455`, accent `#b04a68` di terang; `#eaa4ba` di gelap) dan netralnya diberi rona pink tipis. Harga produk di kartu dan halaman produk ikut memakai `text-primary`, `theme-color` dan `public/favicon.svg` disesuaikan |
| 2026-11-01 | — (working tree) | Nama etalase menjadi **Toko Bahan Kue** dengan **Marketplace** sebagai sub-baris: wordmark header `TOKO BAHAN KUE / MARKETPLACE`, monogram `T`, judul tab, deskripsi meta, halaman info, tagline `SHOP`, pemilik rekening, dan teks CS/WhatsApp. Kata "RetailPro" tidak lagi muncul di permukaan etalase |
| 2026-11-01 | — (working tree) | Toko online menjadi **marketplace lintas tenant**: beranda disusun ulang mengikuti pola marketplace — pencarian, slider `hero-slider.tsx`, grid ikon kategori satu warna, strip penjual, lalu grid "Untuk kamu". Data dari `GET /api/storefront/marketplace`; route produk menjadi `/product/$tenant/$slug` dan keranjang menyimpan `tenant`/`seller` (`persist` versi 3) |
| 2026-11-01 | — (working tree) | Merek etalase pindah ke **RetailPro**; Thalia dan tenant lain tampil sebagai **penjual** di dalamnya (strip penjual + baris penjual di halaman produk & keranjang) |
| 2026-10-31 | — (working tree) | Toko online merender varian: `lib/products.ts` memakai abstraksi **Shelf** (satu SKU = satu rak), halaman produk menampilkan pemilih rasa, keranjang menyimpan `variantId`/`variantLabel` dengan `lineKey` produk+varian+pecahan, dan `api/storefront/catalog.ts` merangkum `units` lama jadi satu harga terendah per (nama, faktor) |
| 2026-10-31 | — (working tree) | E2E mengikuti varian: `kasir.e2e.ts` memilih rasa lalu pecahan dan memastikan harga diambil dari rasa itu, `owner.e2e.ts` membuka tab **Harga Beli** dan **Riwayat Harga** di detail vendor. Keduanya telah **dijalankan** pada tenant demo `rp-thalia` dan lulus |
| 2026-10-31 | — (working tree) | Dialog pilih satuan ditutup tanpa mengosongkan varian terpilih: animasi keluar Radix masih me-mount isi dialog, jadi mengosongkan varian di detik yang sama membuat dialog sempat berkedip kembali ke daftar rasa (dan `getByText('Cokelat')` jadi ambigu di E2E). Seleksi dibersihkan di `onOpenChange` saat kasir sendiri yang menutup |
| 2026-10-31 | — (working tree) | Kasir memilih **varian lalu pecahan**; keranjang berkunci `produk + varian + pecahan`, dan pra-cek stok sebelum bayar menghitung per varian |
| 2026-10-31 | — (working tree) | Transfer stok dan stok opname per varian: pemilih varian di modal transfer, satu baris hitung per varian di opname |
| 2026-10-31 | — (working tree) | Editor produk menampilkan grup atribut + matriks varian × pecahan dengan harga beli/jual per pecahan; tab **Harga Beli** dan **Riwayat Harga** di detail vendor |
| 2026-10-31 | — (working tree) | Harness uji end-to-end `e2e` (tester.army) + `e2e.config.ts` dan smoke test layar login `tests/login.e2e.ts` — lihat §12 |
| 2026-10-28 | — (working tree) | Halaman `/backoffice/branches/orders` (pesanan cabang): kartu statistik, tab status, filter cabang terkunci untuk manajer toko, form pesanan, modal detail dengan linimasa & aksi per peran |
| 2026-10-28 | — (working tree) | `lib/stock-movement.ts` + `lib/branch-orders.ts` menggantikan logika yang sebelumnya disalin di dalam halaman (`Inventory.tsx`, `BranchTransfers.tsx`) |
| 2026-10-28 | — (working tree) | Route dokumen stok memakai grup `STOCK_DOCS` (`MANAGERS` + `warehouse`); sidebar punya `allowedRoles` per item dan badge jumlah pesanan menunggu |
| 2026-10-28 | — (working tree) | Kabar cabang di `ModeSelect`: kartu Back Office untuk peran `warehouse` diarahkan ke Pesanan Cabang, bukan dashboard |
| 2026-10-28 | — (working tree) | Aplikasi kedua `tokoonline/` (TanStack Start) memakai katalog dari API back office — lihat §11 |
| 2026-10-27 | — (working tree) | `TenantContext` + `tenant-session` (token di memori), `RequireTenant` di setiap route, `RoleBasedRoute` gagal-tertutup |
| 2026-10-27 | — (working tree) | Semua halaman pindah ke `@/lib/db` (`query`/`runTransaction`/`batchQuery`), SQL Postgres → SQLite |
| 2026-10-27 | — (working tree) | `lib/date-range.ts` + `sqliteTzModifier()` untuk filter periode dan bucketing bulan |
| 2026-10-27 | — (working tree) | `pagination-bar.tsx` dipakai di daftar transaksi, karyawan, produk, pengeluaran |
| 2026-10-27 | — (working tree) | Panel pengaturan struk/pajak/bank/role menulis ke `tenants.settings` dan menampilkan status simpan |
| 2026-10-27 | — (working tree) | Dashboard: filter periode + filter cabang; kartu statistik dan modal detail memuat data nyata |
| 2026-10-27 | — (working tree) | `Inventory.tsx`: penerimaan PO membukukan hutang ke `expenses`; hapus produk dalam satu transaksi |
| 2026-10-27 | — (working tree) | Halaman **Gudang** (`/backoffice/warehouses`) + menu sidebar + `lib/warehouse.ts` (pemetaan gudang ↔ cabang) |
| 2026-10-27 | — (working tree) | POS, inventori, transfer, dan PO memakai `warehouse_id`; teks stok per "gudang", bukan per "cabang" |
| 2026-10-27 | — (working tree) | Tab **Inventori** di Pengaturan (`InventorySettings`) memilih FIFO/LIFO/FEFO; `lib/stock-issue.ts` mengurutkan batch untuk semua jalur stok keluar |
| 2026-10-27 | — (working tree) | Tombol "Simpan Pengaturan" tanpa handler dihapus, diganti catatan bahwa panel tersambung database menyimpan otomatis |
| 2026-02-11 21:28 | `827940b` | Perbaikan pointer event POS dan perhitungan stok |
| 2026-02-10 00:37 | `7e1950f` | Halaman shift kasir |
| 2026-02-01 17:16 | `b02aa92` | Halaman laporan baru + export Excel |
| 2026-01-29 23:56 | `840dbd9` | Barcode, SKU otomatis, halaman CRM |
| 2026-01-26 04:42 | `d2b8c65` | UI multi-satuan produk + audit |
| 2026-01-20 02:21 | `c87e434` | Pemisahan layout POS dan back office |

---

## 11. Toko online (`tokoonline/`) — lapisan tampilan kedua

Bukan bagian dari SPA ini: aplikasi terpisah (TanStack Start → React 19, Tailwind v4, zustand +
`localStorage`), punya `package.json`, `node_modules`, dan port sendiri (**8082**).

Etalase ini adalah **marketplace lintas tenant**: satu aplikasi menampilkan produk dari semua
tenant RetailPro yang berstatus `active`, dan setiap produk membawa penjualnya sendiri.

| Aspek | Nilai |
|---|---|
| Route file | `/`, `/katalog`, `/product/$tenant/$slug` (+ `/product/$slug` pengalih tautan lama), `/cart`, `/checkout`, `/orders`, `/order/$id`, `/chat`, `/info` |
| Sumber data | `src/lib/catalog.ts` (`useMarketplace`, `useProduct`) → `GET /api/storefront/marketplace` — agregasi semua tenant aktif |
| Layout beranda | Kolom pencarian → `hero-slider.tsx` (scroll-snap, digeser dengan swiping di ponsel, autoplay 5,2 detik, berhenti saat disentuh) → `category-grid.tsx` (ikon Lucide **satu warna**) → strip penjual → grid "Untuk kamu" |
| Banner beranda | `hero-slider.tsx` merender **gambar**, bukan kartu teks: dua banner 16:9 di `public/slider/` (`banner-marketplace.webp` 115 KB, `banner-bahan-kue.webp` 137 KB), tiap slide adalah `Link` ke `/katalog`, `alt` menyalin tulisan yang sudah ada di gambar. Slide pertama `loading="eager"` + `fetchPriority="high"`, sisanya `lazy`. Tiket otomatis dan dots tetap sama; tidak ada lapisan teks di atas gambar supaya tidak menimpa tulisan yang sudah dipanggang di banner. **WebP 1400×788**, bukan PNG: master 1672×941 (676–700 KB) di-encode ulang karena kartu banner hanya ~400 px lebar dan 1400 px sudah cukup untuk layar 3× |
| Ikon kategori | `src/lib/category-icons.ts` — kata kunci nama kategori → ikon Lucide, jatuh ke `Tag`; kategori baru dari back office langsung tampil tanpa ubah kode |
| Url state | `/katalog?q=&kategori=&toko=` (`validateSearch`), jadi chip kategori, filter penjual, dan pencarian bisa dibagikan sebagai tautan |
| Tautan lama | `routes/product.$slug.tsx` mencari slug di seluruh marketplace lalu `navigate(replace)` ke `/product/<tenant>/<slug>`; slug yang sudah hilang mendarat di `/katalog?q=<slug>` (KS-34) |
| Varian | `src/lib/products.ts` — `shelves(product)` mengubah `variants[]` jadi daftar rak `{ id, label, stock, units }`; produk satu SKU tetap satu rak, jadi halaman produk tidak bercabang |
| Keranjang | `src/lib/store.ts` — `CartItem.tenant`/`seller` + `variantId`/`variantLabel`, kunci baris `tenant + slug + variantId + unitName`, `persist` versi 3 + `migrate` untuk keranjang lama |
| Pesanan lintas toko | Satu keranjang, satu ongkir, satu pembayaran (platform sebagai merchant of record), tetapi `sellerGroups()` membagi baris per penjual: summary checkout dan halaman pesanan menampilkan "Dikirim oleh <toko>" + subtotal per toko (hanya bila lebih dari satu). Ambil sendiri tidak menunjuk satu alamat — `SHOP.pickupNote` menyuruh konfirmasi lewat chat |
| Base URL API | `VITE_CATALOG_API_URL` (bawaan `http://localhost:3000`) — **dipanggang saat build** |
| Penyimpanan | Keranjang & pesanan di `localStorage` (kunci `thalia-storefront`); tidak menulis ke DB tenant |
| Branding | **Toko Bahan Kue** dengan sub-baris **Marketplace** (wordmark `TOKO BAHAN KUE / MARKETPLACE`, monogram `T`, judul tab `Toko Bahan Kue`); tiap penjual tampil sebagai kartu/strip di dalam etalase, kode pesanan tetap `THL-…` |
| Warna | Aksen **rose**: `--thalia-primary` `#9d3455` (isi tombol, chip aktif, gelembung chat, badge keranjang) dan `--thalia-accent` `#b04a68` (teks penekanan, titik notifikasi). Netral tetap hangat dengan sedikit rona pink (`bg #f6ecea`, `surface #fff9f8`, `fg #2b2124`); mode gelap membalik arahnya (`primary` `#eaa4ba` di atas `bg #0b0809`) supaya kontrasnya tetap sama |
| Build | Nitro preset Vercel → `.vercel/output`; `db:migrate` melewati migrasi tanpa `DATABASE_URL` |
| Hosting | Proyek Vercel terpisah `thalia-storefront` — lihat [deployment.md](deployment.md) §6 |

Dua jebakan yang sudah dialami: (a) sub-aplikasi ikut memakai `postcss.config.js` milik root
sehingga Tailwind v4-nya dijalankan sebagai v3 — `vite.config.ts` toko memaku
`css.postcss.plugins = []`; (b) port 8080 sudah dipakai back office, jadi dev server toko memakai
8082.

---

## 12. Uji end-to-end (tester.army / `e2e`)

Lapisan verifikasi ketiga setelah Vitest (logika) dan typecheck. `e2e` menjalankan SPA di Chromium
sungguhan; langkah yang butuh ketepatan selector ditulis deterministik, langkah yang butuh penilaian
("apakah layar ini benar?") diserahkan ke model.

| Aspek | Nilai |
|---|---|
| Berkas uji | `tests/**/*.e2e.ts` — 8 berkas, 49 test (44 `test` + 5 `test.setup`): `login`, `auth.setup`, `owner`, `admin`, `kasir`, `gudang`, `rbac`, `permissions` |
| Konfigurasi | `e2e.config.ts` |
| Akun uji | Blok `credentials` di `e2e.config.ts` (`owner`, `admin`, `kasir`, `gudang`, `purchasing`), diselesaikan lewat `signIn()` di `tests/support/accounts.ts`; dibuat oleh `npm run e2e:users` |
| Target | `APP_URL`, default `http://localhost:8080` (`npm run dev`) |
| Model agent | Provider OpenAI-compatible dari `E2E_AI_BASE_URL` / `E2E_AI_API_KEY` / `E2E_AI_MODEL`; bawaan SumoPod + `deepseek-v4.1-flash:netra` |
| Perintah | `npm run test:e2e`, atau `npx e2e run --grep login` untuk sebagian |
| Artefak | `.e2e/report.json` + `.e2e/artifacts/*/screen.txt` (daftar teks node yang dirender) |
| Timeout | assertion 60 detik, action 180 detik, test 300 detik; `workers: 1`, `retries: 1` |

Aturan yang dipakai di repo ini:

1. **Deterministik dulu, agent untuk penilaian.** Navigasi, isian, dan nilai yang sudah diketahui
   memakai locator (`getByRole`, `getByPlaceholder`, `getByLabel`); satu `agent.assert` per alur
   untuk menilai hasil, dan `agent.act` hanya bila langkahnya tidak bisa diungkap dengan selector.
2. **`getByText` mencocokkan seluruh teks node**, bukan substring. Label hasil interpolasi
   (`"Pesanan (4)"`) tidak cocok dengan `getByText('Pesanan')` — pakai regex.
3. **Jangan menekan Enter untuk submit di form web.** Form HTML + React Router bisa berubah menjadi
   GET dan memuat ulang halaman, sehingga state SPA hilang; pakai `.fill()` lalu `.tap()` tombol submit.
4. **Satu tenant demo dipakai bersama** → `workers: 1`; data uji diberi nama unik dan dibersihkan di
   `afterEach` bila menulis ke DB.
5. **Kunci model tidak pernah masuk bundle.** Hanya di `.env` lokal (`.env.example` kosong); nilai
   produksi tidak membutuhkannya karena e2e berjalan di mesin operator.
6. **Timeout dinaikkan, bukan diakali dengan sleep.** Vite mengompilasi route saat pertama dibuka
   (puluhan detik); tunggu keadaan layar, jangan menambah delay tetap.
7. **Kata sandi hanya di `credentials`, tidak pernah di kode tes.** Nilainya `Secret` opaque yang
   hanya diterima `locator.fill` dan `agent.act`, jadi tidak muncul di log, tangkapan layar, maupun
   prompt model; `E2E_USER_<NAME>_PASSWORD` menimpa tanpa menyunting berkas.
8. **Sesi disimpan sekali, dipulihkan per tes.** `tests/auth.setup.e2e.ts` login sekali per peran lalu
   `session.save()`; tes lain memakainya lewat `{ session }`. Tes yang menguji tombol Keluar harus
   login sendiri di dalam tubuh tes, karena `signOut()` mencabut sesi itu di server dan tes lain yang
   memulihkannya akan menjadi anonim.
9. **Penegakan identitas diuji lewat endpoint, bukan UI.** `tests/permissions.e2e.ts` (sesi owner)
   memakai `browser.evaluate(fetch)` untuk `POST`/`PATCH`/`DELETE /api/admin/users/[id]` lalu membaca
   control DB dan proyeksi tenant secara langsung (helper jajak `pollDb` menelan konsistensi-akhir
   Turso lintas koneksi): PATCH satu penulis menyeragamkan kedua store, `active:false` menyet
   `banned=1`, DELETE menghapus identitas sehingga sign-in ditolak, dan peran tak dikenal/self-removal
   ditolak 400. Peran `purchasing` kini punya sesi sendiri di `rbac.e2e.ts` (kartu Back Office, akses
   `/backoffice/inventory/po`, ditolak dari dashboard).
10. **Siklus role custom diuji tanpa login sebagai karyawan baru.** Harness ini hanya menyimpan sesi
    untuk peran yang sudah ada di roster, jadi tes `permissions.e2e.ts` membuktikan bagian yang bisa
    dibuktikan secara deterministik — buat role → muncul di daftar → bisa ditugaskan lewat PATCH →
    penolakan hapus saat masih dipakai ("dipakai 1 karyawan") → tenant dibersihkan. Langkah "login
    sebagai karyawan role custom lalu lihat kartu POS" sengaja tidak ditranskripsi sebagai tes UI
    karena tidak didukung model sesi; perilaku itu dijamin oleh `rbac` peran builtin + unit test
    resolver (`permission-matrix.test.ts`), bukan diabaikan.

Menjalankan:

```sh
npm run dev        # terminal 1 — SPA :8080
npm run dev:api    # terminal 2 — API :3000 (perlu untuk alur login)
npm run test:e2e
```

Batasannya: model yang dipilih mendukung tool call tetapi **tidak** mendukung `responseFormat`,
sehingga `agent.extract` tidak bisa dipakai (KS-32 di [kendala-solusi.md](kendala-solusi.md)).

---

## 13. Izin: katalog, resolver, dan pemakaian

Tiga lapis, dan hanya tiga tempat yang boleh menjawab "boleh tidak orang ini":

| Lapis | Berkas | Isi |
|---|---|---|
| Deklarasi | `src/config/roles.ts` | `PERMISSION_CATALOG` (key + label + hint per grup), `ROLES`, `BUILTIN_ASSIGNABLE_ROLES`, `DEFAULT_ROLE_PERMISSIONS`, `resolveRolePermissions()`. `PERMISSION_GROUPS` / `PERMISSION_LABELS` / `PERMISSION_HINTS` / `ALL_PERMISSION_KEYS` **diturunkan** dari katalog — tidak boleh ditulis tangan lagi |
| Perhitungan | `src/lib/permission-matrix.ts` | murni (tanpa React, tanpa SQL; ikut dipakai `server/roles.ts`): `buildGrants(settings)`, `grantForRole`, `effectivePermissions`, `makeChecker`, `permissionRole` (alias `admin` → `tenant_admin`), `inScope`/`branchInScope`/`warehouseInScope`, `effectiveBranchScope`, `effectiveWarehouseScope` |
| Pemakaian | `src/hooks/use-permissions.ts` | `usePermissions()` → `{ can, granted, scope, loading, role, roleLabel }`; `usePermission(key)`, `useBranchScope()`, `useWarehouseScope()`, `useInvalidateTenantSettings()` |

Aturan yang dijamin resolver (dan diuji di `src/lib/permission-matrix.test.ts` +
`src/config/roles.test.ts`):

1. **Urutan gabung**: default bawaan < `settings.role_permissions[peran]` < permission role
   kustom sendiri (di atas default `clone_of`-nya). Gabung, bukan ganti — kunci yang baru
   dikirim setelah seorang owner menekan Simpan tetap memakai defaultnya, tidak hilang.
2. **Hanya `true` yang mengizinkan.** `can(key)` memeriksa `permissions[key] === true`;
   `false`, tidak ada, dan nilai bukan boolean semuanya menolak.
3. **Gagal-tertutup.** Peran yang tidak ada di matriks (role kustom dihapus, string karier
   lama, sesi tanpa peran) tidak mendapat grant apa pun.
4. **Scope default `all`** untuk semua peran bawaan, jadi mempersempit lokasi selalu
   keputusan owner yang disadari; scope parsial (`{branches: […]}` saja) tidak membuat sisi
   lain jadi kosong.
5. Baris **tanpa lokasi** tidak muncul untuk peran ber-scope sempit — "bagaimana stok di
   tempat saya" tidak dijawab oleh angka tanpa cabang/gudang.

Cara menambah izin baru: satu entri di `PERMISSION_CATALOG` (key, label, hint) + nilai default
di `DEFAULT_ROLE_PERMISSIONS` untuk peran yang berhak. Guard route, sidebar, pratinjau role,
dan tes katalog membaca dari sana, jadi tidak ada daftar kedua yang bisa tertinggal.

Bentuk penyimpanan `role_permissions` / `custom_roles` / `role_scopes` dan batas
`mergeTenantSettings` (satu level, last-write-wins) dijelaskan di
[backend.md](backend.md) §pengaturan-tenant; endpoint tulisnya (`/api/admin/users`,
`/api/admin/users/[id]`) juga di sana.

