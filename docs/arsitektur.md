# Arsitektur Teknis RetailPro

| | |
|---|---|
| Aplikasi | RetailPro — ERP/POS multi-tenant, multi-cabang (pasar Indonesia, IDR) |
| Dokumen | `docs/arsitektur.md` |
| Terakhir diperbarui | **2026-10-27** |
| Versi skema tenant | `schema_version = 3` (`db/schema/tenant.sql` + `db/migrations/`) |
| Status | Berjalan di lokal/vercel; belum dipakai data produksi nyata |

> Dokumen ini menjelaskan **bagaimana sistem disusun dan mengapa**. Untuk daftar fitur lihat
> [fitur-tenant.md](fitur-tenant.md) dan [fitur-platform.md](fitur-platform.md); untuk detail
> tabel dan endpoint lihat [backend.md](backend.md).

---

## 1. Ringkasan

RetailPro adalah SPA React yang **bicara langsung ke database Turso milik tenant** dengan token
berumur pendek. Server hanya dipakai untuk tiga hal yang tidak boleh ada di browser: membuat
database, menandatangani token, dan menyimpan identitas pengguna.

```
                        +-------------------------------+
                        |  Control DB (Turso)           |
                        |  Better Auth: user, session,  |
                        |  account, verification        |
                        |  Registry: tenant_databases   |
                        +---------------+---------------+
                                        ^
                    (Kysely + libSQL)   |
                                        |
  +-------------+    HTTPS /api/*       |
  |   Browser   +----------------> +----+-------------------------+
  |  React SPA  |                  |  Vercel Functions (api/)     |
  |             |                  |  health, auth, tenant/*,     |
  |             |                  |  admin/users                 |
  +------+------+                  +--------------+---------------+
         |                                        |
         |  HTTPS + JWT (60 menit, 1 database)     | Turso Platform API
         |  @libsql/client/web                     | (create db, mint token)
         v                                        v
  +--------------------------+          +-----------------------+
  |  Turso DB tenant A       |          |  Turso Platform       |
  |  25 tabel, tanpa         |          |  (organisasi)         |
  |  kolom tenant_id         |          +-----------------------+
  +--------------------------+
  +--------------------------+
  |  Turso DB tenant B       |   <- isolasi fisik, bukan RLS
  +--------------------------+
```

---

## 2. Prinsip yang dipegang

| # | Prinsip | Konsekuensi |
|---|---|---|
| 1 | **Satu database per perusahaan** | Tidak ada `tenant_id`, tidak ada RLS. Isolasi = batas fisik. Kebocoran satu token dibatasi ke satu perusahaan dan satu jam |
| 2 | **Server setipis mungkin** | Browser memegang koneksi data; server hanya provisioning, identitas, dan token. Tidak ada jalur request aplikasi harian lewat server |
| 3 | **Satu seam akses data** | Semua halaman memakai `query` / `runTransaction` / `batchQuery` dari `@/lib/db`. Transport bisa diganti di satu file |
| 4 | **Skema adalah kode** | `db/schema/*.sql` di repo adalah sumber kebenaran; perubahan bertahap untuk database yang sudah hidup lewat `db/migrations/<nomor>_<slug>.sql`. Tidak ada perubahan skema manual di dashboard |
| 5 | **Uang sebagai integer** | IDR tanpa sen, `INTEGER`. Kuantitas `REAL` karena bisa pecahan (0,5 kg) |
| 6 | **Gagal tertutup** | Route guard menolak bila role tidak diketahui; provisioning melakukan rollback bila satu langkah gagal |

---

## 3. Komponen dan tanggung jawab

| Komponen | Lokasi | Tanggung jawab | Tidak boleh |
|---|---|---|---|
| SPA | `src/` | UI, aturan tampilan, query ke DB tenant | Menyimpan kredensial atau token di storage |
| Fungsi API | `api/` | Health, Better Auth handler, bootstrap/token tenant, provisioning, admin user | Menjalankan logika bisnis POS/inventori |
| Server library | `server/` | Better Auth, control DB, Turso Platform client, provisioning, render seed, generator demo | Diimpor dari `src/` (berisi rahasia) |
| Control DB | Turso | Identitas (Better Auth) + registry tenant | Menyimpan data transaksi/bisnis |
| DB tenant | Turso (1 per tenant) | Seluruh data bisnis | Menyimpan kredensial atau data tenant lain |
| Scripts | `scripts/` | Bootstrap control, apply schema massal, audit SQL, seed demo | Dipanggil dari browser |

---

## 4. Alur kritis

### 4.1 Registrasi tenant (`POST /api/tenant/provision`)

```
RegisterTenant.tsx
  -> provisionTenant()                       server/provision.ts
     1. findTenantByOwner(userId)      -> 409 tenant_exists bila sudah punya
     2. assertUsableSlug()             -> 400 invalid_slug / 409 slug_reserved
     3. countTenantDatabases() >= max  -> 429 tenant_limit_reached
     4. slug sudah dipakai?            -> 409 slug_taken
     5. buildDatabaseName(slug)        -> rp-<slug>-<5 acak>
     6. Turso createDatabase(name, group)
     7. createToken(db, '10m', 'full-access')
     8. applyTenantSchema(BEGIN; tenant.sql + seed.sql; COMMIT;)
     9. insertInto('tenant_databases')
    10. gagal di langkah 6-9 -> deleteDatabase() + lempar error (rollback)
```

Hasilnya satu tenant = satu database + satu baris registry + satu pemilik di control DB.

### 4.2 Login dan bootstrap

```
Login (Better Auth)  ->  session cookie httpOnly (control DB)
   -> TenantProvider:
        GET /api/tenant/bootstrap
            requireTenantSession(headers)      -> cek session + baris registry
            mintTenantToken(db_name)           -> JWT 60 menit, full-access
            kembalikan { dbUrl, token, expiresAt, tenant, user{role,branchId} }
   -> setTenantSession(...)   (memori saja, tidak pernah localStorage)
   -> <RequireTenant> baru melepas render halaman
```

Status bootstrap: `idle → loading → ready | no-tenant | error`. `no-tenant` mengarahkan pemilik
baru ke `/register-tenant`.

### 4.3 Refresh token

`getClient()` memanggil `refreshIfNeeded()`; bila token tinggal < 5 menit, `refreshToken()`
memanggil `POST /api/tenant/token` secara *single-flight* (pemanggil bersamaan berbagi satu
request). `query()` juga mengulang satu kali bila error terlihat seperti token kedaluwarsa.

### 4.4 Checkout POS

```
handlePaymentComplete                       src/pages/POS.tsx
  getStockIssueMethod()                     settings.inventory.stock_issue_method
                                            (dibaca SEBELUM transaksi dibuka)
  runTransaction:
    1. pre-flight stok per baris (warehouse = gudang cabang sesi/switch)
    2. SELECT * FROM product_batches WHERE product_id=$1 AND warehouse_id=$2
              AND quantity_current>0          (tanpa ORDER BY)
       sortBatchesForIssue(rows, method)      fifo | lifo | fefo di memori
    3. UPDATE ... WHERE id=$3 AND quantity_current >= $4   (blind-write guard)
    4. INSERT transaction_items (quantity dalam satuan jual, cost dari batch x konversi)
    5. INSERT transactions (total_amount = nilai jual, amount_paid = uang diterima)
    6. logAuditTx(...)  (detail memuat stock_issue_method)
```

### 4.5 Transfer stok

Pembuatan (`pending`) tidak mengubah stok. Persetujuan berjalan per batch sesuai kebijakan
pengeluaran tenant: satu baris `transfer_items` menyimpan `source_batch_id`, dan **satu batch
tujuan dibuat per leg** sehingga `cost_price`, `expiry_date`, dan `supplier_id` ikut berpindah
apa adanya.

---

## 5. Isolasi dan keamanan

| Aspek | Implementasi saat ini |
|---|---|
| Isolasi data | Database terpisah per tenant; `db/schema/tenant.sql` tidak punya `tenant_id` dan test skema memastikannya |
| Identitas | Better Auth di control DB; `role`, `tenantId`, `branchId` adalah `additionalFields` sehingga selalu ada di session |
| Otorisasi UI | `RoleBasedRoute` gagal-tertutup + daftar `allowedRoles` eksplisit per route di `src/App.tsx` |
| Otorisasi server | `requireAdminSession` pada endpoint admin; peran yang boleh diberikan dibatasi `ASSIGNABLE_ROLES` |
| Kredensial DB | Tidak ada di bundle. Token 60 menit diterbitkan server, disimpan di memori, tidak di storage |
| Rahasia server | Hanya `server/` dan `api/`; `src/` tidak boleh mengimpornya (aturan tertulis di `server/env.ts`) |
| Audit | `audit_logs` di DB tenant: checkout, produk, stok, transfer, PO, pengeluaran, karyawan, pengaturan |

**Batas kepercayaan yang jujur:** siapa pun yang memegang token tenant dapat menjalankan SQL apa
pun di database **perusahaannya** selama ≤ 60 menit. Karena itu token sengaja pendek, per-database,
dan tidak pernah dipersist. Endpoint admin tetap mengandalkan sesi, bukan token.

---

## 6. Model data

27 tabel di DB tenant, dikelompokkan:

| Domain | Tabel |
|---|---|
| Profil | `schema_version`, `tenants`, `branches`, `warehouses`, `branch_warehouses`, `users` |
| Katalog | `categories`, `suppliers`, `products`, `product_units`, `product_batches` |
| Vendor | `vendor_products`, `vendor_payments` — `suppliers` adalah master vendor yang dipakai produk, PO, dan hutang |
| Penjualan | `shifts`, `transactions`, `transaction_items` |
| Persediaan | `stock_transfers`, `transfer_items`, `purchase_orders`, `purchase_order_items` |
| Keuangan | `expenses`, `payables` |
| SDM | `attendance`, `leaves`, `employees` |
| Jejak | `audit_logs` |
| CRM | `customers` |

Detail kolom, indeks, dan konvensi: [backend.md](backend.md) §5.

---

## 7. Deployment dan lingkungan

| Item | Nilai |
|---|---|
| Build | `vite build` → `dist/` (SPA statis) |
| Hosting | Vercel: static + `api/*` sebagai serverless function (`vercel.json` rewrite `/api` dengan negative lookahead) |
| Runtime API | Node ≥ 20 (`node:crypto`, `node:http` types) |
| Database | Turso libSQL; grup default `retailpro` |
| Dev lokal | `npm run dev` (SPA) + `npm run dev:api` (port 3000, proxy `VITE_API_PROXY_TARGET`) |
| Variabel | Lihat tabel env di [backend.md](backend.md) §2 |

---

## 8. Keputusan arsitektur

| # | Keputusan | Alternatif yang ditolak | Konsekuensi |
|---|---|---|---|
| 1 | 2026-10-27 — Turso libSQL, satu DB per tenant | Neon Postgres + RLS; satu DB + kolom `tenant_id` | Isolasi jadi fisik; tidak bisa query lintas tenant; 1 DB = 1 unit backup/restore |
| 2 | 2026-10-27 — Browser → DB langsung dengan token pendek | Semua query lewat API | Latensi rendah dan kode halaman tidak berubah; keamanan bergantung pada umur token |
| 3 | 2026-10-27 — Better Auth di control DB | Auth di DB tenant | Login tetap satu pintu walau tenant punya database sendiri; identitas harus dicerminkan ke `users` tenant |
| 4 | 2026-10-27 — Mulai dari nol (tanpa ETL) | Migrasi data Neon | Skema bersih dan konsisten; tidak ada data lama yang perlu dipetakan |
| 5 | 2026-10-27 — Keuangan basis kas, AP dari `expenses` | Buku besar penuh (COA + jurnal) | Cepat dan sesuai praktik toko; belum ada tutup buku/trial balance |
| 6 | 2026-10-27 — Dataset demo deklaratif + test integritas | SQL seed statis | Angka konsisten dan bisa diuji; katalog adalah satu-satunya sumber kebenaran |
| 7 | 2026-10-27 — Cabang = lokasi penjualan, gudang = lokasi stok (`branch_warehouses` N:N) | Stok berkunci `branch_id` di `product_batches` | Banyak cabang : 1 gudang dan banyak : banyak sama-sama jalan; kasir, transfer, dan PO memakai `warehouse_id`; setiap kueri "stok cabang" harus lewat pemetaan |
| 8 | 2026-10-27 — Urutan pengeluaran stok = kebijakan tenant (`fifo`/`lifo`/`fefo`), diurutkan di memori | `ORDER BY received_at` dipaku di SQL tiap jalur | Satu aturan untuk kelima jalur stok keluar dan bisa diubah tanpa migrasi; kueri batch tidak lagi punya `ORDER BY`, jadi urutan wajib lewat `sortBatchesForIssue()` |

---

## 9. Batasan yang diketahui

1. **Belum ada konsol platform** — pemilik platform belum punya UI untuk daftar/aktifkan/suspend
   tenant, tier, atau fitur. Lihat [fitur-platform.md](fitur-platform.md) §3.
2. **`payables` tidak terbaca UI** — AP dihitung dari `expenses`; tabel `payables` masih ada di
   skema sebagai sisa desain awal (lihat kendala-solusi KS-08).
3. **Belum ada buku besar** — jurnal disusun saat baca dari `transactions` + `expenses`.
4. **Bundle tunggal ±2 MB** — belum di-split per route.
5. **Data bisnis belum lewat TanStack Query** — masih `useEffect` + `query()`; hanya sesi auth
   yang memakai Query.
6. **Tidak ada CI** — test/typecheck/lint dijalankan manual.
