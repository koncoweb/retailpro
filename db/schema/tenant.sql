-- ---------------------------------------------------------------------------
-- RetailPro tenant database schema (libSQL / SQLite)
--
-- Applied once to every tenant database at provisioning time.
-- Conventions:
--   * ids        TEXT  (crypto.randomUUID() generated in JS; the schema-level
--                      DEFAULT is the same UUID v4 shape so legacy INSERTs
--                      that omit `id` — as `gen_random_uuid()` allowed — still work)
--   * money      INTEGER (IDR has no minor unit)
--   * quantities REAL  (may be fractional)
--   * timestamps TEXT  ISO-8601 UTC, e.g. 2026-10-27T04:12:33.120Z
--   * booleans   INTEGER 0/1
--   * json       TEXT (always JSON.parse on read)
--
-- There is no tenant_id column: every database belongs to exactly one tenant.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS schema_version (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  version    INTEGER NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Fleet drift guard: `scripts/apply-schema-all.mjs` compares this row against
-- the version it is about to apply.
INSERT OR IGNORE INTO schema_version (id, version) VALUES (1, 3);

-- Tenant profile (single row). `settings` holds role_permissions, payroll_config,
-- receipt/tax/bank settings as JSON text.
CREATE TABLE IF NOT EXISTS tenants (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  name       TEXT NOT NULL,
  slug       TEXT,
  settings   TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- A branch is a SELLING location (a channel), not a stockroom: physical store,
-- online store or both. Stock lives in `warehouses`, which are mapped to the
-- branches they serve through `branch_warehouses`.
CREATE TABLE IF NOT EXISTS branches (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  name             TEXT NOT NULL,
  code             TEXT,
  -- 'store' (fisik) | 'online' (tanpa stok fisik) | 'hybrid' (keduanya)
  type             TEXT NOT NULL DEFAULT 'store',
  -- Exactly one active head office per tenant, enforced by a partial index.
  is_headquarters INTEGER NOT NULL DEFAULT 0,
  -- Optional grouping for regional hierarchies.
  parent_branch_id TEXT,
  address          TEXT,
  phone            TEXT,
  email            TEXT,
  timezone         TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  status           TEXT NOT NULL DEFAULT 'active',
  sales_target     INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- A warehouse is a STOCKING location. `branch_id` is the branch that owns the
-- stock for reporting; NULL means a shared/company warehouse (central DC).
CREATE TABLE IF NOT EXISTS warehouses (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  name       TEXT NOT NULL,
  code       TEXT,
  -- 'central' | 'regional' | 'store' (backroom)
  type       TEXT NOT NULL DEFAULT 'store',
  branch_id  TEXT,
  address    TEXT,
  status     TEXT NOT NULL DEFAULT 'active',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Which warehouses may fulfil (sell for) which branch. One row per pair; the
-- `is_default` row is the one a till deducts from, `priority` breaks ties.
CREATE TABLE IF NOT EXISTS branch_warehouses (
  branch_id    TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  is_default   INTEGER NOT NULL DEFAULT 0,
  priority     INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (branch_id, warehouse_id)
);

-- Identity mirror of the control-plane user. `id` equals the Better Auth user id.
CREATE TABLE IF NOT EXISTS users (
  id                 TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  email              TEXT NOT NULL,
  name               TEXT,
  role               TEXT NOT NULL DEFAULT 'staff',
  assigned_branch_id TEXT,
  is_active          INTEGER NOT NULL DEFAULT 1,
  base_salary        INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Vendor master data. A vendor is the company that goods are bought from; it is
-- linked to products through `products.supplier_id` (the main vendor) and
-- `vendor_products` (vendor-specific SKU, cost, lead time and MOQ), and to
-- procurement through `purchase_orders` / `expenses`.
CREATE TABLE IF NOT EXISTS suppliers (
  id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  name                TEXT NOT NULL,
  -- Human-readable vendor code, e.g. VND-0001. Unique when present so vendors
  -- imported by name only (legacy rows) stay valid without a code.
  code                TEXT,
  legal_name          TEXT,
  -- 'supplier' | 'distributor' | 'manufacturer' | 'service' | 'other'
  category            TEXT NOT NULL DEFAULT 'supplier',
  tax_id              TEXT,
  contact_person      TEXT,
  phone               TEXT,
  email               TEXT,
  website             TEXT,
  address             TEXT,
  city                TEXT,
  province            TEXT,
  postal_code         TEXT,
  -- Payment terms in days; drives the due date of a received purchase order.
  payment_terms_days  INTEGER NOT NULL DEFAULT 30,
  credit_limit        INTEGER NOT NULL DEFAULT 0,
  currency            TEXT NOT NULL DEFAULT 'IDR',
  bank_name           TEXT,
  bank_account_number TEXT,
  bank_account_name   TEXT,
  -- Expected delivery time in days, used to pre-fill a PO expected date.
  lead_time_days      INTEGER NOT NULL DEFAULT 0,
  -- 0 = belum dinilai, 1..5 = bintang.
  rating              INTEGER NOT NULL DEFAULT 0,
  -- 'active' | 'inactive' | 'blacklisted'
  status              TEXT NOT NULL DEFAULT 'active',
  notes               TEXT,
  settings            TEXT NOT NULL DEFAULT '{}',
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT
);

CREATE TABLE IF NOT EXISTS customers (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  name        TEXT NOT NULL,
  phone       TEXT,
  email       TEXT,
  address     TEXT,
  notes       TEXT,
  preferences TEXT NOT NULL DEFAULT '{}',
  total_spent INTEGER NOT NULL DEFAULT 0,
  points      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS products (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  sku             TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  category        TEXT,
  cost_price      INTEGER NOT NULL DEFAULT 0,
  min_stock_level INTEGER NOT NULL DEFAULT 5,
  is_tracked      INTEGER NOT NULL DEFAULT 1,
  supplier_id     TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS product_units (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  product_id        TEXT NOT NULL,
  name              TEXT NOT NULL,
  conversion_factor REAL NOT NULL DEFAULT 1,
  price             INTEGER NOT NULL DEFAULT 0,
  barcode           TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Stock is tracked per received batch so cost and expiry travel with the goods.
-- Which batch leaves first is a tenant policy (FIFO / LIFO / FEFO, stored in
-- tenants.settings.inventory.stock_issue_method). The location is a warehouse:
-- a branch may own several, and a shared warehouse may serve many branches.
CREATE TABLE IF NOT EXISTS product_batches (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  warehouse_id     TEXT NOT NULL,
  product_id       TEXT NOT NULL,
  batch_number     TEXT,
  expiry_date      TEXT,
  quantity_initial REAL NOT NULL DEFAULT 0,
  quantity_current REAL NOT NULL DEFAULT 0,
  cost_price       INTEGER NOT NULL DEFAULT 0,
  received_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  supplier_id      TEXT
);

-- Vendor-specific catalogue: which products a vendor supplies, at what
-- reference cost, with that vendor's own SKU, lead time and minimum order.
-- `products.supplier_id` remains the product's main vendor; this table adds the
-- many-to-many view the procurement screen needs.
CREATE TABLE IF NOT EXISTS vendor_products (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  vendor_id       TEXT NOT NULL,
  product_id      TEXT NOT NULL,
  vendor_sku      TEXT,
  last_cost       INTEGER NOT NULL DEFAULT 0,
  lead_time_days  INTEGER NOT NULL DEFAULT 0,
  min_order_qty   REAL NOT NULL DEFAULT 1,
  is_preferred    INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS shifts (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  branch_id     TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  start_time    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  end_time      TEXT,
  initial_cash  INTEGER NOT NULL DEFAULT 0,
  final_cash    INTEGER,
  expected_cash INTEGER,
  difference    INTEGER,
  notes         TEXT,
  status        TEXT NOT NULL DEFAULT 'open',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  branch_id      TEXT NOT NULL,
  cashier_id     TEXT,
  customer_id    TEXT,
  shift_id       TEXT,
  invoice_number TEXT NOT NULL,
  total_amount   INTEGER NOT NULL DEFAULT 0,
  amount_paid    INTEGER NOT NULL DEFAULT 0,
  due_date       TEXT,
  payment_method TEXT,
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'completed',
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS transaction_items (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  transaction_id    TEXT NOT NULL,
  product_id        TEXT NOT NULL,
  batch_id          TEXT,
  quantity          REAL NOT NULL DEFAULT 0,
  unit_name         TEXT,
  conversion_factor REAL NOT NULL DEFAULT 1,
  unit_price        INTEGER NOT NULL DEFAULT 0,
  cost_price        INTEGER NOT NULL DEFAULT 0,
  subtotal          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stock_transfers (
  id                        TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  reference_number          TEXT NOT NULL,
  source_warehouse_id       TEXT NOT NULL,
  destination_warehouse_id  TEXT NOT NULL,
  status                    TEXT NOT NULL DEFAULT 'pending',
  notes                     TEXT,
  requested_by              TEXT,
  approved_by               TEXT,
  received_by               TEXT,
  sent_at                   TEXT,
  received_at               TEXT,
  created_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS transfer_items (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  transfer_id       TEXT NOT NULL,
  product_id        TEXT NOT NULL,
  source_batch_id   TEXT,
  quantity_sent     REAL NOT NULL DEFAULT 0,
  quantity_received REAL,
  unit_name         TEXT,
  conversion_factor REAL NOT NULL DEFAULT 1,
  cost_price        INTEGER NOT NULL DEFAULT 0,
  notes             TEXT
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  po_number       TEXT NOT NULL,
  supplier_id     TEXT,
  supplier_name   TEXT,
  branch_id       TEXT,
  warehouse_id    TEXT,
  status          TEXT NOT NULL DEFAULT 'draft',
  total_amount    INTEGER NOT NULL DEFAULT 0,
  notes           TEXT,
  expected_date   TEXT,
  received_at     TEXT,
  created_by      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  purchase_order_id TEXT NOT NULL,
  product_id        TEXT NOT NULL,
  quantity          REAL NOT NULL DEFAULT 0,
  unit_name         TEXT,
  conversion_factor INTEGER NOT NULL DEFAULT 1,
  unit_cost         INTEGER NOT NULL DEFAULT 0,
  subtotal          INTEGER NOT NULL DEFAULT 0
);

-- What the company owes a supplier. Receiving a purchase order writes one row
-- here, so stock arriving is a liability rather than a silent asset increase.
CREATE TABLE IF NOT EXISTS payables (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  supplier_id       TEXT,
  supplier_name     TEXT,
  branch_id         TEXT,
  purchase_order_id TEXT,
  amount            INTEGER NOT NULL DEFAULT 0,
  amount_paid       INTEGER NOT NULL DEFAULT 0,
  due_date          TEXT,
  status            TEXT NOT NULL DEFAULT 'unpaid',
  description       TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS expenses (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  branch_id   TEXT,
  category    TEXT NOT NULL,
  amount      INTEGER NOT NULL DEFAULT 0,
  date        TEXT NOT NULL DEFAULT (date('now')),
  due_date    TEXT,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'paid',
  amount_paid INTEGER NOT NULL DEFAULT 0,
  supplier_id TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Payment ledger for vendor debt. `expenses.amount_paid` stays the running
-- balance that AP reads; this table records each instalment (date, method,
-- reference) so a vendor statement is reconstructable.
CREATE TABLE IF NOT EXISTS vendor_payments (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  vendor_id         TEXT NOT NULL,
  expense_id        TEXT,
  purchase_order_id TEXT,
  amount            INTEGER NOT NULL DEFAULT 0,
  payment_date      TEXT NOT NULL DEFAULT (date('now')),
  -- 'cash' | 'transfer' | 'check' | 'other'
  method            TEXT NOT NULL DEFAULT 'transfer',
  reference_number  TEXT,
  notes             TEXT,
  created_by        TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS attendance (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  employee_id TEXT NOT NULL,
  date        TEXT NOT NULL,
  check_in    TEXT,
  check_out   TEXT,
  status      TEXT NOT NULL DEFAULT 'present',
  overtime    INTEGER NOT NULL DEFAULT 0,
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS leaves (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  employee_id TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'annual',
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  reason      TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Referenced by Reports.tsx:251. Kept as its own table so that report keeps working.
CREATE TABLE IF NOT EXISTS employees (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  name       TEXT NOT NULL,
  email      TEXT,
  role       TEXT,
  branch_id  TEXT,
  status     TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  user_id    TEXT,
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  TEXT,
  details    TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ---------------------------------------------------------------------------
-- Indexes (the Postgres schema had none; hot paths are batch lookups by
-- product+warehouse, branch/date report filters and product search)
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email          ON users(email);
CREATE INDEX        IF NOT EXISTS idx_users_branch         ON users(assigned_branch_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_name        ON branches(name);
-- Only one head office may exist; SQLite partial indexes make that a DB rule.
CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_hq          ON branches(is_headquarters) WHERE is_headquarters = 1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouses_name      ON warehouses(name);
CREATE INDEX        IF NOT EXISTS idx_warehouses_branch    ON warehouses(branch_id);
CREATE INDEX        IF NOT EXISTS idx_wh_branches_wh       ON branch_warehouses(warehouse_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_name      ON categories(name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_name       ON suppliers(name);
-- Partial: legacy vendors created from a product form have no code yet.
CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_code       ON suppliers(code) WHERE code IS NOT NULL;
CREATE INDEX        IF NOT EXISTS idx_suppliers_status     ON suppliers(status);
CREATE INDEX        IF NOT EXISTS idx_suppliers_category   ON suppliers(category);
CREATE INDEX        IF NOT EXISTS idx_customers_phone      ON customers(phone);

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku         ON products(sku);
CREATE INDEX        IF NOT EXISTS idx_products_category    ON products(category);
CREATE INDEX        IF NOT EXISTS idx_products_supplier    ON products(supplier_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_units_prod_factor    ON product_units(product_id, conversion_factor);
CREATE INDEX        IF NOT EXISTS idx_units_product        ON product_units(product_id);
CREATE INDEX        IF NOT EXISTS idx_units_barcode        ON product_units(barcode);
CREATE INDEX        IF NOT EXISTS idx_batches_prod_wh      ON product_batches(product_id, warehouse_id, received_at);
CREATE INDEX        IF NOT EXISTS idx_batches_wh           ON product_batches(warehouse_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_invoice           ON transactions(invoice_number);
CREATE INDEX        IF NOT EXISTS idx_tx_branch_created    ON transactions(branch_id, created_at);
CREATE INDEX        IF NOT EXISTS idx_tx_created           ON transactions(created_at);
CREATE INDEX        IF NOT EXISTS idx_tx_cashier           ON transactions(cashier_id);
CREATE INDEX        IF NOT EXISTS idx_tx_shift             ON transactions(shift_id);
CREATE INDEX        IF NOT EXISTS idx_items_tx             ON transaction_items(transaction_id);
CREATE INDEX        IF NOT EXISTS idx_items_product        ON transaction_items(product_id);

CREATE INDEX        IF NOT EXISTS idx_shifts_branch        ON shifts(branch_id, status);
CREATE INDEX        IF NOT EXISTS idx_shifts_user          ON shifts(user_id, status);
CREATE INDEX        IF NOT EXISTS idx_transfers_status     ON stock_transfers(status, created_at);
CREATE INDEX        IF NOT EXISTS idx_transfers_source     ON stock_transfers(source_warehouse_id);
CREATE INDEX        IF NOT EXISTS idx_transfers_dest       ON stock_transfers(destination_warehouse_id);
CREATE INDEX        IF NOT EXISTS idx_transfer_items_trf   ON transfer_items(transfer_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_po_number            ON purchase_orders(po_number);
CREATE INDEX        IF NOT EXISTS idx_po_status            ON purchase_orders(status, created_at);
CREATE INDEX        IF NOT EXISTS idx_po_warehouse         ON purchase_orders(warehouse_id);
CREATE INDEX        IF NOT EXISTS idx_po_items_po          ON purchase_order_items(purchase_order_id);
CREATE INDEX        IF NOT EXISTS idx_payables_status      ON payables(status, due_date);
CREATE INDEX        IF NOT EXISTS idx_payables_supplier    ON payables(supplier_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_products_pair ON vendor_products(vendor_id, product_id);
CREATE INDEX        IF NOT EXISTS idx_vendor_products_prod ON vendor_products(product_id);
CREATE INDEX        IF NOT EXISTS idx_vendor_payments_vnd  ON vendor_payments(vendor_id, payment_date);
CREATE INDEX        IF NOT EXISTS idx_vendor_payments_exp  ON vendor_payments(expense_id);


CREATE INDEX        IF NOT EXISTS idx_expenses_date        ON expenses(date);
CREATE INDEX        IF NOT EXISTS idx_expenses_category    ON expenses(category);
CREATE INDEX        IF NOT EXISTS idx_expenses_branch      ON expenses(branch_id);
CREATE INDEX        IF NOT EXISTS idx_attendance_emp_date  ON attendance(employee_id, date);
CREATE INDEX        IF NOT EXISTS idx_leaves_emp           ON leaves(employee_id, start_date);
CREATE INDEX        IF NOT EXISTS idx_audit_created        ON audit_logs(created_at);
