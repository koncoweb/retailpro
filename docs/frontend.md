# Frontend RetailPro

| | |
|---|---|
| Dokumen | `docs/frontend.md` |
| Terakhir diperbarui | **2026-10-31** |
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
| Test | `npm run test` (Vitest; **13 file, 161 test**) |
| Test E2E | `npm run test:e2e` (tester.army; `tests/**/*.e2e.ts`, butuh dev server `:8080` dan kunci model di `.env` — lihat §12) |
| Toko online | `cd tokoonline && npm run dev` → port **8082**, `VITE_CATALOG_API_URL` (bawaan `http://localhost:3000`) |

---

## 2. Struktur folder

```
src/
  App.tsx                  Tabel route + guard
  main.tsx                 Bootstrap React
  contexts/TenantContext.tsx  Bootstrap tenant, RequireTenant
  hooks/                   use-auth, use-mobile, use-theme, use-toast
  config/roles.ts          Daftar role, grup izin, izin default
  types/index.ts           Tipe domain
  lib/
    db/                    query, runTransaction, batchQuery, translate, json
    tenant-session.ts      Penyimpan token di memori
    tenant-settings.ts     Baca/merge settings tenant (+ getStockIssueMethod)
    warehouse.ts           Gudang cabang: resolveBranchWarehouse, resolveWarehouseBranch
    stock-issue.ts         Kebijakan FIFO/LIFO/FEFO: comparator + sortBatchesForIssue
    stock-movement.ts      Satu-satunya penulis perpindahan stok (transfer, kirim, terima, batal)
    branch-orders.ts       Mesin status pesanan cabang: canPerform, validate*, nextOrderNumber
    vendor.ts              Kode vendor, termin, kategori, saldo hutang
    audit.ts               logAudit / logAuditTx
    date-range.ts          Rentang periode laporan + koreksi zona waktu
    formatters.ts          formatRupiah, formatTanggal
    inventory-utils.ts     SKU otomatis, validasi barcode
  components/
    auth/RoleBasedRoute.tsx
    layout/{POSLayout,BackOfficeLayout,Header,Sidebar}.tsx
    dashboard/*            Kartu statistik, grafik, modal detail
    inventory/*            AddProduct, StockTransfer, StockOpname, PurchaseOrder, Import/Export
    pos/{PaymentModal,ShiftModal}.tsx
    branches/BranchDetailModal.tsx
    vendors/*              Daftar & detail vendor
    settings/{Receipt,TaxDiscount,Bank,EmployeeRole,Inventory}Settings.tsx
    ui/*                   shadcn/ui (51 komponen, termasuk pagination-bar.tsx)
  pages/                   Satu file per layar (lihat §3)
```

Di luar SPA ini ada aplikasi kedua, `tokoonline/` (TanStack Start, React 19, Tailwind v4), yang
punya `package.json` dan `node_modules` sendiri — lihat §11.

---

## 3. Peta route

Semua route terautentikasi dibungkus dua lapis: `RoleBasedRoute` (boleh atau tidak) dan
`RequireTenant` (database tenant siap atau belum).

| Path | Komponen | Grup peran yang diizinkan |
|---|---|---|
| `/login` | `auth/Login` | publik |
| `/register-tenant` | `auth/RegisterTenant` | publik (butuh sesi) |
| `/mode-select` | `ModeSelect` | semua |
| `/pos` | `POS` | `FRONT_OFFICE` |
| `/pos/transactions` | `POSTransactions` | `ALL_ROLES` |
| `/pos/shifts` | `POSShifts` | `FRONT_OFFICE` |
| `/backoffice` | `Dashboard` | `BACK_OFFICE` |
| `/backoffice/vendors` | `vendors/Vendors` | `BACK_OFFICE` |
| `/backoffice/vendors/:id` | `vendors/VendorDetail` | `BACK_OFFICE` |
| `/backoffice/crm/suppliers` | `vendors/Vendors` (alias lama) | `BACK_OFFICE` |
| `/backoffice/crm/customers` | `crm/Customers` | `BACK_OFFICE` |
| `/backoffice/branches` | `Branches` | `MANAGERS` |
| `/backoffice/warehouses` | `Warehouses` | `STOCK_DOCS` |
| `/backoffice/branches/dashboard` | `branches/Dashboard` | `MANAGERS` |
| `/backoffice/branches/transfer` | `BranchTransfers` | `STOCK_DOCS` |
| `/backoffice/branches/orders` | `BranchOrders` | `STOCK_DOCS` |
| `/backoffice/inventory/{products,opname}` | `Inventory` | `STOCK_DOCS` |
| `/backoffice/inventory/{stock-in,po}` | `Inventory` | `BACK_OFFICE` |
| `/backoffice/finance/{journal,ap-ar,cashflow,expenses}` | `finance/*` | `BACK_OFFICE` |
| `/backoffice/hr/{employees,schedule}` | `Employees` | `HR_ONLY` |
| `/backoffice/hr/{attendance,payroll}` | `EmployeeReports` | `HR_ONLY` |
| `/backoffice/reports` | `Reports` | `BACK_OFFICE` |
| `/backoffice/reports/{sales,inventory,finance}` | `SalesReport`, `InventoryReport`, `FinanceReports` | `BACK_OFFICE` |
| `/backoffice/settings` | `Settings` | `HR_ONLY` |
| `*` | `NotFound` | – |

Grup peran (didefinisikan di `src/App.tsx`):

| Grup | Isi |
|---|---|
| `ALL_ROLES` | 7 peran resmi + alias `admin` |
| `FRONT_OFFICE` | platform_owner, tenant_owner, tenant_admin, store_manager, cashier (+ `admin`) |
| `BACK_OFFICE` = `MANAGERS` | platform_owner, tenant_owner, tenant_admin, store_manager (+ `admin`) |
| `STOCK_DOCS` | `MANAGERS` + `warehouse` — dokumen stok saja |
| `HR_ONLY` | platform_owner, tenant_owner, tenant_admin (+ `admin`) |

Catatan: empat route inventori memakai satu komponen yang sama (`Inventory`) dan memilih tab dari
path; `attendance`/`payroll` juga berbagi satu halaman, begitu pula `employees`/`schedule`.
`STOCK_DOCS` memisahkan staf gudang (boleh menghitung stok, menyetujui & mengirim pesanan) dari
stok masuk dan PO yang tetap `BACK_OFFICE`.

---

## 4. Shell & navigasi

| Komponen | Peran |
|---|---|
| `POSLayout` | Layar kasir: katalog + keranjang, tanpa sidebar back office |
| `BackOfficeLayout` | Sidebar + header + area konten |
| `Sidebar` | Menu per seksi (POS, Dashboard, Cabang, Gudang, Inventori, Keuangan, SDM, Laporan, Pengaturan) |
| `Header` | Judul halaman, indikator pengguna, pemilih cabang (hanya untuk peran yang boleh lintas cabang) |
| `ModeSelect` | Pintu masuk setelah login: POS atau Back Office |
| `pagination-bar.tsx` | Komponen pagination bersama (halaman, ukuran, jumlah) |

---

## 5. Alur identitas di UI

```
Login → authClient (cookie) → useAuth() ambil session
      → TenantProvider.bootstrap  → status: idle | loading | ready | no-tenant | error
            ready      → buka libSQL client (token di memori)
            no-tenant  → arahkan ke /register-tenant
            error      → tampilkan layar gagal + tombol coba lagi
      → RoleBasedRoute: role tidak dikenal → /login (gagal-tertutup)
      → RequireTenant: belum ready → spinner, halaman tidak pernah mount tanpa client
```

`useAuth()` memetakan field session Better Auth (`tenantId`, `branchId`, `role`) ke nama field
lama yang dibaca halaman (`tenant_id`, `assigned_branch_id`), sehingga kode halaman lama tetap
jalan tanpa diubah.

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
| Audit | `lib/audit.ts` | `logAudit` (best effort) dan `logAuditTx` (ikut rollback) |
| Notifikasi | `ui/toast`, `ui/sonner` | Dua jalur toast; pesan sukses/gagal berbahasa Indonesia |

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

---

## 10. Log perubahan frontend

| Waktu | Ref | Perubahan |
|---|---|---|
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

| Aspek | Nilai |
|---|---|
| Route file | `/`, `/katalog`, `/product/$slug`, `/cart`, `/checkout`, `/orders`, `/order/$id`, `/chat`, `/info` |
| Sumber data | `src/lib/catalog.ts` (`useCatalog`, `useProduct`) → `GET /api/storefront/catalog?slug=` |
| Base URL API | `VITE_CATALOG_API_URL` (bawaan `http://localhost:3000`) — **dipanggang saat build** |
| Penyimpanan | Keranjang & pesanan di `localStorage` (kunci `thalia-storefront`); tidak menulis ke DB tenant |
| Branding | Thalia — Toko Bahan Kue; kode pesanan `THL-…` |
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
| Berkas uji | `tests/**/*.e2e.ts` — 7 berkas, 37 test: `login`, `auth.setup`, `owner`, `admin`, `kasir`, `gudang`, `rbac` |
| Konfigurasi | `e2e.config.ts` |
| Akun uji | Blok `credentials` di `e2e.config.ts` (`owner`, `admin`, `kasir`, `gudang`), diselesaikan lewat `signIn()` di `tests/support/accounts.ts` |
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

Menjalankan:

```sh
npm run dev        # terminal 1 — SPA :8080
npm run dev:api    # terminal 2 — API :3000 (perlu untuk alur login)
npm run test:e2e
```

Batasannya: model yang dipilih mendukung tool call tetapi **tidak** mendukung `responseFormat`,
sehingga `agent.extract` tidak bisa dipakai (KS-32 di [kendala-solusi.md](kendala-solusi.md)).

