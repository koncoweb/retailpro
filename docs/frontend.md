# Frontend RetailPro

| | |
|---|---|
| Dokumen | `docs/frontend.md` |
| Terakhir diperbarui | **2026-11-19** |
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
| Lint | Gerbang sebuah perubahan = `npx eslint <berkas yang disentuh>` → **0 masalah** (terukur lagi 2026-11-19 pada `src/components/vendors/*`, `vendor-import.ts`, `product-import.ts`, `vendor-catalog.ts`, `tests/bulk-import.e2e.ts`). `npm run lint` (`eslint .`) **memang keluar 1** karena beban warisan yang tidak disentuh rilis mana pun: **25 error** `@typescript-eslint/no-explicit-any` (`src/components/dashboard/*`, `SalesReport`, `InventoryReport`, `BranchTransfers`, `POS`, `AddProductModal`, `src/lib/db/json.ts`, `server/turso-platform.ts`) + **8 warning** (`react-hooks/exhaustive-deps` di `AddProductModal`/`BranchTransfers`/`POS`, `react-refresh/only-export-components` di `TenantContext` + `tokoonline`, tiga `eslint-disable` yang tidak lagi dipakai) — tersebar di 18 berkas, jumlah error dan warning-nya **sama dengan di `HEAD`**, jadi bukan regresi dan dicatat sebagai pekerjaan terpisah |
| Test | `npm run test` (Vitest; **33 berkas, 547 test** — terukur 2026-11-19) |
| Test E2E | `npm run test:e2e` (tester.army; `tests/**/*.e2e.ts`, butuh dev server `:8080` dan kunci model di `.env` — lihat §12) |
| Toko online | `cd tokoonline && npm run dev` → port **8082**, `VITE_CATALOG_API_URL` (bawaan `http://localhost:3000`) |

---

## 2. Struktur folder

```
src/
  App.tsx                  Tabel route + guard per izin
  main.tsx                 Bootstrap React
  contexts/TenantContext.tsx  Bootstrap tenant, RequireTenant
  hooks/                   use-auth, use-mobile, use-theme, use-toast, use-permissions, use-pos-branch
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
    goods-receipt.ts       Mesin penerimaan barang (GRN) di atas PO
    vendor.ts              Kode vendor, termin, kategori, saldo hutang
    vendor-catalog.ts      SATU penulis relasi vendor⇄produk: resolve-or-create vendor, tautan katalog, is_preferred, harga beli (overwrite/gap-only), defaultVendorFor
    vendor-catalog-sql.ts  Statement builder murni (nol import) untuk tulis di atas — dipakai bersama server/demo/ledger.ts
    product-write.ts       Satu penulis produk: saveProductDraft() (form) + insertImportedProduct() (sheet, termasuk banyak varian) + appendImportedVariants() (extend) — diekstraksi dari Inventory.tsx
    vendor-import.ts       Perencana sheet vendor+produk: carryVendorForward() + expandProductCodes() + groupVendorProductRows() + planVendorProductImport()
    product-import.ts      Perencana sheet produk kaya: groupProductRows() + planProductImport() (murni, tanpa SQL/React)
    pricing.ts             Harga beli/jual per pecahan, margin, pembulatan, harga pack otomatis
    variants.ts            Parsing atribut & label varian; `parseAttributeCell`/`formatAttributeCell` (sel sheet), `mergeGroups` (union sumbu append-only), `variantSku`/`variantKey` (identitas)
    units.ts               Daftar satuan ritel Indonesia + label turunan ("Isi 40 pcs")
    shift-attendance.ts    Absensi otomatis dari buka/tutup shift (best-effort)
    holidays.ts            Hari libur nasional + cuti bersama per tahun (API Tanggal Merah)
    bulk-io.ts             Impor/ekspor massal CSV & Excel
    password.ts            Pembuatan password sementara
    audit.ts               logAudit / logAuditTx
    date-range.ts          Rentang periode laporan + koreksi zona waktu
    formatters.ts          formatRupiah, formatTanggal
    inventory-utils.ts     SKU otomatis (mintSkuForCategory — dipakai bersama tiga importer), validasi barcode
    void.ts                Aturan void (guard, penurunan total, restock batch) + SQL yang bisa di-replay
    geolocation.ts         getCurrentCoords (navigator.geolocation), haversineMeters, withinRadius, formatDistance; error bertipe + pesan "butuh HTTPS" saat bukan secure context
    face.ts                Loader @vladmandic/face-api (lazy), captureDescriptor, encodeDescriptors/decodeDescriptors, bestMatch (jarak L2 < threshold); bagian matematika murni bisa diuji tanpa model
    workplace.ts           Daftar lokasi kerja (branches+warehouses ber-koordinat), locationKey, fetchLocationNames/fetchWorkplaceLocations untuk absensi & geofence
    print/                 Subsistem cetak: document.ts (model kolom), html-render.ts, escpos.ts, print-bridges.ts, print-service.ts, receipt-doc.ts, zreport-doc.ts, receipt-printer.ts (muat data untuk cetak ulang)
  components/
    auth/{RoleBasedRoute,PermissionGate}.tsx
    layout/{POSLayout,BackOfficeLayout,Header,Sidebar}.tsx, nav-items.ts
    dashboard/*            Kartu statistik, grafik, modal detail
    inventory/*            AddProduct, StockTransfer, StockOpname, PurchaseOrder, Import/Export
    pos/{PaymentModal,ShiftModal,VoidDialog}.tsx
    branches/BranchDetailModal.tsx
    vendors/*              Daftar & detail vendor + VendorProductImport (sheet flat vendor+produk)
    settings/{Receipt,TaxDiscount,Bank,EmployeeRole,Inventory,PaymentChannel}Settings.tsx
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
| `/pos/transactions` | `POSTransactions` | `access_pos` **atau** `view_dashboard` **atau** `view_inventory` (`anyOf`) — kasir tetap membuka buku transaksi till-nya sendiri walau dashboard-nya dicabut |
| `/backoffice` | `Dashboard` | `view_analytics` |
| `/backoffice/chat` | `Chat` | `use_chat` (menu masuk sidebar & rute); kelola/archiv channel & tambah/keluar anggota butuh `manage_channels` |
| `/backoffice/vendors`, `/vendors/:id`, `/crm/suppliers`, `/crm/customers` | `vendors/*`, `crm/Customers` | `view_finance` |
| `/backoffice/branches`, `/branches/dashboard` | `Branches`, `branches/Dashboard` | `manage_branches` |
| `/backoffice/warehouses` | `Warehouses` | `view_inventory` |
| `/backoffice/branches/{orders,transfer}` | `BranchOrders`, `BranchTransfers` | `view_inventory` (tindak lanjut per aksi) |
| `/backoffice/inventory/{products,opname,po}` | `Inventory` | `view_inventory` |
| `/backoffice/inventory/stock-in` | `Inventory` | `add_stock` |
| `/backoffice/finance/{journal,ap-ar,cashflow,expenses}` | `finance/*` | `view_finance` |
| `/backoffice/hr/{employees,schedule}` | `Employees` | `view_employees` |
| `/backoffice/hr/{attendance,payroll}` | `EmployeeReports` | `view_employees` |
| `/backoffice/hr/face` | `FaceEnrollment` | `manage_attendance` |
| `/absen` | `AttendanceCheckIn` | terautentikasi saja (tanpa kunci izin — semua karyawan absen sendiri); dibungkus `RequireTenant` + redirect `/login` bila belum login, **tanpa** `RoleBasedRoute` |
| `/backoffice/reports` + `/{sales,inventory,finance,procurement}` | `Reports`, `*Report` | `view_reports`; tombol unduh `export_reports` |
| `/backoffice/storefront-orders` | `StorefrontOrders` | `view_finance` |
| `/backoffice/settings` | `Settings` | `view_settings`; simpan butuh `edit_settings`, tab Role butuh `manage_roles`, tab Pembayaran butuh `edit_settings` |
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
| `Sidebar` | Menu per seksi (POS, Dashboard, Cabang, Gudang, Inventori, Keuangan, SDM, Laporan, Toko Online, Pengaturan) |
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
`staleTime` 60 detik) dan mengembalikan `{ can, granted, scope, loading, role, roleLabel, roleGranted, removedKeys }`.
Cache-nya disemai dari respons bootstrap sehingga paint pertama tidak berkedip `loading`,
dan setiap simpanan di layar Role memanggil `useInvalidateTenantSettings()` sehingga edit
matriks langsung berlaku tanpa reload. Nomor `SELECT settings FROM tenants LIMIT 1` per
komponen yang dulu ada sudah hilang.

**Pengecualian izin per karyawan (restrict-only).** Di samping cache matriks peran yang
bentuknya tidak berubah, ada cache kembar `['tenant-user-permissions']` (`useTenantUserPermissionsQuery()`,
disetel `staleTime` 60 detik dan disemai bootstrap dari slice `userPermissions` milik pemanggil
saja) yang memuat pengecualian per orang, dipetai `userId → { permKey: false }`. `usePermissions()`
menggabungkannya di resolver — `granted = effectiveUserPermissions(grant, restrictions[user.id])` —
sehingga seorang karyawan bisa **dicabut** sebagian izin dari role-nya tetapi tidak pernah
ditambah; hanya `false` yang berarti, dan aturan "hanya mengurangi" ditegakkan di resolver,
bukan di UI (`roleGranted` = peta mentah peran, `removedKeys` = kunci yang sedang dikecualikan,
dipakai editor individu). Setiap simpanan layar Karyawan memanggil `useInvalidateTenantUserPermissions()`.

---

## 6. Pola data di halaman

| Pola | Penggunaan |
|---|---|
| `useEffect` + `query()` + `useState` | Pola utama semua halaman data (belum dimigrasi ke TanStack Query) |
| `batchQuery()` | Halaman yang butuh beberapa hasil sekaligus (hemat round-trip) |
| `runTransaction()` | Semua penulisan multi-tabel: checkout, produk, transfer, opname, PO, pengeluaran |
| Refetch manual | Setelah mutasi berhasil (`fetchX()` dipanggil ulang) |
| `parseJson*` | Membaca kolom JSON (`settings`, `preferences`, `details`) |

Halaman terbesar (perlu kehati-hatian saat mengubah): `VendorDetail.tsx` (~1.977 baris),
`Inventory.tsx` (~1.832), `POS.tsx` (~1.348), `EmployeeReports.tsx` (~1.285), `Employees.tsx` (~1.260),
`Branches.tsx` (~1.046), `BranchOrders.tsx` (~1.024), `POSTransactions.tsx` (~816).

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
| Cetak struk & Z-report | `lib/print/*` + `settings/ReceiptSettings.tsx` | Satu **model dokumen berbasis karakter** (`PrintDoc`: baris `text` atau `cols` kiri-kanan) → dua renderer (HTML di iframe tersembunyi + `window.print()`; byte ESC/POS in-house) → empat transport (`driver`, WebUSB, Web Bluetooth, unduh `.prn`). Lebar roll menentukan kolom (58/60 = 32, 72 = 42, 76 = 44, 80 = 48) dan renderer HTML menghitung ukuran font agar kolom itu benar-benar muat. `printDocument()` **tidak pernah melempar** ke alur bisnis — hasil `PrintResult` menjadi toast, penjualan yang sudah commit tidak dibatalkan printer mati. Dipakai di `POS.tsx` (auto-print setelah checkout), `POSShifts.tsx` (Z-report saat tutup shift + cetak ulang), `POSTransactions.tsx` (cetak ulang struk per bon) |
| Void transaksi | `components/pos/VoidDialog.tsx` + `lib/void.ts` | Dialog konfirmasi beralasan (min. 3 karakter) dengan pratinjau baris yang akan dicoret dan besarnya pengurangan; tombol **Void** per baris item dan **Void Bon** di modal detail `POSTransactions.tsx`. Aturan (izin `void_transaction`, batas shift `open`, owner-tier override) hidup di `voidGuard()` sebagai fungsi murni, bukan di JSX. Baris void dirender `line-through` + badge `VOID` + alasan; filter status Semua/Selesai/Void; struk void otomatis dicetak ulang bila Cetak Otomatis aktif |
| Import/Export Excel | `inventory/ProductImportExport.tsx` + `lib/product-import.ts` | `xlsx`. Sheet **kaya 16 kolom** (`PRODUCT_COLUMNS` = satu-satunya sumber header: template, ekspor, dan impor membacanya dari tempat yang sama), satu baris per (varian × pecahan), atribut `Rasa=Susu;Ukuran=250ml`. Alur: berkas → `normalizeRows` → `groupProductRows` → `planProductImport(seeds, universe, { priceMode })` → pratinjau rencana (chip *produk baru / varian baru / pecahan baru / harga diisi / harga ditimpa / dilewati / SKU otomatis / catatan file*, baris grouped per produk + varian, alasan untuk setiap baris yang dilewati, checkbox **Timpa harga beli** hanya aktif dengan `manage_vendor_prices`, pemilih gudang stok awal, blok terurai **Format kolom & contoh baris** tanpa gate izin) → tulis. Impor **aditif**: SKU existing di-`extend`, bukan dilewati atau ditimpa |
| Import vendor + produk satu sheet | `components/vendors/VendorProductImport.tsx` + `lib/vendor-import.ts` + `lib/vendor-catalog.ts` | Tombol **Import Vendor + Produk** di `pages/vendors/Vendors.tsx`: **satu berkas untuk satu vendor** — baris pertama hanya kolom vendor, baris 2+ produk vendor itu (`VENDOR_PRODUCT_COLUMNS`, **21 kolom**, kolom terakhir `Barcode Varian`, di-append agar ekspor lama tetap sebaris). Pratinjau "N vendor baru · M produk ditautkan · K harga diperbarui" + chip *varian baru* / *pecahan baru* sebelum ada yang ditulis — chip itu **baris di tabel rencana**, bukan hanya angka di baris ringkasan: berkas yang seluruh tugasnya menambah varian/pecahan tidak membawa harga satu pun pada pack yang sudah ada, dan barisnya tetap digambar lengkap dengan alasannya (KS-60), lalu **satu transaksi per produk** (vendor diselesaikan lebih dulu di transaksinya sendiri; satu produk gagal tidak membatalkan sisanya). Baris melanjutkan vendor di atasnya (`carryVendorForward`), sel `SKU` bisa memuat beberapa kode (`expandProductCodes`, hanya menautkan produk existing), dan baris produk boleh **membuat varian/pecahan** yang belum ada bila pemanggilnya memegang `manage_variants` (`planVendorProductImport(…, { priceMode, mayCreateVariants })`) — tanpa izin itu barisnya diberi alasan, dan varian yang tidak pernah disebut pada produk multi-varian **tetap** ambigu. Berkas multi-vendor hanya diberi banner informasi, tidak ditolak. Template CSV/Excel, **Ekspor Katalog**, dan **Sheet per Vendor** memakai header yang sama, jadi hasil ekspor bisa diimpor balik |
| Ekspor sheet satu vendor | `lib/vendor-catalog.ts` + `pages/vendors/VendorDetail.tsx` | `vendorCatalogSheetRows(vendorId?)` adalah satu-satunya pembangun baris sheet: tanpa argumen ia keluar seperti ekspor katalog selalu keluar (vendor diulang di setiap baris), dengan `vendorId` ia menulis baris vendor lebih dulu lalu baris produk dengan kolom vendor dikosongkan. `downloadVendorSheet()` membungkusnya menjadi berkas `sheet_vendor_<KODE>_<tanggal>.<csv\|xlsx>` — dipakai tombol **Ekspor Sheet** di toolbar detail vendor (gate `export_reports`) dan **Sheet per Vendor (Excel/CSV)** di footer dialog impor. Berkasnya dijamin impor-balik-nol-tulis, dan itu diuji e2e dengan menangkap hasil unduhannya. Ditekan juga di browser pada tenant demo: **Ekspor Sheet** untuk VND-0001 menjawab toast `25 baris sheet vendor diekspor` tanpa error, dan footer dialog impor menampilkan kedua tombol formatnya |
| Vendor otomatis di PO | `inventory/PurchaseOrderModal.tsx` + `lib/vendor-catalog.ts` | Belum ada vendor → picker menampilkan semua produk dengan caption vendornya; memilih produk memanggil `defaultVendorFor()` (preferred → `products.supplier_id` → vendor tunggal aktif) sehingga field vendor terisi sendiri dengan caption **"Vendor (otomatis dari produk)"** + tombol **Ubah**, tanggal diharapkan ikut terisi dari `lead_time_days`, dan harga kesepakatan pecahan itu ikut masuk. Ganti vendor saat keranjang berisi baris vendor lain memunculkan `AlertDialog` yang menghitung barisnya — bukan lagi hilang diam-diam |
| Produk baru dari layar vendor | `pages/vendors/VendorDetail.tsx` + `inventory/AddProductModal.tsx` | Menyimpan vendor di daftar melempar ke detail vendor dengan `?tambah-produk=1` (dibaca sekali lalu dibersihkan) dan membuka `AddProductModal` yang sudah terisi vendor itu (`defaultSupplier`); tab **Produk** punya **Tambah Produk Baru** dan dialog **Hubungkan Produk** kini mendapat switch **Jadikan vendor utama** |
| Pembayaran | `pos/PaymentModal.tsx` | Validasi tunai, hitung kembalian, pilih metode |
| Shift | `pos/ShiftModal.tsx` → `POSShifts` | Buka/tutup kas, ringkasan per metode bayar. Modal hanya memvalidasi + menutup; toast "berhasil" dan **absensi otomatis** (`lib/shift-attendance.ts`) dikerjakan pemanggilnya setelah barisnya benar-benar ditulis. Uang tunai awal boleh kosong/`0` ("tanpa uang tunai awal", ada pintasan `Rp0`) di kedua jalur — modal POS maupun layar shift |
| Cabang untuk seluruh POS | `hooks/use-pos-branch.ts` | Satu sumber kebenaran cabang aktif untuk till, meja shift, dan header: prioritas `session.branchId → user.assigned_branch_id → cabang pertama in-scope → baris pertama` (baris terakhir hanya untuk scope penuh), daftar cabang dipakai bersama lewat query `['pos-branches']`, pilihan manual per user disimpan di store modul (`useSyncExternalStore`) — bukan localStorage — supaya shift yang baru dibuka selalu terlihat oleh till. Bila user punya >1 cabang in-scope muncul pemilih cabang |
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
| Chat internal | `pages/Chat.tsx` + `components/chat/*` + `lib/chat.ts` + `hooks/use-chat.ts` | Rail (channel + DM, polling 10s) / thread (3s untuk yang terbuka) / composer dengan autocomplete `@`orang dan `#`produk/invoice/PO/vendor — Enter menerima kandidat, Enter berikutnya mengirim. Body pesan tersimpan sebagai teks natural + snapshot `chat_mentions`; chip entity menjadi taut ke detailnya (`entityRoute`), chip orang hanya highlight. Append optimistis (id `temp-`), hapus pesan menjadi placeholder "Pesan ini telah dihapus", arsip channel = `archived=1`. Rute & menu terbuka untuk semua peran lewat `use_chat`; kelola/arsip/anggota butuh `manage_channels` |
| Matriks izin | `settings/EmployeeRoleSettings.tsx` | Editor detail: daftar role + editor izin. Tata letaknya responsif per lebar — **strip daftar role horizontal yang bisa digeser** di tablet/desktop kecil (`md`/`lg`, kartu `min-w` tetap, `overflow-x-auto`) supaya tidak menumpuk vertikal melewati tinggi layar pendek, dan **master/detail berdampingan** hanya di monitor besar (`xl`); editor lebar & `Sheet` layar penuh di ponsel tak berubah. Kolom pencarian "Cari izin…", "Pilih semua / Kosongkan" per grup, tiap baris `min-h-11` dengan label + hint + Switch, bilah Simpan lengket dengan penanda "Belum disimpan", dan Pratinjau yang dirender dari `nav-items.ts` |
| Izin khusus per karyawan | `employees/IndividualPermissionEditor.tsx` + `pages/Employees.tsx` | Aksi baris "Izin khusus" (ikon Shield, hanya `can('edit_employee')` dan disembunyikan untuk akun sendiri). **Restrict-only**: hanya menampilkan kunci yang **role** berikan (digrup via `PERMISSION_GROUPS`), tiap baris default ON = mewarisi role, mematikannya menambah `false` ke `user_permissions`; kunci di luar role tidak ditawarkan sebagai Switch sama sekali (tidak bisa menambah), dengan catatan bahwa izin itu diatur di Pengaturan → Role. Ringkasan "X dari Y izin aktif, N dikecualikan" + "Kembalikan semua ke role"; dialog di desktop, `Sheet` layar penuh di mobile. Badge "N pengecualian" di daftar, dan hapus karyawan ikut membersihkan entri `user_permissions`-nya |
| Role kustom | `settings/EmployeeRoleSettings.tsx` | Buat / duplikat / hapus (`cust_*`, disimpan di `settings.custom_roles`). Menghapus ditolak selama masih dipakai karyawan, dengan daftar namanya; id tidak pernah diganti, hanya label |
| Scope lokasi | `settings/EmployeeRoleSettings.tsx` + `useBranchScope` / `useWarehouseScope` | "Terapkan di" Cabang/Gudang berupa chip; layar yang kena scope menampilkan kalimat penjelas ("Anda hanya melihat cabang: …") dan baris di luar scope **tidak ditampilkan**, bukan sekadar-disabled |
| Tombol berizin | `auth/PermissionGate.tsx` | Pembungkus standar aksi yang butuh izin: tersembunyi saat `loading`, tersembunyi/`fallback` saat ditolak, supaya aturan "jangan tampilkan tombol yang pasti gagal" tidak ditulis ulang per halaman |
| Baris izin | `ui/permission-row.tsx` | Label + hint + Switch setinggi 44 px — dipakai matriks dan layar pengaturan berikutnya |
| Sasaran sentuh | `ui/button.tsx` | `size="touch"` / `"iconTouch"` (tinggi 44 px); sidebar, kartu karyawan, dan editor role memakainya sehingga konsistensi tidak per-halaman |

Konvensi destruktif: gunakan `AlertDialog`, bukan `window.confirm()`.

---

## 9. Batasan frontend saat ini

1. **Dukungan perangkat keras cetak diuji manual per tipe printer** — jalur `driver` (HTML) jalan di semua
   browser, tetapi `usb` (WebUSB) dan `bluetooth` (Web Bluetooth) butuh Chrome/Edge + secure context +
   satu gesture **Sambungkan Printer** per sesi; printer Bluetooth murni di Windows desktop tidak punya
   API serial Bluetooth, jadi jalur resurnya unduh `.prn`. Code page ESC/POS tidak diimplementasikan
   (rupiah ASCII `"Rp"`, karakter non-ASCII → `?`) dan belum ada logo raster / barcode di struk.
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
10. **Void tidak membalik pembayaran gateway** — QRIS/kartu harus dikembalikan manual di terminal
    provider; laci kas sengaja tidak dibuka saat void. Retur tanpa restock dan alokasi diskon
    proporsional per item belum ada (`src/lib/void.ts` §Di luar cakupan di [fitur-tenant.md](fitur-tenant.md) 2.2.2).

---

## 10. Log perubahan frontend

| Waktu | Ref | Perubahan |
|---|---|---|
| 2026-11-19 | — (working tree) | **Pratinjau satu vendor kini benar-benar menggambar baris `varian baru`/`pecahan baru` (KS-60 — menyempurnakan baris di bawah, bukan menggantinya).** Ditemukan oleh verifikasi browser atas fitur yang sudah dianggap selesai, bukan oleh suite: tombol **Ekspor Sheet** terbukti jalan (toast `25 baris sheet vendor diekspor`, tanpa error konsol), tetapi dialog yang mengunggah sheet satu-vendor nyata menampilkan ringkasan `· 1 varian baru · 3 pecahan baru` sambil tabel rencananya hanya berisi satu baris `catalogue saja (tanpa harga)` — tanpa chip dan tanpa alasan. Akarnya cabang awal di `describe()` (`VendorProductImport.tsx`) yang menelan seluruh produk begitu `product.packs.length === 0`, padahal sheet yang tugasnya cuma memperluas produk memang tidak membawa harga untuk pecahan yang sudah ada; `continue` itu sekarang menuntut `newVariants`, `skippedPacks`, **dan** `ambiguousVariants` ikut kosong. Assertion e2e dipindah dari headline ke tabel (`preview.getByRole('row').filter({ hasText: 'varian baru' })` → `toHaveCount(2)` + `toContainText('nanas')`, `toHaveCount(0)` di kedua round-trip) karena `toContainText` pada dialog selama ini dipenuhi oleh `DialogDescription`, dan prasyarat kasus append dinyatakan sebagai **kebutuhan** (produk belum punya `Rasa=Nanas`) alih-alih angka `before.variants === 4` yang tidak tahan retry. Setelah perbaikan browser menunjukkan tiga baris ber-chip: `Merah`/`Dus ×12`/`Rp 300.000`/`pecahan baru` dan dua baris `PGR-004-UNGU` (`pcs`/`Rp 22.000`, `Dus ×12`/`Rp 250.000`)/`varian baru`; kedua sesi ditutup Batal sehingga tidak ada yang tertulis. Gate: typecheck + typecheck:node 0, `npx eslint` pada berkas yang disentuh bersih (lihat §1 — `eslint .` repo-wide tetap 25 error + 8 warning warisan, diukur ulang dan jumlahnya sama dengan di `HEAD`), `--grep "one vendor per file" --retries 0` **3 lulus (3) · 80,86s**, blok penuh `--retries 2` **`Test Files 2 passed (2)` · `Tests 4 passed \| 1 flaky (5)` · 364,11s**, dan berkas penuh `npx e2e run tests/bulk-import.e2e.ts --retries 2` **`Tests 12 passed \| 1 flaky (13)` · 434,74s** dengan **11/11** kasus lulus (flaky-nya kelas KS-59: `bootstrap 502` / `get-session 500` sebelum tulis apa pun). Catatan lengkap di [kendala-solusi.md](kendala-solusi.md) KS-60 |
| 2026-11-19 | — (working tree) | **Sheet vendor ditulis untuk satu vendor per berkas (tanpa migrasi).** Bentuk lembar yang diajarkan template dan yang dihasilkan ekspor kini: **baris pertama hanya kolom vendor**, baris kedua dan seterusnya produk vendor itu dengan kolom vendor dikosongkan dan diwarisi `carryVendorForward()`; jumlah produk per berkas tidak lagi terbatas karena yang bertambah adalah baris, bukan kolom. `VENDOR_PRODUCT_COLUMNS` **20 → 21** dengan **`Barcode Varian` di-append di ujung** (dua puluh kolom pertama tidak berubah urutan maupun labelnya, jadi berkas lama terbaca persis sama), `VENDOR_PRODUCT_TEMPLATE_ROWS` ditulis ulang menjadi **6 baris** yang menceritakan seluruh bentuknya termasuk "tambah varian ke produk yang sudah jalan". Perencana mendapat opsi `mayCreateVariants` (= `manage_variants`, flag yang sama dengan membuat produk, tidak ada kunci izin baru): sebuah baris kini boleh menyebut varian/pecahan yang belum ada dan harganya menempel padanya lewat `ProductPlan.newVariants` + `blockedVariantWrites` + ringkasan `newVariants`/`newPacks`, sementara **varian tidak pernah ditebak** — baris tanpa penyebut varian pada produk multi-varian tetap `ambiguousVariants` pada kedua pengaturan (jaminan KS-55, dikunci uji `bothWays()` yang memutar baris yang sama dua kali). Penulis `applyVendorBlock` pindah dari **satu transaksi per blok vendor** ke **satu transaksi per produk** dengan `try/catch` sendiri dan laporan `N produk gagal ditulis` (pola KS-58; vendor tetap lebih dulu di transaksinya sendiri, `minted` + `today` diangkat ke lingkup vendor, `try/catch` per vendor tetap ada untuk berkas lama), dan untuk varian baru memakai `appendImportedVariants()` sebelum `upsertVendorCatalogLink`/`upsertVendorPrice`/`markPreferredVendor` sehingga tidak ada harga yang ditulis dua kali. Dialog menambah chip **varian baru** · **pecahan baru**, alasan "butuh izin kelola varian untuk menambah varian", penjelasan bentuk satu-vendor di blok **Format kolom & contoh baris** (tetap tidak digate), dan banner informasi "Sheet ini memuat N vendor — format barunya satu vendor per file" yang **tidak** mematikan tombol Import. Ekspor: pembangun baris katalog yang tadinya inline di dialog dipindah ke `vendorCatalogSheetRows(vendorId?)` (`src/lib/vendor-catalog.ts`, `WHERE ($1 IS NULL OR v.id = $1)` + `pv.barcode AS variant_barcode`) dan dipakai dua jalur — ekspor katalog semua vendor **tidak berubah output maupun nama berkas**, dan **sheet per vendor** yang baru (`sheet_vendor_<KODE>_<tanggal>.<csv\|xlsx>`) lewat tombol **Ekspor Sheet** di toolbar `pages/vendors/VendorDetail.tsx` (gate `export_reports`) serta **Sheet per Vendor (Excel/CSV)** di footer dialog. Daftar kolom yang diwarisi dijadikan **satu sumber** (`VENDOR_SHEET_KEYS` di `bulk-io.ts`) alih-alih dua salinan yang diuji harus sama. Unit: `vendor-import.test.ts` **40 → 51**, `bulk-io.test.ts` **24 → 27**, suite penuh **33 berkas / 547 test**. Browser: **4 kasus baru** dalam `describe('one vendor per file')` di `tests/bulk-import.e2e.ts` (7 → 11) memakai fixture baru `tests/fixtures/fixture_vendor_produk_satu_vendor.csv` (vendor + produk pipih 2 pecahan + produk 3 varian × 2 pecahan, satu `Kode Varian` dan barcode diketik) dan `…_varian_baru.csv` (menambah rasa ke produk yang sudah ada): tulis penuh, tambal varian (dijanjikan `1 varian baru · 2 pecahan baru · 0 produk baru`), impor ulang nol baris, dan **round-trip ekspor** yang benar-benar menangkap hasil unduhan (`browser.waitForDownload`), memeriksa 21 header + baris 1 vendor saja + kolom vendor kosong di baris produk, lalu menyerahkannya kembali ke input impor dan menekan Batal. `tests/vendor-catalog.e2e.ts` dijalankan **tanpa diubah** terhadap `fixture_vendor_produk.csv` lama sebagai bukti kompatibilitas mundur. Desain dibekukan di [spec-sheet-vendor-satu-vendor.md](spec-sheet-vendor-satu-vendor.md) |
| 2026-11-19 | — (working tree) | **Satu baris gagal tidak boleh membatalkan seluruh impor (KS-58 — menyempurnakan baris di bawah, bukan menggantinya).** Pertanyaan pengguna "berkas 282 baris saya kenapa cuma masuk 8" dijawab dengan ukuran, bukan dugaan. (1) Akar: `Inventory.handleImport` di HEAD `a7cb9a4` membungkus **seluruh** loop tulis dengan satu `try/catch`, jadi exception pada produk ke-9 menghentikan baris 10..282; 8 baris pertama tetap commit karena transaksinya per produk, dan yang tersisa di layar hanyalah `toast.error("Gagal mengimport produk")` — tanpa nomor baris, tanpa jumlah, sebabnya cuma sampai ke `console.error`. Kini penangkapannya **per produk** (`failed += 1` + pesan `N gagal ditulis`, dan toast naik ke `error` bila `failed > 0`). (2) Diagnostiknya dipromosikan jadi perintah tetap: `npm run analyze:import -- produk.xlsx` (`scripts/analyze-import-file.ts`, read-only, memakai parser yang **sama** dengan dialog) sekarang memetakan setiap SKU yang sudah ada di database kembali ke **nomor baris berkas** dan mencetak `baris file yang tertulis`, `berhenti setelah baris ke-8 dari 282 → 274 baris sesudahnya tidak pernah ditulis`, `baris yang menghentikan run` (SKU/nama/supplier/barcode), plus `penyebab data pada baris itu` yang menguji tabrakan `products.sku`, `product_variants.sku` (kolom yang dulu diisi SKU **produk** oleh penulis lama, dan UNIQUE-nya berlaku sekatalog lewat `idx_variants_sku`), dan klaim kode varian atas SKU tanpa produk. Terukur: baris 1–8 kontinu 08:19:24.090Z→08:19:36.762Z (±1,7 s), baris penghenti `8994592309639` **tanpa** sebab data (0 dari 274 SKU jadi kode varian; supplier `Nirwana Lestari` sama dengan baris 6–8 yang sukses), dan vendor yang lahir selama run memegang tepat 4+1+3 = 8 tautan produk. (3) Build hari ini di browser, berkas yang sama: "282 produk dalam file · 274 akan ditulis · 8 tidak ada yang baru", badan tabel 200 px, **baris ke-9 kini direncanakan "produk baru · varian baru · harga diisi"**, footer "Import 274 Produk" aktif, penutup "… dan 242 baris lainnya" — dialog ditutup Batal, database tetap 41 produk. Gate: `npm run typecheck` + `npm run typecheck:node` 0, Vitest **33 berkas / 533 test**, `docs:check` OK. Catatan lengkap di [kendala-solusi.md](kendala-solusi.md) KS-58 |
| 2026-11-19 | — (working tree) | **Pratinjau rencana impor dibuat jujur (KS-57 — menyempurnakan baris di atas, bukan menggantinya).** Empat cacat yang **hanya** kelihatan setelah dialognya benar-benar dibuka di browser dan diisi berkas nyata: (a) harga beli direncanakan `fill` walau barisnya tidak menyebut vendor, padahal penulis hanya menulis harga bila `vendorId` ada — chip "harga diisi" untuk janji tanpa jalur tulis; sekarang perencana mengenal `hasVendor` dan baris itu diberi alasan eksplisit "harga beli butuh Kode Vendor atau Supplier". (b) Berkas yang **cuma** menambal harga bolong jatuh ke `nochange` dan tombolnya mati, karena `plan.adds` tidak menghitung harga; sekarang ada `plan.priceWrites` yang menggerakkan gerbang `nochange` **dan** tombol, sehingga "1 akan ditulis" + "Import 1 Produk" aktif untuk tambal-saja. (c) `produk_2026-11-10.xlsx` (282 baris milik pengguna) menampilkan ringkasan tanpa satu baris rencana pun: badan tabel `flex-1 overflow-auto` menyusut ke **tinggi 0** di dalam `DialogContent` ber-`max-h` — diperbaiki jadi `max-h-[85vh] overflow-y-auto` + `min-h-[200px] max-h-[50vh]` di **kedua** importer (`ProductImportExport.tsx`, `VendorProductImport.tsx`). (d) Baris sheet vendor tanpa harga dan tanpa varian ikut dihitung "harga varian dilewati"; sekarang ia jadi "catalogue saja (tanpa harga)" dan ambiguitas hanya dilaporkan bila ada angka yang harus ditempatkan. Berkas 282 baris itu sekaligus menjelaskan impor parsial pengguna: di HEAD `a7cb9a4` hanya **8** produk yang pernah commit karena `Inventory.handleImport` lama membungkus seluruh loop dengan satu `try/catch`; sekarang penangkapannya per produk dan melapor `N gagal ditulis`. Unit: `product-import.test.ts` **28 → 31**, `vendor-import.test.ts` **39 → 40**, suite penuh **33 berkas / 533 test**; verifikasi browser 5 tangkapan (semua Batal, nol baris tertulis — `vendor_price_list` CHC-002/`kg` tetap 1 baris) di `.data/evidence/07…11-*.png`. Catatan lengkap di [kendala-solusi.md](kendala-solusi.md) KS-57 dan kontraknya di [spec-impor-varian-kaya.md](spec-impor-varian-kaya.md) §9 |
| 2026-11-19 | — (working tree) | **Impor varian kaya (tanpa migrasi).** Sheet produk naik 8 → **16 kolom** dan berubah bentuk menjadi **satu baris per (varian × pecahan)** dengan atribut dalam satu sel (`Rasa=Susu;Ukuran=250ml`, pemisah `;`/`\|`/baris baru, `=` atau `:`), sehingga jumlah varian yang bisa diimpor tidak lagi terbatas — yang bertambah adalah baris, bukan kolom. Identitas mengutamakan kode di ketiga tingkat (`SKU` → produk, `Kode Varian` → varian, `Kode Vendor` → vendor); `Kode` **tetap** SKU produk di sheet ini agar file lama tidak berubah sasaran. Modul murni baru `src/lib/product-import.ts` (`groupProductRows` + `planProductImport`) memisahkan arti berkas dari penulisnya, meniru `vendor-import.ts`; **kebijakan berubah**: SKU existing tidak dibuang lagi tetapi di-**`extend`** (varian/pecahan/harga yang kurang ditambah, tidak pernah menamai ulang/menghapus/menolkan), dengan `priceMode` `overwrite`/`gap-only`. `ProductImportExport.tsx` dibangun ulang jadi dialog pratinjau rencana seperti vendor (chip + pengelompokan per produk + alasan per baris + "Timpa harga beli" + blok "Format kolom & contoh baris" yang tidak digate), dan `Inventory.handleImport` menyusut menjadi universe → rencana → eksekusi, satu transaksi per produk. Sheet vendor+produk bertambah **tepat dua kolom di ujung** (18 → 20) dan dapat tiga perilaku: `carryVendorForward` (baris melanjutkan vendor di atasnya), `expandProductCodes` (sel `SKU` multi-kode, hanya menautkan produk existing), dan **harga beli yang ditarget ke varian** — ini memperbaiki cacat nyata: sebelumnya `packsByProduct` merapatkan pecahan semua varian ke produk dan pencocokan hanya pada `unitName`, sehingga harga mendarat di varian yang kebetulan kembali pertama (KS-55). Pemintan SKU disatukan di `mintSkuForCategory()` (`src/lib/inventory-utils.ts`) dan dipakai tiga importer; pemintan **kode vendor** ikut disatukan (`highestVendorCode()` di `src/lib/vendor.ts`, dibaca lewat `latestVendorCode()`) karena `ORDER BY code DESC` mengurutkan teks, sehingga satu kode tulisan tangan seperti `VND-E2E-KOPI` membuat vendor berikutnya diminta di `VND-0001` yang sudah dipakai — `UNIQUE constraint failed: suppliers.code` (KS-56). Ekspor + template ikut bentuk kaya, jadi ekspor → ubah → impor tidak menambah baris. Unit: `product-import.test.ts` (28, termasuk 5 yang memutar ulang fixture e2e lewat parser sungguhan), `variants.test.ts` 28 (`mergeGroups` append-only + toleransi sel atribut), `inventory-utils.test.ts` 13 (`mintSkuForCategory`), `vendor-import.test.ts` 39 (HEAD 24; array label terkunci 20 kolom + dua describe helper baru), `bulk-io.test.ts` 24 (round-trip template → `toCsv` → `normalizeRows`), `vendor.test.ts` 14 + `vendor-catalog.test.ts` 26 (urutan kode vendor). Browser: 2 kasus baru di `tests/bulk-import.e2e.ts` (5 → 7) mengunggah `tests/fixtures/fixture_produk_varian.csv` dan memverifikasi 4 `product_variants` + 5 `product_units` + 5 `vendor_price_list` + batch per varian + vendor hasil impor, lalu mengimpor ulang berkas yang sama dan menuntut **nol baris baru** sambil nama produk & harga nego tetap utuh; `tests/vendor-catalog.e2e.ts` dijalankan **tanpa diubah** terhadap fixture lama sebagai bukti kompatibilitas mundur. Vitest **33 berkas / 529 test**. Desain dibekukan di [spec-impor-varian-kaya.md](spec-impor-varian-kaya.md) |
| 2026-11-18 | `3e0330d` | **Refleksi pasca-implementasi chat — tiga bug nyata diperbaiki.** (a) **Label DM di rail**: `listConversations()` meng-agregasi anggota di atas join yang sudah difilter pembaca, sehingga `members` selalu berisi satu orang dan setiap DM jatuh ke judul "Pesan pribadi" — kini subquery terpisah, dan nama pasangan selalu terbaca. (b) **Enter di composer** sempat mengirim token mentah (`#beras`) ketika pencarian autocomplete belum kembali — gerbang `waitingForSuggestions` membuat Enter pertama menyelesaikan token, bukan mengirimnya. (c) **Pesan mendarat di percakapan yang salah**: `placeholderData: keepPreviousData` pada query yang di-*key* id (`useConversation`, `useMessages`) membuat pane masih menampilkan channel sebelumnya selama yang baru dimuat, padahal composer menulis ke pane yang sedang tampil (terbukti dari `chat_messages.conversation_id`: `halo dari e2e` masuk ke `operasional-toko` pada 18:24:16.780Z) — placeholder dilepas dari kedua hook itu (daftar tetap memakainya) dan `Chat.tsx` menampilkan `ChatEmptyState skeleton` selama identitas belum tiba. `tests/chat.e2e.ts` naik ke **8 kasus** dan dua di antaranya kini mengunci (b) dan (c); hasil ukur bersih: `(8 tests) 170,49s`, total `Tests 10 passed (10)` / `Duration 194,11s`, exit 0. Gate ikut diukur ulang: `tsc -p tsconfig.app.json` 0, `eslint` 0 masalah pada berkas yang disentuh, Vitest **31 file / 441 test**, `docs:check` OK, `audit:sql` **576 / 512 / 64 / 8** |
| 2026-11-17 | `3e0330d` | **Chat internal tenant (skema v11).** Layar baru `/backoffice/chat`: rail channel + DM dengan denormalized preview, thread dengan pemisah hari & grouping pengirim, composer dengan autocomplete `@`/`#`. Modul data satu penulis `src/lib/chat.ts` (query + `runTransaction`, tanpa endpoint baru); codec mention murni `src/lib/chat-mentions.ts` (`findActiveToken`/`insertMention`/`renderSegments`/`entityRoute`); polling react-query di `src/hooks/use-chat.ts` (daftar 10s, thread 3s, tab latar pause, optimistic append). Grup izin baru `collaboration`: `use_chat` nyala bawaan untuk semua peran, `manage_channels` khusus owner/admin/manager — kunci ini juga yang mengaktifkan tombol Channel, arsip, dan kelola anggota. Unit: `chat-mentions.test.ts` (15) + blok chat `schema.test.ts`; browser: `tests/chat.e2e.ts` (7 kasus deterministik: rail per peran, buat channel + pesan, chip `@`/`#` + navigasi deep-link, polling terlihat dari sisi kasir, idempotensi DM `dm_key` + DM terbaca dari kedua sisi, arsip). Desain beku di [spec-chat-internal.md](spec-chat-internal.md) |
| 2026-11-17 | `dabf287` | **Vendor–produk terintegrasi (skema v10, indeks saja).** Jalur tulis: `src/lib/vendor-catalog.ts` + `src/lib/vendor-catalog-sql.ts` menjadi satu-satunya penulis `vendor_products` / `vendor_price_list` / `is_preferred`, `src/lib/product-write.ts` menjadi satu-satunya penulis produk (form produk, impor massal, dan tab Produk vendor memakai fungsi yang sama), `src/lib/vendor-import.ts` memisahkan rencana dari eksekusi. UI baru: tombol **Import Vendor + Produk** + dialog pratinjau (`components/vendors/VendorProductImport.tsx`, 766 baris) dengan template CSV/Excel dan **Ekspor Katalog** berbentuk sama; menyimpan vendor di daftar kini **melempar ke detail vendor dengan form produk terbuka** (`?tambah-produk=1`, dibaca sekali lalu dibersihkan); `AddProductModal` menerima `defaultSupplier`; dialog Hubungkan Produk mendapat switch **Jadikan vendor utama**. PO: memilih produk memilih vendor (`defaultVendorFor`: preferred → supplier_id → vendor tunggal aktif) dengan caption "Vendor (otomatis dari produk)" + **Ubah**, prefill `expectedDate` dan harga kesepakatan, serta `AlertDialog` saat mengganti vendor yang akan menghapus baris vendor lain — menggantikan drop senyap. Aksesibilitas yang dibutuhkan tes: `htmlFor`/`id` pada `#product-category`, `#product-supplier`, `#po-product-picker`, `#vendor-product-import-file`. Unit: `vendor-catalog.test.ts` (25), `vendor-import.test.ts` (24), `bulk-io.test.ts` (19, header baru), `demo-tenant.test.ts` (+3 invarian katalog⇄harga/`is_preferred`/provenance `seed demo`); browser: `tests/vendor-catalog.e2e.ts` (4 kasus). Desain dibekukan di [spec-vendor-produk-terintegrasi.md](spec-vendor-produk-terintegrasi.md) |
| 2026-11-16 | `dabf287` | **Void transaksi di Riwayat Kasir (skema v9)**. Modal detail `POSTransactions.tsx` mendapat tombol **Void** per baris item dan **Void Bon**; dialog baru `components/pos/VoidDialog.tsx` mewajibkan alasan (min. 3 karakter) dan menampilkan pratinjau baris yang dicoret + besar pengurangannya. Seluruh aturan di `src/lib/void.ts` (`voidGuard`, `nextTotalAfterVoid`, `baseQtyForRestock`, SQL diekspor sebagai konstanta) sehingga test bisa memutar ulang query-nya tanpa React. UI: baris void `line-through` + badge `VOID` + alasan, blok jejak pembatalan (alasan/pelaku/waktu), filter status **Semua/Selesai/Void**, kolom "N bon di-void (tidak dihitung)" di ringkasan, hint bila shift tertutup. Cetak: primitif `strikethrough` di model dokumen → `ESC G 1` / `text-decoration:line-through` + penanda teks `[VOID]`, banner **TRANSAKSI DIBATALKAN** untuk bon void. Akuntansi: seluruh agregasi halaman kini memfilter `status='completed'` (Dashboard, Reports, Branches, POS/POSShifts, Cashflow, Piutang, totals riwayat) — angka pendapatan berubah bukan karena bug, tapi karena void tidak lagi dihitung. Unit: `src/lib/__tests__/void.test.ts` (16 tes) + tambahan di `receipt-doc`/`zreport-doc`/`escpos`/`html-render` |
| 2026-11-06 | `1340350` | **Sistem cetak struk & Z-report** (`src/lib/print/*`, tanpa dependency baru): `document.ts` (model `PrintDoc` + `PAPER_WIDTHS`/`normalizePaperWidth`), `html-render.ts` (iframe tersembunyi, ukuran font dihitung dari jumlah kolom agar 32–48 kolom benar-benar muat), `escpos.ts` (encoder byte in-house: `ESC @`, `ESC a`, `ESC E`, `GS !`, `GS V B 0` cut, `ESC p 0 25 250` kick drawer, rupiah ASCII), `print-bridges.ts` + `print-service.ts` (mode driver/usb/bluetooth, fallback `.prn`, `PrintResult` tak pernah melempar), `receipt-doc.ts`/`zreport-doc.ts`/`receipt-printer.ts`. Integrasi: auto-print setelah checkout di `POS.tsx`, Z-report saat tutup shift & reprint di `POSShifts.tsx`, tombol Printer + dialog Cetak Struk di `POSTransactions.tsx`, Seksi **Printer & Koneksi** di `ReceiptSettings.tsx` (mode, lebar 58/60/72/76/80mm, `requestDevice`, Cetak Tes) — preferensi di `settings.printer`/`settings.receipt`. Rekonsiliasi bucket Z-report diperbaiki (`card←{card,debit,credit}`, `ewallet←{…}`, bucket **Lainnya** agar rincian = TOTAL). Unit: `escpos`/`receipt-doc`/`zreport-doc`/`html-render` |
| 2026-11-06 | — (working tree) | **POS: satu sumber cabang**. Hook baru `src/hooks/use-pos-branch.ts` memuat daftar cabang sekali (query TanStack `['pos-branches']`) dan menentukan cabang aktif dengan prioritas `session.branchId → user.assigned_branch_id → cabang pertama in-scope → baris pertama` (baris terakhir hanya untuk scope penuh — scope kosong berarti *tidak* ada cabang, bukan "apa pun"), dengan pilihan manual per user lewat `useSyncExternalStore` (bukan localStorage). `POS.tsx`, `POSShifts.tsx`, `layout/POSLayout.tsx` membacanya dari satu tempat, jadi shift yang dibuka di meja shift selalu terlihat oleh till; pemilih cabang muncul bila user punya lebih dari satu cabang in-scope, dan buntu "Sesi tidak lengkap" diganti state kosong yang menjelaskan + tombol Muat Ulang. Unit: `src/hooks/use-pos-branch.test.ts` (7 kasus prioritas) |
| 2026-11-06 | — (working tree) | **Buka/tutup shift = absensi otomatis** (`src/lib/shift-attendance.ts`, best-effort): `autoCheckInForShift()` membaca dulu baris `attendance` hari berjalan WIB lalu menyisipkan bila kosong (`status='present'`, `source='self'`, `location_type='branch'`, `notes='Otomatis dari buka shift'`); `autoCheckOutForShift()` mengisi `check_out` hanya yang masih NULL. Keduanya mengembalikan `{ ok, changed }` sehingga toast tidak mengklaim "absensi tercatat" ketika barisnya memang sudah ada; kegagalan tulis absensi hanya `toast.warning` dan tidak membatalkan shift. `AttendanceCheckIn.tsx` ikut menyeleksi `notes` dan menampilkannya di bawah badge Masuk/Keluar supaya asal baris terbaca. Unit: `src/lib/db/__tests__/shift-attendance.test.ts` (7 kasus, replay SQL ke DB sementara skema v8) |
| 2026-11-06 | — (working tree) | **Kasir dibatasi ke transaksi saja**: `view_dashboard` dicabut dari default `cashier` di `src/config/roles.ts` **dan** dari snapshot `role_permissions` di `db/schema/seed.sql` — seed menyimpan matriks penuh sehingga pencabutan di kode saja tidak sampai ke tenant yang settings-nya sudah terbaca (merge per key: nilai eksplisit menang). Guard `/pos/transactions` kini `guardedAny(["access_pos", "view_dashboard", "view_inventory"])` agar buku transaksi till sendiri tetap terbuka. Uji: `db/__tests__/seed.test.ts` menambah penjaga bahwa seed tidak boleh bertentangan dengan `DEFAULT_ROLE_PERMISSIONS` |
| 2026-11-06 | — (working tree) | **Notifikasi & state error POS** (`ShiftModal.tsx`, `POS.tsx`): petty cash kosong/`0` sah dengan tombol cepat `Rp0 (tanpa tunai)` dan pesan "tanpa uang tunai awal"; toast "berhasil" dipindah ke pemanggil setelah tulis DB (sebelumnya modal menutup dengan toast kemenangan prematur); `fetchBranches`/`fetchProducts` tidak lagi diam di `console.error` — ada banner "Gagal memuat data" + tombol Coba lagi dan toast berisi pesan asli; sebelum shift dibuka yang tampil banner blocking di atas grid ("Shift belum dibuka — transaksi tidak bisa diproses") beserta tombol Buka Shift, bukan redirect senyap; pesan stok saat bayar menyebut nama produk dan sisa stok. Perbaikan terpisah di `src/hooks/use-permissions.ts`: query grants di-*disable* selama `/api/tenant/bootstrap` belum menjawab, dan TanStack melaporkan itu sebagai `isLoading: false` tanpa data — `ModeSelect` membacanya sebagai "role tidak dikenali" sehingga setiap hard reload menampilkan panel "Belum ada layar untuk Anda" yang menyinggung, lalu `RoleBasedRoute` bisa memantul ke /mode-select untuk layar yang justru boleh dibuka. `loading` kini berarti "belum ada jawaban dan belum ada bacaan yang berjalan" (`data === undefined && (!getTenantSession() \|\| isLoading)`), jadi yang muncul adalah "Memuat hak akses…" |
| 2026-11-06 | — (working tree) | **POS responsif**: grid produk `grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5`; di bawah `lg` keranjang menjadi bar ringkas lengket (jumlah item + total + Bayar) yang membuka `Dialog` berisi baris yang sama, jadi grid tetap punya satu layar penuh; `POSShifts.tsx` riwayat shift jadi kartu di `<md` dan form satu kolom penuh; `POSTransactions.tsx` filter vertikal di mobile, baris transaksi jadi kartu, dialog detail layar penuh; semua dialog POS `max-w-[95vw]`, input pencarian `text-base` (tanpa zoom paksa di mobile), target sentuh `size="pos"` ≥44px dipertahankan. Spot-check viewport (Playwright, 390/662/768/820/1024/1440) menemukan tiga cacat yang ikut diperbaiki: header `POSLayout` 855px pada 820px (tab nav + label cabang pindah ke `lg`, bar navigasi lengket jadi `lg:hidden`, grup kiri `min-w-0` + cabang `truncate` sehingga tombol aksi tidak lagi mendorong header keluar layar), tabel 8 kolom `POSTransactions` yang di-clip `overflow-hidden` antara `md`–`lg` (kini `overflow-x-auto`), dan kartu statistik yang tidak bisa menyusut di bawah ±220px karena `Rp 113.063.000` memakai nbsp (kini `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`). Hasil ukur: `document.scrollWidth == innerWidth` di semua lebar, tanpa scroll menyamping di `main` |
| 2026-11-06 | — (working tree) | **Izin khusus per karyawan (restrict-only) + tab Role responsif**. Resolver `permission-matrix.ts` menambah `effectiveUserPermissions(grant, restrictions)` dan `roleGrantedKeys()`; cache kembar `['tenant-user-permissions']` (`UserPermissionOverrides`, dipetai `userId→{key:false}`) di samping cache `grants` yang bentuknya tak berubah, sehingga seorang karyawan bisa dicabut sebagian izin role-nya tetapi **tidak pernah** ditambah (hanya `false` berarti, ditegakkan di resolver). Layar Karyawan: komponen `employees/IndividualPermissionEditor.tsx` + aksi baris "Izin khusus" (Shield, `can('edit_employee')`, disembunyikan untuk diri sendiri), badge "N pengecualian", hapus karyawan membersihkan entri via `clearUserPermissionOverrides`, audit `update_employee_permissions`. `bootstrap` kini memakai `readTenantAccess` (satu baca settings) dan mengembalikan slice `userPermissions` pemanggil; `TenantContext` men-seed query baru itu. Tab Role `EmployeeRoleSettings.tsx`: daftar role jadi **strip geser horizontal** di `md`/`lg` (satu kolom, tak lagi overflow vertikal di layar pendek), master/detail berdampingan tetap hanya di `xl`, `Sheet` mobile tak berubah. Uji: unit `effectiveUserPermissions` (5 kasus) + `tests/permissions.e2e.ts` "per-employee permission exceptions" |
| 2026-11-05 | — (working tree) | **Absensi geolokasi & pengenal wajah (skema v8)**. Library baru: `src/lib/geolocation.ts` (`getCurrentCoords`, `haversineMeters`, `withinRadius`, `formatDistance`) dan `src/lib/face.ts` (`@vladmandic/face-api` dimuat lazy, `captureDescriptor`, encode/decode descriptor 128-float, `bestMatch`) + `src/lib/workplace.ts` (daftar cabang/gudang ber-koordinat). Layar baru: `/absen` (`AttendanceCheckIn.tsx`, self-service, hard-block di luar radius & wajah tak cocok, kartu "Absensi/Presensi" selalu tampil di `ModeSelect`), `/backoffice/hr/face` (`FaceEnrollment.tsx`, owner mendaftarkan 4 sampel wajah → descriptor, hapus data). Dialog Cabang & Gudang menambahkan input lat/lng + radius + tombol "Pakai GPS sekarang" + switch `require_geo`/`require_face`. `EmployeeReports.tsx` menampilkan kolom Sumber/Lokasi/Geo/Wajah (di tabel & ekspor XLSX) dan capture GPS opsional di jalur override owner. Kunci izin baru `manage_attendance`. Model face-api di-vendor ke `public/models/`. Jarak & kecocokan dihitung di perangkat (audit, bukan paksaan DB); kamera/GPS butuh secure context |
| 2026-11-05 | — (working tree) | `EmployeeReports.tsx` (Absensi & Libur): field Tanggal modal Tambah Absensi dikunci read-only ke hari berjalan WIB (`attendanceToday()`, UTC+7 — sejalan dengan trigger `trg_attendance_today_only` di skema v7), dengan validasi ganda sebelum insert; tab Libur mengganti array statis 2026 dengan `src/lib/holidays.ts` (API Tanggal Merah per tahun + fallback bawaan) lewat TanStack Query, lengkap pemilih tahun, badge Libur Nasional/Cuti Bersama, dan banner saat fallback dipakai |
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
| Berkas uji | `tests/**/*.e2e.ts` — **14 berkas: 78 `test` + 1 `test.setup`** (dihitung dari jumlah `test(`/`test.setup(` per berkas, terukur 2026-11-19) yang mengembang satu per akun (6), jadi **84** saat dijalankan penuh: `login` 3, `auth.setup` 1(+6), `owner` 9, `admin` 4, `kasir` 5, `gudang` 4, `rbac` 16, `permissions` 7, `bulk-import` 11, `pos-printing` 3, `vendor-catalog` 4, `chat` 8, `payment-channels` 2, `storefront-order` 2. Runner hanya mengeksekusi setup untuk sesi yang benar-benar dipakai berkas yang diminta — `npx e2e run tests/auth.setup.e2e.ts tests/chat.e2e.ts` dilaporkan sebagai `auth.setup.e2e.ts (2 tests)`, bukan 6 |
| Konfigurasi | `e2e.config.ts` |
| Akun uji | Blok `credentials` di `e2e.config.ts` (`owner`, `admin`, `manager`, `kasir`, `gudang`, `purchasing`), diselesaikan lewat `signIn()` di `tests/support/accounts.ts`; dibuat oleh `npm run e2e:users` |
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
11. **Teks yang sama boleh muncul dua kali di DOM kalau itu responsif.** Layar POS menyimpan
    ringkasan keranjang di dua tempat (panel samping `hidden lg:flex` dan bar lengket `lg:hidden`),
    sehingga `getByText('1 item')` menabrak aturan "tepat satu node". Ada dua pola untuk ini:
    (a) filter visibilitas — `getByText('1 item', { visible: true })` — cocok bila node tersembunyi
    hanya alternatif tampilan;
    (b) scope ke container semantik — `getByRole('table').getByText('Bayu Pratama', { exact: true })`
    — cocok bila kedua node hidup di wilayah berbeda ( Employees table + card) dan maksud tes hanya
    memverifikasi salah satu. Pilih (b) bila viewport tidak dijamin; pilih (a) untuk kesederhanaan.
12. **Layout responsif diverifikasi dengan pengukuran, bukan tatapan.** Selain spot-check manual,
    lebar 390/662/768/820/1024/1440 diuji lewat `playwright-core` (chromium milik `ms-playwright`,
    tanpa paket `playwright`) yang membandingkan `document.documentElement.scrollWidth` dengan
    `innerWidth` dan mencari elemen yang `getBoundingClientRect().right` melewati viewport. Itulah
    cara cacat header `POSLayout` (855px pada 820px) ditemukan; angka scroll, bukan estetika, yang
    memutuskan sebuah perubahan responsif lulus.
13. **`npm run dev` + e2e menunjuk tenant demo cloud, bukan `.data/demo/thalia.db`.** Baris
    `tenant_databases` untuk slug `thalia` menyimpan `db_hostname` Turso cloud, jadi database file
    lokal dan shim `dev:db` :8090 tidak berada di jalur itu — id produk pun berbeda. Konsekuensinya:
    `tenants.settings` adalah **snapshot**, sehingga perubahan default izin (atau `pricing.auto_pack_price`)
    tidak sampai ke tenant yang diuji hanya dengan mengubah `src/config/roles.ts`. Kalau tes gagal
    tanpa sebab di kode, jajak settings tenant lebih dulu; perbaiki non-destruktif dengan
    menghapus key yang kedaluwarsa (mis. `role_permissions.cashier.view_dashboard`) — `npm run
    demo:cloud` juga bisa, tetapi ia mengganti data demo dan mewajibkan `npm run e2e:users` lagi.

14. **Assertion database harus mengikuti plane yang sama dengan aplikasi.** Aturan 13 di atas punya
    konsekuensi praktis: `.env` bisa menyimpan `CONTROL_DB_URL` Turso cloud sementara tenant yang
    benar-benar dipakai SPA terdaftar di control DB file (`local-thalia` → shim `:8090` →
    `.data/demo/thalia.db`), dan membaca `CONTROL_DB_URL` mentah menghasilkan tes yang "berhasil di
    layar, gagal di database". `tenantClient()` di `tests/support/db.ts` sekarang mengenali
    `file:`/loopback lewat `isLocalDatabase()` dan connect **tanpa** token platform untuk itu. Dua
    jebakan yang terbukti: `process.loadEnvFile()` **tidak** menimpa variabel shell yang sudah di-set
    (jadi `$env:CONTROL_DB_URL='file:.data/control.db'` memang menang), dan
    `npm run schema:apply-all` hanya tahu cara mint token Turso — plane lokal tidak bisa di-migrate
    lewat runner itu, tapi `npm run demo:local` menerapkannya ulang dari `tenant.sql`.
15. **`role="combobox"` pada `<Button>` menampilkan isinya sebagai *value*, bukan *name*.**
    `getByRole('combobox', { name: 'Pilih produk...' })` tidak akan pernah cocok
    (`combobox expandable haspopup="dialog" value="Pilih produk..."`). Yang bisa: asosiasi
    `<Label htmlFor>` (maka `#product-category`, `#product-supplier`), atau id pada pemicunya
    (`#po-vendor`, `#po-product-picker`, `#vendor-product-import-file`). Konsekuensi lain: input file
    yang `hidden` tidak muncul di pohon aksesibilitas, jadi tes menyerahkan sheet ke inputnya langsung
    lewat `setInputFiles` alih-alih menekan tombol yang membuka picker OS.
16. **Satu tes impor harus bersih saat dimulai.** Kebijakan "master aditif" berarti baris yang sudah
    ada tidak pernah ditimpa, termasuk telepon yang sengaja diubah tes lain — jadi
    `tests/vendor-catalog.e2e.ts` menyapu universe fixture (`purgeFixtureRows()`, termasuk vendor sisa
    percobaan yang gagal di tengah jalan) sebelum kasus pertama, dan kasus re-import tetap membuktikan
    harganya mengikuti sheet.
17. **Kalau view Browser IDE tersembunyi, `take_screenshot` gagal — dan itu bukan kegagalan aplikasi.**
    `browser-use` membalas `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE (visible=false, visibilityState=hidden)`
    selama panel Browser tidak terlihat di layar, dan `click` pada elemen di dalam popover bisa `Timed out`.
    Bukti visual tetap bisa didapat tanpa itu: jalankan chromium milik `ms-playwright` lewat
    `playwright-core` (`executablePath` = `…\ms-playwright\chromium-<rev>\chrome-win64\chrome.exe`,
    `headless: true`, viewport 1440×900) dan tulis PNG ke `.data/evidence/` — skripnya di
    `.data/evidence.mjs`, artefaknya tidak ikut di-commit. Untuk periksa **isi** layar, `take_snapshot`
    dan `evaluate_script` tetap jalan tanpa view yang terlihat; catatan: item `cmdk` tidak muncul di
    pohon aksesibilitas, jadi baca `[cmdk-item]` lewat DOM. Assertions tetap milik
    `tests/*.e2e.ts`, bukan skrip bukti.
18. **Nama aksesibilitas baris rail dibaca dari field yang salah kalau tidak dicek dulu.** Baris percakapan chat punya nama kombinasi `"<inisial avatar> <nama> <HH.mm> <preview>"` — inisial avatar **mendahului** nama, jadi `getByRole('button', { name: /^Surya/ })` tidak cocok sementara `/Surya/` cocok. Aturan turunannya: setiap locator yang dibangun dari teks gabungan diuji dengan menyalin nama persis dari `screen-at-failure.txt` (pohon aksesibilitas), bukan dari perkiraan; `toBeHidden()` lolos pada nol node, sehingga ia **bukan** bukti bahwa sebuah label tidak muncul — yang membuktikan adalah pola regex positif.
19. **Kesamaan `chat_conversations.name` dan `chat_messages.body` membuat jajak teks tidak ambigu.** Satu fixture dapat memuat dua channel dengan baris preview yang identik, sehingga jajak `WHERE name = …` / `WHERE body = …` bisa mengembalikan baris milik channel lain. Yang dipakai di `tests/chat.e2e.ts`: kunci **id** (`WHERE id = ?` / `WHERE conversation_id = ?`), dan identifier fixture diberi prefiks khas. Bila sebuah tes "lulus tapi angka tidak masuk akal", curigai jajak yang menyaring pada kolom teks lebih dulu.
20. **Verifier yang membandingkan dua sumber bisa gagal tanpa salah duanya benar-benar berbeda.** Pada kasus `keepPreviousData` (KS-53), pane menampilkan `#e2e-chat` sementara pesan benar-benar tertulis ke `operasional-toko` — keduanya terbaca "benar" bila diperiksa sendirian. Karena itu assertion e2e untuk jalur tulis selalu berpasangan: **satu** assertion layar (`getByText('#e2e-chat')` **sebelum** mengetik, agar identitas pane dikunci sebelum ada yang ditulis) + **satu** assertion database lewat id, bukan teks.

21. **Pratinjau rencana diuji per baris tabel, bukan per teks dialog.** `expect(preview).toContainText('1 varian baru')` lulus walaupun tabel rencananya kosong, karena `DialogDescription` sudah memuat angka itu — dan angka ringkasan justru dihitung dari data yang sama yang disembunyikan tabelnya (KS-60). Yang membuktikan baris benar-benar dirender: `preview.getByRole('row').filter({ hasText: 'varian baru' })` lalu `toHaveCount(2)`, dengan `toHaveCount(0)` untuk sisi negatifnya (impor ulang dan round-trip ekspor). Dua turunannya: (a) teks yang diuji adalah teks yang dirender — untuk varian yang belum ada di database pratinjau menamai dari **nilai** atributnya (`nanas`), bukan dari `Kode Varian`/`Vendor SKU` di sheet; (b) tes yang berbagi tenant dengan tes sebelumnya tidak tahan retry kalau prasyaratnya dinyatakan sebagai **angka hasil** (`before.variants === 4`) — nyatakan sebagai kebutuhan yang harus belum terjadi (`Rasa=Nanas` belum ada) dan tulis nama kasus yang wajib jalan lebih dulu di pesan assertion-nya, karena percobaan pertama yang sudah menulis membuat percobaan berikutnya gagal dengan angka yang tidak menjelaskan apa pun.

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
| Perhitungan | `src/lib/permission-matrix.ts` | murni (tanpa React, tanpa SQL; ikut dipakai `server/roles.ts`): `buildGrants(settings)`, `grantForRole`, `effectivePermissions`, `effectiveUserPermissions(grant, restrictions)` (restrict-only per karyawan — hanya `false` mencabut, `true` disimpan diabaikan), `roleGrantedKeys(grant)`, `makeChecker`, `permissionRole` (alias `admin` → `tenant_admin`), `inScope`/`branchInScope`/`warehouseInScope`, `effectiveBranchScope`, `effectiveWarehouseScope` |
| Pemakaian | `src/hooks/use-permissions.ts` | `usePermissions()` → `{ can, granted, scope, loading, role, roleLabel, roleGranted, removedKeys }`; `usePermission(key)`, `useBranchScope()`, `useWarehouseScope()`, `useTenantUserPermissionsQuery()`, `useInvalidateTenantSettings()`, `useInvalidateTenantUserPermissions()` |

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
6. **Deklarasi ≠ penegakan.** Kunci yang muncul di `PERMISSION_CATALOG` hanya berpengaruh kalau
   ada yang membacanya — guard route (`permission`/`anyOf`), item `nav-items.ts`, `can(key)` di
   layar, atau aturan bisnis di modul murni. Hari ini tepat satu kunci belum punya konsumen:
   `stock_opname` (dinyatakan dan default `true` untuk `warehouse`, tidak dibaca kode mana pun) —
   layar opname sendiri terbuka lewat `view_inventory`. Jadi klaim "satu katalog jadi sumber
   tunggal" berlaku untuk **penyimpanan & tampilan matriks**, bukan untuk jaminan bahwa setiap
   sakelar benar-benar menggembok sesuatu.

Cara menambah izin baru: satu entri di `PERMISSION_CATALOG` (key, label, hint) + nilai default
di `DEFAULT_ROLE_PERMISSIONS` untuk peran yang berhak. Guard route, sidebar, pratinjau role,
dan tes katalog membaca dari sana, jadi tidak ada daftar kedua yang bisa tertinggal.

Cara **mencabut** default: `db/schema/seed.sql` menyimpan snapshot `role_permissions` untuk tenant
baru, dan dokumen itu **boleh kurang kunci** (yang ditulis hanya yang ada saat seed disusun —
owner-tier 18 kunci, `store_manager` 10, `warehouse` 4, `cashier` 2, `staff` 0, dari 33 kunci
katalog sejak v11 — dua kunci `collaboration` memang belum tertulis di snapshot itu, dan itu
boleh karena resolver menggabung per kunci: kunci yang tidak ditulis memakai default kode.
Yang tidak boleh adalah **membantah**: kunci yang ditulis harus sama nilainya dengan
`DEFAULT_ROLE_PERMISSIONS`, dan `db/__tests__/seed.test.ts` menguji dua arah itu. Karena itu
mencabut izin dari satu tempat saja tidak lengkap — kalau seed masih menulis `true`, tenant baru
kembali mendapat izin itu di belakang default kode (lihat kasus `cashier.view_dashboard`).

Bentuk penyimpanan `role_permissions` / `custom_roles` / `role_scopes` dan batas
`mergeTenantSettings` (satu level, last-write-wins) dijelaskan di
[backend.md](backend.md) §5.11; endpoint tulisnya (`/api/admin/users`,
`/api/admin/users/[id]`) juga di sana.

Tidak semua kunci izin menjaga sebuah **route**. Sebagian menjaga **tombol di dalam layar**, dan
kunci semacam itu tidak muncul di peta route §3: `apply_discount` dan `void_transaction` di POS /
Riwayat Kasir, `create_po`/`approve_po`/`receive_po`/`cancel_po` di layar PO, `export_reports` di
tombol ekspor. Polanya selalu sama — `PermissionGate`/`can(key)` untuk UI, aturan bisnisnya sendiri
hidup di modul murni (`src/lib/void.ts`, `src/lib/procurement.ts`, `src/lib/branch-orders.ts`) agar
bisa diuji tanpa React dan tidak bisa dilewati oleh komponen yang lupa memanggil `can`.

