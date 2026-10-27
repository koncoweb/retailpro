# Backend & Database RetailPro

| | |
|---|---|
| Dokumen | `docs/backend.md` |
| Terakhir diperbarui | **2026-10-27** |
| Database | Turso / libSQL — satu database per tenant + satu control database |
| Versi skema tenant | **2** (`db/schema/tenant.sql`, migrasi `db/migrations/`) |
| Runtime API | Node ≥ 20 (Vercel Functions) |

> Dokumen ini menggantikan `Backend.md` lama (arsitektur Neon/Postgres dengan RLS) yang sudah
> **tidak berlaku**. Perbedaan arsitektur lihat [arsitektur.md](arsitektur.md).

---

## 1. Peta kode

```
db/schema/tenant.sql      Skema DB tenant (25 tabel + indeks), idempoten
db/migrations/*.sql       Migrasi bertahap untuk database yang masih versi lama
db/schema/control.sql     Skema control DB (Better Auth 4 tabel + registry)
db/schema/seed.sql        Seed provisioning dengan placeholder {{TOKEN}}
db/__tests__/             Test skema, seed, dan tenant demo (DB sementara per run)

server/env.ts             Akses env (server-only), MissingEnvError
server/http.ts            HttpError, sendJson, readJsonBody, withErrors, methodNotAllowed
server/control-db.ts      Kysely + libsql untuk control DB
server/auth.ts            Better Auth (admin plugin, additionalFields role/tenantId/branchId)
server/access.ts          Access control Better Auth: statement + 7 role
server/auth-helpers.ts    getSession, requireTenantSession, requireAdminSession
server/turso-platform.ts  Klien Turso Platform API (create/delete/list DB, createToken, getUsage)
server/provision.ts       Provisioning tenant, render seed, mint token, registry access
server/demo/*             Dataset contoh "Thalia Toko Bahan Kue"

api/health.ts             GET  /api/health
api/auth/[...all].ts      ANY  /api/auth/*        (Better Auth handler)
api/tenant/bootstrap.ts   GET  /api/tenant/bootstrap
api/tenant/token.ts       POST /api/tenant/token
api/tenant/provision.ts   POST /api/tenant/provision
api/admin/users.ts        POST /api/admin/users
api/admin/users/[id]/password.ts  POST reset password

scripts/bootstrap-control.mjs   Membuat/menyiapkan control DB
scripts/apply-schema-all.mjs    Terapkan migrasi tertunda + tenant.sql (cek schema_version)
scripts/audit-sql.mjs           Putar ulang literal SQL src/ terhadap skema tenant
scripts/seed-demo-tenant.ts     Seed tenant contoh
```

---

## 2. Environment

| Variabel | Dipakai | Wajib | Nilai |
|---|---|---|---|
| `TURSO_API_TOKEN` | server/scripts | Ya | Token organisasi Turso |
| `TURSO_ORG_SLUG` | server/scripts | Ya | contoh `koncowebliberation` |
| `TURSO_GROUP` | server | Tidak | default `retailpro` (grup harus ada sebelum provisioning) |
| `TURSO_MAX_TENANT_DATABASES` | server | Tidak | default `99` |
| `CONTROL_DB_URL` / `CONTROL_DB_TOKEN` | server/scripts | Ya | Control DB |
| `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` | server | Ya | Secret & origin publik |
| `TENANT_TOKEN_TTL` | server | Tidak | default `60m` |
| `VITE_API_BASE_URL` | browser | Tidak | Hanya untuk dev origin terpisah |
| `VITE_API_PROXY_TARGET` | vite dev | Tidak | default `http://localhost:3000` |
| `TURSO_TENANT_TOKEN` | script demo | Tidak | Token bila seed `--url` tanpa `--token` |

Aturan: **hanya `VITE_*` yang publik**. `src/` tidak boleh mengimpor `server/` (berisi rahasia).

**Nama file env:** entry point Node (`server/dev-api.ts`, `scripts/bootstrap-control.mjs`,
`scripts/apply-schema-all.mjs`) memakai `import 'dotenv/config'`, yang **hanya membaca `.env`**.
Vite membaca `.env` **dan** `.env.local`. Karena itu nilai bersama (Turso, control DB, Better Auth)
diisi di `.env`; `.env.local` hanya untuk nilai sisi Vite. Ketidaksesuaian ini tercatat sebagai
KS-22 di [kendala-solusi.md](kendala-solusi.md).

---

## 3. Permukaan API

| Method | Path | Auth | Fungsi | Status error |
|---|---|---|---|---|
| GET | `/api/health` | – | Smoke check; `{ok, service, time, tursoOrg, group, controlDbConfigured}` | – |
| ANY | `/api/auth/*` | – | Handler Better Auth (login, logout, session, admin) | Sesuai Better Auth |
| GET | `/api/tenant/bootstrap` | Sesi + registry | `{dbUrl, token, expiresAt, tenant{id,name,slug}, user{id,name,email,role,branchId}}` | 401 tanpa sesi, 404 tanpa tenant |
| POST | `/api/tenant/token` | Sesi + registry | Mint token baru untuk database tenant pemanggil | 401, 404 |
| POST | `/api/tenant/provision` | Sesi | Buat DB + skema + seed + registry. Body `{companyName, slug?, branchName?, branchAddress?}` | 400 `invalid_company_name`/`invalid_slug`, 401, 409 `tenant_exists`/`slug_taken`/`slug_reserved`, 429 `tenant_limit_reached`, 502 `turso_error`/`turso_no_hostname` |
| POST | `/api/admin/users` | Sesi admin | Buat user Better Auth di tenant pemanggil; password acak bila tidak dikirim | 400 `invalid_email`/`invalid_name`/`invalid_role`, 401, 409 `email_taken` |
| POST | `/api/admin/users/[id]/password` | Sesi admin | Reset password user; mengembalikan password sementara sekali | 401, 403, 404 |

Semua handler dibungkus `withErrors()` (memetakan `HttpError` → JSON `{error, message}`, sisanya
500) dan menolak method yang salah dengan `methodNotAllowed`.

---

## 4. Modul server

| Modul | Inti |
|---|---|
| `env.ts` | `requiredEnv`/`optionalEnv`/`numberEnv`; gagal cepat dengan pesan yang jelas |
| `http.ts` | `HttpError(status, code, message, extra)`, `withErrors`, `readJsonBody` (batas ukuran) |
| `control-db.ts` | `getControlDb()` singleton Kysely + libsql; tipe `TenantDatabaseRow` |
| `auth.ts` | `betterAuth` + `admin()` plugin; `additionalFields` `tenantId`, `branchId`, `status`; `ADMIN_ROLES = [platform_owner, tenant_owner, tenant_admin]` |
| `access.ts` | `statement` (product, inventory, transaction, shift, customer, supplier, expense, employee, branch, report, settings, audit) + 7 role; `AppRole` |
| `auth-helpers.ts` | `getSession(headers)`, `requireTenantSession(headers)` (sesi → baris registry), `requireAdminSession(headers)` |
| `turso-platform.ts` | `createDatabase`, `deleteDatabase`, `listDatabases`, `getUsage`, `createToken`, `browserDbUrl(hostname)` → `https://<host>` |
| `provision.ts` | `loadSchemaFile` (cache + fallback cwd), `renderSeed` (tolak token tak dikenal), `slugify`, `buildDatabaseName` (`rp-<slug>-<5 acak>`, maks 64), `assertUsableSlug`, `countTenantDatabases`, `findTenantByOwner/ById`, `resolveTenantForUser`, `mintTenantToken`, `applyTenantSchema`, `provisionTenant` |
| `demo/catalog.ts` | Data katalog Thalia (murni data, tanpa SQL) |
| `demo/ledger.ts` | `createThaliaIdentity`, `buildDemoStatements(identity, now)` → ±1.241 statement |
| `demo/seed.ts` | `seedDemoTenant`, `describeTenant`, `DemoSeedError` |

---

## 5. Skema DB tenant (`db/schema/tenant.sql`)

### 5.1 Konvensi

| Tipe data | Representasi | Catatan |
|---|---|---|
| Id | `TEXT` UUID v4 | Default di skema = UUID v4 (dulu `gen_random_uuid()`), jadi INSERT tanpa `id` tetap jalan |
| Uang | `INTEGER` | IDR tanpa sen |
| Kuantitas | `REAL` | Bisa pecahan (0,5 kg) |
| Timestamp | `TEXT` ISO-8601 UTC | `strftime('%Y-%m-%dT%H:%M:%fZ','now')` |
| Tanggal | `TEXT` `YYYY-MM-DD` | |
| Boolean | `INTEGER` 0/1 | |
| JSON | `TEXT` | `settings`, `preferences`, `details` |

**Tidak ada kolom `tenant_id`** di satu pun tabel — pemisahan tenant dilakukan oleh database.

### 5.2 Profil & organisasi

| Tabel | Kolom |
|---|---|
| `schema_version` | `id` (selalu 1), `version` (**3**), `applied_at` |
| `tenants` | `id`, `name`, `slug`, `settings` (JSON: `role_permissions`, `payroll_config`, `receipt`, `tax`, `bank`, `inventory` → `{stock_issue_method}`), `created_at` |
| `branches` | `id`, `name`, `code`, `type` (`store`/`online`/`hybrid`), `is_headquarters`, `parent_branch_id`, `address`, `phone`, `email`, `timezone` (default `Asia/Jakarta`), `status`, `sales_target`, `created_at` |
| `warehouses` | `id`, `name`, `code`, `type` (`central`/`regional`/`store`), `branch_id` (**NULL** = gudang bersama/DC), `address`, `status`, `is_default`, `created_at` |
| `branch_warehouses` | `branch_id`, `warehouse_id`, `is_default`, `priority` — PK `(branch_id, warehouse_id)`; peta "gudang mana melayani cabang mana" |
| `users` | `id` (= id Better Auth), `email`, `name`, `role`, `assigned_branch_id`, `is_active`, `base_salary`, `created_at` |

### 5.3 Katalog & persediaan

| Tabel | Kolom |
|---|---|
| `categories` | `id`, `name`, `created_at` |
| `suppliers` | Master vendor. `id`, `code` (unik, `VND-0001`), `name` (unik), `legal_name`, `category` (`supplier`/`distributor`/`manufacturer`/`service`/`other`), `tax_id`, `website`, `contact_person`, `phone`, `email`, `address`, `city`, `province`, `postal_code`, `payment_terms_days`, `credit_limit`, `currency`, `bank_name`, `bank_account_number`, `bank_account_name`, `lead_time_days`, `rating` (0–5), `status` (`active`/`inactive`/`blacklisted`), `notes`, `settings`, `created_at`, `updated_at` |
| `customers` | `id`, `name`, `phone`, `email`, `address`, `notes`, `preferences`, `total_spent`, `points`, `created_at` |
| `products` | `id`, `sku`, `name`, `description`, `category`, `cost_price`, `min_stock_level`, `is_tracked`, `supplier_id`, `created_at` |
| `product_units` | `id`, `product_id`, `name`, `conversion_factor`, `price`, `barcode`, `created_at` |
| `product_batches` | `id`, `warehouse_id`, `product_id`, `batch_number`, `expiry_date`, `quantity_initial`, `quantity_current`, `cost_price`, `received_at`, `supplier_id` |

Harga jual **tidak** ada di `products`; harga ada di `product_units.price` per satuan jual.
`conversion_factor` = jumlah satuan dasar dalam satu satuan jual.

### 5.4 Penjualan

| Tabel | Kolom |
|---|---|
| `shifts` | `id`, `branch_id`, `user_id`, `start_time`, `end_time`, `initial_cash`, `final_cash`, `expected_cash`, `difference`, `notes`, `status` (`open`/`closed`), `created_at` |
| `transactions` | `id`, `branch_id`, `cashier_id`, `customer_id`, `shift_id`, `invoice_number`, `total_amount`, `amount_paid`, `due_date`, `payment_method` (`cash`/`card`/`ewallet`/`credit`), `notes`, `status`, `created_at` |
| `transaction_items` | `id`, `transaction_id`, `product_id`, `batch_id`, `quantity` (**satuan jual**), `unit_name`, `conversion_factor`, `unit_price`, `cost_price` (per satuan jual), `subtotal` |

### 5.5 Persediaan bergerak & pengadaan

| Tabel | Kolom |
|---|---|
| `stock_transfers` | `id`, `reference_number`, `source_warehouse_id`, `destination_warehouse_id`, `status` (`pending`/`completed`), `notes`, `requested_by`, `approved_by`, `received_by`, `sent_at`, `received_at`, `created_at` |
| `transfer_items` | `id`, `transfer_id`, `product_id`, `source_batch_id`, `quantity_sent`, `quantity_received`, `unit_name`, `conversion_factor`, `cost_price`, `notes` |
| `purchase_orders` | `id`, `po_number`, `supplier_id`, `supplier_name`, `branch_id`, `warehouse_id`, `status` (`draft`/`ordered`/`received`), `total_amount`, `notes`, `expected_date`, `received_at`, `created_by`, `created_at` |
| `purchase_order_items` | `id`, `purchase_order_id`, `product_id`, `quantity`, `unit_name`, `conversion_factor`, `unit_cost`, `subtotal` |
| `vendor_products` | Katalog per vendor: `id`, `vendor_id`, `product_id`, `vendor_sku`, `last_cost`, `lead_time_days`, `min_order_qty`, `is_preferred`, `created_at`. `UNIQUE(vendor_id, product_id)` |
| `vendor_payments` | Buku pembayaran vendor: `id`, `vendor_id`, `expense_id`, `purchase_order_id`, `amount`, `payment_date`, `method` (`cash`/`transfer`/`check`/`other`), `reference_number`, `notes`, `created_by`, `created_at` |

**Vendor = `suppliers`.** Tidak ada tabel `vendors` terpisah: `products.supplier_id`,
`purchase_orders.supplier_id`, `expenses.supplier_id`, dan `product_batches.supplier_id`
sudah menunjuk ke sana, jadi modul vendor memperluas tabel yang sama (skema v3).
`vendor_products` adalah katalog N:N (produk bisa dipasok beberapa vendor; satu vendor
utama tetap di `products.supplier_id`). `vendor_payments` adalah buku pembayaran cicilan —
saldo hutang tetap di `expenses.amount_paid`, jadi Hutang/AP dan halaman vendor tidak
pernah menghitung kewajiban dua kali.

### 5.6 Keuangan

| Tabel | Kolom |
|---|---|
| `expenses` | `id`, `branch_id`, `category`, `amount`, `date`, `due_date`, `description`, `status` (`paid`/`unpaid`), `amount_paid`, `supplier_id`, `notes`, `created_at` |
| `payables` | `id`, `supplier_id`, `supplier_name`, `branch_id`, `purchase_order_id`, `amount`, `amount_paid`, `due_date`, `status`, `description`, `created_at` |

**Penting:** layar Hutang/Piutang, Cashflow, dan Jurnal membaca `expenses` (bukan `payables`).
Penerimaan PO menulis satu baris `expenses` belum lunas. Tabel `payables` dipertahankan di skema
tetapi belum dipakai UI mana pun.

### 5.7 SDM & jejak

| Tabel | Kolom |
|---|---|
| `attendance` | `id`, `employee_id`, `date`, `check_in`, `check_out`, `status`, `overtime`, `notes`, `created_at` |
| `leaves` | `id`, `employee_id`, `type`, `start_date`, `end_date`, `reason`, `status`, `created_at` |
| `employees` | `id`, `name`, `email`, `role`, `branch_id`, `status`, `created_at` — dipertahankan karena `Reports.tsx` membacanya; sumber data HR utama adalah `users` + `attendance` + `leaves` |
| `audit_logs` | `id`, `user_id`, `action`, `entity`, `entity_id`, `details` (JSON), `ip_address`, `user_agent`, `created_at` |

### 5.8 Indeks

| Tabel | Indeks |
|---|---|
| `users` | `UNIQUE(email)`, `(assigned_branch_id)` |
| `branches` | `UNIQUE(name)`, partial `UNIQUE(is_headquarters) WHERE is_headquarters = 1` |
| `warehouses` | `UNIQUE(name)`, `(branch_id)` |
| `branch_warehouses` | PK `(branch_id, warehouse_id)`, `(warehouse_id)` |
| `categories`, `suppliers` | `UNIQUE(name)`; `suppliers`: partial `UNIQUE(code) WHERE code IS NOT NULL`, `(status)`, `(category)` |
| `customers` | `(phone)` |
| `products` | `UNIQUE(sku)`, `(category)`, `(supplier_id)` |
| `product_units` | `UNIQUE(product_id, conversion_factor)`, `(product_id)`, `(barcode)` |
| `product_batches` | `(product_id, warehouse_id, received_at)`, `(warehouse_id)` |
| `vendor_products` | `UNIQUE(vendor_id, product_id)`, `(product_id)` |
| `vendor_payments` | `(vendor_id, payment_date)`, `(expense_id)` |
| `transactions` | `UNIQUE(invoice_number)`, `(branch_id, created_at)`, `(created_at)`, `(cashier_id)`, `(shift_id)` |
| `transaction_items` | `(transaction_id)`, `(product_id)` |
| `shifts` | `(branch_id, status)`, `(user_id, status)` |
| `stock_transfers` | `(status, created_at)`, `(source_warehouse_id)`, `(destination_warehouse_id)` |
| `transfer_items` | `(transfer_id)` |
| `purchase_orders` | `UNIQUE(po_number)`, `(status, created_at)`, `(warehouse_id)` |
| `purchase_order_items` | `(purchase_order_id)` |
| `payables` | `(status, due_date)`, `(supplier_id)` |
| `expenses` | `(date)`, `(category)`, `(branch_id)` |
| `attendance` | `(employee_id, date)` |
| `leaves` | `(employee_id, start_date)` |
| `audit_logs` | `(created_at)` |

### 5.9 Cabang vs gudang (model stok)

Cabang adalah **lokasi penjualan**; gudang adalah **lokasi stok**. Satu-satunya sumber kebenaran
stok ada di `product_batches.warehouse_id` — tidak ada lagi kolom stok yang berkunci `branch_id`.

| Aturan | Dijaga oleh |
|---|---|
| Tepat satu kantor pusat per tenant (`branches.is_headquarters = 1`) | `idx_branches_hq` (partial unique index) |
| Setiap cabang punya ≥ 1 gudang lewat `branch_warehouses`; baris `is_default` itulah yang dipakai kasir | `resolveBranchWarehouse()` di `src/lib/warehouse.ts`, seed, migrasi `002_warehouses.sql` |
| Gudang dengan `branch_id` NULL = gudang bersama/DC, boleh melayani banyak cabang | `resolveBranchWarehouse()`: default cabang → `priority` terkecil → gudang default perusahaan |
| Banyak cabang : 1 gudang **dan** banyak cabang : banyak gudang sama-sama sah | peta N:N `branch_warehouses` |
| "Stok cabang X" = stok gudang yang terpetakan ke X (gudang bersama ikut terhitung) | `LowStockAlert`, `BranchPerformance`, dashboard cabang |
| Biaya/hutang yang perlu atribusi cabang (PO, payables) memakai pemilik gudang; gudang bersama memakai cabang pemanggil | `resolveWarehouseBranch()` |

---

## 6. Skema control DB (`db/schema/control.sql`)

| Tabel | Isi |
|---|---|
| `user` | Akun Better Auth + `role`, `tenantId`, `branchId`, `status`, `banned`, `createdAt`, `updatedAt` |
| `session` | Sesi login (cookie) |
| `account` | Kredensial (password hash) dan akun OAuth |
| `verification` | Token verifikasi/reset |
| `tenant_databases` | `id`, `owner_user_id` → `user(id)` ON DELETE CASCADE, `slug`, `company_name`, `db_name`, `db_hostname`, `group_name`, `status` (default `active`), `created_at`, `updated_at` |

Relasi: satu `user` boleh punya 0/1 tenant (dijaga kode, bukan constraint), dan `users.id` di DB
tenant selalu sama dengan `user.id` di control DB.

---

## 7. Pipeline provisioning

`provisionTenant({ userId, userEmail, userName, companyName, slug, branchName, branchAddress })`

| # | Langkah | Gagal → |
|---|---|---|
| 1 | `findTenantByOwner(userId)` | `409 tenant_exists` |
| 2 | `assertUsableSlug(slug)` — min 3, bukan reserved | `400 invalid_slug`, `409 slug_reserved` |
| 3 | `countTenantDatabases() >= TURSO_MAX_TENANT_DATABASES` | `429 tenant_limit_reached` |
| 4 | Slug sudah dipakai tenant lain | `409 slug_taken` |
| 5 | `buildDatabaseName(slug)` → `rp-<slug>-<5 acak>` | – |
| 6 | `createDatabase(dbName, group)` | `502 turso_error` |
| 7 | `createToken(dbName,'10m','full-access')` | `502 turso_error` |
| 8 | `applyTenantSchema(url, jwt, seed)` = `BEGIN; tenant.sql + renderSeed(seed.sql); COMMIT;` | `502`/`500` |
| 9 | Insert baris `tenant_databases` | rollback: `deleteDatabase(dbName)` |
| 10 | Kembalikan `{tenantId, slug, dbName, hostname, branchId}` | – |

`renderSeed()` mengganti placeholder `{{TENANT_ID}}`, `{{TENANT_NAME}}`, `{{TENANT_SLUG}}`,
`{{BRANCH_ID}}`, `{{BRANCH_NAME}}`, `{{BRANCH_ADDRESS}}`, `{{OWNER_ID}}`, `{{OWNER_EMAIL}}`,
`{{OWNER_NAME}}`, `{{CATEGORY_n_ID}}` dengan literal SQL yang sudah di-escape, dan **menolak**
token yang tidak dikenal (termasuk di dalam komentar).

---

## 8. Lapisan akses data (sisi browser)

`src/lib/db/index.ts` — kontrak tunggal:

| Fungsi | Bentuk |
|---|---|
| `query<T>(sql, params?)` | Satu statement → `{ rows, rowCount }`; retry sekali bila error mirip token kedaluwarsa |
| `batchQuery<T>(statements)` | Beberapa statement baca dalam satu round-trip (hasil posisional) |
| `runTransaction(async (tx) => ...)` | `BEGIN` … `COMMIT`, rollback bila melempar; semua penulisan multi-tabel wajib lewat sini |
| `translate(sql)` | `$1` → `?` dengan urutan parameter (nama `$n` didukung) |
| `parseJson*` | Membaca kolom JSON dengan aman |

Kelas error: `DbNotReadyError` (belum bootstrap), `DbTokenError` (token ditolak), `DbQueryError`
(kode SQLite diteruskan agar UI bisa membedakan constraint vs lainnya).

`src/lib/db/client.ts` membuat satu klien libSQL per tenant, menyegarkan token secara *single
flight* sebelum kedaluwarsa, dan **tidak pernah** menulis token ke storage.

---

## 9. Invariant yang tidak boleh dilanggar

1. `transactions.total_amount` = nilai penjualan; `amount_paid` = uang diterima. Omzet **selalu**
   `SUM(total_amount)`.
2. `change = amount_paid - total_amount` (boleh 0 untuk nontunai).
3. `shifts.expected_cash = initial_cash + SUM(total_amount WHERE payment_method='cash')`.
4. `transaction_items.quantity` dalam satuan jual; `cost_price = batch.cost_price × conversion_factor`;
   `subtotal = unit_price × quantity`.
5. Urutan pengeluaran batch mengikuti kebijakan tenant
   (`tenants.settings.inventory.stock_issue_method`: `fifo` | `lifo` | `fefo`, bawaan `fifo`).
   Kandidat diambil **tanpa** `ORDER BY` lalu diurutkan di memori oleh `src/lib/stock-issue.ts`,
   selalu disertai guard `quantity_current >= qty`.
6. Satu `transfer_items` ↔ satu leg batch sumber; batch tujuan menyalin `cost_price`, `expiry_date`,
   `supplier_id`.
7. `users.id` DB tenant = `user.id` control DB.
8. `tenants.settings` diubah lewat read → merge → write dalam satu transaksi (`json_patch` hanya
   dipakai di seed demo).
9. Stok hanya ada di `product_batches.warehouse_id`. Cabang tidak menyimpan stok; kueri yang butuh
   "stok cabang" wajib lewat `branch_warehouses`.
10. Tepat satu kantor pusat aktif per tenant, dan setiap cabang punya tepat satu gudang default
    (`branch_warehouses.is_default = 1`) bila gudangnya lebih dari satu.

---

## 10. Script

| Perintah | Fungsi |
|---|---|
| `npm run bootstrap:control` | Buat/siapkan control DB dari `control.sql` |
| `npm run schema:apply-all` | Bandingkan `schema_version` setiap tenant dengan versi di repo. Dry-run bawaan; `--apply` untuk eksekusi, `--only <slug\|db_name>` untuk satu tenant. Database lama menjalankan migrasi tertunda lebih dulu, lalu `tenant.sql`; database baru (v0) cukup `tenant.sql` |
| `npm run audit:sql` | Kumpulkan literal SQL di `src/`, putar ulang terhadap `tenant.sql` |
| `npm run demo:tenant` | Seed tenant contoh (lokal, `--url`, atau `--tenant <slug>`) |
| `npm test` | Vitest: translate, skema, seed, date-range, inventory-utils, stock-issue, vendor, demo tenant |

---

## 11. Riwayat perubahan skema

| Tanggal | Perubahan | Catatan migrasi |
|---|---|---|
| 2026-10-27 | **Skema v1 dibuat** (`db/schema/tenant.sql`) untuk libSQL: 23 tabel, tanpa `tenant_id`, semua id `TEXT`, uang `INTEGER`, timestamp `TEXT` ISO | Database baru — tidak ada data lama (start fresh). Tidak ada migrasi bertahap; versi dicatat di `schema_version` |
| 2026-10-27 | Indeks ditambahkan (Postgres lama tidak punya): FIFO, filter cabang/tanggal, pencarian produk, `UNIQUE` pada `users.email`, `products.sku`, `transactions.invoice_number`, `purchase_orders.po_number`, `categories/suppliers/branches.name`, `product_units(product_id, conversion_factor)` | Idempoten (`IF NOT EXISTS`) |
| 2026-10-27 | Tabel baru `purchase_orders` + `purchase_order_items` + `payables` | Menggantikan kebiasaan lama yang langsung membuat batch saat PO |
| 2026-10-27 | `transactions.shift_id`, `due_date`; `transaction_items.unit_name`, `conversion_factor`; `product_batches.supplier_id`; `users.base_salary`; `branches.sales_target` | Kolom baru untuk shift, kredit, multi-satuan, dan payroll |
| 2026-10-27 | `employees` dipertahankan sebagai tabel terpisah | `Reports.tsx` masih membacanya |
| 2026-10-27 | **Skema v2** (`db/migrations/002_warehouses.sql`): cabang jadi kanal penjualan (`type`, `is_headquarters`, `parent_branch_id`), tabel baru `warehouses` + `branch_warehouses`, `product_batches.branch_id` → `warehouse_id`, `stock_transfers` memakai `source_/destination_warehouse_id`, `purchase_orders.warehouse_id` | Tenant v1: satu gudang belakang dibuat per cabang, stok dipindahkan, lalu kolom `branch_id` dihapus. Lihat KS-23 |
| 2026-10-27 | `tenants.settings.inventory.stock_issue_method` (`fifo`/`lifo`/`fefo`, bawaan `fifo`) | Tanpa DDL (JSON); dibaca `getStockIssueMethod()`. Lihat KS-24 |
| 2026-10-27 | Indeks baru/berganti: `idx_branches_hq` (partial), `idx_warehouses_branch`, `idx_wh_branches_wh`, `idx_batches_prod_wh`, `idx_batches_wh`, `idx_po_warehouse`; indeks transfer pindah ke kolom gudang | Idempoten; diterapkan migrasi lalu `tenant.sql` |
| 2026-10-27 | **Skema v3** (`db/migrations/003_vendors.sql`): `suppliers` menjadi master vendor (kode, badan usaha, kategori, NPWP, alamat terurai, termin, limit kredit, bank, lead time, rating, status), tabel baru `vendor_products` + `vendor_payments` | Tenant v2: kolom `ALTER TABLE` dengan default konstan, `code` di-backfill `VND-0001…` berurutan, dan relasi produk→vendor yang sudah ada di-backfill ke `vendor_products`. Tabel baru memakai default UUID yang sama dengan `tenant.sql` |

Cara mengubah skema ke depan:

1. Ubah `db/schema/tenant.sql` (idempoten) atau tambah berkas `db/migrations/<nomor>_<slug>.sql`
   untuk struktur yang tidak bisa diekspresikan idempoten, **dan** naikkan `schema_version`.
   `<nomor>` = versi skema yang dihasilkan: `tenant.sql` adalah baseline **v1**, jadi migrasi pertama
   bernomor `002`. Runner hanya menerapkan migrasi yang nomornya **>** versi tercatat, dan untuk
   database baru (v0) hanya `tenant.sql` yang dijalankan.
2. Jalankan `npm run schema:apply-all` (fleet) atau `npm run audit:sql` dulu untuk melihat drift.
3. Tambahkan test di `db/__tests__/` yang membuktikan kolom baru dipakai.
4. Catat baris baru di tabel riwayat di atas.
