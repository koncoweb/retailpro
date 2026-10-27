-- ---------------------------------------------------------------------------
-- RetailPro control-plane database (libSQL / SQLite)
--
-- Holds Better Auth identity (user / session / account / verification) and the
-- tenant -> database registry. It never holds business data.
--
-- Column list, nullability and uniqueness were generated from Better Auth
-- 1.7.14 itself (`getSchema()` from 'better-auth/db' with the exact config used
-- in server/auth.ts), so the adapter and these tables cannot drift.
--
-- Date columns are TEXT: the Kysely adapter runs with `supportsDates: false`
-- on sqlite and stores `new Date().toISOString()`.
-- Boolean columns are INTEGER 0/1 (`supportsBooleans: false`).
-- ---------------------------------------------------------------------------

-- --- Better Auth core ------------------------------------------------------

CREATE TABLE IF NOT EXISTS user (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image         TEXT,
  createdAt     TEXT NOT NULL,
  updatedAt     TEXT NOT NULL,
  -- admin plugin
  role          TEXT NOT NULL DEFAULT 'staff',
  banned        INTEGER NOT NULL DEFAULT 0,
  banReason     TEXT,
  banExpires    TEXT,
  -- RetailPro additional fields (read by use-auth.ts, POSShifts.tsx, ...)
  tenantId      TEXT,
  branchId      TEXT,
  status        TEXT NOT NULL DEFAULT 'active'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_email       ON user(email);
CREATE INDEX        IF NOT EXISTS idx_user_tenant      ON user(tenantId);

CREATE TABLE IF NOT EXISTS session (
  id             TEXT PRIMARY KEY,
  expiresAt      TEXT NOT NULL,
  token          TEXT NOT NULL,
  createdAt      TEXT NOT NULL,
  updatedAt      TEXT NOT NULL,
  ipAddress      TEXT,
  userAgent      TEXT,
  userId         TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  impersonatedBy TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_token    ON session(token);
CREATE INDEX        IF NOT EXISTS idx_session_user     ON session(userId);

CREATE TABLE IF NOT EXISTS account (
  id                    TEXT PRIMARY KEY,
  accountId             TEXT NOT NULL,
  providerId            TEXT NOT NULL,
  userId                TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  accessToken           TEXT,
  refreshToken          TEXT,
  idToken               TEXT,
  accessTokenExpiresAt  TEXT,
  refreshTokenExpiresAt TEXT,
  scope                 TEXT,
  password              TEXT,
  createdAt             TEXT NOT NULL,
  updatedAt             TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_account_user            ON account(userId);
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_provider ON account(providerId, accountId);

CREATE TABLE IF NOT EXISTS verification (
  id         TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value      TEXT NOT NULL,
  expiresAt  TEXT NOT NULL,
  createdAt  TEXT NOT NULL,
  updatedAt  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_verification_identifier ON verification(identifier);

-- --- Tenant registry -------------------------------------------------------

-- One row per provisioned tenant database. `owner_user_id` is the Better Auth
-- user that claimed the tenant; `db_hostname` is what the browser connects to.
CREATE TABLE IF NOT EXISTS tenant_databases (
  id            TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL,
  company_name  TEXT NOT NULL,
  db_name       TEXT NOT NULL,
  db_hostname   TEXT NOT NULL,
  group_name    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_slug      ON tenant_databases(slug);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_db_name   ON tenant_databases(db_name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_owner     ON tenant_databases(owner_user_id);
CREATE INDEX        IF NOT EXISTS idx_tenant_status    ON tenant_databases(status);
