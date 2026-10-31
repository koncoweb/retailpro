# RetailPro — Varian Produk, Pecahan Harga & Template PO Vendor

| | |
|---|---|
| Document | `docs/spec-varian-harga-vendor.md` |
| Status | **Proposed** — spec only, belum ada kode yang ditulis |
| Tanggal | 2026-10-31 |
| Schema impact | migrasi `006`, schema version 5 → **6**, 31 → **33** tabel |
| Spec terkait | `docs/spec-purchase-order.md` (siklus PO & penerimaan barang) |
| Keputusan pemilik | varian = tabel terpisah dengan stok sendiri; harga beli per pecahan independen; template PO = pricelist per vendor |

---

## 0. Ringkasan

Rantai hari ini sudah benar sampai rak:

```
PO → approval → goods receipt → product_batches (rak) → transfer → POS
```

Yang belum ada adalah **kebenaran harga dan identitas barang** di dalam rantai itu:

1. **Harga beli tidak punya tempat.** `product_units` hanya menyimpan harga **jual** per pecahan. Harga beli di PO dihitung `cost_pcs × faktor`, jadi harga karton tidak pernah bisa dicatat apa adanya. Setelah PO selesai, `vendor_products.last_cost` menyimpan **harga per pcs saja** — harga karton (yang justru nilai terbesarnya) hilang.
2. **Varian tidak dimodelkan.** Tidak ada tabel atau kolom varian di `db/` sama sekali. Rasa/warna hanya bisa jadi produk terpisah, sehingga satu produk punya 6 SKU kembar dan vendor tidak punya satu identitas barang untuk dinegosiasikan.
3. **Owner tidak punya titik kontrol** antara "harga vendor" dan "harga jual". Tidak ada pricelist kesepakatan, jadi setiap PO dinegosiasikan ulang di kepala orang purchasing.

Spec ini menambah tiga lapis yang dipisah tegas, karena **harga beli dan harga jual bukan fungsi dari variabel yang sama**:

```
BELI  = f( vendor , varian , pecahan , qty , tanggal )   ← hasil negosiasi, milik vendor
JUAL  = f( varian , pecahan )                            ← keputusan owner, milik toko
```

Kode hari ini memodelkan `beli = f(produk, satuan dasar)` dan `jual = f(produk, pecahan)`. Ketidakcocokan itu akar dari seluruh isi dokumen ini.

---

## 1. Kondisi saat ini (diverifikasi dari kode)

| Fakta | Bukti |
|---|---|
| `products` tidak punya varian | `db/schema/tenant.sql` L157–168: hanya sku/name/category/cost_price/min_stock_level/supplier_id |
| `product_units` menyimpan harga jual per pecahan, **tanpa** harga beli | L170–178: `name, conversion_factor, price, barcode` |
| Satu produk hanya boleh punya satu satuan per faktor | `idx_units_prod_factor UNIQUE (product_id, conversion_factor)` L547 |
| Harga satuan di PO **diturunkan**, bukan diinput | `PurchaseOrderModal.tsx` L185–195: `unitCostOf = baseCost × factor` |
| Harga beli pecahan hilang setelah PO | `goods-receipt.ts` L240–244: `baseCost = unit_cost / factor`, `money()` membulatkan; L300–305 menulis `vendor_products.last_cost` |
| Prasetel harga vendor hanya per produk | `vendor_products` L206–216: `(vendor_id, product_id)` unik, `last_cost` skalar |
| POS menjual per satuan dasar sebagai default | `POS.tsx` L135–155: `base_price = product_units WHERE conversion_factor = 1` |
| Stok tidak punya dimensi varian | `product_batches` L184–200: `product_id` saja |
| Tidak ada template PO/pricelist | `docs/spec-purchase-order.md` §15.5 & §15.9 menyatakan price list dan reorder otomatis di luar cakupan |

### 1.1 Kerugian konkret

Produk "Kopi Sachet ABC", satuan dasar Pcs. Vendor menawarkan karton isi 200 dengan harga **Rp 260.000** (Rp 1.300/pcs), sementara eceran dibeli Rp 1.500/pcs.

| | Hari ini | Setelah spec ini |
|---|---|---|
| Input harga karton di PO | Dipaksa `1.500 × 200 = 300.000`; 260.000 harus diketik ulang tiap PO dan tidak tersimpan | `vendor_price_list.buy_price = 260000` per karton, tersimpan |
| Harga beli karton setelah PO selesai | `last_cost = 1.300`/pcs (dibulatkan), konteks karton hilang | Baris pricelist per pecahan tetap ada, plus riwayat di `audit_logs` |
| Margin karton bisa dihitung? | Tidak — hanya ada satu angka per pcs | Ya: `(350.000 − 260.000) / 200 = 450`/pcs |
| Varian Rasa Susu vs Hitam | Dua produk terpisah dengan SKU berbeda | Satu produk, dua varian, stok & harga masing-masing |
| Harga vendor B (karton 250.000, min 5) | Tidak bisa disimpan berdampingan | Baris pricelist vendor B berdampingan |

---

## 2. Tujuan

1. Harga beli per pecahan tersimpan apa adanya, per **vendor**, per **varian**.
2. Harga jual per pecahan tetap milik owner dan tidak pernah ditentukan vendor.
3. Varian (rasa, warna, ukuran, dst.) menjadi SKU yang dijual, dengan stok, barcode, harga beli dan harga jual sendiri.
4. Owner mengisi pricelist vendor sekali; PO mengambilnya sebagai default sehingga purchasing hanya mengisi kuantitas.
5. Selisih antara harga kesepakatan dan harga tagihan vendor terlihat, bukan hilang.
6. Semua jalur stok yang ada (POS, transfer, opname, permintaan cabang, penerimaan) tetap konsisten setelah stok jadi per varian.
7. Tidak ada perubahan perilaku akuntansi: satu bill per penerimaan, `expenses` tetap sumber AP.

### Non-tujuan

Lihat §14.

---

## 3. Model domain

### 3.1 Tiga lapis

| Lapis | Menjawab | Tabel |
|---|---|---|
| **Identitas** | *barang apa yang ada di rak?* | `products` (model) + `product_variants` (SKU yang dijual) |
| **Pecahan** | *dijual/dibeli dalam kemasan apa, dan berapa nilainya?* | `product_units` (per varian: faktor, harga beli, harga jual, barcode) |
| **Kesepakatan** | *vendor mana menjual berapa, dan sampai kapan?* | `vendor_price_list` (per vendor + varian + pecahan) |

`vendor_products` tetap ada sebagai **katalog relasi** (produk mana yang dipasok vendor ini, lead time, MOQ, preferred). Ia tidak lagi memegang harga kesepakatan — hanya `last_cost` sebagai **realisasi terakhir** per satuan dasar, yang ditulis penerimaan barang.

> Dua angka, dua arti: `vendor_price_list.buy_price` = **kesepakatan**, `vendor_products.last_cost` = **kenyataan terakhir**. Selisihnya adalah laporan, bukan bug.

### 3.2 Rumus & aturan turunan

Semua turunan dihitung di `src/lib/pricing.ts` (murni, tanpa SQL, tanpa React), tidak pernah diketik manual:

```
base_cost(pecahan)      = buy_price / conversion_factor
base_price(pecahan)     = price     / conversion_factor
margin_per_base(pecahan) = (price - buy_price) / conversion_factor
margin_pct(pecahan)     = (price - buy_price) / price
```

Aturan yang ditegakkan (lihat §4.2 untuk daftar lengkap):

- **L1** `base_cost` harus **turun** saat pecahan membesar (ecer lebih mahal per pcs daripada karton). Kalau naik, ada uang yang terbuang di setiap karton.
- **L2** `base_price` juga harus turun. Kalau tidak, tidak ada alasan pelanggan membeli karton.
- **L3** `buy_price` tidak boleh `>= price` — itu mustahil secara ekonomi, ditolak saat simpan.
- **L4** `margin_pct` di bawah `pricing.min_margin_pct` tenant → peringatan, bukan blokir (owner boleh sengaja rugi untuk promo).
- **L5** Harga tagihan ≠ pricelist melebihi toleransi → penerimaan tetap tersimpan, selisih dicatat.

### 3.3 Migrasi `db/migrations/006_variants_pricing.sql`

```sql
-- ---------------------------------------------------------------------------
-- 006 — varian produk, harga beli per pecahan, pricelist vendor
--
-- Berjalan sekali pada database tenant yang masih schema version 5.
-- `scripts/apply-schema-all.mjs` menerapkan file ini, lalu menerapkan ulang
-- `db/schema/tenant.sql` dan menstempel versi, jadi file ini hanya berisi
-- ALTER, dua tabel baru, index, dan backfill — superset-nya hidup di
-- tenant.sql untuk database baru.
--
-- Invariant setelah migrasi:
--   * setiap produk punya minimal satu baris `product_variants`, jadi stok,
--     PO, transfer, dan POS lama tetap punya tujuan yang sah,
--   * `product_units` dimiliki varian, bukan produk: satu varian boleh punya
--     Pcs dan Karton sekaligus, dua varian tidak lagi bertabrakan,
--   * harga beli pecahan hidup di `product_units.cost` dan
--     `vendor_price_list.buy_price`, bukan diturunkan dari harga pcs.
-- ---------------------------------------------------------------------------

-- 1. Identitas varian --------------------------------------------------------

CREATE TABLE IF NOT EXISTS product_variants (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  product_id  TEXT NOT NULL,
  -- SKU yang dijual. Sama dengan products.sku untuk varian default, dan
  -- memakai sufiks atribut untuk sisanya (lihat src/lib/variants.ts).
  sku         TEXT NOT NULL,
  barcode     TEXT,
  -- Label manusia: "Susu 250ml". Diturunkan dari `attributes`, disimpan agar
  -- daftar produk tidak perlu mem-parse JSON di setiap render.
  name        TEXT NOT NULL,
  -- Grup atribut berurutan: {"Rasa":"Susu","Ukuran":"250ml"}. Objek, bukan
  -- array, supaya urutan tampilan tidak ditentukan urutan penulisan JSON.
  attributes  TEXT NOT NULL DEFAULT '{}',
  -- Harga ringkas varian (satuan dasar). Sumber kebenaran tetap product_units;
  -- kolom ini hanya mempercepat daftar produk dan katalog storefront.
  cost_price  INTEGER NOT NULL DEFAULT 0,
  price       INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 2. Pecahan dimiliki varian, dan membawa harga beli -------------------------

-- Grup atribut yang dipilih owner untuk produk ini, berurutan:
-- [{"name":"Rasa","values":["Susu","Hitam"]}]. Array kosong = produk tanpa
-- varian, yaitu satu varian `Default`.
ALTER TABLE products ADD COLUMN variant_attributes TEXT NOT NULL DEFAULT '[]';

ALTER TABLE product_units ADD COLUMN variant_id TEXT;
-- Harga beli default per pecahan ini (rupiah per satuan, bukan per dasar).
-- 0 berarti belum ditetapkan; PO jatuh ke pricelist vendor lalu ke harga dasar.
ALTER TABLE product_units ADD COLUMN cost       INTEGER NOT NULL DEFAULT 0;

-- 3. Stok dan dokumen ikut varian -------------------------------------------
-- SQLite tidak bisa menambah kolom NOT NULL tanpa default yang konstan, jadi
-- kolom di bawah ini nullable. Kewajiban mengisinya ditegakkan oleh penulis
-- aplikasi + test, dan didokumentasikan sebagai invariant di docs/backend.md.

ALTER TABLE product_batches      ADD COLUMN variant_id TEXT;
ALTER TABLE transaction_items    ADD COLUMN variant_id TEXT;
ALTER TABLE purchase_order_items ADD COLUMN variant_id TEXT;
ALTER TABLE goods_receipt_items  ADD COLUMN variant_id TEXT;
ALTER TABLE stock_request_items  ADD COLUMN variant_id TEXT;
ALTER TABLE transfer_items       ADD COLUMN variant_id TEXT;

-- 4. Pricelist vendor = template PO sepihak ---------------------------------

CREATE TABLE IF NOT EXISTS vendor_price_list (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  vendor_id         TEXT NOT NULL,
  variant_id        TEXT NOT NULL,
  -- Nama pecahan apa adanya ("Karton"), disalin saat simpan supaya baris
  -- pricelist tetap terbaca walau pecahannya kelak diubah namanya.
  unit_name         TEXT NOT NULL,
  conversion_factor REAL    NOT NULL DEFAULT 1,
  -- Harga beli kesepakatan, rupiah per `unit_name` (bukan per satuan dasar).
  buy_price         INTEGER NOT NULL DEFAULT 0,
  min_qty           REAL    NOT NULL DEFAULT 1,
  -- 'active' | 'inactive'. Baris tidak pernah dihapus agar PO lama tetap bisa
  -- ditelusuri; menonaktifkan berarti "jangan dipakai lagi".
  status            TEXT    NOT NULL DEFAULT 'active',
  notes             TEXT,
  updated_by        TEXT,
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 5. Index -------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS idx_variants_sku      ON product_variants(sku);
CREATE INDEX        IF NOT EXISTS idx_variants_product  ON product_variants(product_id, status);
CREATE INDEX        IF NOT EXISTS idx_variants_barcode  ON product_variants(barcode);

-- WAJIB: index lama berhenti benar begitu satu produk punya dua varian dengan
-- pecahan "Pcs" faktor 1. Tanpa DROP di sini, migrasi gagal UNIQUE constraint.
DROP INDEX IF EXISTS idx_units_prod_factor;
CREATE UNIQUE INDEX IF NOT EXISTS idx_units_variant_factor ON product_units(variant_id, conversion_factor);
CREATE INDEX        IF NOT EXISTS idx_units_variant        ON product_units(variant_id);

CREATE        INDEX IF NOT EXISTS idx_batches_variant     ON product_batches(variant_id, warehouse_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vprice_pair         ON vendor_price_list(vendor_id, variant_id, unit_name);
CREATE        INDEX IF NOT EXISTS idx_vprice_variant      ON vendor_price_list(variant_id);
CREATE        INDEX IF NOT EXISTS idx_vprice_vendor_active ON vendor_price_list(vendor_id, status);

-- 6. Backfill: setiap produk lama menjadi satu varian default ----------------

INSERT INTO product_variants (product_id, sku, name, attributes, cost_price, price)
SELECT p.id, p.sku, 'Default', '{}', COALESCE(p.cost_price, 0),
       COALESCE((SELECT pu.price FROM product_units pu
                  WHERE pu.product_id = p.id AND pu.conversion_factor = 1
                  ORDER BY pu.created_at ASC LIMIT 1), 0)
  FROM products p
 WHERE NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id);

-- Pemetaan memakai SKU: pada titik ini relasi produk→varian masih 1:1.
UPDATE product_units
   SET variant_id = (SELECT v.id FROM product_variants v
                      WHERE v.product_id = product_units.product_id
                        AND v.sku = (SELECT p.sku FROM products p WHERE p.id = product_units.product_id))
 WHERE variant_id IS NULL;

UPDATE product_units
   SET cost = (SELECT COALESCE(p.cost_price, 0) FROM products p WHERE p.id = product_units.product_id)
 WHERE cost = 0;

UPDATE product_batches
   SET variant_id = (SELECT v.id FROM product_variants v
                      WHERE v.product_id = product_batches.product_id LIMIT 1)
 WHERE variant_id IS NULL;

UPDATE transaction_items
   SET variant_id = (SELECT v.id FROM product_variants v
                      WHERE v.product_id = transaction_items.product_id LIMIT 1)
 WHERE variant_id IS NULL;

UPDATE purchase_order_items
   SET variant_id = (SELECT v.id FROM product_variants v
                      WHERE v.product_id = purchase_order_items.product_id LIMIT 1)
 WHERE variant_id IS NULL;

UPDATE goods_receipt_items
   SET variant_id = (SELECT v.id FROM product_variants v
                      WHERE v.product_id = goods_receipt_items.product_id LIMIT 1)
 WHERE variant_id IS NULL;

UPDATE stock_request_items
   SET variant_id = (SELECT v.id FROM product_variants v
                      WHERE v.product_id = stock_request_items.product_id LIMIT 1)
 WHERE variant_id IS NULL;

UPDATE transfer_items
   SET variant_id = (SELECT v.id FROM product_variants v
                      WHERE v.product_id = transfer_items.product_id LIMIT 1)
 WHERE variant_id IS NULL;

-- 7. Pricelist awal dari data yang sudah ada --------------------------------
-- `vendor_products.last_cost` adalah harga per satuan DASAR. Pakai pecahan
-- faktor 1 milik varian default supaya angkanya tidak berubah arti.

INSERT OR IGNORE INTO vendor_price_list
  (vendor_id, variant_id, unit_name, conversion_factor, buy_price, min_qty)
SELECT vp.vendor_id, v.id, COALESCE(pu.name, 'Pcs'), 1,
       COALESCE(vp.last_cost, 0), COALESCE(vp.min_order_qty, 1)
  FROM vendor_products vp
  JOIN product_variants v ON v.product_id = vp.product_id AND v.sku = (
         SELECT p.sku FROM products p WHERE p.id = vp.product_id)
  LEFT JOIN product_units pu ON pu.variant_id = v.id AND pu.conversion_factor = 1;
```

Semua DML (backfill, pemetaan, pricelist awal) idempoten atau dijaga
`IS NULL` / `NOT EXISTS`, jadi menjalankan ulang bagian itu dengan tangan tidak
merusak data. `ALTER TABLE ... ADD COLUMN` sendiri tidak idempoten — sama seperti
migrasi 002/003/005; yang menjaganya adalah stempel versi di
`scripts/apply-schema-all.mjs`, yang membuat file ini hanya dieksekusi sekali per
tenant.

### 3.4 `db/schema/tenant.sql` (database baru)

`apply-schema-all.mjs` melewati seluruh migrasi bila versi database 0, jadi
`tenant.sql` **wajib menjadi superset penuh**:

- `product_variants` dan `vendor_price_list` ditulis verbatim, diletakkan setelah
  `vendor_products` dan `product_units`;
- `products` mendapat kolom `variant_attributes` (`TEXT NOT NULL DEFAULT '[]'`);
- `product_units` mendapat kolom `variant_id` dan `cost` di posisi yang sama
  dengan hasil ALTER;
- kolom `variant_id` ditambahkan ke enam tabel dokumen;
- `idx_units_prod_factor` **dihapus** dari daftar index, diganti
  `idx_units_variant_factor` (§3.3 langkah 5);
- `INSERT OR IGNORE INTO schema_version (id, version) VALUES (1, 5)` → `6`;
- `CURRENT_SCHEMA_VERSION = 5` → `6` di `scripts/apply-schema-all.mjs`.

### 3.5 Kenapa `variant_id` nullable, dan kenapa itu aman

SQLite hanya bisa `ADD COLUMN` dengan default konstan; `NOT NULL` tanpa default
pada tabel berisi data akan gagal. Karena itu kolomnya nullable dan kewajibannya
dipindahkan ke tiga tempat:

1. penulis aplikasi selalu mengisi `variant_id` (tidak ada satu pun INSERT baru
   yang boleh melewatkannya);
2. `schema.test.ts` menyatakan `SELECT COUNT(*) FROM product_batches WHERE
   variant_id IS NULL` = 0 setelah seed dan setelah checkout POS;
3. `docs/backend.md` mendapat invariant baru di daftar invariannya.

Backfill di §3.3 memastikan nol baris lama yang tertinggal, sehingga di praktik
kolom ini efektif `NOT NULL`.

---

## 4. Aturan harga — `src/lib/pricing.ts`

Modul murni, tanpa SQL dan tanpa React, mengikuti pembagian yang sudah dipakai
`branch-orders.ts` / `procurement.ts` / `stock-issue.ts`.

### 4.1 Tipe

```ts
export interface PackInput {
  unitName: string;
  conversionFactor: number;
  /** Harga beli per pecahan ini (rupiah per unitName). */
  cost: number;
  /** Harga jual per pecahan ini (rupiah per unitName). */
  price: number;
}

export interface PackEconomics extends PackInput {
  baseCost: number;      // cost / factor, dibulatkan
  basePrice: number;     // price / factor, dibulatkan
  marginPerBase: number; // (price - cost) / factor
  marginPercent: number; // (price - cost) / price * 100
}

export type PriceIssue =
  | { code: "cost_above_price"; unitName: string }
  | { code: "buy_ladder_inverted"; unitName: string; cheaperUnit: string }
  | { code: "sell_ladder_inverted"; unitName: string; cheaperUnit: string }
  | { code: "margin_below_floor"; unitName: string; marginPercent: number }
  | { code: "duplicate_factor"; conversionFactor: number };

export function packEconomics(packs: PackInput[]): PackEconomics[];
export function priceIssues(packs: PackInput[], options?: { minMarginPercent?: number }): PriceIssue[];
export function suggestSellPrice(args: {
  buyPrice: number; conversionFactor: number;
  marginPercent: number; rounding: 0 | 500 | 1000;
}): number;
export function resolveBuyPrice(args: {
  priceList?: number | null;   // kesepakatan vendor untuk pecahan ini
  unitCost?: number | null;    // product_units.cost
  lastBaseCost?: number | null;// vendor_products.last_cost (per satuan dasar)
  conversionFactor: number;
}): { value: number; source: "pricelist" | "product" | "last_cost" | "none" };
```

Urutan `resolveBuyPrice` adalah **kontrak**: pricelist menang, lalu harga beli
produk, lalu realisasi terakhir vendor (`last_cost × factor`), lalu 0 dengan
`source: "none"` — PO boleh disimpan, tetapi barisnya ditandai *"harga belum
disepakati"* (§6.3).

### 4.2 Perilaku aturan

| Kode | Kondisi | Efek |
|---|---|---|
| `cost_above_price` | `cost >= price` pada satu pecahan | **Blokir** simpan, pesan menyebut pecahannya |
| `buy_ladder_inverted` | `baseCost` pecahan besar > `baseCost` pecahan kecil | Peringatan di editor produk & pricelist |
| `sell_ladder_inverted` | `basePrice` pecahan besar > `basePrice` pecahan kecil | Peringatan |
| `margin_below_floor` | `marginPercent < pricing.min_margin_pct` | Peringatan, kecuali owner menandai promo (kolom `notes`) |
| `duplicate_factor` | dua pecahan dengan `conversion_factor` sama | **Blokir** — index unik juga menolak |
| selisih tagihan | `|unit_cost − pricelist.buy_price| / buy_price > pricing.variance_tolerance_pct` | Peringatan di penerimaan + audit |

Pengaturan per tenant (di `tenants.settings`, dibaca lewat `src/lib/tenant-settings.ts`,
pola yang sama dengan `stock_issue_method`):

```json
{ "pricing": { "min_margin_pct": 5, "rounding": 500, "variance_tolerance_pct": 2 } }
```

Default di `db/schema/seed.sql` untuk tenant baru. Tenant lama yang belum punya
kunci ini jatuh ke default di kode — **tanpa migrasi**, persis seperti
`stock_issue_method`.

### 4.3 Pembulatan yang harus diakui

`product_batches.cost_price` adalah INTEGER rupiah per satuan dasar. Karton
Rp 260.000 isi 200 → 1.300 (tepat). Karton Rp 110.000 isi 12 → 9.166,67 → 9.167.
Nilai total tetap tepat karena `goods_receipt_items` menyimpan `quantity`,
`unit_cost`, dan `conversion_factor`; hanya nilai per satuan dasar yang
dibulatkan. Ini perilaku yang **sudah ada** dan tidak diperbaiki di sini —
tetapi kini dapat diaudit karena angka aslinya tersimpan.

---

## 5. Identitas varian — `src/lib/variants.ts`

```ts
export interface VariantAttributeGroup { name: string; values: string[]; }

/** Rasa [Susu, Hitam] × Ukuran [250ml] → 2 kombinasi, urutan stabil. */
export function expandCombinations(groups: VariantAttributeGroup[]): Record<string, string>[];

/** {"Rasa":"Susu","Ukuran":"250ml"} → "Susu 250ml" untuk label rak. */
export function variantLabel(attributes: Record<string, string>, groups: VariantAttributeGroup[]): string;

/** KOP-SUSU, KOP-HITAM, KOP-SUSU-250 … unik di dalam satu produk. */
export function variantSku(baseSku: string, attributes: Record<string, string>): string;
```

- Grup atribut disimpan per produk di `products.variant_attributes` (JSON array
  berurutan), bukan katalog atribut global. Alasan: toko bahan kue memakai
  "Ukuran", toko kosmetik memakai "Warna" + "Volume"; katalog global hanya
  menambah tabel dan layar tanpa menambah kebenaran.
- Matriks kombinasi dihasilkan dari grup; **setiap kombinasi adalah baris
  `product_variants`**, jadi 2 rasa × 2 ukuran = 4 SKU, masing-masing dengan
  stok, barcode, pecahan, harga beli dan harga jual sendiri.
- Produk tanpa atribut tetap punya satu varian "Default" (hasil backfill §3.3),
  sehingga tidak ada cabang kode "produk tanpa varian" di POS atau stok.
- SKU varian mengikuti konvensi yang sudah ada di `inventory-utils.ts`
  (`KAT-YYMMDD-NNN` + sufiks atribut), dan tetap unik lewat `idx_variants_sku`.

---

## 6. Layar

### 6.1 Produk — `AddProductModal.tsx` menjadi editor varian

Bagian "Satuan & Barcode" (L590–674) diganti dua bagian:

1. **Grup Varian** — daftar grup (nama + nilai), tombol "Tambah Grup". Kosong =
   produk tanpa varian, sistem membuat satu varian `Default` otomatis.
2. **Matriks Varian** — satu kartu per kombinasi. Tiap kartu berisi pecahan
   (Satuan · Konversi · **Harga Beli** · **Harga Jual** · Barcode).

Perubahan pada tiap baris pecahan:

| Sebelum | Sesudah |
|---|---|
| Konversi · Harga Jual · Barcode | Konversi · **Harga Beli** · Harga Jual · Barcode |
| Harga jual dasar disinkronkan ke field "Harga Jual (Base)" di atas | Field "Harga Jual (Base)" **dihapus**; ia hanya pembulatan yang membingungkan dari `product_units` faktor 1 |
| "Harga Modal" (`products.cost_price`) satu angka untuk semua pecahan | `products.cost_price` tetap ada sebagai ringkasan, diturunkan dari pecahan faktor 1 varian default |

Aksi massal yang wajib ada, karena 4 varian × 3 pecahan = 12 baris:

- **"Samakan harga semua varian"** — salin pecahan + harga dari satu varian ke
  semua varian lain (nama SKU/barcode tetap unik per varian).
- **"Hitung harga jual dari margin"** — isi `price` dari `suggestSellPrice()`.

`priceIssues()` dirender sebagai panel peringatan di bawah matriks, dengan
pembulatan `pricing.rounding` dari tenant.

### 6.2 Vendor — tab baru **Produk & Harga**

Di `VendorDetail.tsx` (tab sekarang: Produk, Purchase Order, Hutang &
Pembayaran) tambahkan dua tab:

**Tab "Harga Beli"** — inti kontrol owner.

```
[ Cari produk/varian… ]  [ Semua kategori ▾ ]  [ Status: aktif ▾ ]   [ Impor/ekspor excel ]

Produk            Varian      Pecahan    Konversi  Harga Beli     MOQ   Sejak
Kopi Sachet ABC   Susu        Pcs        1         Rp 1.500       1     31/10/2026
Kopi Sachet ABC   Susu        Renceng    10        Rp 14.000      5     31/10/2026
Kopi Sachet ABC   Susu        Karton     200       Rp 260.000     1     31/10/2026
Kopi Sachet ABC   Hitam       Karton     200       Rp 275.000     1     31/10/2026
```

- Baris berasal dari `vendor_price_list` **LEFT JOIN** `product_units`, artinya
  pecahan yang belum punya harga kesepakatan tetap muncul dengan badge
  *"Belum disepakati"* — itu justru daftar tugas owner.
- Edit inline per baris: `buy_price`, `min_qty`, `status`, `notes`.
- Kolom **Margin** (opsional, dihitung) menampilkan `marginPercent` dari harga
  jual saat ini; ini yang membuat owner melihat "harga vendor naik, margin
  turun" sebelum PO dibuat.
- Tombol **"Salin dari vendor lain"** untuk membandingkan/menyalin pricelist.

**Tab "Riwayat Harga"** — tidak ada tabel baru. Isinya `audit_logs` dengan
`entity='vendor_price_list'` (§8), sehingga "harga naik kapan, oleh siapa"
terjawab dari log yang sudah ada.

Harga **jual** tidak ada di layar vendor. Vendor tidak boleh menjadi sumber
kebenaran atas harga yang kita tagih ke pelanggan (§13 D4).

### 6.3 PO — `PurchaseOrderModal.tsx`

Tiga perubahan:

| # | Perubahan |
|---|---|
| 1 | Pemilih produk menjadi pemilih **varian**: label `Nama Produk — Susu 250ml`, pencarian mencakup SKU dan barcode varian |
| 2 | Pecahan yang ditawarkan = `product_units` milik varian itu, dan harga beli default = `resolveBuyPrice()`. Baris dengan `source='none'` diberi badge *"Harga belum disepakati"* dan tetap bisa disimpan |
| 3 | Hapus `unitCostOf = baseCost × factor`. Harga per pecahan datang dari pricelist; mengubah pecahan tidak lagi mengalikan harga secara diam-diam. Perkalian hanya muncul di dalam `resolveBuyPrice()` sebagai **fallback** terakhir, ketika vendor belum punya baris pricelist dan satu-satunya data adalah `last_cost` per satuan dasar |

`handleAutoFillLowStock` beralih ke stok per varian (lihat §7), dan kuantitas
awal diisi `max(sisa_ke_min_stock, min_qty pricelist)` dibulatkan ke atas.

`purchase_order_items` menyimpan `variant_id`, `unit_name`, `conversion_factor`,
`unit_cost` seperti sekarang — tidak ada kolom harga baru di dokumen.

### 6.4 Penerimaan barang — `GoodsReceiptModal.tsx`

- Baris menampilkan *dipesan dalam Karton, stok masuk dalam Pcs* seperti
  sekarang; batch ditulis dengan `variant_id`.
- Bila `unit_cost` yang diketik berbeda dari pricelist melebihi
  `variance_tolerance_pct`, tampilkan peringatan sebaris: *"Harga tagihan
  Rp 265.000 berbeda dari kesepakatan Rp 260.000 (+1,9%)"* — tidak memblokir,
  tetapi dicatat di `audit_logs`.

### 6.5 POS — `POS.tsx`

- Produk dengan lebih dari satu varian menampilkan pemilih varian sebelum
  pecahan; produk satu varian langsung ke pemilih pecahan (nol klik tambahan).
- Kunci baris keranjang berubah dari `${product.id}-${unitName}` menjadi
  `${variantId}-${unitName}`; `variant_id` ikut ditulis ke `transaction_items`.
- Batas stok dihitung per varian (`SUM(quantity_current) WHERE variant_id = …`).
- Label stok di POS menyebut variannya, bukan hanya nama produk — dua varian
  dengan nama mirip adalah sumber salah-pilih kasir.

### 6.6 Layar lain yang wajib ikut varian

| Layar | Perubahan minimal |
|---|---|
| `StockTransferModal.tsx` | baris per varian, stok sumber per varian |
| `BranchTransfers.tsx` | tampilkan label varian pada baris |
| `StockOpnameModal.tsx` | hitung selisih per varian |
| `Inventory.tsx` | kolom stok menjumlah per varian; baris produk bisa di-expand |
| `ProductImportExport.tsx` | template excel +2 kolom: `Varian` dan `Harga Beli`, kunci baris `(SKU, Pecahan)` |
| `api/storefront/catalog.ts` | ekspor `variants[]`; produk tanpa varian tetap mengirim satu entri `Default` agar `tokoonline` tidak pecah |
| `LowStockAlert.tsx` | agregasi per varian, tetap per gudang |

---

## 7. Alur end-to-end setelah perubahan

Contoh: Kopi Sachet ABC — Susu.

```
1. Owner membuat produk + 2 varian (Susu, Hitam), tiap varian 3 pecahan:
     Susu   Pcs 1 @ beli 1.500 / jual 2.000
            Renceng 10 @ beli 14.000 / jual 18.000
            Karton 200 @ beli 260.000 / jual 350.000
     Hitam  Pcs 1 @ beli 1.600 / jual 2.200
            Karton 200 @ beli 275.000 / jual 370.000

2. Owner mengisi pricelist Vendor A untuk tiap (varian × pecahan).
     → 6 baris vendor_price_list. Ini "template PO": vendor + pecahan + harga.

3. purchasing membuat PO → pilih Vendor A, Rak Toko Depok
     baris: Susu Karton × 4 → harga terisi otomatis 260.000 → Rp 1.040.000
            Hitam Karton × 2 → 275.000 → Rp 550.000
     status draft, nol stok, nol bill.

4. owner menyetujui PO (approve_po). Purchasing tidak boleh menyetujui PO-nya
   sendiri; pemisahan ini sudah ada dan tidak berubah.

5. barang datang → goods receipt ke Rak Toko Depok:
     Susu  Karton 4 → batch 800 Pcs @ 1.300, variant_id = Susu
     Hitam Karton 2 → batch 400 Pcs @ 1.375, variant_id = Hitam
     tagihan 265.000/karton (≠ 260.000) → peringatan + audit selisih
     satu expenses per penerimaan, due = tanggal terima + payment_terms_days

6. stok rak: Susu 800 Pcs, Hitam 400 Pcs — dua angka terpisah.

7. POS menjual Susu Pcs 2 → 2.000 × 2; batch Susu dipotong sesuai kebijakan
   FIFO/LIFO/FEFO tenant, transaction_items.variant_id = Susu.

8. Owner membuka Vendor → Harga Beli: melihat margin per pecahan dan riwayat
   perubahan harga; membuka Laporan: penjualan dan margin per varian.
```

Rantai yang **tidak** berubah: approval PO, satu bill per penerimaan,
`expenses` sebagai sumber AP, kebijakan FIFO/LIFO/FEFO, penomoran dokumen.

---

## 8. Izin — di mana owner memegang kontrol

`src/config/roles.ts`, grup `inventory`:

```ts
"create_po", "approve_po", "receive_po", "cancel_po",
"manage_vendor_prices",  // baru: isi/ubah pricelist vendor
"manage_sell_prices",    // baru: ubah harga jual per pecahan
"manage_variants",       // baru: tambah/ubah varian produk
```

| Izin | owner / admin / platform | store_manager | warehouse | purchasing |
|---|---|---|---|---|
| `manage_vendor_prices` | ✅ | ❌ | ❌ | ❌ |
| `manage_sell_prices` | ✅ | ❌ | ❌ | ❌ |
| `manage_variants` | ✅ | ❌ | ❌ | ❌ |
| `create_po` (tidak berubah) | ✅ | ✅ | ❌ | ✅ |

Alasannya adalah pemisahan tugas, bukan mistrust: yang **membuat** PO tidak boleh
menentukan harga kesepakatan, dan yang **menerima** barang tidak boleh
menentukan harga jual. Default di atas bisa di-override di Settings → Role
karena `resolveRolePermissions()` sudah melapisi snapshot tenant di atas default
— tetapi default-nya menutup, bukan membuka.

Penerapan memakai `usePermissions()` + `<PermissionGate>` yang sudah ada.
Batasannya sama dengan yang sudah didokumentasikan di `spec-purchase-order.md`
§8: browser memegang token tenant penuh, jadi ini **kontrol UX, bukan
keamanan**, sampai mutasi dipindahkan ke endpoint server.

---

## 9. Audit

`logAudit` / `logAuditTx` yang sudah ada, tanpa tabel baru:

| `entity` | `action` | `details` |
|---|---|---|
| `vendor_price_list` | `create_vendor_price` | vendorId, variantId, unitName, buyPrice, conversionFactor |
| `vendor_price_list` | `update_vendor_price` | vendorId, variantId, unitName, from, to, changedBy |
| `vendor_price_list` | `deactivate_vendor_price` | vendorId, variantId, unitName, reason |
| `product_variants` | `create_variant` / `update_variant` / `archive_variant` | productId, variantId, sku, attributes |
| `products` | `update_sell_price` | variantId, unitName, from, to |
| `goods_receipts` | `create_grn` (ada) | **tambahan**: `priceVariances: [{ variantId, unitName, agreed, invoiced }]` |

Perubahan harga adalah peristiwa bisnis, bukan edit form: tanpa log ini,
pertanyaan "kenapa margin bulan ini turun" tidak bisa dijawab.

---

## 10. Berkas

**Baru**

| Path | Isi |
|---|---|
| `db/migrations/006_variants_pricing.sql` | §3.3 |
| `src/lib/pricing.ts` | §4 — murni: `packEconomics`, `priceIssues`, `suggestSellPrice`, `resolveBuyPrice` |
| `src/lib/pricing.test.ts` | §11 |
| `src/lib/variants.ts` | §5 — `expandCombinations`, `variantLabel`, `variantSku` |
| `src/lib/variants.test.ts` | §11 |
| `src/components/inventory/VariantMatrix.tsx` | matriks varian × pecahan di form produk (dipisah dari modal agar bisa diuji) |
| `src/components/vendors/VendorPriceList.tsx` | tab Harga Beli (§6.2) |
| `src/components/vendors/VendorPriceHistory.tsx` | tab Riwayat Harga, membaca `audit_logs` |

**Diubah** (urutan pengerjaan mengikuti §12)

| Path | Perubahan |
|---|---|
| `db/schema/tenant.sql` | superset §3.4, versi 6 |
| `scripts/apply-schema-all.mjs` | `CURRENT_SCHEMA_VERSION = 6` |
| `src/lib/db/__tests__/schema.test.ts` | versi 5 → 6, daftar tabel +2, invariant `variant_id` terisi |
| `src/lib/tenant-settings.ts` | pembaca `pricing.*` |
| `src/lib/inventory-utils.ts` | SKU per varian |
| `src/lib/goods-receipt.ts` | tulis `variant_id` di batch & item, bandingkan pricelist |
| `src/lib/stock-movement.ts` | filter batch per varian di `drainBatches` / `shipOutOfStock` / transfer |
| `src/components/inventory/AddProductModal.tsx` | §6.1 |
| `src/components/inventory/PurchaseOrderModal.tsx` | §6.3 |
| `src/components/inventory/GoodsReceiptModal.tsx` | §6.4 |
| `src/components/inventory/{StockTransferModal,StockOpnameModal,ProductImportExport}.tsx` | §6.6 |
| `src/pages/POS.tsx` | §6.5 |
| `src/pages/Inventory.tsx` | muat/simpan varian, stok per varian |
| `src/pages/vendors/VendorDetail.tsx` | dua tab baru |
| `src/config/roles.ts` | tiga izin baru + label |
| `api/storefront/catalog.ts` | `variants[]` |
| `server/demo/catalog.ts`, `server/demo/ledger.ts`, `server/demo/seed.ts` | varian + pricelist realistis |
| `tests/{kasir,gudang,owner}.e2e.ts` | lihat §11 |
| `docs/{backend,arsitektur,frontend,fitur-tenant}.md`, `requirement.md`, `README.md` | sinkronisasi |

---

## 11. Rencana uji

**Unit — `pricing.test.ts`**

- `baseCost` dan `basePrice` untuk pecahan 1/10/200, termasuk pembulatan
  Rp 110.000 ÷ 12.
- `marginPercent` saat `price = 0` (hindari bagi nol) dan saat `cost > price`.
- `priceIssues` menangkap keempat kode; `cost_above_price` memblokir, sisanya
  hanya peringatan.
- `buy_ladder_inverted` terdeteksi saat karton per pcs lebih mahal dari eceran.
- `resolveBuyPrice` mengikuti urutan pricelist → produk → last_cost → none,
  termasuk saat `conversion_factor = 0` (diperlakukan 1).
- `suggestSellPrice` membulatkan ke 500/1000 tanpa pernah menghasilkan angka di
  bawah `buyPrice`.

**Unit — `variants.test.ts`**

- `expandCombinations` pada 0/1/2 grup, urutan hasil stabil.
- `variantLabel` pada atribut kosong → `"Default"`.
- `variantSku` unik untuk dua kombinasi yang berbeda hanya pada satu atribut.

**Integrasi — `schema.test.ts` / `goods-receipt.test.ts`**

- `tenant.sql` versi 6, 33 tabel.
- Setelah seed: tidak ada `product_batches`, `transaction_items`,
  `purchase_order_items` dengan `variant_id IS NULL`.
- Migrasi 006 dijalankan pada database berbentuk v5: setiap produk memperoleh
  satu varian `Default`, `product_units.variant_id` terisi,
  `idx_units_prod_factor` hilang, dua varian dengan pecahan `Pcs` dapat hidup
  berdampingan (uji regresi index unik).
- Penerimaan karton 4 → 1 batch × 800 Pcs dengan `cost_price = 1.300` dan
  `variant_id` benar; satu `expenses`.
- Dua varian → dua batch terpisah, stok tidak saling bocor.

**E2E**

- `kasir.e2e.ts`: pilih varian → pilih pecahan → bayar; stok varian yang dipilih
  berkurang, varian lain tidak.
- `gudang.e2e.ts`: terima PO dengan harga ≠ pricelist → muncul peringatan
  selisih, batch masuk ke rak yang benar.
- `owner.e2e.ts`: buka Vendor → Harga Beli, ubah satu harga, muncul di Riwayat
  Harga; `store_manager` tidak melihat tombol ubah harga.

---

## 12. Rollout

Empat fase, masing-masing dapat dikirim sendiri.

**Fase 1 — schema + backfill, perilaku belum berubah.**
Migrasi 006, `product_variants`, `product_units.cost`, `variant_id` di enam
tabel, superset `tenant.sql`, versi 6. Semua penulis kode lama diarahkan ke
varian `Default`. Verifikasi: aplikasi berjalan identik dengan sebelumnya,
`variant_id` tidak pernah NULL.

**Fase 2 — harga beli per pecahan + pricelist vendor.**
`pricing.ts`, `AddProductModal` (harga beli per pecahan), tab **Harga Beli** di
Vendor, `PurchaseOrderModal` memakai `resolveBuyPrice` dan berhenti mengalikan
harga. Ini fase yang langsung memenuhi permintaan owner atas template PO.
Belum ada varian ganda.

**Fase 3 — banyak varian.**
Editor grup atribut + matriks, POS pemilih varian, transfer/opname/import per
varian, `api/storefront/catalog.ts`, seed demo. Ini fase termahal karena
menyentuh setiap jalur stok.

**Fase 4 — penguatan kontrol.**
Izin `manage_vendor_prices` / `manage_sell_prices` / `manage_variants`, panel
peringatan margin, peringatan selisih tagihan, tab Riwayat Harga, sinkronisasi
dokumentasi.

`scripts/apply-schema-all.mjs` adalah langkah **manual** (`--apply`), tidak
pernah dipicu oleh build. Demo seed diperbarui di fase yang sama supaya tenant
baru langsung punya contoh dua varian, tiga pecahan, dan pricelist dua vendor.

---

## 13. Kriteria penerimaan

- [ ] `vendor_price_list` menyimpan harga karton **apa adanya** (260.000), bukan
      hasil `harga_pcs × 200`.
- [ ] `product_units.cost` ada dan dipakai; `unitCostOf = baseCost × factor`
      sudah tidak ada di kode.
- [ ] Satu produk dapat memiliki ≥2 varian, masing-masing dengan stok, barcode,
      dan harga sendiri; tidak ada lagi SKU kembar untuk satu barang.
- [ ] Tidak ada baris `product_batches` / `transaction_items` /
      `purchase_order_items` dengan `variant_id IS NULL`.
- [ ] PO baru mengambil harga dari pricelist vendor; baris tanpa pricelist
      ditandai *"harga belum disepakati"* dan tetap dapat disimpan.
- [ ] Mengubah pecahan di PO tidak lagi mengubah harga satuan secara diam-diam.
- [ ] `cost >= price` ditolak; ladder terbalik dan margin di bawah ambang hanya
      memperingatkan.
- [ ] Tagihan yang menyimpang dari pricelist tercatat di `audit_logs` dan
      terlihat saat penerimaan.
- [ ] Rantai PO → approval → penerimaan → rak → POS tetap berjalan; satu bill
      per penerimaan, `expenses` tetap sumber AP.
- [ ] Nominal AP, cashflow, dan jurnal untuk satu penerimaan **identik** dengan
      build sebelumnya pada skenario yang sama.
- [ ] `store_manager`, `warehouse`, dan `purchasing` tidak dapat membuka editor
      harga beli/jual.
- [ ] `npx tsc --noEmit` bersih untuk app dan node; `npx eslint` tidak menambah
      temuan baru; `npx vitest run` hijau.

---

## 14. Keputusan, dan apa yang ditolak

| # | Keputusan | Alternatif yang ditolak, dan alasannya |
|---|---|---|
| D1 | Varian sebagai tabel terpisah dengan stok sendiri | *Varian hanya label atribut.* Stok dua rasa tidak bisa dibedakan, jadi stok fisik di rak tidak pernah cocok dengan sistem — persoalan yang justru ingin diselesaikan. |
| D2 | Harga beli pecahan **independen**, satuan dasar diturunkan | *Tetap `harga_pcs × faktor`.* Diskon karton hilang dan tidak bisa dicatat; Rp 40.000 per karton menjadi selisih tak terlihat. |
| D3 | Template PO = **pricelist per vendor** | *Basket multi-item dan default rak per template.* Basket menjawab pertanyaan lain ("apa yang biasa dipesan"), bukan "berapa harga yang disepakati"; rak tujuan tetap dipilih per PO. Keduanya bisa ditambah tanpa mengubah skema, lihat §15. |
| D4 | Harga jual tinggal di varian/pecahan, **tidak** di layar vendor | *Harga jual ikut disimpan di pricelist.* Menjadikan vendor sebagai sumber kebenaran harga tagih ke pelanggan; satu kesalahan input vendor mengubah harga semua rak. |
| D5 | Grup atribut disimpan per produk, bukan katalog atribut global | *Tabel `attributes` + `attribute_values`.* Menambah dua tabel dan tiga layar untuk kebenaran yang sama; kebutuhan lintas produk belum terbukti. |
| D6 | `variant_id` nullable, kewajiban di aplikasi + test | *Tabel baru dengan `NOT NULL` lewat rebuild tabel.* Rebuild 6 tabel pada database produksi berisi data jauh lebih berisiko daripada satu kolom nullable yang dijaga test dan invariant. |
| D7 | `vendor_price_list` terpisah dari `vendor_products` | *Menambah `variant_id` + `unit_name` ke `vendor_products`.* Akan memecah makna baris "produk ini dipasok vendor ini" menjadi satu baris per pecahan, dan `last_cost` kehilangan arti per satuan dasar yang sudah dipakai penerimaan. |
| D8 | Harga lama dinonaktifkan, tidak dihapus | *Hapus baris saat harga berubah.* PO lama berhenti bisa ditelusuri ke harga kesepakatan yang berlaku saat itu. |
| D9 | Izin harga tertutup untuk `store_manager` secara default | *Buka untuk semua manajer.* Kontrol owner justru hilang di toko dengan satu manajer — kasus paling umum. |
| D10 | Tidak ada tabel riwayat harga | *Tabel `vendor_price_history`.* `audit_logs` sudah menyimpan from/to/oleh; tabel kedua hanya menggandakan data yang sama sampai ada kebutuhan laporan khusus (§15). |

---

## 15. Di luar cakupan

Semua ini celah nyata; tidak ada yang perlu ikut perubahan ini.

1. **Template PO berupa basket multi-item** ("Restock Mingguan" → draft PO).
   Skema tidak perlu berubah: `po_templates` + `po_template_items` dapat
   ditambahkan kemudian tanpa menyentuh tabel di §3.
2. **Default rak/cabang per template.** Saat ini `purchase_orders.warehouse_id`
   dipilih per PO; menambah kolom default per template adalah pekerjaan kecil di
   fase lanjutan.
3. **Tier harga per kuantitas** (beli 10 karton lebih murah). Pricelist sekarang
   satu harga per (vendor, varian, pecahan) + `min_qty`.
4. **Promo/diskon per varian, tanggal berlaku promo.** `vendor_price_list.status`
   dan `notes` menampung kasus manual.
5. **Katalog atribut global + pencarian faset** (filter "semua rasa jeruk").
6. **Konversi produk duplikat menjadi varian secara otomatis.** Migrasi hanya
   membuat satu varian per produk; menggabungkan "Teh Kotak Jeruk" dan "Teh
   Kotak Madu" yang sudah terlanjur jadi dua produk adalah pekerjaan data
   manual dengan alat bantu, bukan SQL otomatis.
7. **Harga per cabang** (satu varian lebih mahal di toko bandara).
8. **PPN, multi-currency, landed cost.** Sama seperti di `spec-purchase-order.md`
   §15.6 dan §15.8: `suppliers.currency` masih dibaca nol tempat, semua nominal
   integer IDR.
9. **Stok minimum per varian** (min_stock_level masih per produk).
10. **Server-side authorization / RLS.** Browser memegang token tenant penuh;
    seluruh kontrol izin di §8 bersifat UX sampai mutasi pindah ke server.

---

## 16. Status implementasi

Diperbarui: 2026-10-31. Skema sudah di versi **6**; semua test lulus kecuali
yang menunggu `Inventory.tsx` (lihat bawah).

### Sudah jalan

| Berkas | Perubahan |
|---|---|
| `db/migrations/006_variants_pricing.sql` | Tabel `product_variants`, `vendor_price_list`; kolom `variant_id` di 7 tabel + `products.variant_attributes`; `product_units.cost`; backfill satu varian `Default` per produk; drop `idx_units_prod_factor`, ganti `idx_units_variant_factor` |
| `db/schema/tenant.sql` | Superset versi 6 — database baru langsung lengkap |
| `src/lib/variants.ts` | `expandCombinations`, `variantKey`, `variantLabel`, `variantSku`, `parseVariantGroups`, `sanitizeGroups` |
| `src/lib/pricing.ts` | `resolveBuyPrice`, `packEconomics`, `priceIssues`, `isBlockingIssue`, `suggestSellPrice`, `exceedsVarianceTolerance` |
| `src/components/inventory/AddProductModal.tsx` | Ditulis ulang: editor grup atribut, matriks varian x pecahan dengan **harga beli dan harga jual per pecahan** terpisah, stok per varian, ringkasan margin. Hanya `cost_above_price` dan `duplicate_factor` yang memblokir simpan |
| `src/components/inventory/PurchaseOrderModal.tsx` | Pemilih varian; `variant_id` di baris draft; urutan harga: **pricelist vendor -> `product_units.cost` -> `cost x faktor`**; peringatan bila angka yang diketik berbeda dari kesepakatan |
| `src/components/inventory/PurchaseOrderPanel.tsx` | `purchase_order_items.variant_id` ditulis dan dibaca ulang; `PO_LINES_SQL` join `product_variants` |
| `src/components/inventory/PurchaseOrderDetail.tsx` | `variant_id` / `variant_name` di `PurchaseOrderLine` |
| `src/lib/goods-receipt.ts` | `variant_id` ikut ke `product_batches` dan `goods_receipt_items`; selisih harga penerimaan mengisi `vendor_price_list` yang belum ada (`ON CONFLICT DO NOTHING`, tidak pernah menimpa kesepakatan) |
| `src/lib/stock-movement.ts` | `variantId` opsional di sepanjang `stockOnHand` / `createTransfer` / `drainBatches` / `dispatchTransfer` / `shipOutOfStock`; batch tujuan mewarisi varian |
| `src/pages/vendors/VendorDetail.tsx` | Tab **Harga Beli** (pricelist per varian x pecahan, harga terakhir dibayar, aktif/nonaktif) dan tab **Riwayat Harga** (harga yang benar-benar ditagihkan per penerimaan) |

Catatan perilaku: `variantId` kosong di `stock-movement.ts` berarti "seluruh produk".
Itu disengaja — baris lama pra-migrasi tetap bisa dipindahkan, dan backfill
memang memindahkan batch lama ke varian `Default`.

### Belum jalan

Dua berkas tertahan di antrean simpan editor dan **belum tersentuh**:

1. **`src/pages/Inventory.tsx`** — satu-satunya error kompilasi yang tersisa
   (`TS2322` di `onAdd={handleSaveProduct}`). Selama ini form produk mengirim
   matriks varian tetapi halaman masih memakai kontrak lama, sehingga
   **belum ada penulis `product_variants` / `product_units.variant_id` di
   aplikasi** — satu-satunya sumber saat ini adalah backfill migrasi.
   Pekerjaan yang kurang: `Product` + `ProductVariantRow`, `PRODUCTS_SQL`
   mengembalikan `variant_attributes` dan pecahan dengan `cost` + `variant_id`,
   tiga proyeksi datar (`VARIANTS_SQL`, `VARIANT_UNITS_SQL`,
   `VARIANT_STOCK_SQL`) yang dijahit di `mapProductRows`, `handleSaveProduct`
   menulis varian lalu pecahan lalu batch dan menghapus varian/pecahan yang
   dibuang form, serta `reduceStock` memfilter `variant_id`.
2. **`src/config/roles.ts`** — `manage_variants`, `manage_vendor_prices`,
   `manage_sell_prices` belum ada di `PERMISSION_GROUPS.inventory`,
   `PERMISSION_LABELS`, dan default `store_manager`. Tanpa itu
   `can("manage_vendor_prices")` selalu `false`, jadi tombol tambah/ubah harga
   di tab Harga Beli belum muncul untuk siapa pun — termasuk owner.

### Menyusul

- `StockTransferModal.tsx` / `StockOpnameModal.tsx` belum menampilkan pemilih
  varian; keduanya masih bergantung pada bentuk baris dari `Inventory.tsx`.
- `handleImport` di `Inventory.tsx` belum membuat varian maupun pecahan.
- Seed demo dan katalog storefront masih mengabaikan `variant_id`.

