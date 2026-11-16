# Fixture — JANGAN dibaca sebagai dokumen aplikasi

Semua berkas di folder ini **sengaja rusak**: ia adalah positive control untuk
`scripts/check-docs.mjs`. Jalankan dari root repo:

    node scripts/check-docs.mjs --root scripts/__fixtures__/docs-check

Harus keluar 1 dengan **tepat 8 masalah** (satu per kelas yang dijaga gerbang).
Kalau jumlahnya berubah, yang salah adalah gerbangnya, bukan fixture-nya.

# Fixture root index

| Doc | Status |
|---|---|
| [a.md](docs/a.md) | ada |
| docs/ghost.md | tidak ada di disk |
