# Kendala & Solusi RetailPro

| | |
|---|---|
| Dokumen | `docs/kendala-solusi.md` |
| Terakhir diperbarui | **2026-11-19** |
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
| KS-18 | 2026-10-27 | `.env` belum diisi → tenant Turso nyata belum bisa dibuat | Selesai (2026-10-28) |
| KS-19 | 2026-10-27 | Tabel `payables` masih ada tetapi tidak dipakai | **Terbuka** |
| KS-20 | 2026-10-27 | Bundle 2 MB dalam satu chunk | Terbuka (rendah) |
| KS-21 | 2026-10-27 | Tidak ada CI (test/typecheck/audit manual) | **Terbuka** |
| KS-22 | 2026-10-27 | Petunjuk `.env.local`, tetapi API & script hanya membaca `.env` | **Terbuka** |
| KS-23 | 2026-10-27 | Stok terkunci pada cabang (satu gudang tidak bisa melayani dua cabang) | Selesai |
| KS-24 | 2026-10-27 | Urutan pengeluaran stok dipaku di lima tempat (tidak bisa FEFO) | Selesai |
| KS-25 | 2026-10-28 | Dua implementasi persetujuan transfer stok menyimpang satu sama lain | Selesai |
| KS-26 | 2026-10-28 | Semua endpoint `/api/*` 500 di Vercel karena import ESM tanpa ekstensi | Selesai |
| KS-27 | 2026-10-28 | `/api/auth/*` 404 di produksi karena nama berkas bracket | Selesai |
| KS-28 | 2026-10-28 | Turso menolak membuat database: grup `retailpro` tidak ada | Selesai |
| KS-29 | 2026-10-28 | `vercel login` tidak pernah tersimpan (proses device flow mati) | Selesai |
| KS-30 | 2026-10-28 | Deploy toko diblokir CVE TanStack Start, lalu error tipe setelah upgrade | Selesai |
| KS-31 | 2026-10-28 | `demo:cloud` diulang: gagal sesaat lalu membuat owner baru | Sebagian (perilaku didokumentasikan) |
| KS-32 | 2026-10-31 | Model e2e menolak `responseFormat` → `agent.extract` gagal | Terbuka (batasan model) |
| KS-33 | 2026-11-01 | `/api/storefront/marketplace` (publik) mengirim pesan error database apa adanya | Selesai |
| KS-34 | 2026-11-01 | Bentuk URL produk berubah jadi `/product/$tenant/$slug`, tautan lama 404 | Selesai |
| KS-35 | 2026-11-05 | Halaman Karyawan/Cabang menulis proyeksi tenant saja → perubahan peran tidak pernah berlaku | Selesai |
| KS-36 | 2026-11-05 | Hapus karyawan hanya menghapus proyeksi → identitas tetap masuk & dapat token full-access | Selesai |
| KS-37 | 2026-11-05 | Tiga mesin izin berbeda (hook, branch-orders, procurement) + daftar hard-coded → tidak sinkron | Selesai |
| KS-38 | 2026-11-05 | Simpan matriks membekukan default semua role ke dokumen (snapshot) | Selesai |
| KS-39 | 2026-11-05 | `/api/tenant/bootstrap` 500 di produksi: modul src yang dijangkau server memakai alias `@/` | Selesai |
| KS-40 | 2026-11-06 | E2E locator gagal: komponen responsif me-render teks yang sama dua kali di DOM (table + card) | Selesai |
| KS-41 | 2026-11-06 | Akses printer (WebUSB/Web Bluetooth) butuh gesture + secure context; kegagalan cetak hampir memblokir penjualan yang sudah commit | Selesai |
| KS-42 | 2026-11-06 | Renderer HTML memakai 9pt terpaku → struk 48 kolom (80mm) dan 72/76mm meluber melewati lebar roll | Selesai |
| KS-43 | 2026-11-06 | Z-report: POS menyimpan `debit`/`credit`/`ewallet`, SQL hanya menghitung `card`/`ewallet`/`qris` → kolom "Kartu" selalu Rp 0 | Selesai |
| KS-44 | 2026-11-16 | Setelah void per bon, sebagian laporan masih menghitung bon batal karena query tidak menyaring `status='completed'` | Selesai |
| KS-45 | 2026-11-16 | Dialog cetak native + iframe print membekukan screenshot & `evaluate_script` di verifikasi browser | Selesai (pulih lewat navigasi) |
| KS-46 | 2026-11-16 | Menghitung ulang total dari sisa baris saat void item diam-diam menghapus diskon bon | Selesai |
| KS-47 | 2026-11-16 | Tabel peran×menu di dokumen ditulis tangan → kehilangan `purchasing`, dan satu kunci izin ternyata tidak ditegakkan kode | Selesai (tabel dirender dari kode) |
| KS-48 | 2026-11-16 | Dua dokumen spec masih mengklaim "belum ada kode yang ditulis" padahal fiturnya lama terpasang — plus satu anchor internal mati | Selesai (header status + catatan titik waktu) |
| KS-49 | 2026-11-17 | Dokumen tidak punya penjaga: tabel markdown terbelah dan angka lama selamat dari re-sync, sementara auditor SQL membaca komentar sebagai kode | Selesai (`npm run docs:check` + `commentRanges()`, keduanya dengan positive control) |
| KS-50 | 2026-11-17 | Verifikasi produksi pasca-deploy melaporkan 403 pada sign-in lalu 5 kegagalan turunan yang terbaca seperti build CI rusak — padahal browser dan `curl` login dengan normal | Selesai (`scripts/verify-production.mjs` + `npm run verify:prod`, dengan jalur gagal dan jalur skip) |
| KS-51 | 2026-11-18 | Semua DM di rail chat tampil sebagai "Pesan pribadi" + monogram, padahal kedua orangnya punya nama — agregasi peserta dilakukan di atas join yang sudah difilter pembaca | Selesai (subquery `chat_participants` di `listConversationsSql()`, dijaga `tests/chat.e2e.ts`) |
| KS-52 | 2026-11-18 | Enter di composer dikirim **sebelum** pencarian mention selesai, sehingga token mentah `#beras` menjadi pesan dan jejak `chat_mentions` kosong | Selesai (gerbang `waitingForSuggestions` di `Composer.tsx`) |
| KS-53 | 2026-11-18 | Pesan tertulis ke channel yang **salah** sementara header pane sudah menunjuk channel yang benar — `placeholderData: keepPreviousData` pada query yang di-*key* id | Selesai (placeholder dilepas dari `useConversation`/`useMessages`, skeleton saat identitas belum tiba) |
| KS-54 | 2026-11-18 | Runner e2e menilai ulang modul uji lebih dari sekali per run, sehingga identifier ber-`Date.now()` membuat tiap kasus mencari channel milik instans modul lain (3 dari 8 kasus gagal tanpa sebab di kode) | Selesai (identifier konstanta + sweep per kasus; aturan didaftar di `frontend.md` §12) |
| KS-55 | 2026-11-19 | Impor sheet vendor+produk menjatuhkan `buy_price` ke varian yang **salah** pada produk multi-varian — pencocokan hanya pada nama pecahan, tanpa penyebut varian, tanpa pesan | Selesai (identitas varian ikut dicocokkan; yang ambigu dilaporkan dan tidak ditulis) |
| KS-56 | 2026-11-19 | Satu kode vendor tulisan tangan (`VND-E2E-KOPI`) membuat **semua** pembuatan vendor otomatis gagal dengan `UNIQUE constraint failed: suppliers.code`, dan empat uji e2e katalog vendor mati berantai | Selesai (`highestVendorCode()` memeringkat angka, bukan teks; tiga pemintingan kode jadi satu sumber; tabrakan kode di-*retry*, bukan diadopsi) |
| KS-57 | 2026-11-19 | Pratinjau rencana impor **berbohong** dengan empat cara yang hanya terlihat di browser: harga beli dijanjikan tanpa vendor, perbaikan harga bolong tidak bisa ditekan, tabel rencana menyusut ke tinggi 0 pada berkas 282 baris, dan baris taut-saja dilaporkan sebagai "harga varian dilewati" | Selesai (`hasVendor` + `priceWrites` di perencana, alasan lewati baru, `min-h` pada badan dialog, baris tanpa harga tidak lagi dihitung ambigu) |
| KS-58 | 2026-11-19 | Impor `produk_2026-11-10.xlsx` (282 baris) hanya menulis **8** produk dan sisanya hilang tanpa pesan — satu `try/catch` membungkus seluruh loop tulis, jadi exception pada baris ke-9 membatalkan 274 baris sesudahnya | Selesai (tangkap per produk + laporan "N gagal ditulis"; `npm run analyze:import` memetakan baris tempat run berhenti beserta penyebab datanya) |

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
| **Yang masih harus dilakukan** | **Rotasi/revoke token tersebut di dashboard Turso** (`Settings → Tokens`). Tidak bisa dilakukan dari repo. **2026-10-28:** token yang sama kembali tercetak di transkrip saat menyunting `.env` (diff alat sunting menampilkan baris yang berubah), jadi rotasi makin mendesak — nilai yang benar hanya boleh ada di `.env` lokal dan di environment Vercel |
| **Pelajaran** | Rahasia yang pernah tampil di tempat tidak terkendali harus dianggap bocor, bukan "mungkin aman" |

---

## KS-18 · 2026-10-27 · `.env` belum diisi — **SELESAI 2026-10-28**

| | |
|---|---|
| **Gejala** | Tenant Turso sungguhan belum bisa dibuat; uji end-to-end dengan login belum bisa dijalankan |
| **Akar masalah** | `TURSO_API_TOKEN`, `CONTROL_DB_URL`, `CONTROL_DB_TOKEN`, `BETTER_AUTH_SECRET` sengaja kosong |
| **Langkah berikutnya** | Isi `.env` (lihat `.env.example`), pastikan grup `TURSO_GROUP` sudah ada, jalankan `npm run bootstrap:control`, lalu daftar satu tenant lewat `/register-tenant` |
| **Penyelesaian (2026-10-28)** | Token organisasi diisi operator; `npm run demo:cloud -- --write-env` membuat control DB dan DB tenant Thalia di Turso cloud, mengisi skema + 28 produk + 328 transaksi, dan menulis `CONTROL_DB_URL`/`CONTROL_DB_TOKEN`/`TURSO_GROUP`/`STOREFRONT_TENANT_SLUG` ke `.env`. Login, bootstrap token, dan dashboard diverifikasi di lokal **dan** di domain Vercel |
| **Pelajaran** | Kode yang bergantung pada kredensial harus punya jalur verifikasi tanpa kredensial (di sini: test dengan database lokal). Sediakan juga satu perintah yang menyiapkan seluruh data plane, agar "env belum siap" tidak diulang di mesin berikutnya |

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

## KS-25 · 2026-10-28 · Dua implementasi persetujuan transfer stok menyimpang satu sama lain — **SELESAI**

| | |
|---|---|
| **Gejala** | Perbaikan pada persetujuan transfer stok hanya pernah mendarat di satu tempat. Setelah masa simpan/HPP batch dijaga (KS-05) dan urutan FIFO/LIFO/FEFO dipusatkan (KS-24), dua layar yang sama-sama mengirim transfer — `Inventory.tsx` dan `BranchTransfers.tsx` — tetap menghasilkan catatan yang berbeda untuk aksi yang sama |
| **Akar masalah** | Modul tulis hidup **di dalam komponen halaman**. Layar persediaan menyalin seluruh alur "setujui transfer" (header, baris, pre-flight stok, pengurangan batch, pembuatan batch tujuan) dari layar transfer, lalu keduanya berjalan sendiri. Karena berupa komponen React, tidak ada test yang mengunci perilakunya, jadi penyimpangan tidak pernah terdeteksi sampai dibaca berdampingan |
| **Penyimpangan yang terbukti** | (a) Nomor batch tujuan: satu salinan memakai `TRF-<ref>-<leg>` (unik per leg), satunya `TRF-<ref>` untuk **setiap** leg — satu baris yang terpecah ke dua batch sumber menghasilkan **dua batch dengan nomor sama**. (b) Hanya satu salinan yang mengisi `transfer_items.source_batch_id`, `cost_price`, dan `quantity_received`, sehingga jejak "batch mana keluar dari mana" kosong di jalur lainnya dan penerimaan tidak bisa menyimpan selisih. (c) `transfer_items.notes` ditulis oleh satu salinan, tidak oleh yang lain. (d) Daftar role yang boleh menyetujui ditulis ulang di dua handler **dan** tiga tempat di JSX (total lima), jadi menambah role baru (`warehouse`) menuntut lima suntingan yang bisa saling tertinggal |
| **Dampak** | Stok keluar dari gudang tetapi jejaknya tidak lengkap; nomor batch duplikat membuat penelusuran kedaluwarsa menunjuk dua batch berbeda; menambah satu role berisiko meloloskan tombol tanpa lolos di handler (atau sebaliknya) |
| **Solusi** | Ekstraksi ke satu modul murni-plus-SQL, `src/lib/stock-movement.ts`: `createTransfer()`, `dispatchTransfer()`, `receiveTransfer()`, `cancelTransfer()`, `shipOutOfStock()`, `drainBatches()`, `stockOnHand()`, `committedQuantities()`. Setiap halaman memanggilnya **di dalam** `runTransaction` miliknya sendiri, jadi semantik persetujuan tidak bisa lagi bercabang. Modul ini juga memegang guard baru: sumber ≠ tujuan, baris kuantitas nol ditolak, `dispatchTransfer` mengisi `source_batch_id`/`cost_price`/`quantity_received`, batch tujuan memakai `<ref>-<leg>`, dan status bergerak `pending` → `in_transit` → `completed` sehingga selisih penerimaan punya tempat |
| **Bukti** | `src/lib/stock-movement.ts` (header modul menyebut kedua salinan lama), `src/pages/BranchTransfers.tsx`, `src/pages/Inventory.tsx`, `src/lib/stock-movement.test.ts` (14 test: pemecahan multi-batch, LIFO/FEFO, guard, terima/batal, pengiriman tanpa gudang tujuan, kuantitas terkomit), `src/lib/warehouse.ts` |
| **Pelajaran** | Aturan yang dipakai lebih dari satu layar tidak boleh tinggal di dalam komponen layar. Komponen halaman bukan tempat menyimpan aturan bisnis: ia tidak bisa diuji tanpa merender UI, sehingga setiap perbaikan menjadi suntingan di N tempat — dan N tempat selalu menyimpang. KS-05 dan KS-24 adalah gejala dari akar yang sama ini; keduanya baru benar-benar tertutup ketika modulnya dipindahkan keluar dari halaman |

---

## KS-26 · 2026-10-28 · Semua endpoint `/api/*` mengembalikan 500 di Vercel — **SELESAI**

| | |
|---|---|
| **Gejala** | Deployment pertama "completed" dan domain ter-alias, tetapi `/api/health` dan `/api/storefront/catalog` sama-sama `500 FUNCTION_INVOCATION_FAILED`. Log build hanya menampilkan deretan `error TS2835` (relatif import butuh ekstensi eksplisit) yang tampak tidak fatal karena build tetap selesai |
| **Akar masalah** | Vercel **tidak mem-bundle** fungsi API menjadi satu berkas: setiap berkas di `api/` di-transpile sendiri. Karena `package.json` memakai `"type": "module"`, hasilnya dibaca sebagai ESM, dan ESM mewajibkan ekstensi pada import relatif. `import { sendJson } from '../server/http'` gagal diselesaikan saat runtime. Di lokal `tsx`/Vite menyelesaikannya ke `.ts`, jadi tidak ada gejala apa pun sebelum deploy |
| **Solusi** | Semua import relatif di `api/` dan `server/` diberi ekstensi `.js` (16 dari 20 berkas). `tsc -p tsconfig.node.json` dan `npm run typecheck` tetap 0 error, `tsx` tetap menemukan `.ts`. Setelah redeploy, `/api/health` → 200 |
| **Bukti** | `api/health.ts` (`from '../server/env.js'`), seluruh `server/*.ts`, `vercel.json`; deploy ulang lalu `curl /api/health` → `{"ok":true,...}` |
| **Pelajaran** | "Build sukses" bukan bukti runtime sehat. Kalau platform menjalankan kode dengan aturan modul yang berbeda dari dev server, aturan itu harus diuji dengan satu request setelah deploy. Ekstensi `.js` yang eksplisit adalah harga dari ESM tanpa bundler |

---

## KS-27 · 2026-10-28 · `/api/auth/*` 404 di produksi — **SELESAI**

| | |
|---|---|
| **Gejala** | Setelah KS-26 beres, health dan katalog 200, tetapi `POST /api/auth/sign-in/email` menjawab `404 NOT_FOUND` dengan halaman error platform (bukan JSON aplikasi) |
| **Akar masalah** | `api/auth/[...all].ts` adalah konvensi Next.js, bukan konvensi fungsi standalone Vercel: nama berkas bracket tidak dipetakan menjadi rute, sehingga tidak ada fungsi yang menangani `/api/auth/*`. Hal yang sama berlaku untuk `api/admin/users/[id]/password.ts` |
| **Solusi** | `rewrites` eksplisit di `vercel.json`: `/api/auth/(.*)` → `/api/auth/[...all]` dan `/api/admin/users/([^/]+)/password` → `/api/admin/users/[id]/password`, dengan catch-all SPA `/((?!api/).*)` diletakkan **setelah** keduanya. `req.url` tetap membawa path asli, jadi Better Auth menemukan rute internalnya |
| **Bukti** | `vercel.json`; login produksi mengembalikan `role = tenant_owner` dan sesi terbentuk |
| **Pelajaran** | Nama berkas bracket adalah fitur framework, bukan fitur platform. Kalau fungsi dijalankan tanpa framework, setiap route dinamis harus dipetakan ulang secara eksplisit — dan urutan rewrite menentukan siapa yang menang |

---

## KS-28 · 2026-10-28 · Turso menolak membuat database karena grup tidak ada — **SELESAI**

| | |
|---|---|
| **Gejala** | `npm run demo:cloud` gagal dua kali: (a) `group not found` untuk `retailpro`; (b) setelah grup dihapus dari permintaan, `either seed or group must be set` |
| **Akar masalah** | Turso mewajibkan setiap database berada di sebuah grup, dan grup harus sudah ada. `.env.example` menyebut `TURSO_GROUP=retailpro`, padahal organisasi baru hanya punya grup lokasi otomatis (`ap-southeast-2`) dan tidak punya grup `default`. Kode lama juga selalu mengirim grup sehingga tidak ada jalan tengah |
| **Solusi** | (1) `GET /v1/organizations/{org}/groups` dipanggil untuk melihat grup nyata, dan `TURSO_GROUP` diubah ke `ap-southeast-2` (di `.env` **dan** `.env.example`); (2) `createDatabase(name, group?)` kini menerima grup opsional dan `listGroups()` ditambahkan; (3) `setup-cloud-demo.ts` memilih grup pertama yang tidak diarsipkan bila nama yang diminta tidak ada |
| **Bukti** | `server/turso-platform.ts` (`listGroups`, `TursoGroup`), `scripts/setup-cloud-demo.ts` (fallback grup), dua database tercipta di `ap-southeast-2` |
| **Pelajaran** | Nilai contoh di `.env.example` adalah dokumentasi yang dijalankan orang lain. Nilai yang tidak benar-benar ada di akun nyata lebih berbahaya daripada nilai kosong, karena kegagalannya muncul jauh di tengah setup |

---

## KS-29 · 2026-10-28 · `vercel login` tidak pernah tersimpan — **SELESAI**

| | |
|---|---|
| **Gejala** | `vercel whoami` tetap "No existing credentials found" walaupun kode perangkat sudah dimasukkan pengguna. Kode yang sama juga kedaluwarsa saat dipakai ulang |
| **Akar masalah** | Proses `vercel login` dijalankan `detached` dari terminal alat, tetapi tetap anak dari konsol yang sama; begitu konsol ditutup, proses pembunuh ikut mati sebelum kredensial ditulis. Log yang kosong menyembunyikan sebabnya. Percobaan memakai `cmd.exe /c` juga ditolak oleh pengaman perintah |
| **Solusi** | Login dijalankan lewat proses yang benar-benar lepas dari konsol: `Start-Process node.exe <vercel.js> login -WindowStyle Hidden` dengan redirect stdout/stderr ke berkas. Kode perangkat dibaca dari berkas log, browser dibuka otomatis, dan **pengguna** yang menyelesaikan otorisasi. `vercel whoami` kemudian mengembalikan `koncoweb` |
| **Bukti** | `vercel whoami` → `koncoweb`; `.vercel/project.json` → team `koncowebs-projects` |
| **Pelajaran** | Proses otorisasi harus hidup lebih lama dari terminal yang memulainya. Selalu verifikasi dengan `whoami` sebelum melanjutkan, bukan dengan "kode sudah tampil" atau "pengguna bilang sudah" |

---

## KS-30 · 2026-10-28 · Deploy toko diblokir CVE, lalu error tipe setelah upgrade — **SELESAI**

| | |
|---|---|
| **Gejala** | Deploy `thalia-storefront` ditolak: `@tanstack/react-start@1.168.49` mengandung CVE-2026-102989 dan Vercel mensyaratkan minimal 1.168.60. Setelah naik ke 1.168.61, `tsc --noEmit` gagal: `error-component.tsx(17,10): error TS18046: 'error' is of type 'unknown'` |
| **Akar masalah** | (a) Versi paket mengunci versi rentan; (b) tipe `error` pada berkas error-boundary dianggap `unknown` di versi baru sehingga pemakaian `error.message` tidak lagi sah |
| **Solusi** | Naikkan `@tanstack/react-start` ke `1.168.61` (bukan memakai flag `DANGEROUSLY_DEPLOY_VULNERABLE_TANSTACK_START_XSS`), lalu perbaiki pemakaian tipe: `const message = error instanceof Error && error.message ? error.message : "…"`. `npm run typecheck` dan build toko lulus, deploy berhasil |
| **Bukti** | `tokoonline/package.json`, `tokoonline/src/lib/error-component.tsx`, https://thalia-storefront.vercel.app |
| **Pelajaran** | Upgrade keamanan hampir selalu membawa perubahan tipe. Jalankan `typecheck` **sebelum** deploy ulang agar penolakan platform tidak tertukar dengan error kode sendiri, dan jangan mematikan gerbang keamanan platform demi satu build yang hijau |

---

## KS-31 · 2026-10-28 · `demo:cloud` diulang: gagal sesaat lalu mengganti id owner — **SEBAGIAN**

| | |
|---|---|
| **Gejala** | Run kedua `npm run demo:cloud` berhenti dengan `Cloud demo setup failed: fetch failed`, lalu berhasil saat dijalankan lagi — tetapi akun owner di control DB punya `user.id` baru, sehingga baris registry lama (dan sesi lama) menunjuk user yang sudah tidak ada |
| **Akar masalah** | (a) `fetch failed` berasal dari koneksi ke Turso yang baru bangun (cold start), bukan dari data; (b) skrip memang menghapus user lama dengan email yang sama (`session`, `account`, `user`) sebelum `signUpEmail`, jadi setiap run menerbitkan id baru — perilaku yang benar untuk demo bersih, tetapi tidak terlihat dari output |
| **Solusi** | (a) Skrip dijalankan ulang; karena idempoten terhadap database, tidak ada data ganda. (b) Perilaku didokumentasikan di [deployment.md](deployment.md) §3: menjalankan ulang me-reset tenant demo **dan** menerbitkan ulang akun owner, jadi jangan arahkan ke tenant berisi data nyata |
| **Yang masih bisa diperbaiki** | Percobaan ulang otomatis dengan backoff untuk galat jaringan, dan pesan eksplisit "owner diganti: <id lama> → <id baru>" |
| **Bukti** | `scripts/setup-cloud-demo.ts` (blok *Owner account*), dua id owner berbeda di control DB |
| **Pelajaran** | "Idempoten" harus dinyatakan per objek: skrip ini idempoten untuk database dan data tenant, tetapi **rotasi** untuk identitas. Menyebutkan cakupan idempotensi lebih jujur daripada satu kata "aman diulang" |

---

## KS-32 · 2026-10-31 · Model e2e menolak `responseFormat`, sehingga `agent.extract` gagal — **TERBUKA (batasan model)**

| | |
|---|---|
| **Gejala** | Setiap panggilan `agent.*` pada `npx e2e run` mencetak peringatan AI SDK: `Warning (sumopod.chat / deepseek-v4.1-flash:netra): The feature "responseFormat" is not supported. JSON response format schema is only supported with structuredOutputs` |
| **Akar masalah** | `agent.act`, `agent.assert`, dan `agent.waitFor` hanya butuh tool call, sedangkan `agent.extract` meminta keluaran terstruktur (`responseFormat`/JSON schema). Endpoint SumoPod menerima tool call tetapi menolak parameter itu, jadi hanya langkah `extract` yang tidak bisa dipakai — ketiga test smoke tetap lulus |
| **Solusi** | Diterima sebagai batasan dan dicatat di [frontend.md](frontend.md) §12: alur ditulis dengan `agent.act` + `agent.assert` + locator deterministik. Bila `extract` benar-benar dibutuhkan (mis. membaca angka dari tabel), ganti provider/model yang mendukung structured output — cukup mengubah `E2E_AI_BASE_URL`/`E2E_AI_MODEL` di `.env`, tanpa menyentuh `e2e.config.ts` |
| **Yang masih bisa diperbaiki** | Menandai kemampuan model di konfigurasi (mis. komentar di `e2e.config.ts`) agar `extract` tidak dicoba pada model ini; atau menyediakan model kedua khusus `extract` lewat `agents.<name>` |
| **Bukti** | `npx e2e run --grep login` 2026-10-31: 3 test lulus, 3 panggilan model, 10,9k token, dengan peringatan di atas di stderr; `e2e.config.ts` |
| **Pelajaran** | "OpenAI-compatible" tidak berarti semua fitur OpenAI ada. Sebelum memakai model untuk harness yang butuh keluaran terstruktur, uji satu panggilan dengan `responseFormat`; untuk harness yang hanya butuh tool call, cukup pastikan tool calling bekerja — peringatan AI SDK adalah sinyal pertama, bukan kegagalan test |

## KS-33 · 2026-11-01 · Endpoint marketplace publik mengirim pesan error database apa adanya — **SELESAI**

| | |
|---|---|
| **Gejala** | `GET /api/storefront/marketplace` mengembalikan `skipped: [{ slug, reason: "SQLITE_ERROR: no such column: variant_attributes" }]` kepada siapa pun yang memanggilnya tanpa sesi |
| **Akar masalah** | Handler agregasi butuh alasan per tenant yang gagal agar operator bisa mendiagnosis tanpa log, jadi `readOne` mengembalikan `error.message` mentah ke dalam payload. Pesan libSQL menyebut nama tabel dan kolom, artinya pengunjung anonim bisa memetakan skema tenant hanya dengan memancing tenant yang rusak |
| **Solusi** | `readOne` mengembalikan objek `error` (bukan string) dan handler mencatatnya ke log server (`console.error` berlabel `[storefront] tenant "<slug>" skipped:`) lalu mengirim `reason: "unavailable"` — tingkat detail yang boleh dilihat orang luar. Tipe `skipped[]` dipersempit jadi literal `"unavailable"`, jadi kebocoran berikutnya tidak mungkin lolos typecheck |
| **Bukti** | `api/storefront/marketplace.ts` (tipe `SkippedTenant`, `readOne`, cabang `'error' in result`); `curl localhost:3000/api/storefront/marketplace` → `shops=1 products=28 tenants=1/1 skipped=0` |
| **Pelajaran** | "Alasan yang berguna untuk operator" dan "alasan yang boleh dibaca publik" adalah dua hal berbeda. Pada endpoint tanpa sesi, detail diagnosis harus pindah ke log — bukan ke JSON |

## KS-34 · 2026-11-01 · URL produk berubah, tautan lama mati — **SELESAI**

| | |
|---|---|
| **Gejala** | Etalase berubah jadi marketplace, route `/product/$slug` dihapus dan diganti `/product/$tenant/$slug`. Tautan yang terlanjur dibagikan (chat CS, WhatsApp, catatan pesanan, bookmark) berakhir di "Produk tidak ditemukan" |
| **Akar masalah** | Slug hanya unik di dalam satu toko, jadi penjual wajib masuk ke URL — tetapi perubahan bentuk URL diperlakukan sebagai urusan internal, padahal URL adalah bagian dari kontrak yang sudah beredar |
| **Solusi** | Route lama dipertahankan sebagai pengalihan (`tokoonline/src/routes/product.$slug.tsx`): slug dicari di seluruh marketplace, lalu `navigate(..., replace: true)` ke URL baru; slug yang sudah tidak ada sama sekali mendarat di `/katalog?q=<slug>` |
| **Bukti** | Browser: `/product/chc-001` → `/product/thalia/chc-001` (h1 "Cokelat Bubuk Premium"); `/product/tidak-ada-xyz` → `/katalog?q=tidak-ada-xyz` dengan pesan "Tidak ada produk yang cocok" |
| **Pelajaran** | Saat arti sebuah URL berubah, kirimkan juga penerjemahnya. Menghapus route lama tanpa pengalihan memindahkan biaya perbaikan ke setiap orang yang pernah menyimpan tautannya |

## KS-35 · 2026-11-05 · Halaman menulis proyeksi tenant saja, perubahan peran tidak berlaku — **SELESAI**

| | |
|---|---|
| **Gejala** | Mengubah peran/cabang karyawan dari `Employees.tsx` dan `Branches.tsx` menampilkan toast sukses, tapi login berikutnya orang itu masih peran lama. `useAuth()` membaca `user.role` dari sesi Better Auth (control plane), sedangkan halaman hanya menulis `users.role` di database tenant (proyeksi) |
| **Akar masalah** | Ada dua salinan "orang ini siapa" dan tidak ada penulis yang menyatukan keduanya; control plane adalah sumber kebenaran sesi, proyeksi hanya cermin untuk query tenant |
| **Solusi** | Satu endpoint `PATCH /api/admin/users/[id]` (`api/admin/users/[id].ts`) menulis control DB lebih dulu lalu mencerminkan ke proyeksi lewat `withTenantClient`; halaman memanggil endpoint, bukan SQL proyeksi langsung |
| **Bukti** | `src/pages/Employees.tsx`, `src/pages/Branches.tsx`, `src/components/branches/BranchDetailModal.tsx` memanggil `/api/admin/users/[id]`; validasi `server/roles.ts` |
| **Pelajaran** | Kalau dua tempat menyimpan fakta yang sama dan hanya satu yang dibaca saat login, menulis ke yang lain adalah ilusi. Pilih satu sumber kebenaran dan paksa semua penulis melewatinya |

---

## KS-36 · 2026-11-05 · Identitas tetap hidup setelah karyawan dihapus — **SELESAI**

| | |
|---|---|
| **Gejala** | `handleDeleteEmployee` menghapus baris `users` tenant saja. Orang itu masih bisa masuk, dan `api/tenant/bootstrap` tetap memberi token full-access ke database perusahaannya |
| **Akar masalah** | Delete hanya menyentuh proyeksi; baris `user`/`account`/`session` di control tidak dihapus, dan bootstrap tidak memeriksa apakah orang itu masih aktif |
| **Solusi** | `DELETE /api/admin/users/[id]` menghapus `session → account → user` (urutan yang terbukti perlu karena kopling FK) lalu baris proyeksi; bootstrap kini membaca proyeksi dan `403 account_inactive` saat tidak ada/`is_active=0`. `PATCH {active:false}` set `status=inactive` + `banned=1` sehingga Better Auth menolak login |
| **Bukti** | `api/admin/users/[id].ts`, `api/tenant/bootstrap.ts`; pola penghapusan mengikuti `tests/support/db.ts` |
| **Pelajaran** | Menghapus data tampilan bukan menghapus akses. Selama ada identitas yang bisa menghasilkan token, penghapusan belum selesai |

---

## KS-37 · 2026-11-05 · Tiga mesin izin yang saling tidak setuju — **SELESAI**

| | |
|---|---|
| **Gejala** | `usePermissions()` menghormati override `tenants.settings.role_permissions`, tetapi `roleHasPermission()` (branch-orders) dan `roleHasPurchasePermission()` (procurement) hanya membaca `DEFAULT_ROLE_PERMISSIONS`; sebagian layar memakai daftar peran hard-coded yang melewati keduanya. Owner mengubah matriks, sebagian UI berubah dan sebagian tidak |
| **Akar masalah** | Tidak ada satu pun jalur baca izin; tiap modul memutuskan sendiri dari mana jawaban datang |
| **Solusi** | Satu katalog (`PERMISSION_CATALOG`) → satu resolver murni (`src/lib/permission-matrix.ts`) → satu hook (`use-permissions` via TanStack Query). Modul bisnis menerima `PermissionCheck` (`can`) alih-alih string peran; daftar hard-coded diganti panggilan `can(...)` |
| **Bukti** | `src/lib/branch-orders.ts`, `src/lib/procurement.ts`, `src/pages/{Inventory,BranchTransfers,POS}.tsx`; test `src/lib/permission-matrix.test.ts` |
| **Pelajaran** | Otorisasi yang diduplikasi cepat menghasilkan tiga kebenaran. Satu resolver yang bisa diuji tanpa React membuat perubahan owner berarti di seluruh aplikasi sekaligus |

---

## KS-38 · 2026-11-05 · Simpan matriks membekukan default semua role — **SELESAI**

| | |
|---|---|
| **Gejala** | Menyimpan satu role di `EmployeeRoleSettings` menulis snapshot `DEFAULT_ROLE_PERMISSIONS` SEMUA role ke `role_permissions`. Setelah itu menambah izin baru di kode tidak lagi muncul untuk role-role itu (dokumen sudah berisi nilai lama) |
| **Akar masalah** | Loop save membekukan default ke dalam dokumen; `role_permissions` seharusnya hanya menyimpan penyimpangan, bukan salinan penuh |
| **Solusi** | Save hanya menulis override role yang diedit (`setTenantSetting('role_permissions', {...existing, [role]: changed})`); resolver menggabungkan default < override < custom, jadi kunci yang muncul belakangan tetap berlaku untuk role yang tidak pernah disentuh |
| **Bukti** | `src/components/settings/EmployeeRoleSettings.tsx`; `src/lib/permission-matrix.ts` (merge order); test merge-order di `permission-matrix.test.ts` |
| **Pelajaran** | Dokumen konfigurasi harus menyimpan niat (deviasi), bukan hasil evaluasi. Membekukan default ke penyimpanan mengubah data turunan menjadi sampah usang begitu kode tumbuh |

---

## KS-39 · 2026-11-05 · `/api/tenant/bootstrap` 500 di produksi karena alias `@/` di modul src terjangkau server — **SELESAI**

| | |
|---|---|
| **Gejala** | Setelah perubahan Role & Permission di-deploy, owner tidak bisa login di produksi dengan toast "Terjadi kesalahan sistem saat mencoba login". `GET /api/tenant/bootstrap` membalas `500 FUNCTION_INVOCATION_FAILED` **bahkan tanpa sesi**, padahal di mesin lokal endpoint yang sama membalas `401` dan login owner berjalan normal |
| **Akar masalah** | `src/lib/permission-matrix.ts` mengimpor katalog dengan alias `@/config/roles`. Modul itu dijangkau `api/tenant/bootstrap.ts` lewat `server/roles.ts`. Vite dan `tsx` menyelesaikan `@/` dari `tsconfig paths`, tetapi runtime Node serverless menyimpan specifier literal `@/config` dan melempar `ERR_MODULE_NOT_FOUND` saat memuat modul — fungsi mati sebelum cek sesi apa pun |
| **Solusi** | Ganti ke impor relatif berekstensi `.js` (`from "../config/roles.js"`), bentuk yang sama dengan setiap modul src lain yang dijangkau server (`variants.js`, `password.js`). Vite tetap bisa menyelesaikannya untuk browser |
| **Bukti** | `npx vercel logs <url> --json` menampilkan `Cannot find package '@/config' imported from /var/task/src/lib/permission-matrix.js`. Setelah perbaikan: bootstrap produksi `401` tanpa sesi, dan login owner nyata mendarat di `/mode-select` (`200`) |
| **Pelajaran** | Hijau di lokal bukan bukti fungsi bisa dimuat di produksi: `tsx` menghormati alias `@/`, bundel serverless tidak. Aturan turunannya — setiap modul src yang dijangkau (transitif) dari `api/`/`server/` wajib memakai impor relatif `.js`, tidak pernah `@/`. Uji satu request ke endpoint ter-deploy setiap push, jangan percaya status "completed" (perluas KS-26) |

---

## KS-40 · 2026-11-06 · E2E locator `getByText` ambigu karena komponen responsif me-render dua kali — **SELESAI**

| | |
|---|---|
| **Gejala** | Setelah redesign `EmployeeRoleSettings` (dialog → inline editor) dan penghapusan `view_dashboard` dari default cashier, 4 tes e2e gagal: `LOCATOR_NOT_FOUND` untuk "Ubah permission Cashier", `LOCATOR_AMBIGUOUS` untuk `getByText('Bayu Pratama')` dan `getByText('Staff Baru E2E')` meskipun `{ exact: true }` sudah ditambahkan, dan `getByRole('option', 'Staff')` tidak cocok karena accessible name Radix Select sekarang "Staff Karyawan biasa" |
| **Akar masalah** | Komponen `identity(emp)` di `Employees.tsx` dipanggil dua kali: sekali di `<TableCell>` (table desktop `md:block`) dan sekali di `<div md:hidden>` (kartu ponsel). Keduanya ada di DOM secara bersamaan; Playwright strict mode melihat 2 node dengan textContent persis sama, tidak peduli mana yang terlihat CSS |
| **Solusi** | (a) Scope locator ke container semantik yang benar: `screen.getByRole('table').getByText('Bayu Pratama', { exact: true })`. (b) Ganti tombol dialog lama dengan regex role-card: `getByRole('button', { name: /Cashier/ })` lalu assert teks inline. (c) Opsi Radix Select di-match dengan regex prefix: `getByRole('option', { name: /^Staff/ })`. (d) `view_dashboard` → `toBeHidden()` |
| **Bukti** | Full e2e suite 2026-11-06: 53 passed / 6 failed (semua `ExceededBudget`), tidak ada LOCATOR_AMBIGUOUS atau NOT_FOUND |
| **Pelajaran** | `{ exact: true }` saja tidak menyelesaikan duplikasi responsif karena kedua `<p>` punya textContent identik di DOM; solusinya **scoping** (getByRole table) atau filter visibilitas (`visible: true`). Tambahkan aturan baru di `frontend.md` §12 poin 11 |

---

## KS-41 · 2026-11-06 · Akses printer butuh gesture & secure context — kegagalan cetak hampir memblokir penjualan — **SELESAI**

| | |
|---|---|
| **Gejala** | Pada rancangan pertama, cetak dipandang sebagai bagian dari alur checkout: bila `printDocument()` melempar (perangkat belum dipilih, izin ditolak, kabel dicabut), kasir melihat error dan transaksi yang **sudah commit** terlihat gagal. Selain itu tombol "Cetak" di sesi browser baru selalu menolak sebelum pengguna memilih perangkat |
| **Akar masalah** | Dua sifat platform digabung jadi satu kesalahan. (1) WebUSB dan Web Bluetooth hanya tersedia di **secure context** dan wajib dipanggil dari dalam gesture pengguna (`navigator.usb.requestDevice` / `navigator.bluetooth.requestDevice`) — tidak ada pairing yang dipulihkan otomatis antar sesi, jadi mode `usb`/`bluetooth` "belum tersambung" adalah keadaan normal, bukan error. (2) Windows desktop tidak punya API serial untuk Bluetooth, jadi printer thermal Bluetooth di PC tidak bisa diakses langsung dari browser sama sekali |
| **Solusi** | Cetak dijadikan **sisi api yang tidak pernah melempar**: `print-service.printDocument()` mengembalikan `PrintResult { ok, via, error? }` dan pemanggil hanya mengubahnya menjadi toast; urutan pemilihan transport punya fallback eksplisit (`usb`/`bluetooth` tanpa handle hidup → `driver`; `driver` gagal → unduh `.prn`). Seksi **Printer & Koneksi** di `ReceiptSettings.tsx` menyediakan tombol **Sambungkan Printer** (satu gesture per sesi) + Cetak Tes + status terhubung, dan auto-print hanya berjalan **setelah** transaksi commit |
| **Bukti** | `src/lib/print/print-service.ts` (kontrak `PrintResult`, aturan fallback di komentar kepala modul), `src/lib/print/print-bridges.ts`. Verifikasi browser 2026-11-16: struk 80mm keluar lewat jalur driver, dan membatalkan dialog cetak tidak mengubah data bon (308 baris riwayat tetap) |
| **Pelajaran** | Fitur yang menyentuh perangkat keras harus didesain sebagai **efek samping opsional**: kalau kegagalan perangkat bisa membatalkan operasi bisnis, itu salah batas tanggung jawab. Perlakukan API browser yang butuh izin seperti layanan eksternal — anggap "belum siap" sebagai keadaan awal, dan selalu sediakan jalur manual (cetak ulang dari riwayat) |

---

## KS-42 · 2026-11-06 · Renderer HTML memakai ukuran font terpaku — 48 kolom (80mm) meluber melewati lebar roll — **SELESAI**

| | |
|---|---|
| **Gejala** | Struk yang sama rapi di 58mm tetapi melebar ke luar kertas pada 80mm (48 kolom), dan lebih parah di 72/76mm; bagian kanan baris `cols` (nominal) terpotong. Tidak terdeteksi oleh unit test karena test memeriksa isi teks, bukan geometri cetak |
| **Akar masalah** | Model dokumen dihitung dalam **jumlah karakter**, sedangkan renderer HTML memaku `font-size: 9pt`. Lebar karakter Courier adalah rasio font (0.6em), jadi 48 karakter hanya muat pada satu ukuran tertentu — memilih lebar roll lain mengubah kebutuhan font, dan HTML tidak tahu itu |
| **Solusi** | `renderReceiptHtml()` menghitung ukuran font dari `columns` × lebar cetak (`Courier 0.6em`, `1mm = 72/25.4pt`, faktor aman 0.98, dijepit 4–11pt) dan menskalakan header ukuran-2 ke `2em` ikut arus, sementara `@page size:{width}mm auto` tetap mengikuti pilihan kertas |
| **Bukti** | `src/lib/print/__tests__/html-render.test.ts` (+7 kasus rasio kolom/lebar). Pemeriksaan browser terukur: `document.scrollWidth == innerWidth` dan **nihil overflow horizontal** pada 58, 76, dan 80mm |
| **Pelajaran** | Dua renderer dari satu model hanya konsisten bila **unit dasarnya sama di kedua sisi**. Model berbasis karakter butuh penerjemahan eksplisit ke satuan layout (pt/mm); kalau satu renderer menebak-nebak angka tetap, inkonsistensinya baru terlihat di perangkat fisik — jadi sertakan perhitungannya di test, bukan hanya string hasilnya |

---

## KS-43 · 2026-11-06 · Z-report kehilangan penjualan kartu — POS menyimpan `debit`/`credit`, SQL menghitung `card` — **SELESAI**

| | |
|---|---|
| **Gejala** | Di laporan Z setiap shift tertutup, kolom **Kartu** selalu `Rp 0` dan total rincian metode **kurang** dibanding TOTAL PENJUALAN, padahal pembayaran kartu benar-benar terjadi dan muncul di modal detail transaksi |
| **Akar masalah** | Nilai `payment_method` tidak punya sumber tunggal. POS menulis `debit`/`credit` untuk kartu dan `ewallet` (termasuk QRIS lewat e-wallet), sedangkan query agregasi memfilter literal `'card'`/`'ewallet'`/`'qris'`. Tidak ada CHECK constraint dan tidak ada test yang menjahit kedua sisi, jadi perbedaan itu diam tidak terdengar sampai laporan dibaca |
| **Solusi** | SQL `receipt-printer.ts` memetakan **kanonik** di sisi baca: bucket `card ← {card, debit, credit}`, bucket `ewallet ← {ewallet, e-wallet, ovo, gopay, dana, shopeepay}`, plus bucket **Lainnya** = `total − keempat bucket` (baris Lainnya hanya tampil bila > 0). Karena Lainnya diturunkan dari total, rincian **selalu** sama dengan TOTAL PENJUALAN — metode baru tidak bisa lagi hilang tanpa jejak |
| **Bukti** | Unit test rekonsiliasi di `src/lib/print/__tests__/zreport-doc.test.ts`; screenshot verifikasi `void-3-list-totals.png` menunjukkan ringkasan metode cocok dengan total setelah void |
| **Pelajaran** | Untuk kolom yang nilainya ditulis UI dan dibaca laporan, **daftar nilai harus hidup di satu modul** (atau dipetakan di sisi baca seperti ini). Bentuk rekonsiliasi yang lebih aman adalah "sisa masuk ke bucket lain-lain" daripada "daftar metode ditutup" — yang kedua bocor setiap kali ada metode baru |

---

## KS-44 · 2026-11-16 · Bon void masih masuk laporan — agregasi tanpa `status = 'completed'` — **SELESAI**

| | |
|---|---|
| **Gejala** | Setelah satu bon di-void, modal detail dan ringkasan Riwayat Transaksi sudah turun nilainya, tetapi kartu statistik Dashboard, laporan Penjualan, Cashflow, dan **Piutang** masih menghitung bon batal itu. Kas seharusnya shift (`expected_cash`) ikut lebih besar dari uang fisik tanpa ada selisih yang bisa dijelaskan |
| **Akar masalah** | `transactions.status` sudah lama ada di skema dan punya nilai `void`, tetapi **tidak ada satu pun query yang pernah memfilternya** — sebelumnya memang tidak ada yang menulis `void`. Begitu void menjadi nyata, seluruh agregasi warisan (distribusi di puluhan komponen dan halaman) berubah menjadi salah, dan tidak ada test yang memegang aturannya karena dulu tidak ada aturannya |
| **Solusi** | Aturan ditetapkan sebagai invariant (lihat [backend.md](backend.md) §9 no. 1/3/15): setiap agregasi uang menyaring `status = 'completed'`, setiap agregasi per item juga `ti.voided = 0`. Diperbaiki sekaligus di Dashboard (stat card, tren, chart, BranchPerformance, modal SalesDetail/TransactionDetail/ProductSales, RecentTransactions), Reports, Branches + dashboard cabang, POS/POSShifts, SalesReport, Cashflow, `ApAr`, dan totals Riwayat Transaksi — di riwayat memakai `CASE WHEN` supaya **nominal** mengecualikan void tetapi pagination tetap menghitung barisnya. Z-report menambahkan seksi informatif "void (tidak dihitung)" alih-alih diam-diam berkurang |
| **Bukti** | Rekonsiliasi angka pada tenant demo: `114.253.000 − 10.000 − 34.000 − 487.500 − 50.000 − 45.000 = 113.626.500` (Total Penjualan di dashboard) dan `18.951.250 − 34.000 − 487.500 = 18.429.750` (Via E-Wallet), dengan jumlah baris riwayat tetap 308. `src/lib/__tests__/void.test.ts` memutar ulang SQL pendapatan & ApAr ke database v9 sementara, termasuk kasus "bon kredit void tidak lagi jadi piutang" |
| **Pelajaran** | Menambah nilai status baru adalah **perubahan lintas-lapisan**, bukan perubahan satu layar. Sebelum menambahkan keadaan (`void`, `refunded`, `partially_…`), telusuri dulu semua pembaca kolom itu — kalau aturannya tidak bisa ditegakkan oleh database, ia harus ditegakkan oleh test yang memutar ulang SQL-nya |

---

## KS-45 · 2026-11-16 · Verifikasi browser membeku saat dialog cetak terbuka — **SELESAI (pulih lewat navigasi)**

| | |
|---|---|
| **Gejala** | Ketika fitur void diverifikasi lewat CDP, `take_screenshot` dan `evaluate_script` berkali-kali jatuh pada timeout 5 detik tepat setelah struk dicetak, padahal `take_snapshot` masih mengembalikan pohon aksesibilitas yang benar. Screenshot bukti hampir tidak bisa diambil |
| **Akar masalah** | `window.print()` membuka **dialog native** dan iframe cetak tersembunyi menahan antrean eksekusi tab; protokol DevTools tidak bisa menyuntik skrip atau menangkap frame selama dialog modal itu hidup. Ini sifat platform, bukan aplikasi — aplikasi sendiri tetap responsif setelah dialog ditutup |
| **Solusi** | Urutan kerja yang andal: `press_key Escape` untuk menutup dialog → `navigate_page` ke URL yang sama untuk melepas iframe print → baru `take_screenshot`. Kalau yang diuji memang dialog cetak, cukup gunakan `take_snapshot` (baca struktur DOM/teks) dan verifikasi computed style setelah halaman dimuat ulang |
| **Bukti** | Screenshot `void-6-final-reconciled.png`, `void-7-item-struck-postfix.png`, `void-8-voided-line-and-bon-button.png` berhasil diambil setelah navigasi; `evaluate_script` pasca-navigasi membuktikan `line-through` pada baris void (1 baris, kelas `font-medium line-through text-muted-foreground`, badge VOID `rgb(207, 48, 48)`) |
| **Pelajaran** | Otomasi browser punya kelas kegagalan "tab dibekukan modal native" yang tidak bisa diselesaikan dengan menaikkan timeout. Kenali polanya (snapshot hidup, screenshot/skrip mati) dan pulih dengan navigasi — jangan simpulkan aplikasi bermasalah dari alat tangkapnya. Untuk jalur cetak, bukti terbaik tetap computed style + printer sungguhan, bukan e2e |

---

## KS-46 · 2026-11-16 · Void item menghitung ulang total dari sisa baris — diskon bon hilang diam-diam — **SELESAI**

| | |
|---|---|
| **Gejala** | Pada bon berisi diskon (mis. subtotal `Rp 204.500`, didiskon jadi `Rp 154.500`), mem-void satu baris `Rp 50.000` lalu "merapikan total" dengan menjumlahkan sisa baris menghasilkan `Rp 104.500` — bukan `Rp 154.500 − 50.000`. Diskon bon seolah lenyap, dan kas seharusnya ikut melompat |
| **Akar masalah** | Diskon tingkat bon **tidak disimpan sebagai kolom**; ia hanya ada sebagai selisih `SUM(items.subtotal) − transactions.total_amount`. Menghitung ulang total dari baris yang tersisa berarti menyamakan selisih itu dengan nol, dan menguranginya dari total adalah satu-satunya operasi yang mempertahankan diskon |
| **Solusi** | `nextTotalAfterVoid()` menurunkan `total_amount` dan `amount_paid` sebesar **subtotal baris yang dibatalkan** (dengan clamp di 0), bukan menghitung ulang dari sisa baris. Void per bon meninggalkan `total_amount` apa adanya sebagai catatan nilai yang dibatalkan, dan renderer struk menghitung subtotal/diskon dari **baris aktif saja** sehingga angka di kertas tetap konsisten setelah satu baris dicoret |
| **Bukti** | Unit `src/lib/__tests__/void.test.ts` (kasus invarian diskon awet & clamp 0) dan verifikasi browser: bon `INV/20261105-THL-02-0238` setelah satu baris di-void menampilkan **Total Rp 154.500** dengan baris `Rp 50.000` dicoret |
| **Pelajaran** | Nilai yang disimpan **implisit sebagai selisih** tidak boleh diperlakukan seperti nilai yang bisa dihitung ulang. Kalau turunan tidak bisa disimpan eksplisit (karena skema tidak punya kolomnya), satu-satunya operasi aman adalah **mengurangkan**, dan itu harus jadi fungsi murni yang diuji — bukan matematika yang ditulis di dalam dialog |

---

## KS-47 · 2026-11-16 · Tabel peran×menu ditulis tangan — kehilangan satu peran dan satu kunci hiasan — **SELESAI**

| | |
|---|---|
| **Gejala** | Audit dokumentasi menemukan tiga ketidaksesuaian sekaligus. (1) Tabel "Peran dan akses menu" di `docs/fitur-tenant.md` §3 tidak punya kolom `purchasing` sama sekali, padahal peran itu ship sebagai peran nyata pada 2026-11-05 — dan baris "Stok masuk & purchase order" menandai `warehouse` dengan `–` padahal peran itu memegang `add_stock` **dan** `view_inventory`. (2) `docs/frontend.md` §13 dan `docs/backend.md` §5.11 menyebut snapshot `role_permissions` di `db/schema/seed.sql` sebagai "matriks penuh/lengkap", padahal isinya 18 (owner-tier), 10, 4, 2, dan 0 kunci dari katalog yang beranggotakan 31. (3) `requirement.md` menjanjikan `staff` "akses baca area back office", sementara kodenya `staff: {}` — nol izin bawaan, hanya `/absen` yang terbuka |
| **Akar masalah** | Sumber kebenaran sudah pindah ke kode (`DEFAULT_ROLE_PERMISSIONS` + kunci tiap guard rute di `src/App.tsx`) sejak RBAC satu pintu, tetapi tabel matriks di dokumen masih diketik per baris dari **daftar peran** lama. Tidak ada test yang membandingkan isi tabel dengan hasil render kode, jadi menambahkan satu peran (dan memindahkan kunci rute) tidak membuat apa pun gagal. Snapshot seed terlihat "penuh" karena bentuknya satu dokumen JSON per tenant, bukan diff terhadap default — yang membuat orang mengira isinya mengikuti katalog |
| **Solusi** | Tabel §3 **dirender dari kode**, bukan ditulis: skrip sementara mengimpor `DEFAULT_ROLE_PERMISSIONS` dan memasangkan setiap rute dengan kunci guard-nya salinan `App.tsx`, lalu mengeluarkan sel `✓/–`. Kolom baru **Kunci izin** ditambahkan supaya tiap sel bisa diverifikasi tanpa membuka kode, baris "stok masuk" dan "purchase order" dipecah (kuncinya beda: `add_stock` vs `view_inventory`), kolom `purchasing` dan `/absen` ikut, dan jumlah kunci aktif per peran ditulis di bawah tabel. `requirement.md` §2.A dan dua dokumen lain diperbaiki mengikuti angka itu. Temuan `stock_opname` tidak "diperbaiki" dengan memangkas katalog — itu perubahan perilaku — tapi didokumentasikan sebagai aturan baru di `frontend.md` §13 poin 6 ("Deklarasi ≠ penegakan") |
| **Bukti** | Hasil render: owner-tier 31/31, `store_manager` 16, `warehouse` 8, `purchasing` 6, `cashier` 1 (`access_pos`; `apply_discount` eksplisit `false`), `staff` 0. Grep `stock_opname` di `src/` (di luar `config/roles.ts` dan test) **nol** hasil — satu-satunya kunci tanpa konsumen; 30 lainnya dibaca guard rute, `nav-items.ts`, atau `can(key)`. `db/schema/seed.sql` baris 23 memuat JSON snapshot; `db/__tests__/seed.test.ts` ("never contradicts the role matrix") membuktikan kunci yang **hilang** boleh, yang **berbeda** tidak |
| **Pelajaran** | Kalau satu sel tabel bisa **dihitung** dari kode, menulisnya tangan berarti menjadikannya bug tertunda — ia akan tertinggal tepat satu rilis (di sini: satu peran penuh). Untuk dokumen, dua aturan turunannya: (a) cantumkan **sumber** setiap angka (kolom "Kunci izin" membuat tabel bisa diverifikasi tanpa menjalankan aplikasi), dan (b) bedakan "dideklarasikan" dari "ditegakkan" — audit periodik katalog izin terhadap pemanggil `can()`/guard adalah satu-satunya cara tahu sebuah sakelar di layar Role benar-benar menggembok sesuatu |

---

## KS-48 · 2026-11-16 · Dokumen spesifikasi berstatus "Proposed" selamanya — padahal kodenya sudah ship — **SELESAI**

| | |
|---|---|
| **Gejala** | `docs/spec-purchase-order.md` dan `docs/spec-varian-harga-vendor.md` sama-sama membuka dirinya dengan `Status: **Proposed** — spec only, no code written yet`, sementara yang kedua punya **§16 "Status implementasi"** yang isinya membantah header dokumen itu sendiri (§16 sudah mencatat 207 tes lulus dan alur varian jalan). Turut ditemukan: satu anchor mati di §16 ("sebagai template PO (§15.1)" — §15 adalah daftar *Di luar cakupan* dan poin 1-nya justru alternatif yang **ditolak**, yaitu basket multi-item), dan `README.md` tidak mengindeks kedua spec sama sekali sehingga pembaca tidak punya jalan masuk ke status sebenarnya |
| **Akar masalah** | Spec ditulis dengan format header dokumen referensi (`Status`, `Terakhir diperbarui`) tetapi fungsinya berbeda: ia **rekaman keputusan pada titik waktu**. Tidak ada konvensi yang memisahkan bagian yang dibekukan (§0–§15, alasannya) dari bagian yang hidup (status implementasi), jadi yang diperbarui saat rilis hanya §16 sementara baris `Status` — baris yang paling pertama dibaca — tidak pernah disentuh lagi. Anchor `§X.Y` diketik dari ingatan struktur dokumen lain; tidak ada pemeriksa anchor di repo, jadi hanya anchor yang kebetulan dibuka orang yang pernah salah |
| **Solusi** | Kedua header diubah ke **Shipped** + menunjuk migrationsya (`005_procurement_lifecycle`, `006_variants_pricing`) dan diikuti **catatan status bertanggal** yang menyatakan dengan tegas §0–§15 adalah rekaman titik waktu yang **tidak disunting** (termasuk angka lama seperti "tenant.sql versi 6, 33 tabel" dan sitasi baris kode), sementara kebenaran hari ini ada di catatan itu + §16. Anchor diperbaiki ke `§14 D3` untuk keputusan "pricelist = template PO" dan `§15 poin 1` untuk yang di luar cakupan. Kotak koreksi versi di §16 dinaikkan ke **v9 / 34 tabel** dengan penjelasan bahwa void hanya menambah kolom (bukan tabel), sehingga tabel G1–G5 tetap berlaku. `README.md` §Documentation menambah baris kedua spec, `ringkasan-fitur-2026-11-05-06.md`, dan `CHANGELOG.md`, plus aturan baru: *body spec tidak ditulis ulang, hanya diberi catatan status bertanggal* |
| **Bukti** | Yang dinyatakan "belum ada kode" ternyata ada: `goods_receipts` / `goods_receipt_items` (`db/migrations/005_procurement_lifecycle.sql`), `product_variants` / `vendor_price_list` + tujuh kolom `variant_id` (`006_variants_pricing.sql`), `src/lib/procurement.ts`, `src/lib/goods-receipt.ts`, `resolveBuyPrice()` di `src/lib/pricing.ts`, tombol "Isi dari template" di `PurchaseOrderModal.tsx`, tab Harga Beli/Riwayat Harga di `VendorDetail.tsx`, dialog **Pilih Varian** di POS yang ditutup `kasir.e2e.ts` ("a variant product asks which flavour before which pack"). Gerbang pada hari audit: `tsc` app + node 0 error, `vitest run` **28 berkas / 365 tes lulus** (procurement 28, variants 18, pricing 30). Yang **tetap** ditulis sebagai terbuka karena memang belum ada: peringatan "harga penerimaan ≠ harga kesepakatan" di `GoodsReceiptModal.tsx` (modal hanya meng-*seed* baris dari pricelist) dan e2e gudang untuk kasus itu |
| **Pelajaran** | Ada dua jenis dokumen dan aturannya berlawanan. Dokumen **status** ("kode hari ini begini") wajib disinkronkan tiap rilis; dokumen **keputusan** ("kenapa dulu pilih ini") wajib *dibekukan* supaya argumennya tidak hilang. Penanda mekanisnya: kalau isinya bisa dibantah oleh `git log`, itu dokumen keputusan — jangan diedit, tapi tempel header status + tanggal verifikasi yang menunjuk bagian status. Dan untuk anchor: kutip nomor yang benar-benar ada di daftar heading (`Select-String '^#{2,3} '`), dan kalau merujuk item daftar tulis `§15 poin 1`, bukan `§15.1` — format terakhir menyiratkan subbagian yang tidak pernah ada |

---

## KS-49 · 2026-11-17 · Dokumen punya penjaga angka, bukan penulisnya — dan auditor SQL membaca komentar sebagai kode — **SELESAI**

| | |
|---|---|
| **Gejala** | Tiga cacat muncul bersamaan selama rilis v10 dan semuanya ketahuan **oleh tangan**, bukan oleh alat. (1) Dua tabel markdown rusak karena suntingan dokumen: satu baris disisipkan newline fisik di dalam sel (`backend.md` §10) dan satu backtick ganda (`spec-vendor-produk-terintegrasi.md`) — keduanya membuat seluruh tabel tampil salah. (2) Angka lama selamat dari re-sync: `frontend.md` §2 dan `arsitektur.md` masih menulis "28 berkas / 365 test" padahal gerbang hari itu 30/419, dan baris `audit:sql` menulis "478 diperiksa" sementara alatnya melaporkan 477. (3) `npm run audit:sql` melaporkan kelas temuan `SYNTAX \| incomplete input` untuk `UPDATE users` di tiga berkas — ketiga tempat itu ternyata **kalimat di dalam komentar** ("layar ini dulu menjalankan `UPDATE users`"), bukan panggilan kode |
| **Akar masalah** | Untuk (1) dan (2): dokumen disunting sebagai teks sementara setiap angkanya dihitung di tempat lain; pelajaran umum no. 14 sudah melarang angka diketik tangan, tetapi tidak ada satu pun perintah yang **menolak** dokumen yang tidak konsisten, jadi kepatuhannya bergantung pada ingatan penulis. Untuk (3): pengumpul literal memindai isi berkas dengan regex dan tidak tahu bedanya kode dengan komentar — pola pengumpulnya (string yang diapit backtick atau tanda kutip) mengambil apa pun yang berbentuk statement, termasuk yang berada di dalam `//` atau blok dokumentasi `/* … */` |
| **Solusi** | Alat pemeriksaan yang tadinya skrip sekali-pakai di `.data/` **diangkat ke repo**: `scripts/check-docs.mjs` + `npm run docs:check`, empat pemeriksaan — (a) jumlah sel setiap baris tabel harus sama dengan header-nya (blok kode di-*skip*, `\|` dihitung teks, bukan pemisah), (b) versi skema harus satu angka di tiga tempat (stamp `tenant.sql`, `CURRENT_SCHEMA_VERSION`, prefiks tertinggi `db/migrations`), (c) indeks dokumentasi README harus menutup setiap `docs/*.md` dan setiap berkas yang disebut harus ada, (d) anchor `§N` yang ditulis tepat setelah tautan `[foo.md](foo.md)` harus menunjuk heading yang benar-benar ada di berkas itu — kelas kesalahan yang di KS-48 masih ketahuan karena orang kebetulan membuka tautannya. Gerbangnya sendiri diuji dengan **positive control**: `scripts/__fixtures__/docs-check/` menanam satu cacat per pemeriksaan dan harus melaporkan 8 masalah. Enam penyimpangan lama ikut diperbaiki: empat baris `fitur-tenant.md` kehilangan sel **Status** terakhir, satu `\|\|` di dalam code span `frontend.md`, dan satu nilai absolut `\|unit_cost − pricelist.buy_price\|` di tabel validasi `spec-varian-harga-vendor.md` di-escape — **hanya format, isi tidak berubah**, dicatat di catatan status bertanggal spec itu. Untuk (3): `commentRanges()` di `audit-sql.mjs` memisahkan rentang `//` dan `/* … */` lebih dulu (string di-step-over supaya `//` di dalam URL tidak membuka komentar), jadi hanya kode yang diaudit |
| **Bukti** | `npm run docs:check` → **OK, keluar 0** atas 14 berkas markdown; versi skema terbaca v10 dan cocok di ketiga tempat. Gerbang mencetak cakupannya sendiri — jumlah berkas markdown, baris tabel, dan anchor `§` yang benar-benar dibaca (saat ditulis: 14 berkas) — karena keluaran "OK" tanpa angka cakupan tidak bisa dibedakan dari gerbang yang tidak membaca apa pun. Angka baris tabel dan anchor **tidak** dikutip sebagai fakta di bagian lain dokumen ini: keduanya bergerak tiap kali sebuah tabel disunting, dan itulah tepat kelas angka lama yang selamat dari re-sync di atas. Positive control: `node scripts/check-docs.mjs --root scripts/__fixtures__/docs-check` → **keluar 1 dengan 8 masalah** (satu baris tabel 3 sel, stamp v7 vs target v9, migrasi tertinggi 5 vs v9, dua berkas tanpa indeks, satu entri indeks ke berkas hantu, satu `§9` mati, satu berkas target tidak ada) sementara anchor `§4` yang hidup **tidak** dilaporkan. `audit:sql` sebelum → sesudah: **538 → 530** literal dikumpulkan, **477 → 471** diperiksa, 61 → 59 dinamik, `skipped (comments)` = 8, dan **3 → 2** kelas temuan — seluruh kelas `SYNTAX \| incomplete input` hilang tanpa menyentuh satu pun komentar di aplikasi. Delapan literal yang tidak lagi dikumpulkan **bisa didaftar ulang kapan saja** lewat flag `-- --show-comments` di auditor itu sendiri (keluar `src/hooks/use-permissions.ts:39: SELECT settings FROM tenants LIMIT 1`, `src/pages/Employees.tsx:400: UPDATE users`, dst. — 8 situs, semuanya diawali `//` atau ` *`): tidak ada panggilan kode yang ikut tertutup. Awalnya bukti ini hanya ada di skrip jajak sekali-pakai di `.data/` — yaitu persis cacat yang dilarang pelajaran no. 16, jadi kemampuannya dipindah ke dalam `audit-sql.mjs`. `node --check` bersih untuk kedua skrip; `package.json` menambah `docs:check` di samping `audit:sql` |
| **Pelajaran** | (a) Pemeriksaan yang hidup di `.data/` adalah pemeriksaan yang berjalan satu kali — begitu ia menemukan cacat nyata, angkat ke `scripts/` + npm script, kalau tidak cacat berikutnya ditemukan lagi oleh kebetulan. (b) Kalau keluaran alat berbentuk prosa (temuan yang ternyata kalimat), **perbaiki alatnya**, bukan kalimatnya: perbaikan pertama di rilis ini hanya menulis ulang satu komentar JSDoc dan hanya memindahkan salah-temuan itu. (c) Gerbang dokumen tidak perlu pintar — bentuk tabel, satu versi di tiga tempat, indeks yang menutup berkas, dan anchor yang menunjuk heading nyata adalah empat pemeriksaan ±200 baris yang menangkap seluruh kelas kesalahan yang benar-benar terjadi di repo ini. (d) Sebuah gerbang baru belum selesai sebelum ada fixture yang membuatnya gagal — lihat pelajaran umum no. 16 |

---

## KS-50 · 2026-11-17 · 403 dari skrip verifikasi nyaris dilaporkan sebagai deploy rusak — dan hampir memperbaiki runbook yang benar — **SELESAI**

| | |
|---|---|
| **Gejala** | Setelah push ke `main` (build GitHub-integration menggantikan deploy manual di alias), pemeriksaan produksi dijalankan lewat skrip Node. Langkah health/401/marketplace/catalog lolos, lalu `POST /api/auth/sign-in/email` menjawab **403** dan semuanya ikut jatuh: tanpa cookie sesi maka `/api/tenant/bootstrap` → 401, `grants` kosong, `dbUrl` kosong. Keluarannya **6 baris kegagalan** yang terbaca seperti "build CI produksi rusak total", padahal dua klien lain — `Invoke-WebRequest` dan `curl` — dengan kredensial yang sama menjawab 200 pada hari yang sama |
| **Akar masalah** | Better Auth memeriksa `Origin` hanya pada request yang **berpola browser**. Header yang menjadi pemicunya adalah `Sec-Fetch-Mode`: request yang membawanya tanpa `Origin` yang cocok ditolak dengan `{"code":"MISSING_OR_NULL_ORIGIN"}`. `fetch` global Node (undici) selalu mengirim `Sec-Fetch-Mode: cors` dan **tidak** mengirim `Origin`, sedangkan `curl` tidak mengirim keduanya — jadi klien yang satu kena dan yang lain lolos pada request yang secara byte identik. Kegagalannya lalu **berantai**: satu 403 di hulu menjadi enam "temuan" di hilir, karena setiap pemeriksaan berikutnya ikut membaca sesi yang tidak pernah ada. Kesimpulan pertama saya ("Better Auth menolak POST tanpa `Origin`") salah dan nyaris masuk ke runbook sebagai "perbaikan" untuk langkah 4 `curl` — yang justru terbukti benar |
| **Solusi** | Diagnosis dilakukan dengan A/B pada **satu** request, satu header sekali ubah, dan selalu membaca body error (field `code` menyebut penyebabnya; status saja tidak cukup): Node fetch tanpa `origin` → 403; Node fetch + `origin` = URL target → 200; `curl` polos → 200; `curl` + `-H "sec-fetch-mode: cors"` → **403** (inilah yang membantah hipotesis pertama). Temuannya dipromosikan dari skrip sekali-pakai di `.data/` menjadi alat tetap: `scripts/verify-production.mjs` + `npm run verify:prod` menjalankan §7 dengan **satu assert per pemeriksaan** yang selalu mencetak detailnya, `--base` untuk host lain yang menyajikan permukaan API yang sama, `--require-perm k1,k2` sebagai tempat kunci izin rilis berjalan tanpa perlu mengedit skripnya, dan **exit 2** bila pemeriksaan sesi dilewati karena `DEMO_PASSWORD` tidak dipasang — kredensial dibaca dari environment saja, nilainya tetap tinggal di blok credentials `e2e.config.ts` dan tidak diduplikasi ke berkas baru |
| **Bukti** | Tiga jalur dijalankan terhadap produksi dan ketiganya terbukti: **pass** → `RESULT 10 passed, 0 failed`, keluar 0 (`tenant=thalia`, `tokenChars=371`, `ttlMin=60`, `9 role(s): tenant_owner=31, cashier=2, warehouse=8, purchasing=6, …`); **negative control** → `--require-perm izin_yangtidak_ada` menghasilkan `FAIL owner grant …: value=undefined`, keluar 1 dengan nama pemeriksaan yang gagal disebut (gerbang yang tidak bisa gagal tidak dihitung — pelajaran no. 16); **skip** → tanpa `DEMO_PASSWORD`: `4 passed, 0 failed, 3 skipped (incomplete run)`, keluar 2. Bukti header dari echo service: Node mengirim `Sec-Fetch-Mode: cors` tanpa `Origin`. Skrip ini juga **menemukan bug di dirinya sendiri** pada lintasan pertama — `boot.status` seharusnya `boot.res.status`, tampil sebagai `HTTP undefined` padahal payload-nya sempurna — dan itu persis alasan setiap baris `check()` mencetak detail, bukan sekadar ok/gagal. `node --check scripts/verify-production.mjs` bersih; `package.json` menambah `verify:prod` di samping `docs:check`. **Dua cacat tambahan keluar tepat karena flag itu dipakai, bukan karena dibaca**: `--base https://retailpro-thalia-<hash>-koncowebs-projects.vercel.app` → **10/10 FAIL `Protected by Vercel Authentication`** (URL per-deployment dikunci Deployment Protection — klaim bahwa `--base` bisa menunjuknya ternyata salah dan sudah diganti di `docs/deployment.md` §7.0 + CHANGELOG, sementara build-nya sendiri sehat: alias → 10/10 lolos), dan `--base http://localhost:3000` → `FAIL tenant bootstrap: dbUrl=http://127.0.0.1:8090 tokenChars=9` yang justru **benar** untuk shim Hrana lokal, jadi yang salah lingkup adalah assert-nya (sekarang `https` + ≥100 karakter hanya dituntut kalau basisnya `https`; produksi **8/8 lolos**, dev lokal **7/7 lolos**) |
| **Pelajaran** | (a) Kegagalan berantai dari satu sebab hulu dihitung sebagai **satu** temuan: sebelum mempercayai enam kegagalan, perbaiki yang paling awal dan lihat berapa yang ikut hilang. (b) 403/401 dari skrip adalah **klaim tentang skrip** sampai bisa direproduksi di jalur nyata (browser atau klien kedua) — pelajaran no. 10 mengatakan "uji satu request", tapi tidak mengatakan bahwa request yang gagal dari satu klien berarti apa pun. (c) Jangan menulis temuan ke runbook dari simpulan: satu eksperimen berbiaya satu header murah, dokumentasi yang salah mahal dan akan diulang orang lain. (d) Alat verifikasi wajib punya **jalur gagal** dan **jalur skip** yang terlihat (exit 1 vs exit 2), kalau tidak "hijau" berarti tiga hal berbeda. (e) Opsi yang belum pernah dijalankan adalah dokumentasi yang belum diverifikasi: `--base` lolos pemeriksaan mata karena tidak dipakai; sekali dijalankan ia membuka dua hal sekaligus — satu klaim palsu di dokumen saya sendiri dan satu assert yang salah lingkup |

---

## KS-51 · 2026-11-18 · Rail chat menamai setiap DM "Pesan pribadi" — agregasi peserta dibaca dari join yang sudah difilter — **SELESAI**

| | |
|---|---|
| **Gejala** | Daftar percakapan di `/backoffice/chat` menampilkan DM owner ⇄ kasir sebagai **“Pesan pribadi”** dengan avatar bermonogram dua huruf, padahal kedua orang pada DM itu punya nama lengkap. Channel bernama tampil benar, hanya DM yang jatuh ke label fallback |
| **Akar masalah** | `listConversations()` butuh dua hal yang bertentangan dalam satu statement: **membatasi** hasil ke percakapan tempat pembaca ikut (`p.user_id = $1`) dan **meng-agregasi seluruh** peserta percakapan (`json_group_array` atas `chat_participants`). Keduanya dipakai lewat satu join, sehingga setelah filter hanya tersisa baris pembaca — `dmPartner()` tidak pernah menemukan peserta kedua dan selalu mengembalikan fallback. Ini kelas yang sama dengan KS-43: angka yang ditampilkan adalah hasil dari bentuk query, bukan dari data |
| **Solusi** | Pemisahan `listConversationsSql()` (statement builder, dipakai jalur browser **dan** tes): pembatasan menjadi subquery `c.id IN (SELECT conversation_id FROM chat_participants WHERE user_id = $1)` sehingga baris peserta untuk agregasi tidak ikut tersaring. Sisi manfaat lain: karena sekarang hanya ada satu builder, auditor SQL tidak menghitung salinan yang sama dua kali — literal yang dikumpulkan **577 → 576** dan yang dilewati karena dinamik **65 → 64** |
| **Bukti** | `src/lib/chat.ts` (`listConversationsSql`), `src/components/chat/chat-utils.ts` (`dmPartner`). Diukur sebagai pasangan sebelum/sesudah pada baris rail yang sama di `screen-at-failure.txt`: sebelum = `button "PP Pesan pribadi …"`, sesudah = `button "SU Surya 01.17 dm halo"`. Kini dijaga `tests/chat.e2e.ts` kasus “DM terbaca dari kedua sisi” — run bersih 2026-11-18: `tests/chat.e2e.ts (8 tests) 170,49s`, `Tests 10 passed (10)` |
| **Pelajaran** | Klausa `WHERE` yang berfungsi sebagai **share-check** tidak boleh duduk di join yang sama dengan agregasi yang membutuhkan seluruh grup: pindahkan ke `IN (SELECT …)`. Cara tercepat menemukan kelas bug ini: tanyakan “kalau filter ini diterapkan, baris apa yang hilang dari `GROUP BY`-ku?” — dan jangan percaya label fallback yang muncul **untuk semua** baris satu kategori; itu tanda kode pembaca tidak pernah mendapat data yang ia minta |

---

## KS-52 · 2026-11-18 · Enter mengirim token mention yang belum selesai — **SELESAI**

| | |
|---|---|
| **Gejala** | Operator mengetik `#beras` lalu menekan Enter sebelum daftar saran muncul. Yang terkirim adalah teks mentah `#beras` sebagai pesan biasa: bubble di thread berisi token, **nol** baris di `chat_mentions`, dan tidak ada chip yang bisa diklik |
| **Akar masalah** | Dua jalur berebut satu tombol. `onKeyDown` sudah tahu bahwa ada token aktif di kursor (`findActiveToken`), tetapi tidak tahu apakah pencarian entitas untuk token itu **sudah selesai**. Selama query suggestion masih `pending`, cabang “tidak ada kandidat” terlihat sama dengan “tidak ada yang cocok”, jadi Enter mengambil jalur kirim. Yang disalahkan biasanya composer; sebenarnya keadaan “sedang mencari” tidak pernah direpresentasikan |
| **Solusi** | Gerbang eksplisit di `src/components/chat/Composer.tsx`: `waitingForSuggestions = open && suggestions.length === 0 && suggestionsQuery.status === "pending"`; selama itu true, Enter/Tab di-`preventDefault()` dan **tidak** mengirim. `status === "pending"` dipakai, bukan `isFetching`, supaya celah antara token muncul dan query mulai ikut tertutup; begitu pencarian selesai tanpa cocok, teks diperlakukan sebagai ketikan biasa dan Enter memang mengirim |
| **Bukti** | `src/components/chat/Composer.tsx` (guard + komentar “Without this guard Enter sends the raw `#beras”`), dikunci `tests/chat.e2e.ts` kasus mention (chip `@`/`#` dari ketik sampai kirim) — kasus itu lulus pada run bersih 2026-11-18 (170,49s untuk 8 kasus) |
| **Pelajaran** | Untuk setiap “nol hasil”, bedakan **belum ada hasil** dari **hasilnya kosong** — keduanya terlihat identik di UI dan hanya berbeda di state query. Semua pintasan keyboard yang mengambil keputusan dari daftar async harus menanyakan status query-nya lebih dulu |

---

## KS-53 · 2026-11-18 · Pesan mendarat di channel yang salah karena transkrip di-placeholder — **SELESAI**

| | |
|---|---|
| **Gejala** | Flaky di `tests/chat.e2e.ts` kasus “buat channel lalu kirim”: assertion layar **lulus** (header `#e2e-chat`, bubble `halo dari e2e` terlihat), tapi assertion database gagal dengan `Expected values to be strictly equal: + 'null' - 'halo dari e2e'` — `last_message_preview` channel itu kosong. Jajak `tenantClient()` membuktikan pesannya benar-benar tertulis, hanya di baris **lain**: `chat_messages` `halo dari e2e` berada di `operasional-toko` (`created_at` `2026-11-17T18:24:16.780Z`) sementara header pane sudah menunjuk `#e2e-chat`; pada percobaan ulang baris yang sama masuk ke `e2e-chat` (`18:24:49.713Z`) — karena itu tes tampak “sesekali lulus” |
| **Akar masalah** | `placeholderData: keepPreviousData` dipasang pada query yang **key-nya memuat `conversation_id`** (`useConversation`, `useMessages`). Untuk query daftar itu benar (key tidak berubah saat berpilih), tetapi untuk query per-id ia berarti “tahan percakapan **sebelumnya** di layar sampai yang baru tiba”. Composer menerima `conversationId={conversation.id}` dari objek yang sedang tampil, jadi pada jendela transisi itu ia menulis ke channel lama. Jalur tulasnya sendiri (`src/lib/chat.ts` `sendMessage()` INSERT + `UPDATE … WHERE id = $4`) konsisten — yang salah adalah **identitas yang ditampilkan**, bukan penulisnya |
| **Solusi** | Placeholder dilepas dari `useConversation` dan `useMessages` (komentar di `src/hooks/use-chat.ts` mencatat alasannya dan menyimpan bukti timestamp-nya); `useConversations`/`useDiscoverableChannels` tetap memakainya. `src/pages/Chat.tsx` menambah cabang `) : activeId ? (<ChatEmptyState skeleton />)` supaya jendela transisi menampilkan skeleton, **bukan** percakapan lain. Di sisi tes: assertion `getByText('#e2e-chat')` dipasang **sebelum** mengetik, sehingga identitas pane dikunci lebih dulu |
| **Bukti** | Run sebelum perbaikan: 1 gagal (bug ini) pada 01:14:44, lalu **1 flaky** pada 01:22:51 (`tests/chat.e2e.ts (8 tests \| 1 flaky) 208,98s`) — pola flaky khas race. Run sesudah perbaikan (01:34:13): `Tests 10 passed (10)`, `Duration 194,11s`, tanpa flake. Jejak baris DB (dua `conversation_id` untuk teks yang sama) tetap menjadi bukti paling kuat di sini, bukan screenshot |
| **Pelajaran** | (a) `keepPreviousData` hanya aman untuk query yang **ganti key berarti ganti halaman yang sama**; bila key adalah identitas record dan ada jalur tulis yang membaca record yang sedang tampil, placeholder adalah izin untuk menulis ke record yang salah. (b) Assertion yang membandingkan layar dengan database harus mengunci **identitas layar lebih dulu** — kalau tidak, keduanya bisa “benar” secara sendiri-sendiri sementara pasangan mereka salah. (c) Tes yang flaky tanpa sebab di kode jarang diselesaikan dengan sleep; diselesaikan dengan menemukan **baris mana** yang ditulis |

---

## KS-54 · 2026-11-18 · Runner e2e menilai ulang modul uji, identifier ber-`Date.now()` kehilangan state — **SELESAI**

| | |
|---|---|
| **Gejala** | `tests/chat.e2e.ts` dilaporkan **3 dari 8 kasus gagal** tanpa satu pun perubahan kode aplikasi, dengan bentuk kegagalan yang berpindah-pindah setiap run. Yang hilang selalu hal yang sama: channel/DM yang “sudah dibuat” oleh kasus sebelumnya tidak ditemukan oleh kasus berikutnya |
| **Akar masalah** | Identifier fixture dibuat di **scope modul** (`const name = 'e2e-chat-' + Date.now()`). Harness `e2e` (tester.army) menilai ulang berkas modul uji **lebih dari sekali dalam satu run** — tes yang di-retry atau tes yang dijalankan belakangan mendapat instans modul baru — sehingga setiap instans mempunyai nama berbeda dan mencari baris yang dibuat instans lain. Ini persis pelajaran no. 8 (state level modul) tetapi di sisi harness, bukan di aplikasi: yang di-evaluate ulang adalah **kode tes**, dan `Date.now()` adalah state itu |
| **Solusi** | Identifier dijadikan **konstanta** (`CHANNEL = 'e2e-chat'`, pesan `halo dari e2e`, `dm halo`) dan setiap kasus menyapu miliknya sendiri **di awal** (`sweepChatRows()` / `sweepMentionMessages()` — hapus anak dulu: `chat_mentions` → `chat_messages` → `chat_participants` → `chat_conversations`). Karena nama channel dijaga UNIQUE oleh indeks parsial, kombinasi “nama tetap + sweep di awal” inilah yang membuat retry mulai dari state yang diketahui, bukan dari state milik instans lain |
| **Bukti** | Komentar di kepala `tests/chat.e2e.ts` mencatat ukuran penyebabnya (“the run measured 3 of 8 cases failing purely because of that”). Setelah konstanta + sweep: run 2026-11-18 01:34:13 = `tests/chat.e2e.ts (8 tests) 170,49s`, `Tests 10 passed (10)`, `Duration 194,11s`, exit 0. Aturan turunannya didaftar di `docs/frontend.md` §12 no. 18–20 |
| **Pelajaran** | Di harness yang menilai ulang modul, **apa pun di scope modul adalah state**. Jangan menaruh nilai waktu acak di sana; pakai identifier konstanta dan pulihkan state dari database di awal tiap kasus. Bila kegagalan sebuah suite **berpindah tempat** setiap run sementara kodenya tidak berubah, curigai struktur tes sebelum curigai aplikasi |

---

## KS-55 · 2026-11-19 · Impor sheet vendor menjatuhkan harga beli ke varian yang salah — **SELESAI**

| | |
|---|---|
| **Gejala** | Produk dengan beberapa varian (mis. Kopi Sachet: rasa Susu/Hitam × ukuran 250ml/1kg) diimpor lewat **Import Vendor + Produk**. Sheet hanya punya satu kolom `Harga Beli` dan tidak bisa menyebut varian, tetapi sistem menyimpan harga beli **per varian × pecahan** (`vendor_price_list.variant_id`). Operator melihat harga Susu 250ml berubah padahal baris yang ia tulis dimaksudkan untuk Hitam 1kg — tanpa pesan error, tanpa badge, dan angka sebelumnya hilang tertimpa. Produk satu-varian (`Default`) tidak terpengaruh, karena itu tidak ada data demo yang menampakkannya |
| **Akar masalah** | Dua lapis. (1) **Bentuk data**: `VENDOR_PRODUCT_COLUMNS` berhenti di `(vendor × produk × pecahan)`; identitas varian tidak punya kolom, jadi baris sheet secara harfiah tidak bisa menyatakan apa yang akan ditulisnya. (2) **Pencocokan**: `packsByProduct` merapatkan `product_units` **semua** varian ke satu daftar di level produk, lalu `planVendorProductImport` memilih dengan `existing.packs.find((row) => row.unitName === pack.unitName)` — nama pecahan saja. Untuk produk 3 varian, "Pcs" ada tiga kali di daftar itu; yang terpilih adalah **yang kebetulan kembali pertama** dari query. Jadi ini cacat **identitas**, bukan cacat harga: perencana menulis angka yang benar ke baris yang salah, dan `priceMode` tidak pernah punya kesempatan menolaknya |
| **Solusi** | Varian ikut dibawa sampai pencocokan. `PackSeed` menyimpan `variantSku`/`variantKey` dari dua kolom baru (`Kode Varian`, `Atribut Varian`) yang **di-append di ujung** `VENDOR_PRODUCT_COLUMNS` supaya ekspor lama tetap sebaris dengan header-nya; universe impor kini membaca `SELECT id, product_id, sku, attributes FROM product_variants` dan menautkannya sebagai `ExistingProduct.variants[]` dengan `attributeKey = variantKey(attributes)`; helper murni `resolveTargetVariant(variants, pack)` menentukan sasaran (kode menang atas atribut; tanpa penyebut = aman hanya bila produk punya tepat satu varian), dan pecahan dicari **di dalam** varian itu (`existing.packs.filter((row) => row.variantId === target.id)`). Kasus yang tidak bisa diselesaikan **tidak ditebak**: `ambiguousVariants` mencatat alasannya, barisnya dilewati dari tulisan, dan pratinjau menampilkan "N harga varian dilewati (sebutkan Kode Varian)". `variants` bersifat opsional, jadi pemanggil lama (universe tanpa baca varian) tetap berperilaku seperti sebelumnya |
| **Bukti** | Unit: `src/lib/vendor-import.test.ts` `describe('variant-targeted pricing')` — harga mendarat di varian yang disebut, varian tak dikenal → `ambiguousVariants` + tidak ditulis, produk satu-varian tanpa penyebut → tetap ditulis, dan produk multi-varian tanpa penyebut → **tidak** ditulis (regresi langsung dari cacat ini). Berkas itu naik dari 24 test (HEAD `a7cb9a4`) ke 39. Browser: `tests/bulk-import.e2e.ts` kasus kedua mengubah `buy_price` carton menjadi 61000 dan nama produk menjadi "... Edit" lewat SQL, mengunggah berkas yang sama, lalu menuntut pratinjau berkata **"0 akan ditulis · 1 tidak ada yang baru"** sebelum menekan Batal — dan snapshot sesudahnya identik dengan sebelumnya kecuali dua nilai yang diedit manual itu, dengan jumlah tetap `{products: 1, variants: 4, packs: 5, prices: 5}`. `vendor_price_list` per (varian, pecahan) diaassert satu per satu di kasus pertama, 5 baris untuk 5 kombinasi. `tests/vendor-catalog.e2e.ts` dijalankan tanpa diubah terhadap fixture 18-kolom lama: tetap lulus, bukti kompatibilitas mundur. Rangkaiannya ikut tercatat di [spec-impor-varian-kaya.md](spec-impor-varian-kaya.md) §7 |
| **Pelajaran** | (a) Bila tabel tujuan punya kunci lebih spesifik daripada bentuk berkasnya, **berkasnya yang harus diperluas** — bukan pencocokannya diperlonggar; mencocokkan pada kolom yang lebih kasar akan selalu memilih sesuatu, dan "sesuatu" itu adalah baris milik orang lain. (b) Setiap kali kode menulis satu nilai ke satu baris hasil `find()` di daftar yang mungkin berisi beberapa kandidat, tanyakan apa yang membuat kandidat sisanya terbedakan; kalau jawabannya "urutannya", itu bukan pencocokan, itu tebakan senyap. (c) Kegagalan yang tidak dilaporkan lebih mahal daripada kegagalan yang menghentikan impor: operator tidak akan pernah menyadari angkanya salah, dan setelah tertimpa, nilai sebelumnya hilang. (d) Tambah kolom **di ujung** adalah satu-satunya perubahan skema-lembar yang aman untuk data yang sudah diekspor orang |

---

## KS-56 · 2026-11-19 · Satu kode vendor tulisan tangan merusak seluruh pemintingan kode `VND-####` — **SELESAI**

| | |
|---|---|
| **Gejala** | Run e2e suite penuh: `tests/vendor-catalog.e2e.ts` gagal **4 dari 4** (padahal berkas dan fixture-nya tidak saya sentuh sama sekali), dan `tests/auth.setup.e2e.ts` sign-in manager ikut mati sehingga beberapa berkas lain jatuh berantai. Jejak di konsol selalu sama: `UNIQUE constraint failed: suppliers.code`, juga saat `VendorFormModal` menyimpan vendor baru dengan kode kosong. Yang berubah hanyalah fixture baru `tests/fixtures/fixture_produk_varian.csv` — ia memakai `Kode Vendor` `VND-E2E-KOPI`, dan karena konvensi suite ini membersihkan data produksinya saja di awal tiap kasus, kode itu tetap hidup di tenant demo saat berkas vendor-catalog berjalan |
| **Akar masalah** | Pemintingan membaca "kode terakhir" sebagai teks: `SELECT code FROM suppliers WHERE code LIKE 'VND-%' ORDER BY code DESC LIMIT 1`. Secara leksikal huruf selalu di atas angka, jadi `VND-E2E-KOPI` menang atas `VND-0777`; nilai itu masuk ke `nextVendorCode()` yang regex-nya `^[A-Z]+-(\d+)$`, tidak cocok, dan fallback-nya **mulai dari 0001** — angka yang jelas sudah dipakai. Implikasi bukan sekadar uji: satu vendor yang kodenya ditulis tangan operator sudah cukup untuk membuat *setiap* impor sheet, *setiap* simpan produk dengan supplier baru, dan *setiap* form vendor gagal, tanpa hubungan kausal yang terlihat dari layar tempat operator mengetik. Ada tiga salinan query pemintingan (`vendor-catalog.ts`, `Vendors.tsx`, `VendorFormModal.tsx`) dan hanya satu yang dipakai jalur bertransaksi, jadi perbaikannya tidak boleh berbentuk menambal satu salinan |
| **Solusi** | Satu aturan murni, satu tempat: `highestVendorCode(codes)` di `src/lib/vendor.ts` memfilter kode ke bentuk `PREFIX-<angka>` lewat `vendorCodeSequence()` dan mengambil angka terbesar; `nextVendorCode()` sekarang memanggil `vendorCodeSequence()` alih-alih regex sendiri, dan `latestVendorCode()` tinggal membaca mentah `SELECT code ... WHERE code LIKE 'VND-%'` lalu menyerahkannya ke `highestVendorCode` (tanpa `ORDER BY` teks). Kedua salinan di `Vendors.tsx` dan `VendorFormModal.tsx` dipanggil ulang ke `latestVendorCode(outsideTransaction)` supaya tidak ada lagi yang boleh mengarang urutan sendiri. Lapis kedua: `resolveOrCreateVendor()` tidak lagi cuma mengenali tabrakan nama — tabrakan `suppliers.code` dengan kode **hasil minting** di-*retry* sampai 3 kali dengan angka berikutnya (kode yang sedang dipakai tidak boleh direbut, karena kode tidak mengikat nama), sedangkan tabrakan pada kode **eksplisit dari sheet** diselesaikan dengan mengambil baris berkodenya, karena di situ pemiliklah yang menentukan |
| **Bukti** | Data nyata di tenant demo, dibaca lewat `CONTROL_DB_URL` → `tenant_databases` → token Turso: `suppliers` memegang 11 kode (`VND-0001`…`VND-0010` + `VND-E2E-KOPI`). Query lama `ORDER BY code DESC LIMIT 1` mengembalikan `VND-E2E-KOPI`, `nextVendorCode()` atas nilai itu menghasilkan `VND-0001` — dan baris dengan `VND-0001` **sudah ada** (COUNT = 1), persis `UNIQUE constraint failed: suppliers.code` yang muncul di jejak konsol. Pemeringkatan angka memberi `VND-0010` → `VND-0011`, bebas. Unit: `src/lib/vendor.test.ts` `describe('highestVendorCode')` (3 kasus: `VND-2`/`VND-10`/`VND-10000` harus 10000, `VND-0777` + `VND-E2E-KOPI` harus 0777, kosong/`VND-SURIYA` saja harus `null`) dan `src/lib/vendor-catalog.test.ts` kasus "keeps a hand-written code out of the generated sequence" yang menyisipkan `VND-SURIYA` lalu menuntut `latestVendorCode()` tidak berubah dan vendor berikutnya tepat `nextVendorCode(before)`; `vendor.test.ts` 11 → 14, `vendor-catalog.test.ts` 25 → 26. Suite unit: 33 berkas / **529 test** lulus. e2e: `tests/vendor-catalog.e2e.ts` dijalankan **tanpa diubah** terhadap fixture 18-kolom lama → 4 lulus + auth setup (101.72s), `tests/bulk-import.e2e.ts` → 7 lulus (2 di antaranya unggah `fixture_produk_varian.csv` yang memang memakai kode tulisan tangan). Suite penuh `npx e2e run` sesudah perbaikan (14 berkas, 29m02s): **61 lulus + 2 lulus setelah retry, 14 gagal, 3 di-skip** — kedua berkas impor hijau di run yang sama dan `vendor-catalog.e2e.ts` lulus 4/4 dengan 2 kasus butuh retry (justru dua kasus itulah yang sebelumnya mati `suppliers.code`). Dari 14 gagal, 9 adalah `MODEL_PROVIDER_FAILED: ExceededBudget` pada langkah `agent.*` (`Spend=248.11 ≥ Budget=248.10`, kuota provider habis — faktor eksternal) dan 5 sisanya assertion di berkas lain (`auth.setup` sign-in purchasing desk, 2 kasus `chat`, `payment-channels`, `pos-printing`); **tidak satu pun** jejak kegagalan yang masih menyebut `suppliers.code`. Tidak ada migrasi dan tidak ada perubahan skema: `suppliers.code` tetap partial unique `idx_suppliers_code` |
| **Pelajaran** | (a) "Nilai maksimum" pada kolom teks bukan urutan numerik — kalau kolom itu campuran (kode hasil minting + kode tulisan tangan), pemeringkatan harus terjadi di tempat yang bisa diunit-test, bukan di `ORDER BY`. (b) Fallback "mulai dari 0001" untuk input yang tidak dikenali adalah bom waktu: ia tidak gagal keras, ia menghasilkan nilai yang *sudah pasti* dipakai orang lain. (c) Regresi ini baru muncul karena berkas uji **lain** menulis data dengan bentuk yang belum pernah dicoba siapa pun; kalau satu suite berbagi database, setiap tambahan baru harus diperlakukan sebagai uji kompatibilitas untuk suite tetangga. (d) Tabrakan kunci hasil minting diselesaikan dengan *minta nomor berikutnya*, bukan dengan *adopsi baris yang menang* — hanya kunci yang mengikat identitas (nama) yang aman diadopsi |

---

## KS-57 · 2026-11-19 · Pratinjau rencana impor menjanjikan baris yang tidak bisa ditulis — **SELESAI**

| | |
|---|---|
| **Gejala** | Empat hal berbeda, semuanya baru kelihatan setelah dialognya benar-benar dibuka di browser dan diunggah berkas sungguhan. (1) Sheet berisi `Harga Modal` 17000 **tanpa** `Kode Vendor`/`Supplier` menampilkan chip "1 harga diisi" dan badge "harga diisi", tetapi tombolnya bertuliskan "Import 0 Produk" dan mati — tidak ada jalan untuk menepati janji itu. (2) Sebaliknya, berkas yang **memang** hanya menambal harga yang bolong (CHC-002, `kg`/1, 46000, `VND-0002`) dilaporkan "0 akan ditulis · 1 tidak ada yang baru" dengan tombol mati, padahal ada satu angka yang seharusnya masuk. (3) `produk_2026-11-10.xlsx` (282 baris) membuka dialog yang **tidak menampilkan satu baris rencana pun**: ringkasannya ada, tabelnya hilang. (4) Sheet vendor tiga baris melaporkan "2 harga varian dilewati" padahal hanya satu baris yang benar-benar menyebut harga; baris yang hanya menautkan produk (tanpa harga, tanpa varian) ikut dihitung sebagai harga yang hilang |
| **Akar masalah** | (1) dan (2) satu keluarga: perencana dan penulis tidak pernah dibandingkan. `planVariant` memberi aksi `fill` setiap kali `buyPrice > 0`, tanpa peduli baris itu menyebut vendor atau tidak, sementara `appendImportedVariants()` hanya menulis harga di dalam `if (options.vendorId && offers.length > 0)` — jadi janji itu tidak punya jalur tulis. Cerminnya, `plan.adds` hanya menghitung varian/pecahan baru, sehingga produk existing yang cuma menambal harga jatuh ke `nochange`; `Inventory.handleImport` membuang `nochange` dengan `continue` dan tombolnya digerakkan `writeCount = newProducts + extendedProducts` — dua tempat berbeda menyimpulkan "tidak ada yang perlu ditulis" dari angka yang salah. (3) CSS: badan tabel memakai `flex-1 overflow-auto` di dalam `DialogContent` yang `max-h-[85vh] overflow-hidden`; `overflow:auto` membuat ukuran minimum otomatisnya 0, jadi begitu tinggi header + chip + kebijakan + footer melebihi plafon (viewport 379 px, berkas 282 baris), ruang untuk badan sisa **0 px** dan isi 5.900 px-nya tersembunyi. (4) `planVendorProductImport()` menjalankan pemeriksaan ambiguitas untuk **setiap** pecahan, termasuk baris yang tidak membawa harga sama sekali — padahal ambiguitas hanya berarti kalau ada angka yang harus ditempatkan |
| **Solusi** | Harga beli sekarang punya syarat vendor di perencana: `const hasVendor = vendorId !== null \|\| plan.newVendor` diteruskan ke `planVariant()` dan `priceActionForNew(buyPrice, mode, hasVendor)`, dan pecahan yang sudah ada menjadi `skip` bila `pack.buyPrice <= 0 \|\| !hasVendor`. Jumlah harga yang akan ditulis menjadi angka sendiri, `plan.priceWrites` (naik pada `fill` dan `overwrite`), sehingga gerbang `nochange` sekarang `plan.adds === 0 && plan.priceWrites === 0` dan `writeCount` ikut menggerakkan tombol untuk kasus tambal-saja. UI jujur: baris yang dilewati dengan harga tapi tanpa vendor mendapat alasan eksplisit "harga beli butuh Kode Vendor atau Supplier" (bukan lagi "sudah ada harga beli untuk vendor ini"). Dialog: `max-h-[85vh] overflow-y-auto` di `DialogContent` dan `flex-1 min-h-[200px] max-h-[50vh] overflow-auto` pada badan tabel, diterapkan di **kedua** importer (`ProductImportExport.tsx` dan `VendorProductImport.tsx`) supaya pola yang sama tidak jatuh diam-diam di layar kedua. Sheet vendor: baris yang tidak membawa harga dan tidak menyebut varian di-`continue` sebelum pemeriksaan apa pun, sehingga ia menjadi "catalogue saja (tanpa harga)" alih-alih klaim harga yang hilang |
| **Bukti** | Unit: `src/lib/product-import.test.ts` **28 → 31** ("counts a missing buy price as something to write, so it can be filled" menuntut `adds 0` + `priceWrites 1` + `action extend` + `summary.extendedProducts 1`; "promises no buy price for a line that names no vendor" menuntut `skip` + `priceWrites 0` + `nochange`; "still plans the price of a new pack when the vendor itself is brand new" mengunci `newVendor`), `src/lib/vendor-import.test.ts` **39 → 40** ("treats a price-less line on a multi-variant product as a plain link" menuntut `ambiguousVariants 0` + `skippedPacks []` + `linkedProducts 1`), suite penuh `npx vitest run` **33 berkas / 533 test** lulus, `npm run typecheck` dan `npm run build` bersih. Browser (viewport 662×379; semuanya ditekan **Batal/Escape** sehingga tidak satu baris pun tertulis — dibuktikan dari database sesudahnya: `vendor_price_list` untuk CHC-002/`kg` tetap **1** baris, VND-0001 harga beli 47000, tanpa baris 46000 yang seharusnya muncul kalau dialog tadi jadi ditekan): (a) satu baris `CHC-002` berisi `Harga Modal` 17000 **tanpa** `Kode Vendor` maupun `Supplier` → ringkasan "1 produk dalam file · 0 akan ditulis · 1 tidak ada yang baru", chip "harga diisi" **tidak ada**, barisnya menampilkan alasan eksplisit "harga beli butuh Kode Vendor atau Supplier", tombol "Import 0 Produk" mati (`07-impor-varian-preview-tanpa-vendor.png` bagian ringkasan, `07b-impor-varian-alasan-tanpa-vendor.png` bagian baris); (b) baris yang sama dengan `Kode Vendor` VND-0002 dan harga 46000 yang belum ada → "1 akan ditulis", chip "1 harga diisi", status "produk sudah ada · SKU sudah ada", tombol **aktif** "Import 1 Produk" (`08-impor-varian-harga-gap-diisi.png`); tinggi badan tabel diukur **199 px** pada kedua kasus dan pada berkas 282 baris (sebelum perbaikan: 0 px); `produk_2026-11-10.xlsx` 282 baris → "282 produk dalam file · 274 akan ditulis · 8 tidak ada yang baru" dengan chip 274 produk baru / 274 varian baru / 274 pecahan baru / 274 harga diisi / 8 dilewati, tabel rencana terlihat berisi baris beserta alasan "sudah ada harga beli untuk vendor ini" dan footer "Import 274 Produk" (`09-impor-produk-282-rencana-baru.png`, `10-impor-produk-282-baris-rencana.png`); sheet vendor tiga perilaku (baris 1 `VND-0002` menautkan `TLR-003;CHC-002` tanpa harga, baris 2 mewarisi vendor lalu `TLR-003`/`kaleng` 19000 dengan `Kode Varian` `TLR-003-COKELAT`, baris 3 `TLR-003`/`dus` tanpa penyebut varian) → "0 vendor baru · 1 vendor sudah ada · 0 produk baru · 2 produk ditautkan · 1 harga beli (0 diperbarui) · **1** harga varian dilewati" dengan baris Cokelat/kaleng/Rp 19.000 "harga diisi", baris `dus` "varian ambigu", dan CHC-002 "catalogue saja (tanpa harga)" (`11-impor-vendor-tiga-perilaku.png`). Semua nama berkas tangkapan di atas ada di `.data/evidence/` (tidak ikut di-commit, sesuai konvensi artefak verifikasi). Berkas 282 baris itu juga yang dipakai untuk mengaudit penyebab impor parsial pengguna: di HEAD `a7cb9a4` hanya **8** produk yang pernah commit (`created_at` 08:19:24.090Z → 08:19:36.762Z, ~1,8 s antar baris = baris file 0–7) karena `Inventory.handleImport` lama membungkus **seluruh** loop dengan satu `try/catch`; versi sekarang menangkap per produk dan melapor `N gagal ditulis`. Baris tempat run itu berhenti (indeks 8, `8994592309639`, supplier `Nirwana Lestari` — sama dengan baris 6–7 yang justru berhasil) **tidak** punya tabrakan apa pun yang bisa ditemukan dari datanya: 0 duplikat SKU dalam file, 0 tabrakan `products.sku`, 0 tabrakan `product_variants.sku`, dan kolom `barcode` kosong. Jadi yang membunuh 274 baris itu adalah kegagalan runtime/transien di tengah jalan, yang oleh desain lama diubah menjadi "berhenti total tanpa pesan" — persis alasan `analyze:import` dibuat. Diagnostiknya kini menjadi alat tetap, bukan skrip sekali-pakai: `npm run analyze:import -- produk_2026-11-10.xlsx` (`scripts/analyze-import-file.ts`, read-only) mencetak isi file, apa yang dibuang aturan lama (8 baris sudah ada → dibuang, bukan di-extend), apa yang dijanjikan perencana terhadap data tenant nyata (`newProducts 274 · unchangedProducts 8 · newVariants 274 · newPacks 274 · priceFills 274` — angka yang sama dengan dialog pratinjau), dan jejak waktu tulis. Menjadikannya alat tetap menuntut dua modul Vite-only bisa dimuat di Node: `src/lib/logger.ts` dan `src/lib/db/client.ts` kini membaca `import.meta.env?.…` alih-alih `import.meta.env.…`, yang sebelumnya melempar `TypeError: Cannot read properties of undefined (reading 'DEV')` saat `product-import.ts` diimpor dari skrip. Gerbang dokumen tetap membuktikan dirinya: `npm run docs:check` OK dan fixture kontrol masih tepat 8 masalah |
| **Pelajaran** | (a) Pratinjau rencana adalah **janji**; ia hanya terbukti kalau dicocokkan dengan `if` milik penulis dan dengan `disabled` milik tombol — bukan dengan tipe milik perencana. Baca jalur tulis setiap kali menulis kalimat "akan ditulis". (b) Kalau ada dua tempat yang menyimpulkan "ada yang perlu ditulis" (`writeCount` dan lompat-`nochange`), keduanya harus membaca **satu** angka; kalau tidak, satu kasus akan selalu tertutup diam-diam. (c) `flex-1` + `overflow-auto` di dalam container berplafon bisa menyusut ke 0 tanpa pesan: wilayah gulir butuh `min-h`, dan plafon yang lebih baik digulir daripada memotong isi. (d) Jangan melaporkan kerugian yang tidak diminta berkas: baris tanpa harga tidak bisa "kehilangan harga". (e) Berkas nyata pengguna (282 baris) adalah probe yang tidak bisa ditiru fixture 5 baris — ukur fitur sekali dengan data sebesar aslinya |

---

## KS-58 · 2026-11-19 · Impor 282 baris berhenti di baris ke-9 dan menghapus sisanya tanpa memberi tahu — **SELESAI**

| | |
|---|---|
| **Gejala** | `produk_2026-11-10.xlsx` (282 baris, 8 kolom lama, semua kolom terisi) diimpor lewat build sebelum perbaikan ini. Yang muncul hanya satu toast `Gagal mengimport produk` — tanpa nomor baris, tanpa jumlah — dan sesudahnya database memegang tepat **8** produk dari file itu. 274 baris lainnya tidak pernah ditulis dan tidak ada tempat di aplikasi yang mengatakan bahwa yang gagal itu **satu** baris, bukan seluruhnya. Pertanyaan pengguna secara wajar menjadi "berkas saya rusak bagian mana?" |
| **Akar masalah** | `Inventory.handleImport` lama (HEAD `a7cb9a4`, ±L570–646) membungkus **seluruh** loop tulis dengan satu `try/catch`: `for (const { p, sku } of toInsert) { await runTransaction(...) }` di dalam `try`, dan blok `catch` hanya berisi `console.error("Import failed:", error)` + toast generik. Jadi exception pada produk ke-9 menghentikan iterasi ke-10..282; transaksi per produk membuat 8 baris pertama tetap commit (tidak ada rollback yang menyatukan semuanya), sehingga hasilnya "sebagian masuk" tanpa penjelasan. Dua hal lain membuat run seperti ini tidak bisa dibedakan dari berkas yang buruk: penulis lama ikut menuliskan SKU **produk** ke `product_variants.sku` — kolom yang UNIQUE di seluruh katalog lewat `idx_variants_sku` — dan aturan lama **membuang** SKU yang sudah ada alih-alih meng-extend, jadi angka "8 masuk, 274 hilang" tidak punya terjemahan yang jujur di layar |
| **Solusi** | (1) Loop tulis sekarang menangkap **per produk**: `try { await runTransaction(...) } catch { console.error(\`Import of ${product.seed.sku \|\| product.seed.name} failed:\`, error); failed += 1 }`, dan toast-nya menghitung `${failed} gagal ditulis` (dinaikkan ke `toast.error` bila `failed > 0`) — satu baris nakal tidak lagi membatalkan yang lain, dan operator tahu berapa yang hilang. (2) Penyebabnya dibuat bisa diukur, bukan disimpulkan: `npm run analyze:import -- produk.xlsx` (`scripts/analyze-import-file.ts`, read-only, parser yang sama dengan dialog) kini memetakan setiap SKU yang ada di database kembali ke **nomor baris berkas**, mencetak `baris file yang tertulis`, `berhenti setelah baris ke-N dari M → X baris sesudahnya tidak pernah ditulis`, `baris yang menghentikan run` (SKU/nama/supplier/barcode), dan `penyebab data pada baris itu` dengan menguji tiga tabrakan yang bisa dijelaskan dari data — `products.sku`, `product_variants.sku` (warisan penulis lama), dan klaim kode varian atas SKU yang belum punya produk. (3) Kebijakan `extend` + pratinjau jujur (KS-57) membuat impor ulang berkas yang sama berjanji **274 akan ditulis**, bukan 0 |
| **Bukti** | Berkas: 282 baris data, header `SKU \| Nama Produk \| Kategori \| Harga Jual \| Harga Modal \| Stok \| Stok Minimum \| Supplier`, **282/282 terisi di semua kolom**, 282 SKU berbeda, 0 SKU kembar, 0 nama kembar, 0 harga ≤ 0, Supplier terisi 282. Aturan lama diukur ulang: 0 baris ditolak, **8 dibuang** (sudah ada SKU), 274 akan dicoba. Jejak tulis: 8 baris = **baris 1 sampai 8 berkas, kontinu**, `created_at` 08:19:24.090Z → 08:19:36.762Z (±1,7 s per produk = satu transaksi per produk ke cloud); `berhenti setelah baris ke-8 dari 282 → 274 baris sesudahnya tidak pernah ditulis`. Baris penghenti (baris ke-9, indeks 8) = `8994592309639` "Tulip Milk Comp 1Kg X 1", Kategori `Coklat Blok`, Harga 84.000, Stok 16, Supplier `Nirwana Lestari` — supplier yang **sama** dengan baris 6, 7, 8 yang justru berhasil; `penyebab data pada baris itu: tidak ada`, dengan **0 dari 274** SKU yang belum punya produk ternyata sudah dipakai sebagai `product_variants.sku`. Korroborasi sisi vendor: supplier yang lahir selama run itu adalah VND-0006 `Nirwana Lestari` 08:19:23.924 (4 `vendor_products`), VND-0007 `Kartika Wira Adi Sukses` 08:19:26.018 (1), VND-0008 `Prambanan Kencana` 08:19:28.041 (3) — 4+1+3 = **8**, persis jumlah baris yang commit, dan tidak ada supplier baru lagi setelah 08:19:28, artinya run mati sebelum sempat menyentuh vendor berikutnya. Kesimpulan: yang membunuh 274 baris adalah kegagalan runtime/transien pada satu baris, bukan isi berkas. Browser, build final, berkas yang sama diunggah sungguhan: "282 produk dalam file · 274 akan ditulis · 8 tidak ada yang baru", chip 274 produk baru / 274 varian baru / 274 pecahan baru / 274 harga diisi / 8 dilewati, badan tabel **200 px**, baris 1–8 "sudah ada · sudah ada, tidak ada yang baru" dengan alasan "sudah ada harga beli untuk vendor ini", **baris ke-9 `8994592309639` kini direncanakan "produk baru · varian baru · harga diisi"**, penutup "… dan 242 baris lainnya" (40 baris ter-render + 242 = 282), footer "Import 274 Produk" aktif (`09-impor-produk-282-rencana-baru.png`, `10-impor-produk-282-baris-rencana.png`). Dialog ditutup **Batal** — tidak ada yang ditulis; sesudahnya database tetap 41 produk dan tetap 8 SKU file. Gate: `npx vitest run` 33 berkas / **533 test**, `npm run typecheck` + `npm run typecheck:node` 0 error, `npm run docs:check` OK dengan fixture kontrol tepat 8 masalah |
| **Pelajaran** | (a) Loop tulis tanpa penangkap per item berarti kegagalan ke-N menghapus N+1..akhir; selalu hitung `failed` dan tampilkan angkanya, karena "gagal" tanpa jumlah tidak bisa dibedakan dari "tidak ada yang perlu dilakukan". (b) `console.error` bukan laporan pengguna — sebab yang hanya sampai ke konsol hilang bersama tab-nya. (c) Jangan menyimpulkan "berkasnya rusak" dari hasil impor parsial: petakan kembali hasil tulis ke **nomor baris berkas** supaya titik berhenti terukur, dan uji penyebab data satu per satu sebelum menyalahkan runtime. (d) Mengisi kolom anak (`product_variants.sku`) dengan nilai induk membuat baris lain di tabel itu ikut menjadi ancaman; kalau bentuk itu diwarisi, alat diagnosa harus memeriksa tabrakannya, bukan hanya tabrakan di tabel induk. (e) Sekali lagi (pelajaran #16): diagnostik yang menjawab pertanyaan pengguna harus dipromosikan menjadi perintah di repo, bukan skrip sekali pakai |

---

## KS-59 · 2026-11-19 · Gate e2e mati karena koneksi database, bukan karena fitur — **SELESAI**

| | |
|---|---|
| **Gejala** | Tiga run beruntun dari `npx e2e run tests/bulk-import.e2e.ts tests/vendor-catalog.e2e.ts` gagal di tempat yang sama dengan dua bentuk berbeda, dan **tidak pernah** berupa assertion yang salah. (1) Kasus `one vendor per file > re-uploading the one-vendor sheet adds no row anywhere` mati 13,0s / 23,7s dengan `ERROR: fetch failed: Connect Timeout Error (attempted address: rp-thalia-….turso.io:443, timeout: 10000ms)` pada pembacaan database **pertama** kasus itu — kedua percobaan gagal identik. (2) Kasus `the exported one-vendor sheet reads back as the same file` mati 412s dengan `LOCATOR_NOT_FOUND: locator matched no nodes within locator("#vendor-product-import-file")`, browser parkir di `/login`, `app 1 error … logged` (`GET /api/tenant/bootstrap 502`). (3) Run berikutnya seluruh gate mati lebih awal: `tests/auth.setup.e2e.ts > sign in as the owner` gagal `expect.toHaveURL failed` dengan `POST /api/auth/sign-in/email 500` pada **4 dari 4** percobaan, sehingga 13 kasus ikut `skipped`. Di tengah semua itu, dua kasus fitur yang baru (`a sheet that states its vendor once writes the vendor and both products`, `the same sheet naming a flavour the product lacks appends that variant`) justru **lulus** — jadi yang gagal adalah infrastruktur, bukan lembar satu vendor |
| **Akar masalah** | Dua hal berbeda, dan keduanya harus dipisahkan sebelum ada yang "memperbaiki" yang salah. (a) **Sisi test:** `tenantClient()` di `tests/support/db.ts` membuka koneksi HRANA **baru** dan minting **token baru untuk setiap pernyataan**. Diukur di mesin ini (skrip sekali-pakai, lima ronde berurutan): koneksi dingin 5,3–6,9s dan klien menyerah pada 10s, sambungan berikutnya 1,2–2,9s. Artinya satu kasus yang membaca lima tabel setelah satu unggahan adalah lima perlombaan melawan plafon 10 detik — dan `select`/`mutate` milik `bulk-import.e2e.ts` memanggilnya tepat setelah `app.open()`, saat browser juga sedang bicara ke API yang sama. (b) **Sisi server:** pada jendela 00:45–01:00 bidang kontrol Turso menjawab `fetch failed` (diukur: 2 dari 3 query kontrol gagal), dan jalur sign-in Better Auth tidak punya retry — satu kedipan cloud menjadi `500` dan satu setup yang gagal mematikan seluruh run. Buktinya bukan dugaan: permintaan yang sama, terhadap **proses `:3000` yang sama**, diulang pada 01:20 menjawab `200` (2/2), dan terhadap proses baru `:3100` juga `200` (2/2); kredensial dan data owner tidak pernah berubah |
| **Solusi** | Hanya infrastruktur uji yang disentuh — tidak ada satu baris pun kode produksi, karena tidak ada perilaku aplikasi yang salah di sini. (1) `tests/support/db.ts` sekarang membuka koneksi **sekali per proses**: `openTenantClient()` menjadi privat, hasilnya di-cache sebagai `shared.handle` dengan TTL `TOKEN_LIFETIME_MS - 60_000` (token minting umurnya 10 menit, jadi cache sengaja berhenti sebelum kedaluwarsa dan minting ulang terjadi sendiri); `sharedHandle()` adalah Proxy yang membuat `close()` tidak melakukan apa apa, sehingga **sembilan** call site yang tidak disentuh perbaikan ini (`chat`, `permissions`, `vendor-catalog`, dan tiga helper di file `db.ts` sendiri) tetap boleh menulis `finally { client.close() }` tanpa diubah satu huruf — hanya `select`/`mutate` milik `bulk-import.e2e.ts` yang memang sengaja dipindahkan ke jalur retry. (2) `executeTenant(sql, args)` — pernyataan tunggal di atas handle bersama, dengan maksimal 3 percobaan khusus untuk kelas **kehilangan koneksi** (`fetch failed\|Connect Timeout\|ECONNRESET\|ETIMEDOUT\|socket hang up\|ClosedExplicitly`); error SQL biasa tetap dilempar apa adanya, jadi tidak ada assertion yang bisa ditutupi retry. `select`/`mutate` di `tests/bulk-import.e2e.ts` sekarang berjalan lewat `executeTenant`. (3) Kebutaan yang tersisa — sign-in tanpa retry sehingga satu kedipan cloud memakan satu setup — **dibiarkan dan dicatat di sini**, karena memperbaiki jalur auth di luar spesifikasi ini berarti menguji sesuatu yang tidak diminta; gerbangnya sendiri sudah sah setelah dijalankan pada jendela yang sehat dengan `--retries 4` dari CLI |
| **Bukti** | Perbaikan terukur, bukan dirasakan: probe lima ronde (masing-masing `tenantClient()` + satu `SELECT COUNT(*) FROM suppliers`) berubah dari `5825 / 2923 / 2220 / 1206 / 1452 ms` (total ±13,6s) menjadi `5286 / 1094 / 343 / 350 / 346 ms` (total ±7,4s) — setelah satu koneksi dingin, satu pernyataan hanya berharga **±345ms**, bukan 1,2–2,9s; koneksi dingin memang tidak bisa dihilangkan (itu jaringan), tetapi ia kini terjadi **sekali per proses**, bukan sekali per pernyataan. Gerbang penuh sesudahnya: `npx e2e run tests/bulk-import.e2e.ts tests/vendor-catalog.e2e.ts --retries 4` → **`Test Files 3 passed (3)` · `Tests 11 passed \| 6 flaky (17)` · 21m 35s**, termasuk keempat kasus baru satu vendor (`…writes the vendor and both products` 47,6s, `…appends that variant` 26,2s, `re-uploading … adds no row anywhere` 38,8s, `the exported one-vendor sheet reads back as the same file` 34,6s) dan `tests/vendor-catalog.e2e.ts` **4/4** (56,6 / 212,3 / 243,4 / 15,6s). Kompatibilitas balik terbukti dua lapis: `git status` tidak menyebut `tests/vendor-catalog.e2e.ts` maupun `tests/fixtures/fixture_vendor_produk.csv` (keduanya byte-identik dengan HEAD), dan berkas itu lulus pada run yang sama dengan fixture 20-kolom lama. Enam `flaky` semuanya adalah kelas yang sama (satu percobaan habis 60s menunggu, percobaan kedua lulus) — tidak ada satu pun yang gagal pada angka. Gate non-browser tetap hijau setelah perubahan: `npm run typecheck:node` 0 error, `npx eslint tests/support/db.ts tests/bulk-import.e2e.ts` bersih, dan `select`/`mutate` lama tetap ada sebagai pembungkus agar diff-nya hanya tiga baris |
| **Pelajaran** | (a) "Flaky" harus **diubah menjadi angka** sebelum diperbaiki: waktu sambung dingin yang terukur (5,3s vs plafon 10s) mengubah dugaan menjadi fakta, dan langsung menunjuk penyebabnya. (b) Helper yang membuka koneksi per pernyataan mengubah latensi cloud menjadi probabilitas kegagalan **per assertion** — satu koneksi per proses + retry khusus kelas koneksi adalah perbaikan infrastruktur, bukan pengendoran uji: retry hanya boleh untuk kegagalan yang jelas bukan "data tidak cocok". (c) Kegagalan yang hanya muncul di satu jendela waktu bukan berarti kredensialnya salah; cara termurah memisahkan kode dari lingkungan adalah mengulang permintaan yang sama terhadap proses yang sama beberapa menit kemudian (200/200) — dan kalau perlu, proses kedua di port lain sebagai kontrol. (d) Setup bersama (`auth.setup`) adalah titik tunggal kegagalan: satu akun yang tidak bisa masuk menaikkan `skipped` untuk seluruh suite, jadi kegagalan di berkas setup harus diperlakukan sebagai darurat infrastruktur, bukan sebagai gangguan satu kasus. (e) Godaan untuk "memperbaiki aplikasi" agar gerbang hijau harus ditolak: yang salah di sini adalah cara tes membaca database, dan batas itu harus tercatat supaya tidak disalahartikan sebagai perbaikan fitur |

---

## KS-60 · 2026-11-19 · Pratinjau satu vendor menghitung `varian baru` di ringkasan tapi menyembunyikan barisnya di tabel — **SELESAI**

| | |
|---|---|
| **Gejala** | Ditemukan saat memverifikasi fitur lembar satu-vendor langsung di browser, bukan saat run hijau. (a) Tombol `Ekspor Sheet` di halaman detail vendor **bekerja**: muncul di samping `Catat Tagihan`/`Edit Vendor`, aktif, melepas toast `25 baris sheet vendor diekspor`, tanpa toast error dan tanpa pesan konsol. (b) Import dialog yang mengunggah sheet satu-vendor nyata (satu produk yang sudah ada, tugasnya hanya menambah pecahan dan rasa) menampilkan ringkasan yang benar — `0 vendor baru · 1 vendor sudah ada · 0 produk baru · 1 produk ditautkan · 0 harga beli (0 diperbarui) · 1 varian baru · 3 pecahan baru` — **tetapi tabel rencananya berisi satu baris saja**, `catalogue saja (tanpa harga)`, tanpa chip `varian baru`/`pecahan baru` dan tanpa satu pun alasan. Jadi dialog menjanjikan empat baris rencana di judulnya lalu menolak menampilkannya, persis pada bentuk berkas yang menjadi alasan format satu-vendor itu ada. Tidak ada risiko data: jalur tulis mengonsumsi `plan`, bukan baris tampilan |
| **Akar masalah** | Di `describe()` (`src/components/vendors/VendorProductImport.tsx` ±L254) ada cabang awal `if (product.packs.length === 0) { rows.push({ action: "catalogue saja (tanpa harga)" }); continue; }` yang letaknya **di atas** ketiga loop penghasil chip (`newVariants` ±L322, `skippedPacks` ±L344, `ambiguousVariants` ±L359). Sheet yang seluruh pekerjaannya memperluas produk tidak membawa satu baris harga pun untuk pecahan yang sudah tersimpan, sehingga `product.packs.length === 0` benar dan seluruh produk ditelan sebelum chip sempat digambar. Cabang itu sendiri ditambahkan KS-57 (butir 4 solusi: baris tanpa harga harus berhenti sebelum pemeriksaan ambiguitas) dan memang jujur untuk berkas multi-vendor, di mana baris tanpa harga adalah tautan katalog belaka — yang salah adalah memakainya sebagai kesimpulan tunggal tanpa melihat rencana perluasan. Invarian perencana membuat gerbang baru ini aman: `productPlan.newVariants` hanya pernah diisi di cabang produk-existing (`src/lib/vendor-import.ts` L888–1037, penugasan `Array.from(pending.values())` L1029), jadi produk yang baru dibuat tidak bisa dilaporkan dua kali. Kenapa suite tidak pernah melihatnya: `expect(preview).toContainText('1 varian baru')` di `tests/bulk-import.e2e.ts` cocok dengan `DialogDescription` — baris ringkasan yang sama yang menghitung angka yang disembunyikan tabel — sehingga header memenuhi assertion sementara tabelnya kosong; dan `toHaveCount` atas baris tabel tidak pernah dipakai di berkas itu |
| **Solusi** | (1) Cabang placeholder kini digerakkan keempat daftar rencana, bukan jumlah harga: `product.packs.length === 0 && product.newVariants.length === 0 && product.skippedPacks.length === 0 && product.ambiguousVariants.length === 0`, dengan komentar yang menyebut kasus satu-vendor secara eksplisit supaya `continue` berikutnya tidak ditulis ulang tanpa membaca daftar itu. Tidak ada perubahan pada perencana maupun penulis — `describe()` murni tampilan. (2) Assertion dipindah dari headline ke tabel: `const plannedVariants = preview.getByRole('row').filter({ hasText: 'varian baru' })` lalu `toHaveCount(2)` dan `toContainText('nanas')`; kedua kasus round-trip mendapat `toHaveCount(0)` untuk `varian baru` (dan `pecahan baru` di kasus ekspor), jadi negatifnya juga terbukti di tabel, bukan hanya di ringkasan. Sel varian sengaja diuji sebagai `nanas`, bukan `E2E-TC-NAN`: untuk varian yang belum ada di database, `variantHint()` (±L163–169) menampilkan **nilai** dari kunci atributnya, sedangkan `E2E-TC-NAN` adalah sel 18 (`Vendor SKU`) — kode barang vendor, bukan kode varian kita. (3) Prasyarat yang rapuh diganti pernyataan kebutuhan: kasus append butuh produk **tanpa** rasa Nanas, jadi ia menguji `sheetVariants(variedId).filter((line) => line.startsWith('Rasa=Nanas'))` deep-equal `[]` dengan pesan yang menyebut kasus mana yang harus dijalankan lebih dulu, bukan `assert.equal(before.variants, 4)` |
| **Bukti** | Data nyata tenant demo (bukan fixture e2e, karena e2e membersihkan baris `VND-E2E-*` miliknya): VND-0001 `CV Aroma Pangan Nusantara`, produk `PGR-004` "Pewarna Makanan Set 12 Warna" dengan sumbu `Warna` = Merah/Kuning/Hijau/Biru yang semuanya hanya punya `pcs ×1`. Berkas uji 4 baris (baris 1 hanya vendor, baris 2 `Dus ×12` pada `PGR-004-MERAH`, baris 3–4 `pcs` dan `Dus ×12` pada varian baru `PGR-004-UNGU`/`Warna=Ungu`), 21 sel per baris. Sebelum perbaikan: satu baris `catalogue saja (tanpa harga)`. Sesudah perbaikan browser menunjukkan **tiga baris ber-chip**: `Merah` / `Dus ×12` / `Rp 300.000` / `pecahan baru` dengan alasan "produk ini belum menjual pecahan ini; template produknya yang ditambah", dan dua baris `PGR-004-UNGU` (`pcs` / `Rp 22.000`, `Dus ×12` / `Rp 250.000`) ber-chip `varian baru` dengan alasan "varian ini belum ada di produk ini; template produknya yang ditambah"; baris `catalogue saja` tidak ada lagi, banner multi-vendor tidak muncul, dan kedua sesi ditutup dengan `Batal` sehingga tidak satu baris pun tertulis. Gate: `npm run typecheck` dan `npm run typecheck:node` 0 error, `npx eslint src/components/vendors/VendorProductImport.tsx tests/bulk-import.e2e.ts` bersih; `npx e2e run tests/bulk-import.e2e.ts --grep "one vendor per file" --retries 0` → **3 lulus (3), 80,86s** (kasus create + append + re-upload, semuanya dengan assertion baris baru); blok penuh dengan `--retries 2` → **`Test Files 2 passed (2)` · `Tests 4 passed \| 1 flaky (5)` · 364,11s** (45,68 / 223,64 flaky / 40,68 / 37,27s). Dua jejak kegagalan di antaranya menjelaskan dirinya sendiri: `10 !== 12` pada kasus round-trip ekspor **bukan** bug ekspor (percobaan append mati sebelum menekan Import, jadi Nanas memang tidak pernah ada), dan satu-satunya `flaky` adalah kelas KS-59 — `GET /api/tenant/bootstrap 502` → `LOCATOR_NOT_FOUND` pada input berkas tersembunyi, terjadi sebelum tulis apa pun, yang justru membuat percobaan keduanya memenuhi prasyarat baru. Gerbang penuh berkas sesudahnya, `npx e2e run tests/bulk-import.e2e.ts --retries 2` → **`Test Files 2 passed (2)` · `Tests 12 passed \| 1 flaky (13)` · 434,74s**: **11/11 kasus bulk-import lulus** (auth setup ikut 2), dan satu-satunya flake adalah **varian lain dari kelas yang sama** — `GET /api/auth/get-session 500` membuat browser mendarat di `/login` sehingga `#vendor-product-import-file` tidak ditemukan (`Waited: 3m 0s` pada langkah itu), juga sebelum ada yang ditulis. Tidak ada angka yang gagal |
| **Pelajaran** | (a) Ringkasan dan tabel yang berasal dari satu rencana harus diassert **terpisah**: `toContainText` pada dialog tidak bisa membuktikan sebuah baris ada — assert terhadap `getByRole('row')`, dan berikan `toHaveCount(0)` untuk sisi negatifnya. (b) `continue` yang jujur untuk satu bentuk berkas adalah penelan bagi bentuk berikutnya; setiap cabang placeholder wajib menyebut satu per satu daftar rencana yang akan ia sembunyikan kalau lewat. (c) Fitur bisa "hijau" dua run gerbang penuh sementara janji utamanya tidak terlihat sama sekali — yang menemukannya adalah membuka dialognya sungguhan, jadi verifikasi browser atas fitur yang sudah dianggap selesai tetap berbayar dan tetap perlu. (d) Kasus yang berbagi tenant dengan kasus sebelumnya tidak tahan retry kalau prasyaratnya dinyatakan sebagai angka hasil; nyatakan sebagai **kebutuhan** (state yang harus belum terjadi) dan tulis nama kasus yang wajib jalan duluan di pesannya. (e) Teks yang diuji adalah teks yang dirender, bukan teks yang diketik: kode varian di sheet bisa tidak pernah muncul di layar karena pratinjau memberi nama varian barunya sendiri dari atribut |

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
9. **Halaman bukan tempat aturan.** Aturan bisnis yang tinggal di dalam komponen layar tidak bisa
   diuji dan akan disalin; pindahkan ke modul sebelum layar kedua membutuhkannya.
10. **Deploy adalah lingkungan berbeda, bukan salinan lokal.** Aturan modul (ESM + ekstensi),
    pemetaan rute, dan gate keamanan platform hanya terlihat saat kode benar-benar dijalankan di
    sana — uji satu request setelah setiap deploy, jangan percaya status "completed".
11. **Nilai contoh adalah kode.** `.env.example`, contoh perintah di README, dan nama grup di
    dokumen akan dijalankan apa adanya; nilai yang tidak ada di akun nyata lebih berbahaya daripada
    nilai kosong.
12. **Verifikasi UI bukan pekerjaan unit test.** 365 test unit tidak melihat satu pun layar; alur
    yang benar-benar dipakai kasir harus dijalankan di browser. Harness yang dinilai model menambah
    dependensi baru yang bisa gagal sendiri (kunci API, kuota, kemampuan tool call), jadi langkah
    `agent.*` diperlakukan seperti layanan eksternal: beri timeout dan sediakan jalur deterministik.
13. **Mengganti sistem berarti mengganti kalimatnya juga.** Saat satu toko menjadi marketplace,
    yang usang bukan hanya data: alamat "ambil di toko kami", satu ongkir untuk satu penjual, dan
    judul "etalase toko X" semuanya jadi salah ucap. Telusuri kembali setiap tempat yang menyebut
    "toko kami" — teks CS, halaman info, ringkasan checkout, dan tautan yang sudah dibagikan —
    bukan hanya berkas tema atau navigasi.
14. **Tabel yang meniru hasil evaluasi harus dihasilkan, bukan diketik.** Matriks peran×menu,
    jumlah tabel skema, dan jumlah test adalah angka yang bisa dihitung dari kode/database; begitu
    ia ditulis tangan, setiap fitur baru menjadikannya salah secara senyap. Cantumkan sumber tiap
    angka di dokumen (kolom kunci izin, versi skema, nama berkas test) supaya pembaca bisa
    memverifikasi tanpa mempercayai penulisnya.
15. **Bedakan dokumen status dan dokumen keputusan.** Yang pertama ("kode hari ini begini") wajib
    disinkronkan tiap rilis dan boleh mati kalau tidak; yang kedua ("kenapa dulu memilih ini")
    justru harus dibekukan — angka dan sitasi baris di dalamnya sengaja dibiarkan. Cara mendamaikan
    keduanya: header status bertanggal + satu bagian "status implementasi", dan kalimat tegas bahwa
    body adalah rekaman titik waktu. Dokumen yang menempel kedua peran tanpa penanda seperti spec di
    KS-48 akan selalu terbaca salah di baris pertamanya.
16. **Gerbang wajib membuktikan dirinya bisa gagal.** Pemeriksaan yang hanya mencetak "OK" tidak
    membedakan dunia "tidak ada cacat" dari "pemeriksaannya tidak membaca apa pun" — dan yang kedua
    justru yang paling sering terjadi saat pola regex-nya meleset. Setiap gerbang dokumen di repo ini
    membawa fixture berisi satu cacat per pemeriksaan (`scripts/__fixtures__/docs-check`, harus 8
    masalah) dan mencetak jumlah baris/anchor yang benar-benar diperiksa. Konsekuensinya serupa untuk
    skrip sekali-pakai: begitu sebuah pemeriksaan di `.data/` menemukan cacat nyata, angkat ke
    `scripts/` + npm script — kalau tidak, cacat berikutnya ditemukan lagi oleh kebetulan.
17. **Gagal dari satu klien bukan kegagalan sistem.** Sebelum menyatakan deploy rusak (atau
    "memperbaiki" runbook) karena sebuah probe mengembalikan 401/403, reproduksikan kegagalan itu pada
    satu request dengan header diubah satu per satu dan baca body error-nya; kalau browser dan klien
    lain lolos, yang salah adalah probe-nya. Rantai kegagalan (satu 403 → enam temuan) dihitung satu
    kali, bukan enam — lihat KS-50.
18. **Fitur yang lulus build harus diukur sekali lagi sebagai fitur.** Empat temuan
    KS-51…KS-54 tidak lahir dari review kode, typecheck, maupun Vitest — semuanya lahir dari
    menjalankan alur sungguhan lalu membandingkan apa yang tampil dengan baris yang tertulis.
    Akarnya satu keluarga: **keputusan di jalur baca ikut menentukan isi jalur tulis** —
    placeholder menentukan channel tujuan pesan, filter join menentukan nama pasangan DM,
    status query menentukan arti "kosong", dan scope modul menentukan siapa yang memegang
    identifier. Setelah sebuah fitur dianggap selesai, jalankan satu alur ujung-ke-ujung dan
    baca tabelnya; hijau di build hanya membuktikan kodenya bisa dimuat.
19. **Assertion hanya boleh membuktikan apa yang ditulisnya.** KS-60 lulus dua run gerbang penuh
    karena `toContainText('1 varian baru')` dibaca di seluruh dialog — dan baris yang lulus adalah
    ringkasan, yaitu teks yang persis sama yang menghitung baris yang **tidak** dirender. Janji fitur
    berbentuk baris tabel, jadi buktinya pun harus `getByRole('row')` + `toHaveCount`, termasuk untuk
    sisi negatif. Keluarga yang sama: prasyarat tes yang dinyatakan sebagai angka hasil (bukan sebagai
    keadaan yang harus belum terjadi) membuat retry gagal tanpa penjelasan, dan teks yang diuji harus
    teks yang dirender, bukan teks yang diketik di sheet.
20. **Gerbang wajib disebut lingkupnya, kalau tidak angkanya bohong.** `npm run lint` di repo ini
    keluar **1** dan akan selalu begitu (25 error `no-explicit-any` + 8 warning warisan di 18 berkas yang
    tidak disentuh rilis mana pun — jumlahnya sama dengan di `HEAD`), sehingga menulis "eslint bersih" di
    changelog itu salah meskipun tidak ada satu pun masalah di perubahan ini. Yang diukur dan yang
    dilaporkan harus berlingkup sama: `npx eslint <berkas yang disentuh>`, dan angka baseline warisannya
    ditulis apa adanya di §1 `frontend.md` + tabel Verifikasi `arsitektur.md` supaya pembaca berikutnya
    tidak mengira regresi. Lingkup yang sama berlaku untuk angka usang di dokumen hidup — audit pasca
    implementasi kali ini menemukan `31 berkas/441 test` masih tertulis di dua dokumen status padahal
    suite sudah 547; baris log lama (KS-5x) sengaja dibiarkan karena ia rekaman titik waktu
    (pelajaran 8), yang wajib disinkronkan hanya dokumen status.
