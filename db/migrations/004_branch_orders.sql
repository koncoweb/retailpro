-- ---------------------------------------------------------------------------
-- 004 — branch replenishment orders (a shop asking the warehouse for stock)
--
-- Runs once against a tenant database that is still on schema version 3.
-- `scripts/apply-schema-all.mjs` applies the file, then re-applies
-- `db/schema/tenant.sql` and stamps the new version, so only the ALTER, the two
-- new tables and their indexes live here.
--
-- Invariant after this migration:
--   * demand and movement stay separate documents: `stock_requests` records what
--     a branch wants and who approved it, `stock_transfers` records the batches
--     that actually left the gudang — linked by `stock_transfers.request_id`,
--   * a transfer can be `pending` -> `in_transit` (stock has left the source)
--     -> `completed` (the shop confirmed receipt),
--   * no existing transfer or item row is rewritten, so the upgrade is additive.
-- ---------------------------------------------------------------------------

-- 1. Link a movement back to the request that demanded it --------------------

ALTER TABLE stock_transfers ADD COLUMN request_id TEXT;

-- 2. Demand documents -------------------------------------------------------

CREATE TABLE IF NOT EXISTS stock_requests (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  request_number    TEXT NOT NULL,
  branch_id         TEXT NOT NULL,
  warehouse_id      TEXT NOT NULL,
  -- 'draft' | 'submitted' | 'approved' | 'rejected' | 'in_transit' | 'received' | 'cancelled'
  status            TEXT NOT NULL DEFAULT 'draft',
  -- 'normal' | 'urgent'
  priority          TEXT NOT NULL DEFAULT 'normal',
  -- 'branch' today; 'online' once the storefront raises its own pick lists.
  source            TEXT NOT NULL DEFAULT 'branch',
  needed_date       TEXT,
  notes             TEXT,
  rejection_reason  TEXT,
  requested_by      TEXT,
  approved_by       TEXT,
  approved_at       TEXT,
  dispatched_by     TEXT,
  dispatched_at     TEXT,
  received_by       TEXT,
  received_at       TEXT,
  transfer_id       TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS stock_request_items (
  id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  request_id          TEXT NOT NULL,
  product_id          TEXT NOT NULL,
  unit_name           TEXT,
  conversion_factor   REAL NOT NULL DEFAULT 1,
  quantity_requested  REAL NOT NULL DEFAULT 0,
  quantity_approved   REAL NOT NULL DEFAULT 0,
  quantity_dispatched REAL NOT NULL DEFAULT 0,
  quantity_received   REAL NOT NULL DEFAULT 0,
  notes               TEXT
);

-- 3. Indexes ---------------------------------------------------------------

CREATE INDEX        IF NOT EXISTS idx_transfers_request    ON stock_transfers(request_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_number      ON stock_requests(request_number);
CREATE INDEX        IF NOT EXISTS idx_requests_status      ON stock_requests(status, created_at);
CREATE INDEX        IF NOT EXISTS idx_requests_branch      ON stock_requests(branch_id, status);
CREATE INDEX        IF NOT EXISTS idx_requests_warehouse   ON stock_requests(warehouse_id, status);
CREATE INDEX        IF NOT EXISTS idx_request_items_req    ON stock_request_items(request_id);
