# Kendala & Solusi RetailPro

| | |
|---|---|
| Dokumen | `docs/kendala-solusi.md` |
| Terakhir diperbarui | **2026-10-27** |
| Isi | Masalah, bug, error, dan ketidaksesuaian yang benar-benar dihadapi — beserta cara mengatasi dan pelajarannya |

## Cara memakai log ini

- Satu entri = satu masalah dengan ID stabil (`KS-nn`). **Jangan hapus** entri lama; ubah `Status`
  bila sudah selesai.
- Setiap entri wajib punya: gejala, akar masalah, solusi, bukti (file/perintah), pelajaran.
- Tambahkan entri baru di nomor berikutnya, dengan tanggal kejadian.

## Ringkasan

| ID | Tanggal | Masalah singkat | Status |
|---|---|---|---|
| KS-01 | 2026-10-27 | Kredensial database di repo + isolasi tenant bergantung pada klien | Selesai (rotasi token: lihat KS-17) |
| KS-02 | 2026-10-27 | Role tidak ada di session → route guard lolos untuk siapa pun | Selesai |
| KS-03 | 2026-10-27 | Registrasi tenant tidak membuat tenant apa pun | Selesai |
| KS-04 | 2026-10-27 | Omzet dihitung dari `amount_paid` (termasuk kembalian) | Selesai |
| KS-05 | 2026-10-27 | Transfer stok kehilangan tanggal kedaluwarsa & HPP batch | Selesai |
| KS-06 | 2026-10-27 | Opname negatif membuat batch berkuantitas negatif | Selesai |
| KS-07 | 2026-10-27 | Pengaturan tidak tersimpan (toast sukses, data hilang) | Selesai |
| KS-08 | 2026-10-27 | Penerimaan PO menulis hutang ke tabel yang tidak dibaca UI | Selesai |
| KS-09 | 2026-10-27 | Hapus produk menjalankan tiga DELETE terpisah | Selesai |
| KS-10 | 2026-10-27 | Dua implementasi shift (satu hanya mengubah state lokal) | Selesai |
| KS-11 | 2026-10-27 | Seed demo gagal: `UNIQUE constraint failed: transactions.invoice_number` | Selesai |
| KS-12 | 2026-10-27 | Seed demo: perbedaan tipe & bug urutan replace pada katalog | Selesai |
| KS-13 | 2026-10-27 | Test gagal di Windows karena file DB masih dipegang libSQL | Selesai |
| KS-14 | 2026-10-27 | Browser tidak bisa membuka database `file:` | Selesai (dengan batasan) |
| KS-15 | 2026-10-27 | Nama kolom stok minimum berbeda antara dokumen, tipe, dan skema | Selesai |
| KS-16 | 2026-10-27 | Dokumentasi lama (Neon/RLS) bertentangan dengan kode | Selesai |
| KS-17 | 2026-10-27 | Token organisasi Turso pernah ditempel di percakapan | **Terbuka (operator)** |
| KS-18 | 2026-10-27 | `.env` belum diisi → tenant Turso nyata belum bisa dibuat | **Terbuka (operator)** |
| KS-19 | 2026-10-27 | Tabel `payables` masih ada tetapi tidak dipakai | **Terbuka** |
| KS-20 | 2026-10-27 | Bundle 2 MB dalam satu chunk | Terbuka (rendah) |
| KS-21 | 2026-10-27 | Tidak ada CI (test/typecheck/audit manual) | **Terbuka** |
| KS-22 | 2026-10-27 | Petunjuk `.env.local`, tetapi API & script hanya membaca `.env` | **Terbuka** |
| KS-23 | 2026-10-27 | Stok terkunci pada cabang (satu gudang tidak bisa melayani dua cabang) | Selesai |
| KS-24 | 2026-10-27 | Urutan pengeluaran stok dipaku di lima tempat (tidak bisa FEFO) | Selesai |

---

## KS-01 · 2026-10-27 · Kredensial database di repo & isolasi tenant yang bergantung pada klien

| | |
|---|---|
| **Gejala** | `.env` ikut ter-commit berisi kredensial Postgres level owner; string koneksi ikut masuk ke bundle browser |
| **Akar masalah** | Aplikasi memanggil Postgres langsung dari browser dan mengandalkan Row Level Security yang identitasnya di-`set_config` oleh klien sendiri (`app.current_tenant_id`, `app.user_role`) |
| **Solusi** | Pindah ke Turso libSQL dengan **satu database per tenant**. `.env` di-ignore, `.env.example` mencatat semua variabel tanpa nilai. Browser hanya menerima token 60 menit untuk **satu** database. Tidak ada lagi `tenant_id` dan RLS |
| **Bukti** | `db/schema/tenant.sql` (tanpa `tenant_id`), `src/lib/db/client.ts`, `api/tenant/bootstrap.ts`, `.gitignore`, `src/lib/db/__tests__/schema.test.ts` |
| **Pelajaran** | Kalau klien menentukan identitasnya sendiri, itu bukan isolasi — itu janji. Isolasi harus menjadi batas yang tidak bisa dilanggar dari sisi klien (database terpisah) |

---

## KS-02 · 2026-10-27 · Route guard lolos ketika role tidak diketahui

| | |
|---|---|
| **Gejala** | Semua halaman back office bisa dibuka semua orang yang login; sidebar sebagian hilang |
| **Akar masalah** | `RoleBasedRoute` memakai pola `if (role && !allowedRoles.includes(role))`. Karena `role` tidak pernah ada di session (role disimpan di tabel `users`, bukan di session auth), kondisi selalu `false` → halaman dirender |
| **Solusi** | Tiga langkah: (1) `role`/`tenantId`/`branchId` didaftarkan sebagai `additionalFields` Better Auth sehingga selalu ada di session; (2) guard dibuat **gagal-tertutup** — tanpa role → `/login`; (3) setiap route diberi daftar `allowedRoles` eksplisit di `src/App.tsx` |
| **Bukti** | `server/auth.ts`, `src/components/auth/RoleBasedRoute.tsx`, `src/App.tsx` |
| **Pelajaran** | Guard harus menolak secara default. `if (role && ...)` adalah bug menunggu terjadi setiap kali ada field yang kosong |

---

## KS-03 · 2026-10-27 · Registrasi tenant tidak membuat tenant

| | |
|---|---|
| **Gejala** | Setelah daftar, pemilik masuk ke aplikasi kosong; layar sukses selalu muncul |
| **Akar masalah** | `RegisterTenant.tsx` hanya menampilkan layar sukses (`TODO: Call Backend API`); tidak ada endpoint provisioning dan tidak ada skema di repo |
| **Solusi** | `POST /api/tenant/provision` menjalankan `provisionTenant()`: buat database Turso → terapkan skema + seed → daftarkan di `tenant_databases` → buat cabang utama. Gagal di tengah → database dihapus |
| **Bukti** | `api/tenant/provision.ts`, `server/provision.ts`, `db/__tests__/seed.test.ts` |
| **Pelajaran** | Alur onboarding harus diuji terhadap database sungguhan (bukan mock), karena justru langkah-langkahnya yang mudah gagal |

---

## KS-04 · 2026-10-27 · Omzet dihitung dari uang diterima

| | |
|---|---|
| **Gejala** | Setelah kembalian disimpan dengan benar, laporan penjualan membengkak; delapan agregat memakai `SUM(amount_paid)` |
| **Akar masalah** | `amount_paid` dulu diisi sama dengan total. Ketika artinya diubah menjadi "uang tunai yang diterima", semua agregat lama otomatis menghitung kembalian sebagai pendapatan |
| **Solusi** | Omzet **selalu** `SUM(total_amount)`. `amount_paid` hanya untuk rekonsiliasi kas shift. `expected_cash = initial_cash + SUM(total_amount WHERE payment_method='cash')` |
| **Bukti** | `src/pages/Dashboard.tsx`, `Reports.tsx`, `FinanceReports.tsx`, `POSShifts.tsx`, `server/demo/seed.ts` (`describeTenant`) |
| **Pelajaran** | Mengubah arti sebuah kolom adalah perubahan skema secara diam-diam. Setiap agregat yang memakainya harus dicari dan diperiksa |

---

## KS-05 · 2026-10-27 · Transfer stok kehilangan kedaluwarsa & HPP

| | |
|---|---|
| **Gejala** | Barang berumur pendek menjadi "panjang umur" setelah dipindah cabang; HPP menjadi rata-rata sehingga laba per batch tidak bisa dilacak |
| **Akar masalah** | Saat penerimaan, semua batch sumber digabung menjadi satu batch tujuan dengan `avgCost`, dan `expiry_date` tidak ikut disalin |
| **Solusi** | Satu leg pengeluaran = satu baris `transfer_items` = satu batch tujuan, masing-masing membawa `cost_price`, `expiry_date`, dan `supplier_id` asalnya |
| **Bukti** | `src/pages/BranchTransfers.tsx`, `src/pages/Inventory.tsx`, `db/__tests__/schema.test.ts` |
| **Pelajaran** | Kalau dua jalur menulis entitas yang sama (POS dan transfer), keduanya harus memakai aturan pengeluaran stok yang identik (`src/lib/stock-issue.ts`) — kalau tidak, laporan akan berbeda tergantung siapa yang menulis |

---

## KS-06 · 2026-10-27 · Opname negatif membuat batch negatif

| | |
|---|---|
| **Gejala** | Total stok bisa turun di bawah nol dan setiap penjumlahan stok setelahnya salah |
| **Akar masalah** | Penyesuaian negatif disimpan sebagai batch dengan `quantity_initial`/`quantity_current` negatif |
| **Solusi** | Penyesuaian negatif menguras batch yang ada dari yang tertua, dengan penjagaan kuantitas; seluruh penyimpanan produk berjalan dalam satu transaksi |
| **Bukti** | `src/pages/Inventory.tsx` (`handleOpname`, `handleSaveProduct`) |
| **Pelajaran** | Stok adalah hasil penjumlahan; satu baris negatif merusak semuanya. Penyesuaian harus berupa mutasi, bukan angka negatif |

---

## KS-07 · 2026-10-27 · Pengaturan tidak tersimpan

| | |
|---|---|
| **Gejala** | Pengguna mengubah footer struk, PPN, dan rekening bank; muncul toast sukses; setelah reload semuanya hilang |
| **Akar masalah** | Panel pengaturan menyimpan ke `useState` lokal; tombol "Simpan Pengaturan" tidak punya handler |
| **Solusi** | `lib/tenant-settings.ts` membaca/menggabungkan/menulis `tenants.settings` dalam satu transaksi; setiap panel punya indikator simpan |
| **Bukti** | `src/lib/tenant-settings.ts`, `src/components/settings/*` |
| **Pelajaran** | Toast sukses tanpa penulisan adalah kebohongan UI. Setiap tombol simpan harus punya bukti persistensi |

---

## KS-08 · 2026-10-27 · Penerimaan PO menulis hutang ke tabel yang tidak dibaca UI

| | |
|---|---|
| **Gejala** | Stok bertambah tetapi Hutang (AP), Cashflow, dan Jurnal tidak menunjukkan kewajiban apa pun; total hutang tidak pernah cocok dengan PO yang diterima |
| **Akar masalah** | `handlePO` menulis ke tabel `payables`, sementara layar Hutang/Piutang membaca `expenses WHERE amount > amount_paid`. Dua sumber kebenaran untuk hal yang sama |
| **Solusi** | Penerimaan PO membukukan satu baris `expenses` kategori `Pembelian Stok` berstatus `unpaid` (konsisten dengan jalur stok masuk lainnya). Dataset demo melakukan hal yang sama |
| **Bukti** | `src/pages/Inventory.tsx` (`handlePO`), `src/pages/finance/ApAr.tsx`, `server/demo/ledger.ts` |
| **Pelajaran** | Tabel tanpa pembaca adalah fitur yang tidak ada. Sebelum menambah tabel, pastikan siapa yang membaca dan siapa yang menulisnya |

---

## KS-09 · 2026-10-27 · Hapus produk menjalankan tiga DELETE terpisah

| | |
|---|---|
| **Gejala** | Bila satu langkah gagal, tersisa batch atau satuan tanpa produk induk |
| **Akar masalah** | `handleDeleteProduct` memanggil `query()` tiga kali di luar transaksi |
| **Solusi** | Ketiga perintah dibungkus `runTransaction()`. (Batasan tersisa: penghapusan masih permanen dan memutus riwayat transaksi — lihat KS-19 catatan) |
| **Bukti** | `src/pages/Inventory.tsx` |
| **Pelajaran** | Setiap penulisan lebih dari satu tabel harus transaksional secara default, bukan pengecualian |

---

## KS-10 · 2026-10-27 · Dua implementasi shift

| | |
|---|---|
| **Gejala** | Menutup shift dari POS tampak berhasil, tetapi shift di database tetap `open` |
| **Akar masalah** | `POS.tsx` punya `ShiftModal` yang hanya mengubah state lokal; hanya `POSShifts.tsx` menulis ke database |
| **Solusi** | Kedua layar memakai jalur persistensi yang sama; shift terbuka/tertutup tercatat dengan kas awal, kas akhir, kas seharusnya, dan selisih |
| **Bukti** | `src/pages/POS.tsx`, `src/pages/POSShifts.tsx`, `server/demo/ledger.ts` |
| **Pelajaran** | Satu perilaku bisnis = satu implementasi. Duplikasi UI cepat berubah menjadi dua kebenaran |

---

## KS-11 · 2026-10-27 · Seed demo gagal karena nomor invoice duplikat

| | |
|---|---|
| **Gejala** | `SQLITE_CONSTRAINT: UNIQUE constraint failed: transactions.invoice_number` pada seed kedua/berikutnya |
| **Akar masalah** | Nomor invoice dibuat per-hari (`INV/<tanggal>-<kode>-001`). Shift "hari ini" dimulai 3 jam sebelum waktu jalan, sehingga pada eksekusi dini hari shift melewati tengah malam dan bertabrakan dengan penomoran hari sebelumnya |
| **Solusi** | Satu penghitung global `invoiceSeq` untuk seluruh dataset; tanggal hanya bagian dari tampilan, bukan penentu urutan |
| **Bukti** | `server/demo/ledger.ts` (`nextInvoice`) |
| **Pelajaran** | Penomoran berbasis tanggal mudah patah pada rentang waktu yang melewati batas hari. Gunakan satu penomoran dokumen yang monoton |

---

## KS-12 · 2026-10-27 · Katalog demo: tipe, `as const`, dan bug urutan replace

| | |
|---|---|
| **Gejala** | Tiga masalah berurutan: (a) objek unit punya properti `unitPrice` yang tidak dipakai dan cast tipe gagal; (b) `as const`/`satisfies` membuat tipe readonly sehingga menyulitkan konsumen; (c) setelah penggantian string berurutan, gaji Agus Salim ikut turun menjadi sama dengan staf lain |
| **Akar masalah** | (a) helper `product()` mengembalikan bentuk berbeda dari `DemoUnit`; (b) tipe literal readonly bocor ke API publik; (c) rantai `Replace("4_500_000","4_000_000")` lalu `("4_000_000","3_300_000")` saling menimpa |
| **Solusi** | (a) helper mengembalikan `{ name, factor, price }`; (b) anotasi `DemoCatalog` menggantikan `as const`; (c) nilai dipulihkan eksplisit per entri, bukan lewat replace massal |
| **Bukti** | `server/demo/catalog.ts` |
| **Pelajaran** | Jangan menjalankan replace berurutan pada nilai yang bisa menjadi hasil replace sebelumnya. Untuk data contoh, uji angkanya (test) agar salah ketik langsung terlihat |

---

## KS-13 · 2026-10-27 · Test gagal di Windows karena file database masih dipegang

| | |
|---|---|
| **Gejala** | Test lulus sekali lalu gagal (`EBUSY` / file tidak bisa dihapus) pada eksekusi berikutnya |
| **Akar masalah** | libSQL mempertahankan handle file; membersihkan file DB di `afterAll` tidak selalu berhasil di Windows |
| **Solusi** | Setiap run memakai file database sementara dengan nama unik; tidak ada pembersihan yang bergantung pada kunci file |
| **Bukti** | `db/__tests__/seed.test.ts`, `db/__tests__/demo-tenant.test.ts`, `src/lib/db/__tests__/schema.test.ts` |
| **Pelajaran** | Test yang menyentuh database harus menganggap filesystem musuh: pakai nama unik per run, jangan andalkan pembersihan |

---

## KS-14 · 2026-10-27 · Browser tidak bisa membuka database `file:`

| | |
|---|---|
| **Gejala** | Dataset demo hasil `npm run demo:tenant` tidak bisa dipakai untuk mengklik aplikasi |
| **Akar masalah** | `@libsql/client/web` hanya berbicara HTTP/WebSocket ke server libSQL; browser tidak punya akses file. Tidak ada `sqld` lokal di mesin |
| **Solusi** | File lokal dipertahankan sebagai artefak data yang diverifikasi test, dan CLI punya mode `--tenant <slug>` yang menanam data ke tenant Turso yang sudah terdaftar (memakai id tenant & owner asli dari registry) |
| **Bukti** | `scripts/seed-demo-tenant.ts`, `server/demo/seed.ts` |
| **Pelajaran** | Bedakan "data siap" dan "aplikasi bisa diklik". Untuk uji end-to-end perlu database yang bisa dijangkau protokol aplikasi |

---

## KS-15 · 2026-10-27 · Nama kolom stok minimum tidak konsisten

| | |
|---|---|
| **Gejala** | Query `p.min_stock` gagal (`no such column`), padahal dokumen dan tipe menyebut `min_stock_alert` |
| **Akar masalah** | Tiga sumber berbeda: skema memakai `min_stock_level`, `src/types/index.ts` menyebut `min_stock_alert`, `Backend.md` lama memakai `min_stock` |
| **Solusi** | Skema adalah acuan: semua query memakai `min_stock_level`. Tipe domain diselaraskan; dokumen lama diganti |
| **Bukti** | `db/schema/tenant.sql` baris `min_stock_level`, `src/pages/Inventory.tsx` |
| **Pelajaran** | Jika ada tiga nama untuk satu kolom, cepat atau lambat salah satunya dipakai dan gagal di runtime. Beri nama sekali, di skema |

---

## KS-16 · 2026-10-27 · Dokumentasi lama bertentangan dengan kode

| | |
|---|---|
| **Gejala** | `Backend.md` menjelaskan Neon + RLS + `tenant_id` yang sudah tidak ada; `TECHNICAL_DOCS.md` menyebut `tenant_id` pada kategori/supplier; jumlah role 5 (dokumen) vs 7 (kode) |
| **Akar masalah** | Dokumen ditulis sebelum implementasi berubah dan tidak pernah diperbarui |
| **Solusi** | Dokumentasi diganti dengan `docs/` (arsitektur, fitur tenant, fitur platform, frontend, backend, kendala-solusi) yang bertanggal; `Backend.md` dan `TECHNICAL_DOCS.md` dijadikan penunjuk ke dokumen baru. **Koreksi lanjutan 2026-10-27:** `requirement.md` masih memuat strategi *shared schema + RLS*, Neon Auth, `VITE_DATABASE_URL`, dan `tenant_id` pada 12 baris; seluruhnya ditulis ulang (strategi database, auth, deployment, model data) + tabel riwayat revisi bertanggal, sedangkan rencana lamanya disimpan sebagai bagian "Ditolak" |
| **Bukti** | `docs/*.md` (enam dokumen, semua bertanggal 2026-10-27); `Backend.md` & `TECHNICAL_DOCS.md` kini hanya penunjuk (`git show HEAD:<file>` mempertahankan isi lama); `requirement.md` ditulis ulang + tabel riwayat revisi; `TECHNICAL_ISSUES.md` disimpan sebagai arsip audit pra-migrasi |
| **Pelajaran** | Dokumen yang tidak bertanggal tidak bisa dipercaya. Setiap dokumen teknis butuh tanggal dan cara verifikasi |

---

## KS-17 · 2026-10-27 · Token organisasi Turso pernah ditempel di percakapan — **TERBUKA**

| | |
|---|---|
| **Gejala** | Token organisasi Turso dikirim sebagai teks saat perencanaan |
| **Akar masalah** | Kebutuhan eksperimen cepat mengalahkan prosedur rahasia |
| **Solusi sementara** | Token tidak pernah ditulis ke repo atau `.env`; semua kode hanya membaca dari environment |
| **Yang masih harus dilakukan** | **Rotasi/revoke token tersebut di dashboard Turso** (`Settings → Tokens`). Tidak bisa dilakukan dari repo |
| **Pelajaran** | Rahasia yang pernah tampil di tempat tidak terkendali harus dianggap bocor, bukan "mungkin aman" |

---

## KS-18 · 2026-10-27 · `.env` belum diisi — **TERBUKA (operator)**

| | |
|---|---|
| **Gejala** | Tenant Turso sungguhan belum bisa dibuat; uji end-to-end dengan login belum bisa dijalankan |
| **Akar masalah** | `TURSO_API_TOKEN`, `CONTROL_DB_URL`, `CONTROL_DB_TOKEN`, `BETTER_AUTH_SECRET` sengaja kosong |
| **Langkah berikutnya** | Isi `.env` (lihat `.env.example`), pastikan grup `TURSO_GROUP` sudah ada, jalankan `npm run bootstrap:control`, lalu daftar satu tenant lewat `/register-tenant` |
| **Pelajaran** | Kode yang bergantung pada kredensial harus punya jalur verifikasi tanpa kredensial (di sini: test dengan database lokal) |

---

## KS-19 · 2026-10-27 · `payables` duplikatif — **TERBUKA**

| | |
|---|---|
| **Gejala** | Ada dua tempat hutang bisa dicatat (`payables` dan `expenses`), hanya satu yang dibaca UI |
| **Akar masalah** | Desain awal membuat tabel hutang khusus, implementasi finance memilih `expenses` |
| **Pilihan** | (a) hapus `payables` dari skema dan generator demo (paling sederhana), atau (b) jadikan `payables` satu-satunya sumber AP dan migrasikan pembacaan `expenses` |
| **Rekomendasi** | (a) selama keuangan tetap basis kas; (b) bila nanti butuh buku besar penuh |
| **Pelajaran** | Tabel yang tidak punya pembaca adalah utang desain, bukan cadangan |

---

## KS-20 · 2026-10-27 · Bundle 2 MB satu chunk — **TERBUKA (rendah)**

| | |
|---|---|
| **Gejala** | Build memberi peringatan `chunks are larger than 500 kB` |
| **Akar masalah** | Semua halaman diimpor statis di `App.tsx`; `recharts`, `xlsx`, dan shadcn ikut di bundle awal |
| **Rencana** | `React.lazy` per route + `manualChunks` untuk `recharts`/`xlsx` |
| **Pelajaran** | Peringatan build bukan kebisingan; catat, jangan biarkan hilang begitu saja |

---

## KS-21 · 2026-10-27 · Tidak ada CI — **TERBUKA**

| | |
|---|---|
| **Gejala** | Test, typecheck, lint, dan audit SQL hanya dijalankan manual; regresi bisa lolos ke deploy |
| **Solusi diusulkan** | GitHub Actions: `npm ci && npm run typecheck && npm test && npm run audit:sql && npm run build` |
| **Pelajaran** | Pemeriksaan yang tidak otomatis akan dilewati saat mengejar tenggat |

---

## KS-22 · 2026-10-27 · Petunjuk `.env.local`, tetapi API & script hanya membaca `.env` — **TERBUKA**

| | |
|---|---|
| **Gejala** | Mengikuti `.env.example` ("Copy to `.env.local`") membuat `npm run dev:api`, `bootstrap:control`, dan `apply-schema-all` gagal dengan `MissingEnvError` / "TURSO_API_TOKEN is not set", padahal variabel sudah diisi |
| **Akar masalah** | Empat entry point memuat env lewat `dotenv/config`, yang **hanya** membaca `.env`. Vite membaca `.env` **dan** `.env.local`. Jadi nilai di `.env.local` terlihat oleh SPA tetapi tidak oleh server/CLI |
| **Dampak** | Kebingungan saat setup; paling berbahaya bila token ditaruh di `.env.local` lalu dianggap "sudah dikonfigurasi" |
| **Solusi saat ini** | Nilai bersama (Turso, control DB, Better Auth) diisi di **`.env`**; `.env.local` hanya dipakai untuk nilai khusus Vite |
| **Perbaikan yang disarankan** | Pilih satu dari dua: (a) ubah keempat entry point menjadi `dotenv.config({ path: ['.env.local', '.env'] })`, atau (b) ubah `.env.example` menjadi "copy to `.env`" dan hapus `.env.local` dari instruksi. (a) lebih ramah karena `.env.local` lazim diabaikan git |
| **Bukti** | `.env.example` baris 3; `server/dev-api.ts`, `scripts/bootstrap-control.mjs`, `scripts/apply-schema-all.mjs` (semua `import 'dotenv/config'`); `server/env.ts` pesan galat menyebut `.env.local` |
| **Pelajaran** | Instruksi setup adalah bagian dari kode. Kalau instruksi menyebut nama file yang tidak dibaca program, kegagalan pertama selalu terjadi pada pengguna baru, bukan pada penulisnya |

---

## KS-23 · 2026-10-27 · Stok terkunci pada cabang — **SELESAI**

| | |
|---|---|
| **Gejala** | Permintaan "banyak cabang, satu gudang" tidak bisa dipenuhi: setiap batch stok wajib punya `branch_id`, sehingga satu gudang fisik tidak bisa melayani dua cabang dan satu cabang tidak bisa menarik stok dari dua lokasi |
| **Akar masalah** | Lokasi penjualan dan lokasi stok disamakan: `product_batches.branch_id`, `stock_transfers.source_branch_id`/`destination_branch_id`, `purchase_orders.branch_id` |
| **Solusi** | Skema v2 (`db/migrations/002_warehouses.sql`): tabel `warehouses` (`type` pusat/regional/toko, `branch_id` NULL = gudang bersama) + `branch_warehouses` (peta N:N dengan `is_default` dan `priority`); stok pindah ke `product_batches.warehouse_id`; cabang menyimpan `type`, `is_headquarters`, `parent_branch_id`; kasir memakai `resolveBranchWarehouse()` |
| **Bukti** | `db/migrations/002_warehouses.sql`, `db/schema/tenant.sql` (`branches`/`warehouses`/`branch_warehouses`), `src/lib/warehouse.ts`, `src/pages/Warehouses.tsx`, `src/lib/db/__tests__/schema.test.ts`, `db/__tests__/seed.test.ts` |
| **Pelajaran** | "Tempat menjual" dan "tempat menyimpan" tidak boleh disatukan hanya karena di toko kecil keduanya satu bangunan. Memisahkan sejak awal jauh lebih murah daripada memigrasikan skema yang sudah berisi data |

---

## KS-24 · 2026-10-27 · Urutan pengeluaran stok dipaku di lima tempat — **SELESAI**

| | |
|---|---|
| **Gejala** | Barang bermasa simpan tetap kedaluwarsa walau stok berputar; tidak ada cara memakai FEFO (kedaluwarsa terdekat keluar dulu) |
| **Akar masalah** | `ORDER BY received_at ASC, id ASC` ditulis ulang di lima jalur stok keluar: POS, pengurangan stok dari form produk, opname negatif, dan dua implementasi persetujuan transfer. Mengubah satu jalur tidak mengubah yang lain |
| **Solusi** | Kebijakan per tenant `tenants.settings.inventory.stock_issue_method` (`fifo`/`lifo`/`fefo`, bawaan `fifo`) dibaca **sebelum** transaksi; kandidat batch diambil tanpa `ORDER BY` lalu diurutkan di memori oleh `sortBatchesForIssue()` di `src/lib/stock-issue.ts`. FEFO: `expiry_date` terdekat dulu, batch tanpa expiry paling akhir, tie-break FIFO |
| **Batasan yang disengaja** | Average cost (AVCO) tidak dimasukkan — itu metode penilaian persediaan, bukan urutan pengeluaran. Transaksi yang sudah tercatat tidak dihitung ulang |
| **Bukti** | `src/lib/stock-issue.ts`, `src/lib/tenant-settings.ts` (`getStockIssueMethod`), `POS.tsx`, `Inventory.tsx`, `BranchTransfers.tsx`, `src/lib/stock-issue.test.ts` (9 test), test skema kebijakan batch |
| **Pelajaran** | Aturan yang dipakai lebih dari satu jalur tulis harus tinggal di satu fungsi murni yang diuji; menaruhnya di SQL berarti menyalinnya, dan salinan selalu menyimpang |

---

## Pelajaran umum (ringkas)

1. **Isolasi harus fisik.** Pemfilteran data di sisi klien bukan keamanan.
2. **Gagal-tertutup.** Guard, provisioning, dan filter harus menolak saat data tidak lengkap.
3. **Satu perilaku, satu implementasi.** Shift, pengeluaran stok, dan format uang yang diduplikasi cepat
   menghasilkan dua kebenaran.
4. **Tulis > baca.** Tabel/atau fitur baru harus jelas siapa pembacanya, bukan hanya siapa penulisnya.
5. **Uji dengan data sungguhan.** Bug paling mahal (invoice duplikat, batch negatif, omzet
   membengkak) hanya muncul saat database benar-benar diisi.
6. **Setiap dokumen teknis butuh tanggal.** Tanpa tanggal, dokumen lama diam-diam menjadi salah.
7. **Pisahkan yang kebetulan sama.** Di toko kecil cabang dan gudang satu bangunan; menyatukannya
   di skema membuat model "banyak cabang, satu gudang" mustahil tanpa migrasi.
8. **Log itu tambah-baris.** Baris lama yang sudah terjadi tidak boleh disunting agar terbaca benar
   hari ini; perubahan dicatat sebagai baris baru yang menyebut baris sebelumnya.
