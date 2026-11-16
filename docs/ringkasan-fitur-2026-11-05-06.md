# Ringkasan Fitur Baru & Berubah — 5 s.d. 6 November 2026

Dokumen singkat untuk pengguna/pemilik toko. Detail teknis lengkap: [CHANGELOG.md](../CHANGELOG.md) dan [docs/fitur-tenant.md](fitur-tenant.md).

> Cakupan dokumen ini berhenti di 6 November. Perubahan setelahnya — **void transaksi**
> (16 November, skema v9) — tidak masuk daftar di bawah; baca bagian teratas
> [CHANGELOG.md](../CHANGELOG.md) dan [fitur-tenant.md](fitur-tenant.md) §2.2.2.

## 1. Hak akses satu pintu (RBAC)

- Semua izin (role bawaan, role custom, scope cabang/gudang) kini diatur di **Pengaturan → Role** dan langsung berlaku di seluruh aplikasi — tidak ada lagi tiga sistem izin yang berbeda.
- Role custom bisa dibuat, diduplikasi, dan dihapus; pembatasan lokasi (cabang/gudang) berlaku sampai ke Dashboard, Pesanan Cabang, dan Inventori.
- Perbaikan login error 500 saat deploy di Vercel.

## 2. Pengecualian izin per karyawan

- Owner bisa **mencabut** satu izin dari satu orang saja (misal: satu kasir kehilangan Akses POS, kasir lain tetap bisa).
- Hanya bisa mengurangi, tidak bisa memberi izin di luar role — sistem role tetap berkuasa.
- Setiap perubahan tercatat di log audit dan ada badge "N pengecualian" di daftar karyawan.

## 3. Absen mandiri dengan GPS + wajah

- Karyawan absen sendiri di halaman **/absen**: lokasi GPS diverifikasi (ditolak bila di luar radius kantor) dan wajah dipindai di browser.
- Foto wajah tidak disimpan — hanya pola pengenal 128 angka; pendaftaran wajah dilakukan owner di halaman khusus.
- Cabang & gudang bisa mengatur radius, wajib-GPS, dan wajib-wajah masing-masing; laporan absensi menampilkan kolom Sumber/Geo/Wajah.

## 4. Shift POS lebih andal

- **Satu sumber cabang**: layar kasir, shift, dan header selalu menampilkan cabang yang sama — bug "sudah buka shift tapi POS bilang belum" hilang.
- Buka shift otomatis mencatat check-in, tutup shift otomatis check-out (best-effort, tidak pernah menggagalkan shift).
- Tampilan POS rapi di ponsel dan tablet (keranjang jadi bar lengket/sheet, grid produk menyesuaikan).
- Kasir kini hanya melihat transaksi (tanpa dashboard); notifikasi error lebih jelas (banner "Gagal memuat data" + Coba lagi).

## 5. Cetak struk & Z-report printer thermal

- Struk pelanggan **cetak otomatis** setelah checkout, dan bisa **cetak ulang** dari Riwayat Transaksi (tombol printer per baris).
- **Z-report** (laporan ringkas tutup shift: penjualan per metode, kas, selisih) cetak otomatis saat tutup shift, bisa cetak ulang per shift.
- Tiga mode printer: **driver** (printer USB/jaringan biasa, semua browser), **USB langsung** (WebUSB, Chrome/Edge), **Bluetooth** (Android); ukuran kertas 58/60/72/76/80mm.
- Semua diatur di **Pengaturan → Struk → Printer & Koneksi** (ada tombol Sambungkan Printer dan Cetak Tes); gagal cetak tidak pernah memblokir penjualan.

## 6. Impor/ekspor massal CSV & Excel

- Layar Inventori, Vendor, dan Pelanggan punya tombol **Import** (.csv/.xlsx) plus **Export** dan **unduh template**.
- Impor bersifat **menambah**: SKU yang sudah ada dilewati (tidak menimpa), baris tanpa SKU dibuat otomatis melanjutkan penomoran.
- Header dikenal longgar (label Indonesia maupun Inggris), hasil ekspor terbuka rapi di Excel Indonesia (anti mojibake).

---

*Semua perubahan di atas sudah melalui typecheck, lint, 300+ unit test, dan e2e; commit terkait: `a94ace4`, `a6b1e2c`, `dbe44eb`, `f7ffb7d`, `1769684`, `1f820ac`, `1340350`.*
