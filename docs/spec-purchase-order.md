# RetailPro — Purchase Order Lifecycle & Goods Receipt

| | |
|---|---|
| Document | `docs/spec-purchase-order.md` |
| Status | **Proposed** — spec only, no code written yet |
| Date | 2026-10-30 |
| Replaces | the single-step behaviour in `Inventory.tsx` → `handlePO` |
| Reference implementation | branch replenishment: `stock_requests` → `stock_transfers` |
| Schema impact | migration `005`, schema version 4 → **5** |

---

## 0. Summary

Today "Buat PO" is one click that writes a purchase order **already marked
received**, puts the stock on a shelf, and books a payable — all in the same
transaction and the same millisecond. There is no gap between ordering and
delivery, so nothing can be late, short, partial, rejected or approved.

This spec splits that one action into the four documents a purchasing process
actually needs:

```
PO (intent)  →  approval  →  goods receipt (reality)  →  bill (liability) + batch (stock)
```

It follows the pattern already used and already justified in this codebase for
internal replenishment (`src/lib/branch-orders.ts`):

> *"Demand is deliberately not a transfer: the request records intent and
> approval, `stock_transfers` records the batches that actually left the
> gudang."*

The same sentence applies verbatim to purchases: the PO records intent and
approval, `goods_receipts` records the batches that actually arrived.

---

## 1. Current behaviour (verified against the live tenant DB)

Executed as `owner@tokobahankue.com`, destination **Rak Toko Pusat**, vendor
VND-0002, TPG-001 × 10 @ Rp 13.500:

| Table | Row written | Note |
|---|---|---|
| `purchase_orders` | `status='received'`, `received_at` = `created_at` (identical ms) | no ordered/draft state |
| `purchase_order_items` | qty 10, unit `Pcs`, factor 1 | no `quantity_received` |
| `product_batches` | qty 10/10 at Rak Toko Pusat, `expiry_date = NULL`, `batch_number = po_number` | no FK to the PO |
| `expenses` | `'Pembelian Stok'`, unpaid, due = +45d | PO link is a **string** in `description` |
| `payables` | — | table is empty (0 rows); `tenant.sql` L357 still claims it is written |

Consequences, all verified: no partial receipt, no over/short delivery, no
approval gate (`store_manager` reaches `/backoffice/inventory/po`), no expiry
capture, no cancel, no PO list, and `payables.purchase_order_id` unusable.

---

## 2. Goals

1. A PO has a real lifecycle; goods arrive in their own document.
2. One PO can be received in several deliveries, each with its own date, cost,
   lot and expiry.
3. Creating a PO and approving it are different permissions and, by default,
   different people.
4. Goods land in a warehouse the tenant deliberately chose, and only in an
   **active** one.
5. Every receipt writes a batch that is traceable back to its PO line by
   foreign key, not by matching a string.
6. The bill is booked when the liability arises (delivery), not when the order
   was typed.
7. Nothing in the existing stock ledger, POS, opname, AP/AR, cashflow or
   journal changes behaviour.

### Non-goals

See §15.

---

## 3. Domain model

### 3.1 Four documents

| Document | Table | Answers | Written when |
|---|---|---|---|
| Purchase order | `purchase_orders` + `purchase_order_items` | *what did we ask for, and who agreed to it?* | draft → submitted → approved |
| Goods receipt | `goods_receipts` + `goods_receipt_items` | *what physically arrived, on which day, at which price, in which lot?* | each delivery |
| Stock | `product_batches` | *what is on the shelf now* | each delivery |
| Bill | `expenses` | *what do we owe the vendor and when* | each delivery |

`payables` stays unused and is marked **deprecated** in `tenant.sql`. Migrating
the four AP readers (`ApAr`, `Expenses`, `Cashflow`, `Journal`) is a separate
change; §15 covers it.

### 3.2 Migration `db/migrations/005_procurement_lifecycle.sql`

```sql
-- ---------------------------------------------------------------------------
-- 005 — purchase order lifecycle and goods receipt
--
-- Runs once against a tenant database still on schema version 4.
-- `scripts/apply-schema-all.mjs` applies this file, then re-applies
-- `db/schema/tenant.sql` and stamps the version, so this file holds only the
-- ALTERs, the two new tables and their indexes — the same superset then lives
-- in tenant.sql for virgin databases.
--
-- Invariant after this migration:
--   * a PO is `draft` -> `submitted` -> `approved` before any stock moves,
--   * stock moves only in `goods_receipts`, which may be partial and repeated,
--   * every `product_batches` row created by a purchase carries its
--     `purchase_order_id`, so PO -> batch is a join and not a string match,
--   * `expenses.purchase_order_id` replaces the description-string link.
-- ---------------------------------------------------------------------------

-- 1. Purchase order lifecycle ----------------------------------------------

ALTER TABLE purchase_orders ADD COLUMN payment_terms_days INTEGER NOT NULL DEFAULT 30;
ALTER TABLE purchase_orders ADD COLUMN submitted_by        TEXT;
ALTER TABLE purchase_orders ADD COLUMN submitted_at        TEXT;
ALTER TABLE purchase_orders ADD COLUMN approved_by         TEXT;
ALTER TABLE purchase_orders ADD COLUMN approved_at         TEXT;
ALTER TABLE purchase_orders ADD COLUMN rejected_by         TEXT;
ALTER TABLE purchase_orders ADD COLUMN rejected_at         TEXT;
ALTER TABLE purchase_orders ADD COLUMN rejection_reason    TEXT;
ALTER TABLE purchase_orders ADD COLUMN cancelled_by        TEXT;
ALTER TABLE purchase_orders ADD COLUMN cancelled_at        TEXT;
ALTER TABLE purchase_orders ADD COLUMN cancel_reason       TEXT;
ALTER TABLE purchase_orders ADD COLUMN updated_at          TEXT;

-- 2. Line-level received quantity ------------------------------------------

ALTER TABLE purchase_order_items ADD COLUMN quantity_received REAL NOT NULL DEFAULT 0;
ALTER TABLE purchase_order_items ADD COLUMN notes             TEXT;

-- 3. Ledger linkage --------------------------------------------------------

ALTER TABLE product_batches ADD COLUMN purchase_order_id     TEXT;
ALTER TABLE product_batches ADD COLUMN goods_receipt_id      TEXT;
-- No `goods_receipt_item_id`: `goods_receipt_items.batch_id` already points at
-- the batch it created, so a second pointer back would only be something else
-- to keep in sync. With `goods_receipt_id` present the link is navigable in
-- both directions.

ALTER TABLE expenses ADD COLUMN purchase_order_id TEXT;
ALTER TABLE expenses ADD COLUMN goods_receipt_id  TEXT;

-- 4. Delivery documents ----------------------------------------------------

CREATE TABLE IF NOT EXISTS goods_receipts (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  grn_number        TEXT NOT NULL,
  purchase_order_id TEXT NOT NULL,
  warehouse_id      TEXT NOT NULL,
  branch_id         TEXT,
  supplier_id       TEXT,
  supplier_name     TEXT,
  -- The vendor's own delivery-note / invoice number, free text.
  supplier_document TEXT,
  total_amount      INTEGER NOT NULL DEFAULT 0,
  notes             TEXT,
  received_by       TEXT,
  received_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS goods_receipt_items (
  id                     TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  goods_receipt_id       TEXT NOT NULL,
  purchase_order_item_id TEXT NOT NULL,
  product_id             TEXT NOT NULL,
  -- In `unit_name`, the same unit the PO line was ordered in.
  quantity               REAL NOT NULL DEFAULT 0,
  unit_name              TEXT,
  conversion_factor      REAL NOT NULL DEFAULT 1,
  -- Price actually paid on this delivery; may differ from the PO line.
  unit_cost              INTEGER NOT NULL DEFAULT 0,
  subtotal               INTEGER NOT NULL DEFAULT 0,
  batch_id               TEXT,
  batch_number           TEXT,
  expiry_date            TEXT
);

-- 5. Indexes ---------------------------------------------------------------

CREATE INDEX        IF NOT EXISTS idx_po_status_date    ON purchase_orders(status, created_at);
CREATE INDEX        IF NOT EXISTS idx_po_supplier       ON purchase_orders(supplier_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_grn_number        ON goods_receipts(grn_number);
CREATE INDEX        IF NOT EXISTS idx_grn_po            ON goods_receipts(purchase_order_id);
CREATE INDEX        IF NOT EXISTS idx_grn_warehouse     ON goods_receipts(warehouse_id, received_at);
CREATE INDEX        IF NOT EXISTS idx_grn_items_grn     ON goods_receipt_items(goods_receipt_id);
CREATE INDEX        IF NOT EXISTS idx_grn_items_poitem  ON goods_receipt_items(purchase_order_item_id);
CREATE INDEX        IF NOT EXISTS idx_batches_po        ON product_batches(purchase_order_id);
CREATE INDEX        IF NOT EXISTS idx_expenses_po       ON expenses(purchase_order_id);

-- 6. Backfill existing rows ------------------------------------------------

-- `ordered` is retired: approving a PO *is* committing to the vendor. There is
-- no delivery channel in the app that could distinguish the two.
UPDATE purchase_orders SET status = 'approved' WHERE status = 'ordered';

-- Orders the old code marked received really did arrive in full.
UPDATE purchase_order_items
   SET quantity_received = quantity
 WHERE purchase_order_id IN (SELECT id FROM purchase_orders WHERE status = 'received');

UPDATE purchase_orders
   SET payment_terms_days = COALESCE(
         (SELECT s.payment_terms_days FROM suppliers s WHERE s.id = purchase_orders.supplier_id),
         30);

-- Old receipts used `batch_number = po_number` as the only link.
UPDATE product_batches
   SET purchase_order_id = (
         SELECT po.id FROM purchase_orders po WHERE po.po_number = product_batches.batch_number)
 WHERE purchase_order_id IS NULL AND batch_number IS NOT NULL;

-- Old bills used the description string as the only link.
UPDATE expenses
   SET purchase_order_id = (
         SELECT po.id FROM purchase_orders po
          WHERE expenses.description LIKE 'Pembelian stok ' || po.po_number || '%')
 WHERE purchase_order_id IS NULL AND category = 'Pembelian Stok';

UPDATE purchase_orders
   SET updated_at = created_at
 WHERE updated_at IS NULL;
```

Every statement is idempotent or guarded by `IS NULL`, so re-running the file by
hand is harmless.

### 3.3 `db/schema/tenant.sql` (virgin databases)

`scripts/apply-schema-all.mjs` skips the migrations entirely when a database is
at version 0 (`if (version > 0)`), so **`tenant.sql` must remain the full
superset**. Add to it:

- the six new `purchase_orders` columns, the two `purchase_order_items`
  columns, the three `product_batches` columns and the two `expenses` columns,
  inlined into the existing `CREATE TABLE` statements at the same position;
- `goods_receipts` and `goods_receipt_items` verbatim, placed directly after
  `purchase_order_items`;
- the five new indexes;
- the deprecation note on `payables` (`tenant.sql` L357–358 currently claims
  receiving writes a row there — it does not);
- `INSERT OR IGNORE INTO schema_version (id, version) VALUES (1, 4);` → `5`.

And bump `CURRENT_SCHEMA_VERSION = 4` → `5` in `scripts/apply-schema-all.mjs`
(its comment already says to bump it together with `tenant.sql`).

---

## 4. State machine

Lives as pure functions in `src/lib/procurement.ts`, mirroring the shape of
`BRANCH_ORDER_STATUSES` / `actionsForStatus` / `nextStatuses` in
`src/lib/branch-orders.ts`.

```
  draft ──submit──▶ submitted ──approve──▶ approved ──receive──▶ partially_received
    │                   │                    │                          │
    │                   │                    │                          └──receive──▶ received
    │                   └──reject──▶ rejected│
    └──cancel───────────┴──cancel──────┴──cancel──▶ cancelled

  cancelled / rejected are terminal.   cancel requires SUM(quantity_received) = 0.
```

| # | From | Action | To | Permission | Guards | Side effects |
|---|---|---|---|---|---|---|
| 1 | `draft` | `submit` | `submitted` | `create_po` | ≥1 line, supplier set, warehouse `active` | `submitted_by/at` |
| 2 | `submitted` | `approve` | `approved` | `approve_po` | creator ≠ approver **unless** creator is `tenant_owner`/`platform_owner` | `approved_by/at` |
| 3 | `submitted` | `reject` | `rejected` | `approve_po` | reason required | `rejected_by/at`, `rejection_reason` |
| 4 | `approved`, `partially_received` | `receive` | `partially_received` \| `received` | `receive_po` | §6.4 | receipt + batches + bill, then status recomputed |
| 5 | `draft`, `submitted`, `approved` | `cancel` | `cancelled` | `cancel_po` | `SUM(quantity_received) = 0` | `cancelled_by/at`, `cancel_reason`; no ledger effect (§6.5) |
| 6 | `draft` | `edit` | `draft` | `create_po` | — | replaces lines |
| 7 | `draft` | `delete` | — | `create_po` | never submitted | hard delete PO + lines |

`rejected` and `cancelled` are terminal. A rejected PO is **not** editable —
copy it into a new draft (`action = "duplicate"`, `create_po`).

`partially_received` reverts to nothing; there is no "reverse a receipt"
transition (see §15: returns to vendor).

> **Retired:** `ordered`. Migration 005 rewrites it to `approved`. The status
> enum in code becomes exactly:
> `draft | submitted | approved | partially_received | received | rejected | cancelled`.

---

## 5. Document numbering

One helper in `src/lib/procurement.ts`:

```ts
/** `PO-20261030-0001` / `GRN-20261030-0001`, sequence per day, per document type. */
export async function nextDocumentNumber(
  tx: Transaction, prefix: "PO" | "GRN", table: string, column: string
): Promise<string>
```

- Format `PREFIX-YYYYMMDD-NNNN`, `NNNN` zero-padded from `0001`.
- The sequence is the count of existing rows whose value starts with the same
  `PREFIX-YYYYMMDD-`, computed **inside the write transaction**, then retried
  once on a `UNIQUE` violation (the `idx_po_number` / `idx_grn_number` indexes
  are the real arbiter).
- Generated in the transaction, never in the modal. Today
  `PurchaseOrderModal.generatePONumber()` runs before the write, so any retry
  silently produces a second number.
- Legacy `PO/2026/0015` rows keep their numbers. The `LIKE 'PO-YYYYMMDD-%'`
  filter cannot collide with them. The list screen must not parse the number
  for sorting or grouping — it sorts on `created_at`.

---

## 6. Screens

### 6.1 PO list — `/backoffice/inventory/po` (replaces the placeholder card)

`Inventory.tsx` `TabsContent value="po"` currently renders one icon and one
button (L1461–1471). It becomes `<PurchaseOrderPanel />`.

**Filters:** status (multi, default = open = `submitted, approved,
partially_received`), vendor, date range (reuse `src/lib/date-range.ts`),
free-text on `po_number` / `supplier_name`.

**Columns:** No · Vendor · Tanggal · Diharapkan · Tujuan (warehouse label via
`warehouseLabel`) · Nilai PO · Diterima (value of `SUM(goods_receipts.total_amount)`)
· Status chip · Aksi.

**Sort:** `created_at DESC`. **Paging:** `PAGE_SIZE = 20`, matching the
convention already used on the products table.

**Row actions** come from `transitionsFor(status, permissions)`:

| Status | Buttons |
|---|---|
| `draft` | Edit · Submit · Hapus |
| `submitted` | Setujui · Tolak |
| `approved` | Terima Barang · Batalkan |
| `partially_received` | Terima Barang |
| `received` | Lihat · Cetak |
| `rejected` / `cancelled` | Lihat · Duplikat |

A KPI strip above the table: *PO terbuka*, *Menunggu persetujuan*, *Terlambat*
(`expected_date < today AND status IN ('approved','partially_received')`),
*Nilai pembelian bulan ini*. The overdue count is what makes `expected_date`
finally useful — it is captured today and read by nothing.

### 6.2 PO editor — `PurchaseOrderModal.tsx` (rewritten as draft-only)

Kept as a modal, but it now only ever creates or edits a **draft**.

Fixes specified here, all currently present:

| # | Change |
|---|---|
| 1 | Quantity uses `Number()`, not `parseInt` — allows `0,5` kg. Reject `<= 0` and `> 3` decimals. |
| 2 | `onSubmit` becomes `(po) => Promise<void>`; the modal `await`s it, closes and toasts **only** on resolve. Remove the modal's own `toast.success("Purchase Order berhasil dibuat")` — the caller owns the toast. |
| 3 | Delete `generatePONumber()`; the number comes back from the write. |
| 4 | Two buttons: **Simpan Draf** and **Simpan & Ajukan**. |
| 5 | Warehouse select uses `ACTIVE_WAREHOUSES_SQL` (§6.7). |
| 6 | `handleAutoFillLowStock`: unit = the product's factor-1 unit from `product_units` (fallback `"Pcs"`), cost = `vendor_products.last_cost` for the **selected vendor** (fallback `products.cost_price`). Today it hardcodes `Pcs`/1 and `product.cost`. |
| 7 | Default the destination to the tenant's supply warehouse (`resolveSupplyWarehouse(user.assigned_branch_id)`), not the first row. |
| 8 | If the chosen warehouse has `type='store'`, show an inline note: *"Penerimaan langsung ke rak — stok tidak melewati gudang."* Not a blocker (§14, D2). |

### 6.3 Approval

No new screen. The list inline-approves; the detail sheet is where Reject asks
for `rejection_reason` (required, non-empty).

Rules: the approver must hold `approve_po`; a `tenant_owner`/`platform_owner`
may approve their own draft, anyone else may not. An empty approval queue is the
normal state for a one-person shop.

### 6.4 Goods receipt — `GoodsReceiptModal.tsx`

Opened from `approved` / `partially_received`. Header: PO number, vendor,
destination warehouse (read-only), *No. dokumen vendor*, *Tanggal terima*
(default `now()`, not editable), *Catatan*.

Per line, one row per PO line:

| Read-only | Editable |
|---|---|
| Produk · Dipesan · Sudah diterima · Sisa | **Terima sekarang** (default = sisa) · **Harga satuan** (default = PO price) · **No. batch** (default = GRN number) · **Kedaluwarsa** |

Guards, evaluated in the handler and re-evaluated inside the transaction:

1. At least one line with `terima > 0`.
2. `0 ≤ terima ≤ sisa`. Over-receipt is blocked (`"Terima kelebihan sebagai PO
   baru"`) — see §14, D7.
3. `expiry_date` is **required** when the tenant's
   `inventory.stock_issue_method = 'fefo'` (`getStockIssueMethod()`), because a
   batch with `expiry_date = NULL` silently corrupts FEFO picking order. For
   FIFO/LIFO it is optional.
4. Destination warehouse must still be `status='active'`.
5. `expiry_date`, when present, must be `> received_on`.

Write, inside **one** `runTransaction` (new module `src/lib/goods-receipt.ts`,
`receivePurchaseOrder(tx, params)`):

```sql
-- a. header
INSERT INTO goods_receipts (grn_number, purchase_order_id, warehouse_id, branch_id,
  supplier_id, supplier_name, supplier_document, total_amount, notes, received_by, received_at)
VALUES (…);

-- b. per line
INSERT INTO goods_receipt_items (goods_receipt_id, purchase_order_item_id, product_id,
  quantity, unit_name, conversion_factor, unit_cost, subtotal, batch_id, batch_number, expiry_date)
VALUES (…);

-- c. stock — same arithmetic as today, so the ledger stays consistent
INSERT INTO product_batches (warehouse_id, product_id, batch_number, expiry_date,
  quantity_initial, quantity_current, cost_price, received_at, supplier_id,
  purchase_order_id, goods_receipt_id)
VALUES (po.warehouse_id, …, qty * conversion_factor, qty * conversion_factor,
        unit_cost / conversion_factor, …, po.supplier_id, po.id, grn.id);

-- d. received quantity
UPDATE purchase_order_items SET quantity_received = quantity_received + $qty WHERE id = $item;

-- e. vendor catalogue — last_cost only
INSERT INTO vendor_products (vendor_id, product_id, last_cost, lead_time_days, min_order_qty)
VALUES ($vendor, $product, $baseCost, $leadTime, 1)
ON CONFLICT (vendor_id, product_id) DO UPDATE SET last_cost = excluded.last_cost;

-- f. status, computed in JS from the re-read lines
UPDATE purchase_orders SET status = $status,
  received_at = CASE WHEN $status = 'received'
                     THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE received_at END,
  updated_at  = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id = $poId;
```

Two deliberate departures from today's `handlePO`:

- **`lead_time_days` is no longer overwritten.** The current upsert sets
  `lead_time_days = excluded.lead_time_days` from the vendor master, silently
  resetting any per-product lead time on every receipt. The receipt has no
  opinion about lead time.
- **A price entered on the receipt does not rewrite the PO line.** The PO keeps
  the agreed price; the batch and the bill record what was actually paid.

### 6.5 Cancel

`draft` / `submitted` / `approved` with `quantity_received = 0` → `cancelled`
plus a required reason. Nothing has hit the ledger, so only status columns move.

`cancelled` must also clear any bill already booked for that PO — but a bill is
only ever written by a receipt, and a receipt sets `quantity_received > 0`,
which blocks cancellation. The two rules cannot meet. If a bill exists anyway
(corrupt state), blocking with an explicit error is the correct answer: never
delete an `expenses` row that has `amount_paid > 0` or a `vendor_payments` row.

### 6.6 Vendor detail (`src/pages/vendors/VendorDetail.tsx`)

`PO_LIST_SQL` (L167) keeps working. Add `partially_received` and `rejected` to
the status label map, and make each row navigate to the PO detail sheet. Title
the column *Nilai diterima* from `goods_receipts` instead of `total_amount` for
anything not yet fully received.

### 6.7 Warehouse pickers

`WAREHOUSES_SQL` stays unfiltered on purpose: the Warehouses admin page needs
the inactive rows, and every label lookup needs them too — a historical PO may
point at a location that has since been deactivated, and `warehouseLabel()`
must still resolve it. Note that it has **no `status` filter at all** today, so
an inactive warehouse is currently selectable as a PO destination.

Add one pure helper to `src/lib/warehouse.ts`:

```ts
/** Pickers only: receiving into a deactivated location must be impossible. */
export function activeWarehouses(list: WarehouseOption[]): WarehouseOption[] {
  return list.filter((warehouse) => warehouse.status === "active");
}
```

`Inventory.tsx` already loads the full list once and passes it down as a prop.
Feed `activeWarehouses(warehouses)` to `PurchaseOrderModal`,
`GoodsReceiptModal` and `StockTransferModal`; keep the unfiltered array for the
per-warehouse stock columns and for label resolution. No extra query, one
place where the rule lives.

---

## 7. Accounting integration

**One bill per receipt**, not per PO.

| Field | Value |
|---|---|
| `category` | `'Pembelian Stok'` (unchanged, so existing reports keep working) |
| `amount` | `SUM(goods_receipt_items.subtotal)` |
| `branch_id` | `purchase_orders.branch_id` |
| `supplier_id` | `purchase_orders.supplier_id` |
| `purchase_order_id` | the PO |
| `goods_receipt_id` | this receipt |
| `date` | `received_at::date` (the liability date — today it is `date('now')` at PO creation, which is wrong for a PO raised in March and delivered in April) |
| `due_date` | `date + purchase_orders.payment_terms_days` via `dueDateFromTerms()` |
| `status` / `amount_paid` | `'paid'` / `amount` when terms = 0, else `'unpaid'` / `0` |
| `description` | `'Pembelian stok <grn_number> (PO <po_number>) - <vendor>'` — human-readable only, no longer the join |

`payment_terms_days` is **snapshotted onto the PO** at creation from
`suppliers.payment_terms_days`. Changing the vendor's terms later must not
retroactively move existing bills.

Cash purchases (terms 0) are the one behaviour change worth calling out: today
they produce an `unpaid` bill with `due_date = today` that sits in AP until
someone pays it manually. After this change they post as `paid` immediately,
which is what a cash purchase is.

`vendor_payments.purchase_order_id` becomes fillable once `expenses` carries
the link — `ApAr.tsx` L313–316 can copy `expenses.purchase_order_id` into the
insert it already performs. Cheap, and it makes the column stop being
seed-only.

---

## 8. Permissions

`src/config/roles.ts`:

```ts
inventory: [
  "view_inventory", "add_stock", "transfer_stock", "stock_opname",
  "request_stock", "approve_stock_request", "dispatch_stock",
  "create_po", "approve_po", "receive_po", "cancel_po",   // new
],
```

Labels: `create_po` "Buat Purchase Order", `approve_po` "Setujui Purchase
Order", `receive_po` "Terima Barang Datang", `cancel_po` "Batalkan Purchase
Order".

New role `purchasing`:

```ts
{ value: "purchasing", label: "Purchasing", description: "Bagian pembelian" }
```

Defaults:

| Permission | owner / admin / platform | store_manager | warehouse | purchasing |
|---|---|---|---|---|
| `create_po` | ✅ | ✅ | ❌ | ✅ |
| `approve_po` | ✅ | ❌ | ❌ | ❌ |
| `receive_po` | ✅ | ✅ | ✅ | ✅ |
| `cancel_po` | ✅ | ✅ (own drafts) | ❌ | ✅ |

`store_manager` keeps `create_po` because in a single-shop tenant the owner
*is* the store manager; separation is preserved by `approve_po`, not by
removing `create_po`. `warehouse` gains `receive_po` — the people who unload
the truck currently cannot open the PO screen at all, while the person who
cannot see the truck can receive it alone.

`src/App.tsx`: add a role list for the procurement routes.

```ts
const PROCUREMENT: UserRole[] = [...MANAGERS, "warehouse", "purchasing"];
```

use it for `/backoffice/inventory/po` (currently `BACK_OFFICE`).

### Enforcement

Permissions are configured today (`EmployeeRoleSettings` writes
`tenants.settings.role_permissions`) and **enforced nowhere** — `Buat PO Baru`
has no guard. New:

- `src/hooks/use-permissions.ts` — `usePermissions()` returns
  `{ can(permission), loading }`, reading `role_permissions` via
  `readTenantSetting("role_permissions", {})` with
  `DEFAULT_ROLE_PERMISSIONS[role]` as the fallback. One read per mount,
  memoised, same source the settings screen writes.
- `src/components/auth/PermissionGate.tsx` — `<PermissionGate
  permission="create_po">…</PermissionGate>` renders children only when
  granted; renders nothing while loading so a button never flickers in.

Applied to: the PO list row actions, Simpan/Simpan & Ajukan, Setujui/Tolak,
Terima Barang, Batalkan, and the "Buat PO Baru" button.

> **Known limitation, stated plainly:** this is UI-level enforcement only. The
> browser holds a full-access tenant token for `libSQL`, so a determined user
> could write to the tenant database directly. There is no RLS and no
> server-side authorisation on tenant data. That is a platform-level gap
> (§15), not something this feature can close.

---

## 9. Audit events

`logAudit` / `logAuditTx` from `src/lib/audit.ts`, `entity = "purchase_orders"`,
**`entityId = purchase_orders.id`** (today it is `po.poNumber`, which no future
"open this PO" link can resolve):

| `action` | `details` |
|---|---|
| `create_po` | poNumber, supplierId, itemsCount, totalAmount |
| `submit_po` | poNumber |
| `approve_po` | poNumber, approvedBy, createdBy |
| `reject_po` | poNumber, reason |
| `receive_po` | poNumber, grnNumber, warehouseId, linesCount, totalAmount, `stock_issue_method` |
| `cancel_po` | poNumber, reason |

`goods_receipts` gets `entity = "goods_receipts"`, `entityId = receipt.id`,
`action = "create_grn"`.

---

## 10. Files

**New**

| Path | Purpose |
|---|---|
| `db/migrations/005_procurement_lifecycle.sql` | §3.2 |
| `src/lib/procurement.ts` | pure rules: statuses, `transitionsFor`, `derivePOStatus`, `remainingQty`, `validatePO`, `nextDocumentNumber`. No SQL, no React — same division as `branch-orders.ts`. |
| `src/lib/procurement.test.ts` | unit tests, §12 |
| `src/lib/goods-receipt.ts` | `receivePurchaseOrder(tx, params)` — the single write path |
| `src/lib/goods-receipt.test.ts` | integration, §12 |
| `src/hooks/use-permissions.ts` | §8 |
| `src/components/auth/PermissionGate.tsx` | §8 |
| `src/components/inventory/PurchaseOrderPanel.tsx` | list + filters + KPI strip (§6.1) |
| `src/components/inventory/PurchaseOrderDetail.tsx` | sheet: header, lines, receipts, bills, actions |
| `src/components/inventory/GoodsReceiptModal.tsx` | §6.4 |

**Modified**

| Path | Change |
|---|---|
| `db/schema/tenant.sql` | new columns/tables/indexes, `payables` deprecation note, version 5 |
| `scripts/apply-schema-all.mjs` | `CURRENT_SCHEMA_VERSION = 5` |
| `src/pages/Inventory.tsx` | PO tab renders `PurchaseOrderPanel`; delete `handlePO` (starts ~L885); pass `activeWarehouses(warehouses)` to the three modals |
| `src/components/inventory/PurchaseOrderModal.tsx` | draft-only, §6.2 |
| `src/lib/warehouse.ts` | `activeWarehouses()` helper (§6.7) |
| `src/config/roles.ts` | permissions + `purchasing` role |
| `src/App.tsx` | `PROCUREMENT` role list on `/backoffice/inventory/po` |
| `src/pages/vendors/VendorDetail.tsx` | status labels, received value, row navigation |
| `src/pages/finance/ApAr.tsx` | read `expenses.purchase_order_id`; set `vendor_payments.purchase_order_id` |
| `src/lib/db/__tests__/schema.test.ts` | expected table list (+2), and the existing PO/payables assertions |
| `docs/fitur-tenant.md` | one changelog block |

`EmployeeRoleSettings.tsx` needs no change — it renders `PERMISSION_GROUPS`.

---

## 11. Rollout

Four phases, each independently shippable and non-breaking.

**Phase 1 — schema + write path, no UI change visible yet.**
Migration 005, `procurement.ts`, `goods-receipt.ts`, `nextDocumentNumber`.
`handlePO` keeps working but is re-pointed to `receivePurchaseOrder` so the
new columns get populated. Verify the cloud tenant still functions.

**Phase 2 — split the UI.** PO editor becomes draft-only; approval actions and
`GoodsReceiptModal` ship; `handlePO` and the placeholder card are deleted.
This is the phase where the behaviour the user asked about changes.

**Phase 3 — list, detail, permissions.** `PurchaseOrderPanel`,
`PurchaseOrderDetail`, `usePermissions`, `PermissionGate`, `purchasing` role,
route list.

**Phase 4 — finance wiring.** `ApAr` reads the FK, `vendor_payments` gets its
PO, `VendorDetail` shows received value, `docs/fitur-tenant.md`.

`scripts/apply-schema-all.mjs` is a **manual** step (`--apply`), run once per
tenant. It is never triggered by a build. Demo seed (`server/demo/seed.ts`) is
updated in the same commit as Phase 2 so a freshly seeded tenant has draft,
submitted, approved, partially_received and received examples instead of the
three unreachable legacy states.

---

## 12. Test plan

**Unit — `src/lib/procurement.test.ts`** (pure, no DB)

- `transitionsFor()` returns exactly the §4 row for each (status, permission)
  pair, and `[]` for `rejected` / `cancelled`.
- `remainingQty()` across 0 / partial / full receipt, and never negative.
- `derivePOStatus()`: no receipt → `approved`; some → `partially_received`;
  all → `received`; and the rounding edge `Σreceived === Σordered` with 0.1
  decimals.
- Self-approval: owner allowed, `tenant_admin` blocked.
- Over-receipt rejected; equal-to-remaining accepted.
- `nextDocumentNumber()` formatting and day rollover.

**Integration — `src/lib/goods-receipt.test.ts`**
(`@libsql/client` in-memory + `db/schema/tenant.sql`, following the pattern in
`src/lib/db/__tests__/schema.test.ts`)

- Full receipt writes 1 receipt, N items, N batches with correct
  `cost_price = unit_cost / conversion_factor`, `expiry_date`, and
  `purchase_order_id`.
- Two partial receipts: status walks `approved → partially_received →
  received`, `quantity_received` accumulates, two `expenses` rows exist with
  the two receipt dates.
- Rollback: a throw mid-loop leaves zero receipts, zero batches, zero bills,
  `quantity_received` unchanged. This is the regression that matters most.
- Terms 0 → bill `status='paid'`, `amount_paid = amount`.
- FEFO + empty expiry → throws.
- Migration 005 re-run on a v4-shaped fixture: no error, `ordered` → `approved`,
  `batch_number` backfilled to `purchase_order_id`.

**Manual acceptance (browser, on the demo tenant)** — the exact scenario the
user asked about:

1. `purchasing` user creates a PO for Rak Toko Pusat, 10 × TPG-001 → status
   `draft`, **no stock change**, **no bill**. Assert
   `SUM(product_batches.quantity_current)` unchanged.
2. Submit → `submitted`. Approve with a different user → `approved`. Attempt
   self-approval as `tenant_admin` → blocked.
3. Receive 6 → `partially_received`, Rak Toko Pusat +6, one bill of 6 × price,
   due = today + terms.
4. Receive 4 → `received`, +4, second bill. `remainingQty = 0`.
5. Attempt to receive 1 more → blocked.
6. Batalkan on a `partially_received` PO → blocked with an explanatory error.
7. Cancel a fresh `approved` PO → `cancelled`, no stock, no bill.
8. Warehouse role: 404 on the finance routes, can open `/po`, sees only
   *Terima Barang*, cannot create.

---

## 13. Acceptance criteria

- [ ] Creating a PO changes no `product_batches`, no `expenses`, no `payables` row.
- [ ] `purchase_orders.received_at` is NULL until the first receipt.
- [ ] One PO can hold ≥2 `goods_receipts`; `quantity_received` equals their sum.
- [ ] Every batch from a purchase has non-null `purchase_order_id`, and
      `SELECT … FROM product_batches JOIN purchase_orders ON …` returns it.
- [ ] Every purchase bill has non-null `expenses.purchase_order_id`.
- [ ] Over-receipt, receipt into an inactive warehouse, and receipt on a
      `cancelled`/`rejected` PO are all refused with a readable message.
- [ ] Approving requires `approve_po`; a non-owner cannot approve their own PO.
- [ ] FEFO tenants cannot receive a line without an expiry date.
- [ ] `quantity` accepts `0.5`.
- [ ] No double toast; a failed write shows one error and leaves the form open
      with its values intact.
- [ ] `payables` still has 0 rows and nothing reads it.
- [ ] POS, opname, transfer, AP/AR, cashflow and journal output are unchanged
      for a receipt, compared against the current build.
- [ ] `npx tsc --noEmit -p tsconfig.app.json` clean; `npx eslint` introduces no
      new findings (the pre-existing `EmployeeReports.tsx` `Unexpected any` is
      out of scope).

---

## 14. Decisions, and what was rejected

| # | Decision | Rejected alternative, and why |
|---|---|---|
| D1 | Four documents: PO, approval on the PO, `goods_receipts`, bill per receipt | *Single-step create+receive kept, with a "received" flag only.* Cannot express partial, short or late delivery — the exact gap that prompted this spec. |
| D2 | Any **active** warehouse may be a receiving destination, rack included; a rack choice shows an inline warning | *Block `type='store'` outright.* `resolveSupplyWarehouse` documents single-warehouse tenants whose only location is also their supplier; blocking would make `/po` unusable for them. |
| D3 | Bill per receipt, not per PO | *One bill for the whole PO at first receipt.* Overstates the liability on a partial delivery and gives every later delivery the wrong due date. |
| D4 | `ordered` retired, folded into `approved` | *Keep both.* Nothing in the app can distinguish "approved internally" from "sent to vendor" — there is no email, portal or EDI. Two states with no distinguishing action is two states that drift. |
| D5 | `expenses` stays the AP source of truth; `payables` deprecated | *Start writing `payables` as designed.* `ApAr`, `Expenses`, `Cashflow` and `Journal` all read `expenses`; switching sources is a finance-module change with its own risk, unrelated to procurement. Adding `expenses.purchase_order_id` gets the same join for a fraction of the blast radius. |
| D6 | Receipt price is editable and does not rewrite the PO line | *Lock the receipt to the PO price.* Invoices differ from quotes constantly; the batch ledger must record what was actually paid. Keeping the PO line intact preserves what was agreed. |
| D7 | Over-receipt blocked | *Allow with a warning.* Silently inflates the order value and the liability, and destroys the meaning of `quantity_received ≤ quantity`. |
| D8 | `expiry_date` required only when FEFO is active | *Always required.* Blocks FIFO/LIFO tenants who do not track expiry at all (box kue, plastik). |
| D9 | `store_manager` keeps `create_po`; separation is enforced on `approve_po` | *Remove `create_po` from `store_manager`.* Breaks every single-shop tenant, where the owner is the store manager and would then be unable to buy anything. |
| D10 | `warehouse` gains `receive_po` | *Leave the PO screen manager-only.* The person who unloads the truck is the only one who knows what arrived; forcing a manager to key it in creates a fidelity gap exactly where accuracy matters. |
| D11 | Permissions enforced in the UI only | *Wait for server-side authorisation.* The tenant token architecture has no server enforcement yet; blocking this feature on a platform change would leave procurement broken indefinitely. Limitation documented in §8. |
| D12 | Numbering generated inside the transaction, `PO-YYYYMMDD-NNNN` | *Keep the random 4-char suffix.* Not sortable, and generated before the write, so a retry produces a second number for one intent. |

---

## 15. Out of scope

Each is a real gap; none belongs in this change.

1. **Returns to vendor / receipt reversal.** Needed to fix a receipt entered in
   error, and to cancel a PO that has already received stock. Requires a
   stock-out path with a `reason` that the ledger already supports but nothing
   calls for purchases.
2. **PO amendment after approval.** Changing qty or price on an `approved` PO
   needs versioning (`po_revisions`) so the approval stays meaningful.
3. **Migrating `payables` into the AP screens** (D5 follow-up).
4. **Server-side authorisation / RLS for tenant data.** The browser token is
   full-access.
5. **Vendor-facing features**: email/PDF send, vendor portal, price lists,
   quotes, blanket orders, framework agreements.
6. **Tax (PPN) and multi-currency.** `suppliers.currency` exists and is read
   nowhere; PO amounts are integer IDR throughout.
7. **Purchase requisitions** (internal request → PO). Today the branch-side
   equivalent is `stock_requests`, which covers internal replenishment.
8. **Landed cost** (freight, duty allocated to batch cost).
9. **Reordering automation** from `min_stock_level` — the PO and the low-stock
   panel exist, the reader that turns them into draft POs does not.
