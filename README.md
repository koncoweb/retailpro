# RetailPro

Multi-tenant retail point-of-sale, inventory, finance and HR for Indonesian
shops. Every company gets its own Turso (libSQL) database; a single control
database holds authentication and the tenant registry.

## Stack

Vite + React + TypeScript, shadcn/ui + Tailwind, TanStack Query, Recharts.
`@libsql/client/web` talks to Turso straight from the browser, so there is no
application server in the request path. Better Auth runs against the control
database; `server/` only handles provisioning and token minting.

## Inventory model

Branches are **selling** locations; stock lives in **warehouses**, linked to the
branches they serve through `branch_warehouses`. That one mapping covers both
shapes the platform promises: many branches drawing on a single central
warehouse, and one branch drawing on a backroom plus the DC. Batch pick order is
a tenant setting — FIFO (default), LIFO or FEFO (nearest expiry first) — stored
at `tenants.settings.inventory.stock_issue_method` and applied by
`src/lib/stock-issue.ts` on every stock-out path (POS checkout, product-form
reduction, negative opname and both transfer approvals).

## Requirements

- Node.js >= 20
- A Turso organization for the control database and per-tenant databases

## Environment

Copy `.env.example` to **`.env`** and fill it in. The Node entry points
(`npm run dev:api`, `bootstrap:control`, `apply-schema-all`) load env through
`dotenv/config`, which reads `.env` only — values placed solely in `.env.local`
are visible to Vite but not to the API or the CLI scripts (tracked as KS-22 in
`docs/kendala-solusi.md`).

| Variable | Where | Purpose |
| --- | --- | --- |
| `TURSO_API_TOKEN` | server | Organization token used to create and delete tenant databases |
| `TURSO_ORG_SLUG` | server | Turso organization slug |
| `TURSO_GROUP` | server | Group new databases are created in (`retailpro`) |
| `TURSO_MAX_TENANT_DATABASES` | server | Database quota guard (`99`) |
| `CONTROL_DB_URL` / `CONTROL_DB_TOKEN` | server | Control database holding auth and the tenant registry |
| `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` | server | Better Auth signing secret and public origin |
| `VITE_API_BASE_URL` | browser | API origin, only for the split-origin dev setup |
| `TENANT_TOKEN_TTL` | server | Lifetime of the token handed to the browser (`60m`) |

Only `VITE_*` values are public, and `VITE_API_BASE_URL` must never carry a
Turso secret. Never import anything from `server/` in `src/`.

## Commands

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server (SPA) |
| `npm run dev:api` | Local auth/provisioning API on port 3000 |
| `npm run build` | Production build |
| `npm test` | Vitest (schema, seed, SQL translation, date range, inventory utils, stock issue, demo tenant) |
| `npm run typecheck` | TypeScript, app project |
| `npm run lint` | ESLint |
| `npm run bootstrap:control` | Create/schema the control database |
| `npm run schema:apply-all` | Dry-run drift report per tenant; `--apply` runs pending `db/migrations/*.sql` then `db/schema/tenant.sql` (`--only <slug>` for one tenant) |
| `npm run audit:sql` | Replay every SQL literal against the tenant schema |
| `npm run demo:tenant` | Seed the demo tenant (see below) |

## Demo tenant: Thalia Toko Bahan Kue

A complete reference dataset for a Bandung cake-supply shop with two branches.
It exercises every module, so a freshly seeded database looks like a shop that
has been trading for weeks.

```sh
# Local SQLite file, wiped and rebuilt from scratch
npm run demo:tenant -- --reset

# Any other target
npm run demo:tenant -- --database .data/demo/other.db --reset
npm run demo:tenant -- --url libsql://<db>.turso.io --token <jwt> --reset

# Fill a tenant that is already registered in the control database
npm run demo:tenant -- --tenant thalia --reset
```

`--tenant <slug>` resolves the tenant id, owner id and database hostname from
`tenant_databases`, mints a 10-minute full-access token and seeds over HTTPS —
this is the mode to use for a tenant created through the app's own signup flow.
`--tenant-id` and `--owner-id` override the ids when seeding a database that is
not in the registry yet.

What gets seeded (anchored to the run date, nothing future-dated):

- 2 branches (Pusat, Antapani) with sales targets, one backroom warehouse each
  plus a shared central warehouse, 7 users across the five roles, 5 vendors with
  full master data (code, terms, bank, lead time, rating), 6 bakery customers
- 7 categories, 28 products with 50 selling units, 2 batches per product in each
  branch warehouse with shelf-life-derived received/expiry dates
- 21 days of shifts and ~217 sales (open shifts today, so the POS is usable),
  plus 40 older sales for period comparisons
- 5 credit sales with due dates, 4 purchase orders (2 received and unpaid or
  part-paid, 1 ordered, 1 draft), 3 stock transfers, attendance, leave requests
  and audit-log entries; every product is linked to its vendor's catalogue and
  the part-paid PO leaves a row in the vendor payment ledger
- Rent, utilities and payroll for the month, 5 one-off operating costs

Each item is booked the way the UI reads it: purchase liabilities go to
`expenses` (the table Hutang/AP, Cashflow and Journal query), credit sales stay
as unpaid `transactions` for Piutang/AR, and shift cash is reconciled as
`initial_cash + cash sales`.

`db/__tests__/demo-tenant.test.ts` asserts the seeded database is internally
consistent (stock matches the catalog, invoice totals equal their line items,
shifts reconcile, low-stock SKUs are exactly the intended four, re-seeding
refuses without `--reset`), so the catalog in `server/demo/catalog.ts` cannot
drift from the data without a test failing.

## Repository layout

```
db/schema/tenant.sql     one-database-per-tenant schema (version 3)
db/migrations/           stepwise migrations for databases already on an older
                         schema version, applied by `npm run schema:apply-all`
db/schema/seed.sql       provisioning seed with {{TOKEN}} placeholders
server/                  provisioning, auth, demo dataset generator
src/                     React app (pages, components, lib/db client)
scripts/                 CLI entry points
docs/                    architecture, feature logs, problem register
```

## Documentation

The reference set lives in `docs/` (written in Indonesian). Each file carries a
"Terakhir diperbarui" date; the feature logs and the problem register are
append-only logs, so read the newest rows first.

| Document | Contents | Updated |
| --- | --- | --- |
| [docs/arsitektur.md](docs/arsitektur.md) | Technical architecture: topology, components, critical flows, isolation, decisions | 2026-10-27 |
| [docs/fitur-tenant.md](docs/fitur-tenant.md) | Tenant feature log, one row per change with commit date/time, plus the role × menu matrix | 2026-10-27 |
| [docs/fitur-platform.md](docs/fitur-platform.md) | Platform owner capabilities, gaps and roadmap, same dated log format | 2026-10-27 |
| [docs/frontend.md](docs/frontend.md) | Frontend: build config, routes and allowed roles, data patterns, formatting, limits | 2026-10-27 |
| [docs/backend.md](docs/backend.md) | Backend and database: API surface, server modules, full 25-table schema (v2), schema change history | 2026-10-27 |
| [docs/kendala-solusi.md](docs/kendala-solusi.md) | Problems, bugs and mismatches actually hit, with cause, fix, evidence and lesson | 2026-10-27 |
| [requirement.md](requirement.md) | Product and architecture plan, kept in sync with the code, with a dated revision history | 2026-10-27 |

`Backend.md` and `TECHNICAL_DOCS.md` in the repository root are now dated
pointers to these documents; `TECHNICAL_ISSUES.md` is kept as the archive of the
pre-migration audit (written against the old Neon design). `requirement.md` is the
product plan: it states the one-database-per-tenant strategy and records why the
shared-schema/RLS plan was rejected. When you change schema, routes, roles or
behaviour, add a dated row to the matching log, bump the "Terakhir diperbarui"
value, and add a row to the revision table in `requirement.md` if a product
decision changes.
