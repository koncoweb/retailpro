# Backend.md — dipindahkan

| | |
|---|---|
| Status | **Digantikan** per **2026-10-27** |
| Pengganti | [`docs/backend.md`](docs/backend.md), [`docs/arsitektur.md`](docs/arsitektur.md) |

Dokumen ini dulu berisi rancangan backend **Neon (Serverless PostgreSQL) + Neon Auth + Row Level
Security** dengan kolom `tenant_id` di setiap tabel. Rancangan itu **tidak lagi berlaku**.

Sejak 2026-10-27 aplikasi memakai **Turso / libSQL dengan satu database per tenant**:

- tidak ada kolom `tenant_id` dan tidak ada RLS — isolasi adalah batas fisik (database terpisah);
- autentikasi memakai **Better Auth** di satu *control database*;
- browser hanya menerima token berumur pendek untuk **satu** database tenant miliknya.

## Ke mana harus membaca

| Kebutuhan | Dokumen |
|---|---|
| Arsitektur teknis, alasan keputusan, alur provisioning | [docs/arsitektur.md](docs/arsitektur.md) |
| Skema database per tabel, API, modul server, riwayat perubahan skema | [docs/backend.md](docs/backend.md) |
| Lapisan tampilan, route, pola query | [docs/frontend.md](docs/frontend.md) |
| Masalah yang ditemukan saat migrasi (termasuk kredensial & RLS) | [docs/kendala-solusi.md](docs/kendala-solusi.md) — lihat KS-01 |
| Audit temuan lama (arsip, ditulis untuk rancangan Neon) | [TECHNICAL_ISSUES.md](TECHNICAL_ISSUES.md) |

Isi lama dokumen ini masih dapat dibaca dari riwayat git:

```bash
git show HEAD:Backend.md
```
