# TECHNICAL_DOCS.md — dipindahkan

| | |
|---|---|
| Status | **Digantikan** per **2026-10-27** |
| Pengganti | [`docs/frontend.md`](docs/frontend.md), [`docs/backend.md`](docs/backend.md) |

Dokumen ini dulu mencatat tiga penambahan fitur inventori (SKU otomatis, combobox yang bisa dicari,
barcode) plus catatan pengujian dan "Database Schema Updates" yang masih menyebut `tenant_id`.
Semua isi yang masih benar sudah dipindahkan ke dokumentasi baru dan diperbarui: kolom `tenant_id`
tidak ada lagi.

## Pemetaan isi lama → dokumen baru

| Isi lama | Sekarang |
|---|---|
| 1.1 SKU otomatis (`PREFIX-YYYYMMDD-SEQ`, `src/lib/inventory-utils.ts`) | [docs/frontend.md](docs/frontend.md) §8 |
| 1.2 Combobox kategori/supplier (Command + Popover, auto-add) | [docs/frontend.md](docs/frontend.md) §8 |
| 1.3 Barcode (`react-barcode`, unduh PNG) | [docs/frontend.md](docs/frontend.md) §8 |
| 2. Testing (Vitest) | [docs/frontend.md](docs/frontend.md) §1, [docs/backend.md](docs/backend.md) §1 |
| 3. Database schema (`categories`, `suppliers`, `tenant_id`) | [docs/backend.md](docs/backend.md) §5 — tanpa `tenant_id` |

## Dokumentasi yang berlaku

- [docs/arsitektur.md](docs/arsitektur.md) — arsitektur teknis
- [docs/frontend.md](docs/frontend.md) — frontend
- [docs/backend.md](docs/backend.md) — backend & database, termasuk perubahan skema
- [docs/fitur-tenant.md](docs/fitur-tenant.md) / [docs/fitur-platform.md](docs/fitur-platform.md) — log fitur per tanggal
- [docs/deployment.md](docs/deployment.md) — runbook deploy (Vercel + Turso cloud)
- [docs/kendala-solusi.md](docs/kendala-solusi.md) — masalah, solusi, pelajaran

Isi lama dokumen ini masih dapat dibaca dari riwayat git:

```bash
git show HEAD:TECHNICAL_DOCS.md
```
