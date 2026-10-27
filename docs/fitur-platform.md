# Fitur Platform (khusus owner platform RetailPro)

| | |
|---|---|
| Dokumen | `docs/fitur-platform.md` |
| Terakhir diperbarui | **2026-10-27** |
| Cakupan | Kemampuan operator platform: menyediakan, mengelola, dan mengawasi tenant — **bukan** data bisnis tenant |
| Status ringkas | **Fondasi tersedia (API + CLI + database), konsol UI belum ada** |

## Cara memakai log ini

Sama seperti [fitur-tenant.md](fitur-tenant.md): tambah baris baru, jangan ubah baris lama. Satu
baris = satu kemampuan operator yang berubah, dengan tanggal dan jam.

---

## 1. Log perubahan kemampuan platform

### 2026-10-27 — control plane & provisioning (belum di-commit)

| Waktu | Ref | Area | Perubahan | Status |
|---|---|---|---|---|
| 2026-10-27 | — (working tree) | Control plane | Database kontrol berisi Better Auth (`user`, `session`, `account`, `verification`) + registry `tenant_databases` | Baru |
| 2026-10-27 | — (working tree) | Provisioning | `POST /api/tenant/provision` membuat database Turso, menerapkan skema + seed, mendaftarkan tenant, dan menandai pemilik — satu panggilan | Baru |
| 2026-10-27 | — (working tree) | Provisioning | Rollback otomatis: bila pendaftaran gagal setelah database dibuat, database dihapus | Baru |
| 2026-10-27 | — (working tree) | Kuota | Batas jumlah database tenant (`TURSO_MAX_TENANT_DATABASES`, default 99) → HTTP 429 bila penuh | Baru |
| 2026-10-27 | — (working tree) | Kuota | Slug tenant divalidasi: minimal 3 karakter, tidak boleh sama, daftar slug terlarang (`www`, `api`, `admin`, …) | Baru |
| 2026-10-27 | — (working tree) | Token | Penerbitan token per tenant (TTL 60 menit untuk browser, 10 menit untuk provisioning) tanpa membocorkan token organisasi | Baru |
| 2026-10-27 | — (working tree) | Admin user | `POST /api/admin/users` membuat identitas karyawan tenant; `POST /api/admin/users/[id]/password` mereset password; keduanya wajib sesi admin | Baru |
| 2026-10-27 | — (working tree) | Operasional | `GET /api/health` melaporkan status layanan, organisasi, grup, dan apakah control DB terkonfigurasi | Baru |
| 2026-10-27 | — (working tree) | Operasional | `npm run bootstrap:control` membuat/menyiapkan control DB; `npm run schema:apply-all` menerapkan skema ke seluruh tenant dengan penjaga `schema_version` | Baru |
| 2026-10-27 | — (working tree) | Operasional | `npm run audit:sql` memutar ulang seluruh literal SQL di `src/` terhadap skema tenant untuk mendeteksi drift | Baru |
| 2026-10-27 | — (working tree) | Demo | `npm run demo:tenant -- --tenant <slug>` mengisi tenant terdaftar dengan data contoh, memakai id tenant & owner asli dari registry | Baru |
| 2026-10-27 | — (working tree) | Peran | Peran `platform_owner` terdaftar di Better Auth access control (termasuk izin `user`/`session` admin) dan diterima di seluruh route guard | Baru |
| 2026-10-27 | — (working tree) | Skema | Roll-out skema v2: `apply-schema-all` menjalankan migrasi tertunda (`db/migrations/002_warehouses.sql`) **sebelum** `tenant.sql`, lalu mencap `schema_version` — tenant lama mendapat gudang per cabang tanpa kehilangan stok (lihat kendala-solusi KS-23) | Baru |

### Riwayat commit (sebelum migrasi)

| Waktu | Ref | Area | Perubahan | Status |
|---|---|---|---|---|
| 2026-02-02 03:44 | `2d16c16` | Deployment | Konfigurasi Vercel untuk API + penanganan sesi database | Baru |
| 2026-02-01 20:19 | `33b3fff` | Peran | Peran `admin` ditambahkan pada penanganan sesi | Baru |
| 2026-01-23 19:27 | `0d46d02` | Auth | Autentikasi multi-tenant (belum ada pemisahan control plane) | Baru |

> Sebelum 2026-10-27 **belum ada** control plane, registry tenant, atau provisioning. Peran
> `platform_owner` hanya nama di daftar role tanpa mekanisme apa pun di belakangnya.

---

## 2. Yang bisa dilakukan operator hari ini

| Kemampuan | Cara | Bukti di kode |
|---|---|---|
| Menyediakan tenant baru untuk seorang pengguna | Otomatis saat pengguna menyelesaikan `/register-tenant`; satu akun hanya boleh punya satu tenant (`409 tenant_exists`) | `server/provision.ts` → `provisionTenant` |
| Melihat daftar tenant | Query registry `tenant_databases` di control DB | `db/schema/control.sql` |
| Melihat database mana milik tenant mana | Kolom `db_name`, `db_hostname`, `group_name`, `owner_user_id`, `status` | idem |
| Membatasi jumlah tenant | `TURSO_MAX_TENANT_DATABASES` (default 99, sesuai kuota gratis Turso) | `server/env.ts`, `provision.ts` 429 |
| Menerbitkan akses sementara ke satu tenant | `createToken(dbName, ttl, 'full-access')` | `server/turso-platform.ts` |
| Menerapkan perubahan skema ke semua tenant | `npm run schema:apply-all` (dry-run bawaan; `--apply`, opsional `--only <slug\|db_name>`; migrasi tertunda → `tenant.sql`, database baru cukup `tenant.sql`) | `scripts/apply-schema-all.mjs` |
| Memverifikasi SQL aplikasi cocok dengan skema | `npm run audit:sql` | `scripts/audit-sql.mjs` |
| Mengisi tenant dengan data contoh | `npm run demo:tenant -- --tenant <slug> --reset` | `scripts/seed-demo-tenant.ts` |
| Mengelola akun karyawan tenant | `POST /api/admin/users`, `POST /api/admin/users/[id]/password` (sesi admin wajib) | `api/admin/*` |
| Memantau kesehatan layanan | `GET /api/health` | `api/health.ts` |
| Masuk ke aplikasi sebagai `platform_owner` | Login biasa; semua route menerima peran ini | `src/App.tsx` (`ALL_ROLES`) |

---

## 3. Yang belum ada (gap yang harus disadari)

| # | Gap | Dampak | Prioritas |
|---|---|---|---|
| 1 | **Tidak ada konsol platform** — belum ada layar daftar tenant, detail, atau statistik | Semua pengelolaan lewat SQL/CLI; operator tanpa akses database tidak bisa bekerja | P0 |
| 2 | Belum ada aksi **approve / suspend / arsipkan** tenant di UI, padahal kolom `status` sudah ada | Status hanya bisa diubah manual di control DB | P0 |
| 3 | Belum ada **tier/paket** dan **feature flag** per tenant; tabel `tenants` tidak punya kolom `plan` | Tidak bisa menjual paket berbeda atau mematikan modul per pelanggan | P1 |
| 4 | Belum ada **penagihan/langganan** (invoice, jatuh tempo, reminder) | Tidak ada alur komersial | P1 |
| 5 | Belum ada **audit lintas tenant** (siapa dari platform membuka tenant mana) | Tidak ada jejak akses operator | P1 |
| 6 | Belum ada **impersonate / support access** dengan jejak audit | Dukungan pelanggan harus minta password | P1 |
| 7 | Belum ada **hapus/restore database** dari aplikasi | Salah buat tenant menumpuk di kuota (99 DB gratis) | P1 |
| 8 | Belum ada **pemakaian sumber daya** per tenant (ukuran DB, jumlah transaksi) | Sulit menentukan harga dan mendeteksi tenant besar | P1 |
| 9 | Belum ada **undangan email** untuk pemilik/karyawan | Password harus disampaikan manual | P2 |
| 10 | Belum ada **CI** yang menjalankan test/typecheck/audit SQL sebelum deploy | Regresi skema bisa lolos | P0 |

Catatan penting soal kuota: paket gratis Turso memberi 100 database per organisasi. Dengan
`schema_version` dan `apply-schema-all`, satu organisasi bisa melayani puluhan tenant tanpa
perubahan kode — tetapi **penghapusan tenant** (gap #7) wajib ada sebelum kuota terpakai penuh.

---

## 4. Rencana berikutnya (usulan urutan)

1. **Konsol platform** (`/platform`): daftar tenant (nama, slug, paket, status, jumlah pengguna,
   ukuran DB, terakhir aktif), tombol suspend/aktifkan, dan tautan "buka sebagai" dengan audit.
2. **Tier & fitur**: kolom `plan` + `features` (JSON) pada registry, dibaca saat bootstrap untuk
   menyembunyikan menu yang tidak termasuk paket.
3. **Audit operator**: tabel `platform_audit` di control DB (aktor, tenant, aksi, waktu, IP).
4. **Lifecycle database**: hapus/restore tenant, plus peringatan bila kuota > 80%.
5. **CI**: `npm run typecheck && npm test && npm run audit:sql && npm run build` pada setiap PR.
