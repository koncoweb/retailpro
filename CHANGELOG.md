# Changelog

Semua perubahan penting pada RetailPro didokumentasikan di sini.
Format mengikuti [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
