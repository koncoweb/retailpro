# Deployment RetailPro

| | |
|---|---|
| Dokumen | `docs/deployment.md` |
| Terakhir diperbarui | **2026-10-31** |
| Cakupan | Cara aplikasi berjalan di produksi: dua proyek Vercel, dua database Turso cloud, variabel lingkungan, langkah deploy & verifikasi, serta aturan platform yang tidak boleh dilanggar |
| Rujukan | [arsitektur.md](arsitektur.md) §7 · [backend.md](backend.md) §2 & §12 · [kendala-solusi.md](kendala-solusi.md) KS-26…KS-30 |

> Dokumen ini adalah **runbook**, bukan rencana. Setiap nilai di bawah diambil dari proyek yang
> benar-benar sudah ter-deploy dan sudah diverifikasi lewat HTTP serta browser pada 2026-10-28.

---

## 1. Topologi produksi

Dua proyek Vercel, satu organisasi Turso.

```
                    https://retailpro-thalia.vercel.app        https://thalia-storefront.vercel.app
                    +--------------------------------+          +--------------------------------+
  Browser  -------> | SPA statis (dist/)             |          | TanStack Start (SSR + aset)    |
                    | + /api/* serverless functions  |          | tanpa kredensial database      |
                    +---------------+----------------+          +---------------+----------------+
                                    |                                          |
                    sesi (cookie)   |  token tenant 60m                        | GET /api/storefront/catalog
                                    v                                          |
                    +-------------------------------+  <-----------------------+
                    | Control DB (Turso)            |
                    | Better Auth + tenant_databases|
                    +---------------+---------------+
                                    | mint token
                                    v
                    +-------------------------------+
                    | DB tenant Thalia (Turso)      |  <--- browser SPA: @libsql/client/web + JWT
                    | 29 tabel, tanpa tenant_id     |
                    +-------------------------------+
```

| Komponen | Nilai |
|---|---|
| Proyek Vercel (back office + API) | `retailpro-thalia` · root repository · https://retailpro-thalia.vercel.app |
| Proyek Vercel (toko online) | `thalia-storefront` · root `tokoonline/` · https://thalia-storefront.vercel.app |
| Control DB Turso | `retailpro-control-koncowebliberation.aws-ap-southeast-2.turso.io` |
| DB tenant Turso | `rp-thalia-koncowebliberation.aws-ap-southeast-2.turso.io` |
| Grup Turso | `ap-southeast-2` (satu-satunya grup yang ada di organisasi) |
| Akun/team Vercel | pengguna `koncoweb`, team `koncowebs-projects` |
| CLI yang dipakai | Vercel CLI 50.13.2, Node ≥ 20 |

Yang **tidak** ikut ter-deploy: `.data/` (database file lokal), `dist/` versi lama,
`.vercel-tmp/`, berkas `*.log`, dan seluruh `tokoonline/` di deployment back office — lihat
`.vercelignore`.

---

## 2. Kredensial yang dibutuhkan

| Kredensial | Dari mana | Dipakai untuk |
|---|---|---|
| `TURSO_API_TOKEN` | Turso → Settings → Tokens (scope organisasi) | Membuat/menghapus database tenant, menerbitkan token database |
| `CONTROL_DB_TOKEN` | `npm run demo:cloud -- --write-env` atau `POST /v1/.../auth/tokens` | Akses Kysely ke control DB dari fungsi serverless |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` | Menandatangani session Better Auth |
| Sesi Vercel | `vercel login` (device flow) | `vercel link`, `vercel env`, `vercel --prod` |

Aturan: token Turso organisasi **tidak pernah** masuk ke browser. Browser hanya menerima token
per-tenant berumur `TENANT_TOKEN_TTL` (bawaan 60 menit) yang diterbitkan `/api/tenant/bootstrap`.

---

## 3. Menyiapkan database cloud

Control DB dan DB tenant dibuat oleh satu skrip, bukan lewat dashboard:

```sh
# 1. Isi TURSO_API_TOKEN, TURSO_ORG_SLUG, TURSO_GROUP, BETTER_AUTH_SECRET di .env
# 2. Buat/ulangi seluruh data plane cloud (idempoten)
npm run demo:cloud                 # cetak nilai env ke stdout
npm run demo:cloud -- --write-env  # tulis CONTROL_DB_URL/TOKEN dkk. ke .env tanpa mencetak token
```

`scripts/setup-cloud-demo.ts` melakukan, berurutan:

1. `ensureDatabase('retailpro-control')` lalu `ensureDatabase('rp-thalia')` — memakai database yang
   sudah ada bila namanya sama, atau membuatnya di `TURSO_GROUP`.
2. Bila grup yang diminta tidak ada, skrip memilih **grup pertama yang tidak diarsipkan**
   (`listGroups()`) karena organisasi baru tidak punya grup `default`.
3. Menerbitkan token long-lived (mencoba `never`, lalu `30d`) untuk kedua database.
4. Menerapkan `db/schema/control.sql`, mendaftarkan pemilik Thalia lewat `auth.api.signUpEmail`,
   lalu `seedDemoTenant({ reset: true })` (28 produk, 5 vendor, 328 transaksi).
5. Menulis baris `tenant_databases` dengan `db_name`, `db_hostname`, dan `group_name` cloud.

Kredensial owner demo diambil dari `DEMO_OWNER_EMAIL` / `DEMO_PASSWORD` bila diisi; nilai
bawaannya ada di `scripts/setup-cloud-demo.ts`. Skrip ini **reset** data tenant Thalia setiap kali
dijalankan — jangan arahkan ke tenant berisi data nyata.

Pemeriksaan cepat tanpa dashboard:

```sh
curl -H "Authorization: Bearer $TURSO_API_TOKEN" \
  https://api.turso.tech/v1/organizations/$TURSO_ORG_SLUG/databases
curl -H "Authorization: Bearer $TURSO_API_TOKEN" \
  https://api.turso.tech/v1/organizations/$TURSO_ORG_SLUG/groups
```

---

## 4. Variabel lingkungan per proyek

Diisi di **Vercel → Project → Settings → Environment Variables → Production**, bukan dari `.env`
lokal. `vercel env add <NAME> production` membaca nilainya dari stdin.

### 4.1 `retailpro-thalia`

| Variabel | Nilai produksi |
|---|---|
| `TURSO_API_TOKEN` | token organisasi |
| `TURSO_ORG_SLUG` | `koncowebliberation` |
| `TURSO_GROUP` | `ap-southeast-2` |
| `TURSO_MAX_TENANT_DATABASES` | `99` |
| `CONTROL_DB_URL` | host control DB cloud (`https://…turso.io`) |
| `CONTROL_DB_TOKEN` | token control DB |
| `BETTER_AUTH_SECRET` | secret produksi |
| `BETTER_AUTH_URL` | `https://retailpro-thalia.vercel.app` — **harus** origin yang dibuka browser |
| `STOREFRONT_TENANT_SLUG` | `thalia` |

### 4.2 `thalia-storefront`

| Variabel | Nilai produksi | Catatan |
|---|---|---|
| `VITE_CATALOG_API_URL` | `https://retailpro-thalia.vercel.app` | **Build-time**: nilainya dipanggang ke bundle, jadi ubah lalu deploy ulang |

Tidak ada variabel lain: toko tidak memegang kredensial database mana pun.

`BETTER_AUTH_URL` yang salah adalah penyebab paling umum "login berhasil tetapi sesi hilang" di
produksi, karena cookie `secure` dan trusted origin mengikuti nilai itu.

**Tidak** termasuk di sini: `E2E_AI_BASE_URL` / `E2E_AI_API_KEY` / `E2E_AI_MODEL` dan `APP_URL`. Variabel
itu hanya dibaca `e2e.config.ts` di mesin operator (lihat [backend.md](backend.md) §2 dan §7.1 di bawah), jadi
jangan ditambahkan ke dashboard Vercel — kunci model bukan milik runtime aplikasi.

---

## 5. Deploy back office + API

```sh
vercel login                          # device flow, sekali per mesin
vercel link --yes --project retailpro-thalia
vercel --prod                         # dari root repository
```

`vercel link` pada proyek ini juga menautkan repository GitHub `koncoweb/retailpro`, sehingga push
ke branch yang terhubung ikut memicu deployment produksi. Bila tidak diinginkan, putuskan di
Project → Settings → Git.

### 5.1 Kontrak `vercel.json`

| Bagian | Isi | Alasan |
|---|---|---|
| `framework` / `buildCommand` | `vite` / `npm run build` | SPA Vite, output `dist/` |
| `rewrites[0]` | `/api/auth/(.*)` → `/api/auth/[...all]` | Fungsi standalone tidak mengenal nama berkas bracket |
| `rewrites[1]` | `/api/admin/users/([^/]+)/password` → `/api/admin/users/[id]/password` | idem untuk route dinamis |
| `rewrites[2]` | `/((?!api/).*)` → `/index.html` | SPA fallback, dengan negative lookahead agar `/api/*` tidak tertelan |
| `headers` | CSP + `X-Frame-Options` + `nosniff` + `Referrer-Policy` + `Permissions-Policy` | CSP mengizinkan `connect-src https://*.turso.io wss://*.turso.io` karena browser bicara langsung ke Turso |
| `functions["api/**/*.ts"].includeFiles` | `db/schema/**` | `server/provision.ts` membaca `tenant.sql` & `seed.sql` dari disk saat runtime |

Urutan `rewrites` penting: catch-all harus **terakhir**, kalau tidak `/api/*` akan dijawab
`index.html` dan endpoint terlihat "hilang".

---

## 6. Deploy toko online

```sh
cd tokoonline
vercel link --yes --project thalia-storefront
vercel env add VITE_CATALOG_API_URL production    # https://retailpro-thalia.vercel.app
vercel --prod
```

Catatan yang sudah terbukti di lapangan:

- Build memakai Nitro preset Vercel dan mengeluarkan `.vercel/output`; `vercel --prod` mengunggah
  output itu. Hapus `.vercel/output` lama sebelum build ulang bila ragu.
- `npm run build` menjalankan `scripts/migrate.mjs` di belakangnya; skrip itu **melewati** migrasi
  bila `DATABASE_URL` tidak diset, jadi aman di proyek yang tidak punya database.
- `VITE_AUTH_ENABLED=false` berasal dari `.grok/app-env.json`; `scripts/with-app-env.mjs` tidak
  menimpa nilai yang sudah ada di environment.
- Vercel menolak deploy bila `@tanstack/react-start` < 1.168.60 (CVE-2026-102989). Paket di
  `package.json` harus ≥ 1.168.60 (sekarang 1.168.61); jangan memakai flag
  `DANGEROUSLY_DEPLOY_VULNERABLE_TANSTACK_START_XSS`.

---

## 7. Verifikasi setelah deploy

Jalankan berurutan; berhenti di langkah pertama yang gagal.

```sh
# 1. Fungsi hidup (bukti import ESM & rewrite /api)
curl -s https://retailpro-thalia.vercel.app/api/health
# {"ok":true,"service":"retailpro-api","tursoOrg":"koncowebliberation",
#  "group":"ap-southeast-2","controlDbConfigured":true,...}

# 2. Control DB + token terbaca (katalog publik)
curl -s "https://retailpro-thalia.vercel.app/api/storefront/catalog?slug=thalia"
# shop "Thalia Toko Bahan Kue", 7 kategori, 28 produk, gudang pemenuh "Gudang Pusat Depok"

# 3. Better Auth (bukti rewrite catch-all)
curl -s -X POST https://retailpro-thalia.vercel.app/api/auth/sign-in/email \
  -H 'content-type: application/json' \
  -d '{"email":"owner@tokobahankue.com","password":"<demo>"}'
# 200 + user.role "tenant_owner"; cookie sesi

# 4. Token tenant (bukti registry + Turso Platform API). Butuh cookie dari langkah 3.
curl -s -X POST https://retailpro-thalia.vercel.app/api/tenant/token -b cookies.txt
# {dbUrl: "https://rp-thalia-…turso.io", token: "<±371 char JWT>", expiresAt: …}
```

Di browser: buka toko → harus tampil 28 produk dengan teks "dikirim dari Gudang Pusat Depok", dan
permintaan jaringan hanya ke `retailpro-thalia.vercel.app`. Login di back office → `/mode-select`
→ `/backoffice` harus memuat dashboard dengan panggilan `/v2/pipeline` ke `*.turso.io`. Bila
dashboard kosong sementara katalog benar, yang salah biasanya `BETTER_AUTH_URL` atau sesi, bukan
database.

### 7.1 Uji UI otomatis (e2e) terhadap deployment

Smoke test `tests/login.e2e.ts` hanya membaca (membuka `/login`, memeriksa field dan tombol), jadi
aman diarahkan ke produksi:

```powershell
$env:APP_URL = "https://retailpro-thalia.vercel.app"; npx e2e run --grep login
```

`e2e` berjalan di mesin operator, bukan di Vercel: kunci model tetap di `.env` lokal dan tidak perlu
dimasukkan sebagai env proyek. Artefak `.e2e/` tidak di-commit. Alur yang **menulis** data (POS,
penerimaan barang, pengeluaran) jangan diarahkan ke tenant produksi — jalankan terhadap
`http://localhost:8080` dengan tenant demo.

---

## 8. Aturan platform yang mengikat kode

| Aturan | Konsekuensi bila dilanggar |
|---|---|
| **Import relatif di `api/` dan `server/` wajib berekstensi `.js`** (mis. `from '../server/http.js'`) | Vercel men-transpile tiap berkas fungsi secara terpisah dan membacanya sebagai ESM (`"type": "module"`); import tanpa ekstensi gagal saat runtime → `500 FUNCTION_INVOCATION_FAILED`. `tsx` lokal tetap menemukan `.ts`, jadi masalahnya hanya muncul di produksi (KS-26) |
| **Route dinamis/catch-all harus lewat `rewrites`** | `api/auth/[...all].ts` dan `api/admin/users/[id]/password.ts` bukan nama rute yang valid untuk fungsi standalone → `404 NOT_FOUND` dari platform (KS-27) |
| **`db/schema/**` harus ikut ke lambda** lewat `functions.includeFiles` | Provisioning gagal karena berkas SQL tidak ada di bundle fungsi |
| **CSP harus mengizinkan host Turso** (`https://*.turso.io`, `wss://*.turso.io`) | Browser memblokir koneksi libSQL; halaman tampak "gagal memuat data" tanpa error server |
| **`BETTER_AUTH_URL` = origin publik** | Cookie aman/trusted origin tidak cocok, sesi hilang setelah login |
| **`VITE_*` dipanggang saat build** | Mengubah `VITE_CATALOG_API_URL` tanpa deploy ulang tidak berefek apa pun |
| **Variabel Turso tidak boleh berawalan `VITE_`** | Rahasia ikut ke bundle browser |

---

## 9. Operasional

| Kebutuhan | Cara |
|---|---|
| Melihat log fungsi | `vercel logs <deployment-url>` atau Vercel → Deployments → Functions |
| Inspeksi deployment | `vercel inspect <deployment-url>` |
| Kembali ke versi sebelumnya | Vercel → Deployments → pilih deployment lama → **Promote to Production** (atau `vercel rollback`) |
| Mengubah env produksi | `vercel env rm <NAME> production` lalu `vercel env add <NAME> production`, kemudian deploy ulang |
| Mengisi ulang data demo | `npm run demo:cloud -- --write-env` lalu deploy ulang bila control DB berganti |
| Memeriksa kuota | `GET /v1/organizations/{org}/usage`; batas tenant dijaga `TURSO_MAX_TENANT_DATABASES` |
| Rotasi token yang bocor | Turso → Settings → Tokens → revoke, buat token baru, perbarui env Vercel + `.env`, deploy ulang (KS-17) |

Deployment tidak menjalankan `npm run typecheck`, `npm test`, `npm run test:e2e`, atau `npm run audit:sql` — belum ada
CI (KS-21), jadi keempatnya dijalankan manual sebelum `vercel --prod`.

---

## 10. Checklist rilis

1. `npm run typecheck && npm test && npm run audit:sql` lulus di root. Bila perubahan menyentuh UI,
   jalankan juga `npm run test:e2e` dengan `npm run dev` (`:8080`) dan `npm run dev:api` (`:3000`) hidup.
2. `cd tokoonline && npm run typecheck` lulus.
3. Variabel produksi lengkap (§4) dan `BETTER_AUTH_URL` menunjuk domain final.
4. `npm run demo:cloud` hanya dijalankan bila memang ingin me-reset data demo.
5. `vercel --prod` dari root, lalu dari `tokoonline/` bila katalog berubah.
6. Empat pemeriksaan §7 lulus, plus dashboard & toko dibuka di browser.
7. Catat perubahan di [fitur-tenant.md](fitur-tenant.md) / [fitur-platform.md](fitur-platform.md),
   dan tambahkan entri bila ada masalah baru di [kendala-solusi.md](kendala-solusi.md).

---

## 11. Batasan yang masih berlaku

1. **Pesanan dari toko online belum masuk ke database tenant** — masih disimpan di perangkat
   pengunjung (prototype); yang live adalah katalog, harga, satuan, dan stok.
2. **Belum ada CI** dan belum ada staging; setiap deploy langsung ke produksi, dan uji e2e dijalankan
   manual dari mesin operator.
3. **Satu region** (`ap-southeast-2`) untuk semua database; tidak ada replika baca.
4. **Menghapus tenant belum ada di UI** (fitur-platform gap #7) — pembersihan masih lewat API
   Turso atau `deleteDatabase()`.
5. **Kanal online tidak punya rak**, jadi stok web diambil dari gudang pusat; pengiriman pesanan
   web tidak membuat dokumen transfer.
