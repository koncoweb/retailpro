# Frontend RetailPro

| | |
|---|---|
| Dokumen | `docs/frontend.md` |
| Terakhir diperbarui | **2026-10-27** |
| Stack | React 18 + Vite 5 + TypeScript, shadcn/ui, Tailwind, React Router 6 |
| Bahasa UI | Indonesia (label, pesan, format Rupiah) |

> Dokumen ini tentang **lapisan tampilan**. Alur data lintas lapisan ada di
> [arsitektur.md](arsitektur.md), detail query di [backend.md](backend.md).

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
| Test | `npm run test` (Vitest; 7 file, 79 test) |

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
    settings/{Receipt,TaxDiscount,Bank,EmployeeRole,Inventory}Settings.tsx
    ui/*                   shadcn/ui (54 komponen) + pagination-bar.tsx
  pages/                   Satu file per layar (lihat §3)
```

---

## 3. Peta route

Semua route terautentikasi dibungkus dua lapis: `RoleBasedRoute` (boleh atau tidak) dan
`RequireTenant` (database tenant siap atau belum).

| Path | Komponen | Peran yang diizinkan |
|---|---|---|
| `/login` | `auth/Login` | publik |
| `/register-tenant` | `auth/RegisterTenant` | publik (butuh sesi) |
| `/mode-select` | `ModeSelect` | semua |
| `/pos` | `POS` | platform_owner, tenant_owner, tenant_admin, store_manager, cashier, admin |
| `/pos/transactions` | `POSTransactions` | semua peran |
| `/pos/shifts` | `POSShifts` | front office (tanpa warehouse/staff) |
| `/backoffice` | `Dashboard` | back office + store_manager |
| `/backoffice/vendors` | `vendors/Vendors` | back office |
| `/backoffice/vendors/:id` | `vendors/VendorDetail` | back office |
| `/backoffice/crm/suppliers` | `vendors/Vendors` (alias lama) | back office |
| `/backoffice/crm/customers` | `crm/Customers` | back office |
| `/backoffice/branches` | `Branches` | managers (tanpa cashier) |
| `/backoffice/warehouses` | `Warehouses` | managers (tanpa cashier) |
| `/backoffice/branches/dashboard` | `branches/Dashboard` | managers |
| `/backoffice/branches/transfer` | `BranchTransfers` | managers |
| `/backoffice/inventory/{products,stock-in,opname,po}` | `Inventory` | back office |
| `/backoffice/finance/journal` | `finance/Journal` | back office |
| `/backoffice/finance/ap-ar` | `finance/ApAr` | back office |
| `/backoffice/finance/cashflow` | `finance/Cashflow` | back office |
| `/backoffice/finance/expenses` | `finance/Expenses` | back office |
| `/backoffice/hr/employees` | `Employees` | HR only |
| `/backoffice/hr/attendance` | `EmployeeReports` | HR only |
| `/backoffice/hr/schedule` | `Employees` | HR only |
| `/backoffice/hr/payroll` | `EmployeeReports` | HR only |
| `/backoffice/reports` | `Reports` | back office |
| `/backoffice/reports/{sales,inventory,finance}` | `SalesReport`, `InventoryReport`, `FinanceReports` | back office |
| `/backoffice/settings` | `Settings` | HR only |
| `*` | `NotFound` | – |

Catatan: empat route inventori memakai satu komponen yang sama (`Inventory`) dan memilih tab dari
path; `attendance`/`payroll` juga berbagi satu halaman, begitu pula `employees`/`schedule`.

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
