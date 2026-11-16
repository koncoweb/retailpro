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
reduction, negative opname, transfer dispatch and branch-order dispatch).

A shop refills by **request**, not by editing stock. `stock_requests` records what
the branch asked for and who approved, adjusted or rejected it; `stock_transfers`
records the batches that actually left the gudang, and `stock_transfers.request_id`
links the two so the stock math is never written twice. Stock leaves the gudang at
**dispatch** and lands on the shop's own `type = 'store'` shelf, which is what the
till then sells from — the gudang supplies, the shelf sells. Every batch movement
goes through `src/lib/stock-movement.ts`; no page carries its own copy.

Vendors and products are one catalogue. The links between them — `vendor_products` (vendor SKU, last
cost, minimum order, preferred flag) and `vendor_price_list` (the agreed buy price per variant and
pack, which is the purchase-order template) — are written by exactly one module,
`src/lib/vendor-catalog.ts`, that every path now calls: the product form, the vendor screen, the flat
vendor+product CSV/Excel import, goods receipt and the demo seeder. Choosing a product in a purchase
order therefore chooses its vendor (`defaultVendorFor()`: preferred → main → the only active linked
vendor) and pulls in the agreed price, while switching away from that vendor asks before dropping the
lines it owns. Schema v10 only added the two indexes this reads through — no table and no column
changed.

A sale can be cancelled without erasing it. Voiding (`src/lib/void.ts`, schema v9)
marks rows — per line or per whole bon — instead of deleting them: stock returns
to the batch the line was picked from, `total_amount` is reduced by that line's
subtotal so a bon-level discount survives, the audit trail records who and why,
and the receipt prints the line struck through. Every revenue query therefore
filters `status = 'completed'`, and per-line aggregates also filter
`transaction_items.voided = 0`.

Printing is in-house (`src/lib/print/`, no extra dependency): one character-based
document model feeds two renderers — HTML through the OS printer driver, and an
ESC/POS byte stream for thermal printers over WebUSB/Web Bluetooth or a downloadable
`.prn` — for both receipts and the Z-report. `printDocument()` never throws, so a
missing printer can't fail a committed sale.

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
| `TURSO_GROUP` | server | Group new databases are created in (`ap-southeast-2`) |
| `TURSO_MAX_TENANT_DATABASES` | server | Database quota guard (`99`) |
| `CONTROL_DB_URL` / `CONTROL_DB_TOKEN` | server | Control database holding auth and the tenant registry |
| `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` | server | Better Auth signing secret and public origin |
| `VITE_API_BASE_URL` | browser | API origin, only for the split-origin dev setup |
| `VITE_API_PROXY_TARGET` | Vite dev | Where `/api` is proxied during `npm run dev` (`http://localhost:3000`) |
| `TENANT_TOKEN_TTL` | server | Lifetime of the token handed to the browser (`60m`) |
| `STOREFRONT_TENANT_SLUG` | server | Tenant the public catalogue serves when `?slug=` is omitted (`thalia`) |
| `VITE_CATALOG_API_URL` | storefront | API origin for `tokoonline/`; baked into the bundle at build time |
| `E2E_AI_BASE_URL` / `E2E_AI_API_KEY` / `E2E_AI_MODEL` | e2e | OpenAI-compatible endpoint and model that drive `agent.act`/`agent.assert` in `e2e.config.ts` |
| `APP_URL` | e2e | SPA origin the e2e tests drive (`http://localhost:8080`) |

Only `VITE_*` values are public, and `VITE_API_BASE_URL` must never carry a
Turso secret. Never import anything from `server/` in `src/`.

## Commands

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server (SPA) |
| `npm run dev:api` | Local auth/provisioning API on port 3000 |
| `npm run build` | Production build |
| `npm test` | Vitest — 30 files / 419 tests (schema + migrations, seed, demo tenant, SQL translation, date range, inventory/stock-issue/stock-movement, permissions & roles, variants/units/pricing, procurement & goods receipt, vendor catalogue + vendor/product import, vendors, branch orders, bulk import, password, geolocation/face, shift attendance, the print model + both renderers, void) |
| `npm run typecheck` | TypeScript, app project |
| `npm run lint` | ESLint |
| `npm run test:e2e` | End-to-end tests (tester.army), see below |
| `npm run bootstrap:control` | Create/schema the control database |
| `npm run schema:apply-all` | Dry-run drift report per tenant; `--apply` runs pending `db/migrations/*.sql` then `db/schema/tenant.sql` (`--only <slug>` for one tenant) |
| `npm run audit:sql` | Replay every SQL literal against the tenant schema; literals inside comments are skipped, `npm run audit:sql -- --show-comments` lists what was dropped |
| `npm run docs:check` | Documentation gate: markdown table shape, one schema version in its three places, README doc index covers `docs/`, cross-doc `§N` anchors resolve. It prints its own coverage and ships with a positive control — `node scripts/check-docs.mjs --root scripts/__fixtures__/docs-check` must report exactly 8 problems |
| `npm run demo:tenant` | Seed the demo tenant (see below) |
| `npm run demo:cloud` | Create/reseed the demo tenant in Turso cloud; `-- --write-env` also rewrites `.env` |
| `cd tokoonline && npm run dev` | Storefront for the online branch on port 8082 |

## End-to-end tests (tester.army)

`tests/**/*.e2e.ts` drives the SPA in a real browser. Deterministic steps use
locators; `agent.act` / `agent.assert` hand a goal to an LLM whenever a step
needs judgement instead of a selector.

The agent model comes from `e2e.config.ts`, which reads `E2E_AI_BASE_URL`,
`E2E_AI_API_KEY` and `E2E_AI_MODEL` (loaded from `.env` through
`process.loadEnvFile()`). The default points at SumoPod's OpenAI-compatible
endpoint, so switching provider or model is an `.env` change only. The model
must support tool calls; it need not support structured output (`extract` is
the only step that requires it).

```bash
# terminal 1 — the app under test (add `npm run dev:api` for auth flows)
npm run dev
# terminal 2
npx e2e run                  # whole suite
npx e2e run --grep login     # one file/title
```

Reports and failure artifacts land in `.e2e/` (`report.json`, plus
`artifacts/.../screen.txt` listing the rendered node text — the fastest way to
fix a locator). `.e2e/cache/` holds verified `agent.act` replays; it is
gitignored, so a fresh clone pays model calls once per act step.

## Demo tenant: Thalia Toko Bahan Kue

A complete reference dataset for a Depok cake-supply shop with a central store,
a second outlet and an online store. It exercises every module, so a freshly
seeded database looks like a shop that has been trading for weeks.

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

- 3 branches — Thalia Toko Pusat (Jl. Arif Rahman Hakim, Depok), Thalia Toko 2
  and Thalia Online (tokobahankue.com, no walk-in counter) — with sales targets,
  **one** central warehouse (Gudang Pusat Depok, Jl. Arif Rahman Hakim near Toko
  Pusat) plus **two racks**, one `type = 'store'` shelf per walk-in shop: the
  gudang supplies, each shop's till sells from its own shelf, and the online
  channel sells straight from the gudang; 9 users across six roles, 5 vendors
  with full master data (code, terms, bank, lead time, rating), 6 bakery customers
- 7 categories, 28 products with 55 selling units across 32 variants; stock is
  authored per location (~40% in the gudang, the rest split between the two
  shelves) and split into batches at each location with shelf-life-derived
  received/expiry dates
- 63 till sessions over 21 days (~240 sales, open shifts today so the POS is
  usable) plus 60 older sales without a shift for period comparisons — the
  generator is a seeded PRNG anchored to the run date, so the totals drift a
  little between runs (304 transactions, 768 lines on the 2026-11-16 run)
- ~190 stock batches (`product_batches`). **4 branch orders**: 1 draft and 1
  submitted
  (urgent) waiting on the gudang, 1 already dispatched to Toko Pusat with a linked
  in-transit transfer, and 1 received from Thalia Online (shipped straight out of
  the gudang, no rack to move to) — each with its per-line
  requested/approved/dispatched/received quantities
- 5 credit sales with due dates, and 7 purchase orders spanning the whole
  lifecycle (2 received — one unpaid, one part-paid — 1 partially received, 1
  approved, 1 submitted, 1 draft, 1 rejected) backed by 3 goods receipts; attendance,
  leave requests and audit-log entries; every product is linked to its vendor's
  catalogue and has an agreed buy price on its base pack — written through the same
  `src/lib/vendor-catalog.ts` helpers the screens use, so the demo data cannot be a
  catalogue the app itself could not have produced; and the part-paid PO leaves a row in the
  vendor payment ledger
- Rent, utilities and payroll booked monthly, plus a few one-off operating costs

Each item is booked the way the UI reads it: purchase liabilities go to
`expenses` (the table Hutang/AP, Cashflow and Journal query), credit sales stay
as unpaid `transactions` for Piutang/AR, and shift cash is reconciled as
`initial_cash + cash sales`.

`db/__tests__/demo-tenant.test.ts` asserts the seeded database is internally
consistent (stock matches the catalog once the per-location split is summed,
invoice totals equal their line items, shifts reconcile, low-stock SKUs are
exactly the intended four **in the gudang**, every branch order agrees with the
movement it produced and never dispatches more than the gudang holds, every
catalogue link carries a base-pack buy price and every product has **exactly
one** preferred vendor, re-seeding refuses without `--reset`), so the catalog in
`server/demo/catalog.ts` cannot
drift from the data without a test failing.

## Storefront online (`tokoonline/`)

`tokoonline/` is the customer-facing **marketplace**: one app showing the goods of
every `active` tenant side by side, with each product carrying its seller. It is a
separate TanStack Start app that holds no database credential — it renders
whatever `GET /api/storefront/marketplace` returns (sellers, branches, selling
units, prices, and the stock of the gudang that ships web orders), so the shop
cannot drift from any tenant's back office. `GET /api/storefront/catalog?slug=`
still exists for clients that only want one shop's window.

The storefront is branded **Toko Bahan Kue** with *Marketplace* underneath and a
rose accent; product URLs are `/product/<tenant>/<slug>`, and the old
`/product/<slug>` links redirect to them.

```sh
# terminal 1 — API (health, auth, provisioning, marketplace catalogue)
npm run dev:api          # :3000

# terminal 2 — the shop
cd tokoonline
npm install              # first run only
npm run dev              # :8082
```

`VITE_CATALOG_API_URL` points the shop at another API origin; it defaults to
`http://localhost:3000`. Orders placed in the shop are still stored on the
device (prototype) — the catalogue is the live part. Port 8082 is deliberate:
the back office keeps 8080.

## Deployment (Vercel)

Two production projects on the same Turso organization (control database + one
database per tenant, group `ap-southeast-2`):

| Project | URL | Root directory |
| --- | --- | --- |
| Back office + `/api/*` | https://retailpro-thalia.vercel.app | repository root |
| Storefront / marketplace | https://thalia-storefront.vercel.app | `tokoonline/` |

```sh
npm run demo:cloud -- --write-env   # create/reseed the cloud databases, write .env
vercel --prod                       # back office + API first (new endpoints live here)
cd tokoonline && vercel --prod      # then the storefront, which calls them
```

Deploy order is not cosmetic: the storefront's API origin is baked into the
bundle at build time, so a storefront deployed ahead of a new `/api/storefront/*`
endpoint shows "Katalog tidak bisa dimuat (HTTP 404)" until the API catches up.
Full runbook: [docs/deployment.md](docs/deployment.md).

Production variables live in Vercel → Project → Settings → Environment
Variables: the nine Turso/auth values plus `STOREFRONT_TENANT_SLUG=thalia` on
`retailpro-thalia`, and `VITE_CATALOG_API_URL` on `thalia-storefront`.

Four platform rules everything else depends on — each one is a `500`/`404`/
blank screen when broken:

- relative imports in `api/` and `server/` carry explicit `.js` extensions
  (Vercel resolves each function file separately as ESM);
- `api/auth/[...all].ts` and `api/admin/users/[id]/password.ts` are reached
  through the explicit `rewrites` in `vercel.json`, not by file-path matching;
- `functions["api/**/*.ts"].includeFiles` ships `db/schema/**`, because
  provisioning reads `tenant.sql` and `seed.sql` at runtime;
- the CSP must allow `https://*.turso.io`, because the browser talks to the
  tenant database directly.

Full runbook (cloud setup, env per project, `vercel.json` contract, verification
requests, rollback, release checklist): **[docs/deployment.md](docs/deployment.md)**.

## Repository layout

```
db/schema/tenant.sql     one-database-per-tenant schema (version 10, 34 tables)
db/migrations/           stepwise migrations for databases already on an older
                         schema version, applied by `npm run schema:apply-all`
db/schema/seed.sql       provisioning seed with {{TOKEN}} placeholders
db/schema/control.sql    control database: Better Auth tables + tenant registry
api/                     Vercel functions (health, auth, tenant, admin, public catalogues)
server/                  provisioning, auth, demo dataset generator, shared catalogue reader
src/                     React app (pages, components, lib/db client)
tokoonline/              customer-facing marketplace (all active tenants)
scripts/                 CLI entry points
docs/                    architecture, feature logs, problem register, deploy runbook
```

## Documentation

The reference set lives in `docs/` (written in Indonesian). Every living document
carries a "Terakhir diperbarui" date; the `spec-*.md` files carry their
original date plus a dated status note. The feature logs and the problem register
are append-only logs, so read the newest rows first.

| Document | Contents | Updated |
| --- | --- | --- |
| [docs/arsitektur.md](docs/arsitektur.md) | Technical architecture: topology, components, critical flows (incl. printing, void and the vendor catalogue), isolation, decisions | 2026-11-17 |
| [docs/deployment.md](docs/deployment.md) | Deployment runbook: Turso cloud setup, both Vercel projects, env per project, schema migration rollout, `vercel.json` contract, verification, rollback | 2026-11-17 |
| [docs/backend.md](docs/backend.md) | Backend and database: API surface, server modules, full 34-table schema (v10), the single vendor-catalogue writer and the domain writer modules, env vars, invariants, schema change history, deploy constraints on the code | 2026-11-17 |
| [docs/frontend.md](docs/frontend.md) | Frontend: build config, routes and allowed roles, data patterns, formatting, printing & void UI, vendor/product entry and import, the marketplace app, limits | 2026-11-17 |
| [docs/fitur-tenant.md](docs/fitur-tenant.md) | Tenant feature log, one row per change with commit date/time, plus the role × menu matrix | 2026-11-17 |
| [docs/fitur-platform.md](docs/fitur-platform.md) | Platform owner capabilities, gaps and roadmap, same dated log format | 2026-11-16 |
| [docs/kendala-solusi.md](docs/kendala-solusi.md) | Problems, bugs and mismatches actually hit (KS-01…KS-49), with cause, fix, evidence and lesson | 2026-11-17 |
| [docs/spec-purchase-order.md](docs/spec-purchase-order.md) | Design record for the PO lifecycle: four documents, state machine, goods receipt, accounting split — **shipped** as migration `005` | 2026-10-30, status 2026-11-17 |
| [docs/spec-varian-harga-vendor.md](docs/spec-varian-harga-vendor.md) | Design record for variants, per-pack buy prices and the vendor price list as PO template; §16 lists what actually landed — **shipped** as migration `006` | 2026-10-31, status 2026-11-17 |
| [docs/spec-vendor-produk-terintegrasi.md](docs/spec-vendor-produk-terintegrasi.md) | Design record for the integrated vendor↔product catalogue: where the relation leaked, the four locked decisions, the flat 18-column sheet, PO vendor auto-fill order, why no table or column changed — **shipped** as migration `010`; §9 maps every number it quotes to the command that proves it | 2026-11-17 |
| [docs/ringkasan-fitur-2026-11-05-06.md](docs/ringkasan-fitur-2026-11-05-06.md) | Frozen sprint summary for 5–6 November (RBAC consolidation, printing, POS/shift hardening) | 2026-11-16 |
| [CHANGELOG.md](CHANGELOG.md) | Release notes grouped by branch/commit, newest first, with the gate results each release shipped with | 2026-11-17 |
| [requirement.md](requirement.md) | Product and architecture plan, kept in sync with the code, with a dated revision history | 2026-11-17 |

The `spec-*.md` files are point-in-time design records: their bodies are never
rewritten, only given a dated status note, so the reasoning behind a decision
survives the release that implemented it. Everything else in `docs/` describes
the code as it is today.

`Backend.md` and `TECHNICAL_DOCS.md` in the repository root are now dated
pointers to these documents; `TECHNICAL_ISSUES.md` is kept as the archive of the
pre-migration audit (written against the old Neon design). `requirement.md` is the
product plan: it states the one-database-per-tenant strategy and records why the
shared-schema/RLS plan was rejected. When you change schema, routes, roles or
behaviour, add a dated row to the matching log, bump the "Terakhir diperbarui"
value, and add a row to the revision table in `requirement.md` if a product
decision changes. A change to hosting, environment variables or the
`vercel.json` contract also updates `docs/deployment.md` — that file is the
runbook, so it must describe what is actually deployed.
