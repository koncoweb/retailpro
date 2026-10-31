# RetailPro — Rencana Produk & Arsitektur Multi-Tenant

| | |
|---|---|
| Dokumen | `requirement.md` |
| Terakhir diperbarui | **2026-10-28** |
| Sifat dokumen | Rencana + catatan implementasi. Bila isi dokumen berbeda dengan kode, **kode yang menang** |
| Rujukan detail | [`docs/arsitektur.md`](docs/arsitektur.md), [`docs/backend.md`](docs/backend.md), [`docs/deployment.md`](docs/deployment.md), [`docs/fitur-tenant.md`](docs/fitur-tenant.md), [`docs/fitur-platform.md`](docs/fitur-platform.md), [`docs/frontend.md`](docs/frontend.md), [`docs/kendala-solusi.md`](docs/kendala-solusi.md) |

## Riwayat revisi

| Tanggal | Perubahan |
|---|---|
| 2026-10-27 | Strategi database: *shared schema + RLS* → **satu database Turso per tenant**. Bagian 1.B ditulis ulang, alasan penolakan dicatat. Lihat `docs/kendala-solusi.md` KS-01 |
| 2026-10-27 | Autentikasi: Neon Auth → **Better Auth** pada control database; peran menjadi 7 |
| 2026-10-27 | Skema v2: cabang dipisah dari gudang (`warehouses`, `branch_warehouses`); stok tidak lagi berkunci `branch_id` |
| 2026-10-27 | Urutan pengeluaran stok dapat dipilih per tenant: `fifo` (bawaan), `lifo`, `fefo` |
| 2026-10-27 | Deployment: Neon → **Turso**; daftar environment variable diganti dengan yang benar-benar dibaca kode |
| 2026-10-27 | Alur onboarding dikoreksi: tenant langsung `active` (tidak ada persetujuan manual Platform Owner) |
| 2026-10-28 | Skema v4: pesanan cabang (`stock_requests`, `stock_request_items`) dipisah dari eksekusi (`stock_transfers`), rak toko per cabang |
| 2026-10-28 | Aplikasi kedua **`tokoonline/`** menjadi kanal penjualan online tenant; katalog berasal dari `GET /api/storefront/catalog`, tanpa kredensial database di browser pengunjung |
| 2026-10-28 | Deployment nyata: **dua proyek Vercel** + control DB dan DB tenant di **Turso cloud** (grup `ap-southeast-2`); runbook di `docs/deployment.md` |

---

## 1. Arsitektur Multi-Tenant

### A. Konsep Tenant

Setiap "Usaha" atau "Perusahaan" adalah satu **Tenant**.
*   Satu Tenant memiliki banyak **Cabang (branches)** — cabang adalah **lokasi penjualan** (toko, online, hybrid), bukan gudang.
*   Satu Tenant memiliki banyak **Gudang (warehouses)** — gudang adalah **lokasi stok** (pusat, regional, toko), boleh melayani beberapa cabang lewat tabel `branch_warehouses`.
*   Satu Tenant memiliki banyak **User (Employees)**.
*   Data antar tenant terisolasi **secara fisik** (database berbeda), bukan secara logis.

### B. Strategi Database (Database per Tenant)

Setiap tenant mendapat **database Turso/libSQL sendiri di cloud**.

*   **Isolasi fisik**: tidak ada kolom `tenant_id` di tabel mana pun dan tidak ada Row Level Security. Pemisahan terjadi karena datanya memang berada di database berbeda.
*   **Control database**: menyimpan autentikasi Better Auth (`user`, `session`, `account`, `verification`) + registry `tenant_databases` (`id`, `owner_user_id`, `slug`, `company_name`, `db_name`, `db_hostname`, `group_name`, `status`, `created_at`, `updated_at`).
*   **Provisioning**: `POST /api/tenant/provision` → `provisionTenant()` membuat database `retailpro-tenant-<slug>` di grup `TURSO_GROUP`, menerapkan `db/schema/tenant.sql` + seed, membuat cabang utama, lalu mendaftarkannya di registry dengan status `active`. Gagal di tengah → database dihapus.
*   **Grup Turso**: setiap database wajib berada di grup yang sudah ada. Organisasi baru hanya punya grup lokasi otomatis, jadi `TURSO_GROUP` diisi `ap-southeast-2` (bukan `retailpro` seperti contoh lama). `listGroups()` tersedia sebagai pemeriksaan sebelum provisioning.
*   **Akses browser**: aplikasi hanya memegang token berumur `TENANT_TOKEN_TTL` (bawaan 60 menit) yang berlaku untuk **satu** database tenant. Token organisasi Turso tidak pernah sampai ke browser.
*   **Kuota**: `TURSO_MAX_TENANT_DATABASES` (bawaan 99, mengikuti 100 database paket gratis per organisasi) → HTTP 429 bila penuh. Slug: minimal 3 karakter, unik, daftar terlarang (`www`, `api`, `admin`, …).
*   **Skema sebagai kode**: `db/schema/tenant.sql` (baseline) + `db/migrations/NNN_*.sql` (perubahan pada tabel yang sudah ada) + penanda `schema_version` di setiap database (saat ini **4**, 29 tabel). `npm run schema:apply-all` menerapkannya ke seluruh tenant.
*   **Konsekuensi yang harus diingat**: tidak ada query lintas tenant; laporan lintas cabang tetap butuh filter `branch_id` eksplisit; setiap database adalah satu unit backup/restore dan satu unit biaya.

**Ditolak — Shared Database, Shared Schema + RLS.** Rencana awal memakai satu database PostgreSQL (Neon) dengan kolom `tenant_id` di setiap tabel dan Row Level Security yang identitasnya diatur lewat session variable. Dibatalkan 2026-10-27 karena isolasinya bergantung pada klien yang mengaku sebagai tenant tertentu (`set_config` dijalankan aplikasi), kredensial database ikut ke bundle browser, dan setiap query harus ingat `WHERE tenant_id`. Pelajaran: isolasi yang ditentukan klien adalah janji, bukan batas. Lihat `docs/kendala-solusi.md` KS-01 dan `docs/arsitektur.md` ADR-1.

### C. Inventory & Stock Management

1.  **Pengeluaran Stok Otomatis (per batch)**: Pengurangan stok (penjualan, transfer keluar, opname negatif, penyesuaian manual dari form produk) mengambil data dari `product_batches` milik **gudang** terkait. Urutan batch mengikuti kebijakan per tenant di `tenants.settings.inventory.stock_issue_method`:
    *   `fifo` (bawaan) — `received_at` tertua dulu;
    *   `lifo` — `received_at` terbaru dulu;
    *   `fefo` — `expiry_date` terdekat dulu; batch tanpa expiry paling akhir.
    Kasir tidak memilih batch. Kelima jalur stok keluar memakai satu pembanding yang sama: `sortBatchesForIssue()` di `src/lib/stock-issue.ts`. Kebijakan dipilih di **Pengaturan → Inventori**.
2.  **Product Costing**:
    *   Harga modal (`products.cost_price`) adalah harga referensi/default.
    *   Harga modal aktual disimpan per batch (`product_batches.cost_price`) saat barang masuk (Stock In / PO / Opname Positif) dan disalin ke `transaction_items.cost_price` per satuan jual saat keluar.
    *   Nilai inventaris dihitung dari harga modal default untuk konsistensi tampilan; audit stok tetap mengacu pada batch.
3.  **Audit Trail**: Setiap perubahan stok (manual, import, opname, transfer, PO) dicatat di `audit_logs` dengan aksi yang sesuai (`create_product`, `stock_adjustment`, `create_transfer`, `approve_transfer`, `create_po`), termasuk `stock_issue_method` yang dipakai saat stok keluar.
4.  **Unit Conversion**: Multi-satuan per produk dengan `conversion_factor` relatif terhadap satuan terkecil (base unit); harga jual ada di `product_units.price`.
5.  **Kebijakan yang TIDAK dipakai**: average cost (AVCO) tidak diimplementasikan — AVCO adalah metode penilaian, bukan urutan pengambilan batch. Mengubah kebijakan tidak menghitung ulang histori.

## 2. Authentication & Authorization (Better Auth)

Autentikasi memakai **Better Auth** (plugin `admin`) pada **control database** Turso, bukan di database tenant. Field tambahan pada session: `tenantId`, `branchId`, `status`. Peran admin platform: `ADMIN_ROLES = [platform_owner, tenant_owner, tenant_admin]`.

### A. Hierarki User & Peran (7 peran)

| Peran | Cakupan | Catatan |
|---|---|---|
| `platform_owner` | Lintas tenant | Peran operator platform. **Belum ada konsol platform**; kemampuan saat ini = provisioning, kuota, token, `apply-schema-all`, `audit:sql` (lihat `docs/fitur-platform.md`) |
| `tenant_owner` | Satu tenant | Pemilik usaha; boleh semua menu tenant |
| `tenant_admin` | Satu tenant | Operasional penuh; boleh membuat user |
| `store_manager` | Cabang | Back office tanpa POS sebagai kasir |
| `cashier` | Cabang | POS, transaksi, shift |
| `warehouse` | Gudang | Inventori & penerimaan barang |
| `staff` | Terbatas | Akses baca area back office |

Nama `admin` masih diterima oleh guard lama sebagai alias; jangan dipakai untuk kode baru.

### B. Skema Integrasi Better Auth

1.  **Control database** (`db/schema/control.sql`): `user`, `session`, `account`, `verification` (bawaan Better Auth) + `tenant_databases` (registry).
2.  **`users` di database tenant**: cermin profil untuk keperluan laporan dan relasi lokal.
    *   `id` (TEXT, PK) — **sama dengan id user Better Auth**
    *   `email`, `name`
    *   `role` (7 peran di atas)
    *   `assigned_branch_id` (FK → `branches`, nullable)
    *   `is_active` (INTEGER 0/1)
    *   `base_salary` (INTEGER, default 0)
    *   `created_at` (TEXT ISO-8601)
    *   Tidak ada `tenant_id` — database itu sendiri sudah milik satu tenant.

## 3. Onboarding & Login

### A. Halaman Registrasi Tenant (`/register-tenant`)

*   **Field formulir (yang ada)**: nama usaha, nomor telepon, alamat lengkap, domain/subdomain (opsional), nama lengkap pemilik, email (menjadi email owner), password.
*   **Yang belum ada**: unggah logo, kirim email konfirmasi, verifikasi nomor telepon.
*   **Proses**:
    1.  Validasi input (format email, password, field wajib).
    2.  Buat akun Better Auth (owner).
    3.  `POST /api/tenant/provision` dengan `{companyName, slug, branchName: "Cabang Utama", branchAddress}`.
    4.  Status tenant langsung `active` — **tidak ada** antrean persetujuan Platform Owner.
    5.  Gagal provisioning → akun tetap ada, tetapi belum punya tenant; pengguna bisa mengulang dari halaman ini.

### B. Halaman Login Universal (`/login`)

*   Satu pintu masuk untuk semua peran; field email & password.
*   **Redirect**: akun tanpa tenant → `/register-tenant`; selain itu → `/mode-select` (pilih POS atau Back Office). Tidak ada dashboard admin terpisah.
*   **Lupa password**: tautan ada, alurnya belum diimplementasikan. Reset password dilakukan admin lewat `POST /api/admin/users/[id]/password`.

## 4. Struktur Database (Schema Design)

Kanónik: `db/schema/tenant.sql` (versi **4**, **29 tabel**) + `db/migrations/`. Detail kolom lengkap ada di `docs/backend.md` bagian 5. Konvensi: id `TEXT` UUID, uang `INTEGER` (IDR tanpa sen), kuantitas `REAL`, timestamp `TEXT` ISO-8601 UTC, boolean `INTEGER`, JSON `TEXT`.

### A. Core / Identity & Settings

1.  **`tenants`** — satu baris per database.
    *   `id`, `name`, `slug`, `created_at`
    *   `settings` (JSON teks): `role_permissions`, `payroll_config`, `receipt`, `tax`, `bank`, `inventory.stock_issue_method`
2.  **`branches`** — lokasi penjualan.
    *   `id`, `name`, `code`, `address`, `phone`, `email`, `timezone` (bawaan `Asia/Jakarta`), `status`, `sales_target`
    *   `type` (`store`/`online`/`hybrid`), `is_headquarters` (0/1), `parent_branch_id`
3.  **`warehouses`** — lokasi stok.
    *   `id`, `name` (unik), `code`, `type` (`central`/`regional`/`store`), `branch_id` (**NULL** = gudang bersama/DC), `address`, `status`, `is_default`, `created_at`
4.  **`branch_warehouses`** — pemetaan gudang mana melayani cabang mana.
    *   `branch_id`, `warehouse_id`, `is_default`, `priority`; PK `(branch_id, warehouse_id)`
5.  **`users`** — lihat bagian 2.B.

### B. Stok

*   **`product_batches`**: `warehouse_id`, `product_id`, `batch_number`, `expiry_date`, `quantity_initial`, `quantity_current`, `cost_price`, `received_at`, `supplier_id`. **Tidak ada `branch_id`** — stok selalu berkunci gudang.
*   **`stock_transfers`**: `source_warehouse_id`, `destination_warehouse_id`, `status` (`pending`/`completed`), jejak pengirim/penerima.
*   **`transfer_items`**: per leg batch (`source_batch_id`), `quantity_sent`, `quantity_received`, `cost_price` — expiry & HPP per batch ikut berpindah.
*   **`purchase_orders`** / **`purchase_order_items`**: `warehouse_id` tujuan penerimaan; status `draft`/`ordered`/`received`.
*   **`products`**, **`product_units`**, **`categories`**.
*   **Vendor** memakai `suppliers` sebagai master (kode `VND-0001`, badan usaha, kategori, NPWP, alamat terurai, termin, limit kredit, rekening bank, lead time, rating, status) plus:
    *   **`vendor_products`** — katalog N:N vendor↔produk (`vendor_sku`, `last_cost`, `lead_time_days`, `min_order_qty`, `is_preferred`); `products.supplier_id` tetap menjadi vendor utama.
    *   **`vendor_payments`** — buku pembayaran cicilan hutang (`expense_id`, `purchase_order_id`, `amount`, `payment_date`, `method`, `reference_number`). Saldo hutang tetap di `expenses.amount_paid` agar Hutang/AP tidak menghitung dua kali.
    *   Integrasi: form produk & import menautkan `vendor_products`; PO memilih vendor (bukan nama bebas) dan memo `due_date` dari termin; pembayaran di Hutang/AP menulis `vendor_payments`; ganti nama vendor otomatis berlaku di semua layar karena relasinya id.

### C. HR & Employee Management

1.  **`attendance`**: `id`, `employee_id` (→ `users.id`), `date`, `check_in`, `check_out`, `status` (`present`/`sick`/`permission`/`alpha`), `overtime`, `notes`, `created_at`. Tidak ada `tenant_id`.
2.  **`leaves`**: `id`, `employee_id`, `type` (`annual`/`sick`/`unpaid`), `start_date`, `end_date`, `reason`, `status` (`pending`/`approved`/`rejected`), `created_at`. Tidak ada `tenant_id`.
3.  **`employees`** dipertahankan hanya karena `Reports.tsx` membacanya; sumber data HR utama adalah `users` + `attendance` + `leaves`.

### D. Keuangan & POS

*   **`shifts`** — lihat bagian 7.C.
*   **`transactions`**: `branch_id`, `cashier_id`, `customer_id`, `shift_id`, `invoice_number` (unik), `total_amount`, `amount_paid`, `due_date`, `payment_method` (`cash`/`card`/`ewallet`/`credit`), `status`, `created_at`.
*   **`transaction_items`**: `quantity` dalam **satuan jual**, `unit_name`, `conversion_factor`, `unit_price`, `cost_price`, `subtotal`.
*   **`expenses`**: sumber tunggal Hutang/AP, Cashflow, dan Jurnal (termasuk penerimaan PO yang belum lunas). Tabel `payables` masih ada tetapi belum dibaca UI mana pun (KS-19).
*   **Piutang/AR** = `transactions` dengan `total_amount > amount_paid`.

## 5. Deployment & Infrastruktur (Vercel + Turso)

Runbook operasional lengkap — langkah deploy, isi `vercel.json`, verifikasi, rollback: **`docs/deployment.md`**. Bagian ini hanya mencatat keputusan.

### A. Hosting (Vercel) — dua proyek

*   **`retailpro-thalia`** (root repository): SPA React statis dari `dist/` + fungsi serverless di `api/`. URL: https://retailpro-thalia.vercel.app
*   **`thalia-storefront`** (root `tokoonline/`): TanStack Start dengan Nitro preset Vercel, keluaran `.vercel/output`. URL: https://thalia-storefront.vercel.app
*   `vercel.json`: tiga `rewrites` berurutan — `/api/auth/(.*)` → `/api/auth/[...all]`, `/api/admin/users/([^/]+)/password` → `/api/admin/users/[id]/password`, baru catch-all SPA dengan *negative lookahead* agar `/api/*` tidak ditelan `index.html`. Header keamanan (CSP) ikut dipasang dan wajib mengizinkan `https://*.turso.io` + `wss://*.turso.io`.
*   `functions["api/**/*.ts"].includeFiles` menyertakan `db/schema/**` karena `server/provision.ts` membaca `tenant.sql` & `seed.sql` saat runtime.
*   Build: `npm run build` (Vite). Build tidak menjalankan typecheck — jalankan `npm run typecheck` terpisah. Vercel tidak menjalankan `npm test` maupun `npm run audit:sql`; belum ada CI (KS-21).
*   `.vercelignore` mengecualikan `.data/`, `dist/`, `tokoonline/`, `*.log`, dan berkas `*.tsbuildinfo` dari deployment back office.

### B. Database (Turso / libSQL) — cloud

*   Control database dan database tenant **keduanya di Turso cloud**, pada grup `ap-southeast-2` (satu-satunya grup di organisasi): `retailpro-control-…` dan `rp-thalia-…`. Tidak ada salinan SQLite lokal yang dipakai produksi — `.data/*.db` hanya untuk dev.
*   Koneksi browser langsung ke database tenant memakai `@libsql/client/web` + token per tenant; tidak ada pool Postgres dan tidak ada koneksi database yang melewati fungsi serverless pada alur harian.
*   Control database menyimpan auth + registry; akses server memakai Kysely + libSQL.
*   Tidak ada RLS. Isolasi = database terpisah, dan setiap token dibatasi ke satu database.
*   Membuat/mengulang seluruh data plane cukup satu perintah: `npm run demo:cloud` (atau `-- --write-env` untuk menulis nilai ke `.env`). Skrip ini **idempoten per objek** — database dipakai ulang bila namanya sama, tetapi data tenant Thalia di-reset dan pemilik dibuat ulang (id owner berganti setiap kali jalan, lihat KS-31).

### C. Environment Variables

**Lokal**: diisi di **`.env`** (entry point Node memakai `dotenv/config`, yang hanya membaca `.env`; `.env.local` hanya dibaca Vite — lihat KS-22). **Produksi**: diisi di Vercel → Project → Settings → Environment Variables, bukan dibaca dari `.env` yang di-commit.

| Variabel | Dipakai | Wajib |
|---|---|---|
| `TURSO_API_TOKEN` | server/scripts | Ya |
| `TURSO_ORG_SLUG` | server/scripts | Ya |
| `TURSO_GROUP` | server | Tidak (bawaan di kode `retailpro`, **isi `ap-southeast-2`** karena grup `retailpro` tidak ada — KS-28) |
| `TURSO_MAX_TENANT_DATABASES` | server | Tidak (bawaan 99) |
| `CONTROL_DB_URL` / `CONTROL_DB_TOKEN` | server/scripts | Ya |
| `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` | server | Ya — `BETTER_AUTH_URL` harus origin publik di produksi |
| `TENANT_TOKEN_TTL` | server | Tidak (bawaan `60m`) |
| `STOREFRONT_TENANT_SLUG` | server | Tidak (bawaan `thalia`) — slug yang dipakai `/api/storefront/catalog` bila klien tidak mengirim `?slug=` |
| `VITE_API_BASE_URL` | browser | Tidak (hanya dev origin terpisah) |
| `VITE_API_PROXY_TARGET` | vite dev | Tidak (bawaan `http://localhost:3000`) |
| `VITE_CATALOG_API_URL` | `tokoonline/` | Ya untuk toko — dipanggang saat build, jadi ubah lalu deploy ulang |

Hanya `VITE_*` yang publik; `src/` tidak boleh mengimpor `server/`, dan rahasia Turso tidak boleh berawalan `VITE_`.

### D. Monitoring & Logging

*   **Health check**: `GET /api/health` mengembalikan `ok`, `service`, `tursoOrg`, `group`, `controlDbConfigured` — satu-satunya pemeriksaan siap pakai untuk deployment (tanpa autentikasi, tanpa query database).
*   **Audit trail**: `audit_logs` di database tenant (aktor, aksi, entitas, detail JSON, IP, user agent). Belum ada layar penjelajah audit.
*   **Logging**: `lib/logger.ts`; di produksi dibaca lewat `vercel logs <deployment-url>`.
*   **Error handling**: masih per-halaman (try/catch + toast). **Error boundary global belum ada** — kegagalan render memutihkan halaman.
*   **Belum ada**: alerting, uptime probe eksternal, dashboard biaya/kuota (lihat `docs/fitur-platform.md` celah #12).

## 6. Pembaruan Implementasi (UI/UX & Fitur)

### A. User Experience

*   **Safety Deletion**: `AlertDialog` untuk konfirmasi penghapusan data penting (karyawan, absensi, cuti, produk), bukan `window.confirm()`.
*   **Feedback System**: toast `sonner` yang konsisten untuk sukses/gagal.

### B. Functional Improvements

*   **Dynamic Payroll**: variabel gaji (hari kerja, tunjangan, potongan) diatur dari halaman laporan karyawan, disimpan di `tenants.settings.payroll_config` — tanpa hardcode.
*   **Role Persistence**: konfigurasi permission role kustom disimpan di `tenants.settings.role_permissions`, dibaca `lib/tenant-settings.ts`.
*   **Data Correction**: hapus record absensi dan cuti yang salah input langsung dari dashboard laporan.
*   **Pagination**: daftar transaksi, karyawan, produk, dan pengeluaran memakai `pagination-bar`.

## 7. Manajemen Shift (POS)

### A. Konsep

*   Satu shift terikat pada satu user (kasir) **dan satu cabang**.
*   Status: `open` atau `closed`.
*   **Penegakan**: transaksi ditolak bila tidak ada shift `open` untuk user tersebut di cabang aktif; POS menampilkan peringatan dan mengarahkan ke `/pos/shifts`.
*   Satu user hanya boleh punya satu shift aktif pada satu waktu.

### B. Alur Kerja

1.  **Buka shift**: input modal awal (`initial_cash`), catat `start_time`.
2.  **Operasional**: semua transaksi menyimpan `shift_id`.
3.  **Tutup shift**: sistem menghitung `expected_cash = initial_cash + SUM(total_amount WHERE payment_method='cash')`; kasir memasukkan uang fisik (`final_cash`); selisih (`difference`) dihitung dan disimpan. Ringkasan per metode pembayaran ditampilkan.

### C. Schema `shifts`

`id`, `branch_id`, `user_id`, `start_time`, `end_time`, `initial_cash`, `final_cash`, `expected_cash`, `difference`, `notes`, `status`, `created_at`.
Tidak ada `tenant_id`.

## 8. Checklist Implementasi (MVP Phase 1)

- [x] Setup project (Vite + React + TS + Tailwind + shadcn/ui)
- [x] Database Turso: satu database per tenant, skema v4 (29 tabel), provisioning otomatis
- [x] Autentikasi Better Auth + 7 peran, guard route gagal-tertutup
- [x] CRUD master data (karyawan, cabang, gudang, produk, vendor, pelanggan)
- [x] Modul vendor: master vendor, katalog vendor↔produk, PO per vendor, hutang & buku pembayaran
- [x] Absensi & cuti (input manual, approval)
- [x] Laporan gaji dasar + konfigurasi payroll dinamis
- [x] Role permission management (persisten di `tenants.settings`)
- [x] POS: katalog, keranjang, multi-satuan, pembayaran, kembalian, FIFO/LIFO/FEFO
- [x] Manajemen shift (buka/tutup, rekonsiliasi kas)
- [x] Inventori: stok masuk, opname, transfer antar gudang, purchase order
- [x] Pesanan cabang: permintaan → persetujuan → pengiriman → penerimaan, terhubung ke transfer
- [x] Keuangan: pengeluaran, hutang/piutang, cashflow, jurnal
- [x] Laporan: penjualan, inventori, keuangan, karyawan + export Excel
- [x] Katalog publik `GET /api/storefront/catalog` (tanpa sesi, data langsung dari DB tenant)
- [x] Toko online `tokoonline/` — kanal penjualan branch `type = 'online'`, tanpa kredensial database
- [x] Deploy produksi: dua proyek Vercel + control DB & DB tenant di Turso cloud, `GET /api/health` hijau
- [ ] Keranjang toko online yang benar-benar memesan (saat ini pesanan tersimpan di perangkat)
- [ ] Konsol platform (daftar tenant, suspend, tier) — lihat `docs/fitur-platform.md`
- [ ] Cetak struk & pemilihan pelanggan di POS
- [ ] CI (typecheck + test + audit:sql + build) — KS-21
- [ ] Lingkungan staging & alerting produksi — `docs/deployment.md` §11
