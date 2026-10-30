# RetailPro — Issues Register

**Feature gaps, technical and architectural risks**

> **ARSIP (2026-10-27).** Register ini ditulis terhadap desain **Neon Postgres +
> shared schema/RLS** yang sudah ditinggalkan. Sebagian temuannya sudah tidak
> berlaku (mis. kredensial database di bundle, `tenant_id`/RLS), dan sebagian
> masih relevan namun sudah dipindahkan ke [docs/kendala-solusi.md](docs/kendala-solusi.md)
> atau [docs/fitur-platform.md](docs/fitur-platform.md). Jangan pakai dokumen ini
> sebagai sumber kebenaran: kode sekarang memakai Turso libSQL dengan satu
> database per tenant. Dipertahankan hanya sebagai jejak audit.

| | |
|---|---|
| App | RetailPro — multi-tenant, multi-branch retail ERP/POS (Indonesian market, IDR) |
| Stack | React 18 + Vite 5 SPA, shadcn/ui, React Router 6, Neon serverless Postgres (direct from browser), Neon Auth (Better Auth) |
| Scope reviewed | `src/**` (≈100 TS/TSX files), `package.json`, build config, `.env`, `.gitignore`, git history, and the three design docs (`requirement.md`, `Backend.md`, `TECHNICAL_DOCS.md`) |
| Method | Static review of source, SQL statements, and configuration; cross-check of documentation against implementation |
| Register date | 2026-10-27 |

## How to read this register

Each finding has a stable ID, a severity, the evidence, the impact, and a recommended fix. IDs are grouped by class:

| Prefix | Class |
|---|---|
| `SEC-` | Security, privacy, access control |
| `ARCH-` | Architecture, data layer, platform |
| `FUNC-` | Feature behaviour and functional gaps |
| `QUAL-` | Maintainability, testing, developer experience |
| `DOC-` | Documentation / implementation drift |

| Severity | Meaning |
|---|---|
| **Blocker** | Prevents safe or correct use of the product; fix before any real user or data |
| **High** | Causes wrong business data, silent failure, or is exploitable |
| **Medium** | Degrades reliability, UX, or maintainability; workaround exists |
| **Low** | Cosmetic, hygiene, or future-proofing |

**Totals:** 5 Blocker · 22 High · 28 Medium · 12 Low (67 findings).

---

## 1. Executive summary

The application is **feature-rich but not yet production-safe**. The POS checkout path is the strongest area — real FIFO batch deduction inside a database transaction, with per-batch cost captured for gross-profit reporting. Around it, however, the platform has three systemic problems:

1. **The trust boundary is inverted.** The browser holds database credentials and *declares its own* tenant, branch, role and user id to Postgres. Row-Level Security therefore enforces isolation only against well-behaved clients. Repository `.env` (including the `neondb_owner` superuser password) is committed to git.
2. **Identity is split across two stores.** Authentication lives in Neon Auth; role/tenant/branch live in `public.users`. The UI reads role from the auth session, which does not carry it, so authorization is effectively fail-open and every client-side role guard is unreliable.
3. **The domain has no stable contract.** There are no migrations or SQL files in the repository, business rules are embedded in JSX handlers, and multi-table writes are not transactional. The database schema exists only inside the live Neon project.

Consequently, several modules *look* complete but are not operable end to end: tenant self-registration creates no tenant, receipts cannot be printed, settings changes are discarded, and purchase orders never reach the finance module.

---

## 2. Security findings (`SEC`)

| ID | Sev | Finding | Evidence | Impact |
|---|---|---|---|---|
| SEC-01 | **Blocker** | `.env` is tracked by git and contains the **owner-level** Postgres credential (`DATABASE_URL`) plus the application role password (`VITE_DATABASE_URL`) and Neon Auth endpoint | `git ls-files` lists `.env`; `.gitignore` has no `.env` entry | Full database takeover by anyone with repo/CI access or a clone. Must be treated as a credential leak: rotate both roles, then purge from history |
| SEC-02 | **Blocker** | The application connects **directly from the browser to Postgres**; `VITE_DATABASE_URL` is inlined into the shipped JS bundle | `src/lib/db.ts` (`new Pool({ connectionString })`), `import.meta.env.VITE_DATABASE_URL` | Every visitor can extract working DB credentials, bypass all UI logic, run arbitrary SQL permitted to that role, and script requests at will |
| SEC-03 | **Blocker** | Row-Level Security is driven by GUCs the client sets itself (`app.current_tenant_id`, `app.current_branch_id`, `app.user_role`, `app.current_user_id`) | `setupSession()` / `clearSession()` in `src/lib/db.ts`; policies documented in `Backend.md` §4.A | Tenant isolation is advisory. A malicious client can `set_config` any tenant/branch/role and read or write other tenants' data. RLS must derive identity from the verified JWT/DB session, not from caller-supplied settings |
| SEC-04 | **High** | Route guard fails open: access is denied only when a role is present and not allowed | `src/components/auth/RoleBasedRoute.tsx` — `if (role && !allowedRoles.includes(role))` | When `role` is undefined (see SEC-05) *every* protected route renders. Deny-by-default is required |
| SEC-05 | **High** | Authorization reads `session.user.role`, but the authoritative role is stored in `public.users`; the auth client is created without custom-field mapping | `src/hooks/use-auth.ts`, `src/lib/auth-client.ts` (`getUserRole` assumes `session.user.role`), `src/lib/db.ts` (`SELECT role FROM users WHERE id = $1`) | Role is almost certainly `undefined` in the client. Effects: guards pass (SEC-04), sidebar section disappears, and server-side-in-code checks such as `handleApproveTransfer` reject legitimate approvals. **Verify at runtime** (Appendix B) |
| SEC-06 | **High** | Privileged Neon Auth admin endpoints are called from the browser without an admin credential; on failure the code falls back to `/sign-up/email` | `src/pages/Employees.tsx` (`/admin/create-user`, then `/sign-up/email`), `src/components/branches/BranchDetailModal.tsx` (`/admin/update-user`, `credentials: "include"`) | Creating employees and resetting passwords either fails or silently **replaces the administrator's own session** with the new user's. Password reset should never be reachable from the client |
| SEC-07 | **High** | New branch managers get a hard-coded shared password, displayed in a toast | `src/pages/Branches.tsx` — `const defaultPassword = "ChangeMe123!"`, shown in `toast.success` | Predictable credentials for privileged accounts; no forced rotation, no invitation flow |
| SEC-08 | **High** | `/pos`, `/pos/transactions`, `/pos/shifts` and all `/backoffice/*` routes except three branch routes have **no authentication guard** | `src/App.tsx` route table | Logged-out users receive the full shell; queries execute as `guest` and fail quietly, producing empty or partially-rendered screens instead of a login redirect |
| SEC-09 | **Medium** | No login throttling/lockout; "Lupa password?" links to `/forgot-password`, which is not routed | `src/pages/auth/Login.tsx`, `src/App.tsx` | Brute-force exposure; broken recovery path (requirement.md asks for both) |
| SEC-10 | **Medium** | Audit trail is partial and does not record `ip_address`/`user_agent` | `src/lib/audit.ts` inserts only action/entity/entity_id/details/user_id; not called from POS checkout, employees, expenses, or settings | Compliance claims in `requirement.md`/`Backend.md` are unmet; financial mutations are unattributable |

---

## 3. Architecture findings (`ARCH`)

| ID | Sev | Finding | Evidence | Impact |
|---|---|---|---|---|
| ARCH-01 | **High** | There is no backend or API layer. SQL, business rules and privileged integrations (auth admin, stock mutation) live inside React components | 20+ files import `query` from `src/lib/db.ts`; e.g. `Inventory.tsx` holds product/PO/opname/transfer logic | Impossible to enforce invariants, keep secrets server-side, or reuse logic outside the UI. This is the root cause of SEC-02, SEC-03 and SEC-06 |
| ARCH-02 | **Blocker** | **No schema, migrations, RLS policies or seed data in the repository.** `scripts/` is empty; zero `.sql` files | `Glob **/*.sql` → 0 results; `Backend.md` §5 instructs "run the DDL" but the DDL is not committed | The system cannot be provisioned, reviewed, rolled back, or tested elsewhere. Schema drift between docs and DB is undetectable (see DOC-01…03) |
| ARCH-03 | **High** | Multi-table writes are sequential, independent queries instead of one transaction | Product create + units + batches + expense (`Inventory.tsx` `handleSaveProduct`), transfer approval (`BranchTransfers.tsx` `handleApproveTransfer`), opname, PO (`handlePO`) | Partial failures leave orphan stock batches, mismatched expenses, half-applied transfers. `runTransaction` exists but is used only by POS checkout |
| ARCH-04 | **High** | Batch deduction is read-then-write with no row locking or atomic guard | `POS.tsx` `handlePaymentComplete` (SELECT … WHERE quantity_current > 0, then UPDATE … - $1); transfer approval does the same | Two concurrent checkouts can oversell the same batch; stock can go negative |
| ARCH-05 | **High** | Tenant identity is omitted from INSERT statements and left to DB defaults/triggers | `INSERT INTO products (sku, name, …)`, `INSERT INTO suppliers (name)`, `INSERT INTO stock_transfers (…)` — no `tenant_id`; `queries` rely on RLS defaults | Correct multi-tenancy depends on unversioned DB defaults that cannot be reviewed. Cross-tenant leakage risk if a default is missing |
| ARCH-06 | **Medium** | Data fetching is ad-hoc: `useEffect` + `query()` + local `useState` per page, with manual refetch after mutations | All pages; `@tanstack/react-query` is used **only** for the auth session | No caching, no invalidation, no request de-duplication, inconsistent loading/error states, duplicated fetch code |
| ARCH-07 | **Medium** | No domain/service layer and no typed schema access; SQL is string-concatenated across components | Direct `query(...)` calls in pages; types in `src/types/index.ts` do not match DB columns (see DOC-03) | Business rules drift between screens (FIFO implemented twice with different semantics), refactors are high-risk |
| ARCH-08 | **Medium** | Error handling is `console.error` + generic toast; no React error boundary; DB/RLS errors are not translated | `catch (e) { console.error(...); toast.error("Gagal …") }` throughout; no boundary component in `App.tsx` | Users get "Gagal" with no cause; silent failures (e.g. shift page returning early when context is missing) look like empty data |
| ARCH-09 | **Medium** | Observability is nominal: a logger helper exists but is not used by pages; audit covers only a few entities | `src/lib/logger.ts` used only inside `db.ts` | Production incidents are undiagnosable beyond Vercel console output |
| ARCH-10 | **Medium** | Test coverage is effectively zero | Only `src/lib/inventory-utils.test.ts`; vitest installed but no `test` script in `package.json`; no component/E2E tests | Regressions in stock, cash and permissions cannot be caught mechanically — the riskiest code is the least tested |
| ARCH-11 | **Medium** | Large monolithic page files concentrate unrelated concerns | `Inventory.tsx` ~1,236 lines, `EmployeeReports.tsx` ~988, `Branches.tsx`, `POS.tsx`, `BranchDetailModal.tsx` ~34 KB | Hard to review, test, or modify safely; encourages the duplication already observed |
| ARCH-12 | **Medium** | Deployment has no CI and no environment validation | `vercel.json` (SPA rewrite only); `db.ts` throws at import when the URL is missing | A missing/mis-set env var breaks the entire bundle at runtime rather than failing the build |
| ARCH-13 | **Low** | Dead or unused code paths | `src/components/layout/MainLayout.tsx` and `src/pages/Index.tsx` are never imported; duplicate toast implementations (`components/ui/use-toast.ts` vs `hooks/use-toast.ts`) | Confusion for new contributors; bundle noise |
| ARCH-14 | **Low** | No pagination, virtualisation, or a11y treatment on data-heavy screens | Transaction/employee/product tables render full result sets; icon-only buttons lack labels | Slower screens with real data volumes; keyboard/screen-reader gaps |

---

## 4. Functional problems by module (`FUNC`)

### 4.1 Authentication, onboarding, tenancy

| ID | Sev | Finding | Evidence | Impact |
|---|---|---|---|---|
| FUNC-01 | **Blocker** | Tenant self-registration creates **no** tenant and **no** user row; success screen is unconditional | `src/pages/auth/RegisterTenant.tsx` — explicit `TODO: Call Backend API to create 'tenants' record`, then `setIsSuccess(true)`; dev fallback simulates success | A newly registered owner logs in to an empty application with no tenant context. The core SaaS onboarding promise is unmet |
| FUNC-02 | **High** | No platform-owner console to approve/activate tenants, although the role and `tenants.status = 'pending'` exist | No admin routes in `App.tsx`; `platform_owner` only appears in role lists | Tenant lifecycle is manual DB work |
| FUNC-03 | **Medium** | Login ignores role-based redirects; always navigates to `/mode-select` | `Login.tsx` `navigate("/mode-select")` with the role-based block commented out | Cashiers land in the management mode chooser; requirement.md §6.B expects `/pos` for cashiers |
| FUNC-04 | **High** | The tenant context is never resolved in the UI; there is no tenant/branch session object | No `SessionContext`; pages derive branch ad hoc from `useAuth()` or from "first branch in the list" | Every screen re-invents context, inconsistently (see FUNC-05) |

### 4.2 POS and shifts

| ID | Sev | Finding | Evidence | Impact |
|---|---|---|---|---|
| FUNC-05 | **High** | POS sells against the **first branch alphabetically**, not the cashier's assigned branch; the shift check mixes `currentBranchId` and `assigned_branch_id` | `POS.tsx` `fetchBranches()` → `setCurrentBranchId(res.rows[0].id)`; `checkShift()` uses `currentBranchId \|\| user.assigned_branch_id` | Stock is deducted from, and revenue booked to, the wrong branch. In a multi-branch tenant this corrupts inventory and reports |
| FUNC-06 | **High** | Two competing shift implementations. `POS.tsx`'s `ShiftModal` only mutates local state; only `POSShifts.tsx` persists | `POS.tsx` `handleShiftAction` (no SQL) vs `POSShifts.tsx` `handleOpenShift` / `handleCloseShift` | Closing a shift from the POS UI appears to work but leaves the DB shift `open`; cash reconciliation can be skipped entirely |
| FUNC-07 | **High** | Payment details are lossy, so cash and card reporting cannot be trusted | `PaymentModal.tsx` validates cash and computes change, but `POS.tsx` inserts `amount_paid = total`; card payments overwrite `payment_method` with `'debit'`/`'credit'`; wallet brand is dropped; discount is applied to `total` but never stored | Cash received/change, card type, e-wallet brand and discount are unrecoverable. Shift summary type-switches on `'card'`/`'ewallet'`, which never match |
| FUNC-08 | **High** | No receipt: no print, preview, or reprint anywhere | `Grep "window.print\|printReceipt\|escpos"` → 0 results; `ReceiptSettings` only holds local switches | A POS that cannot issue a receipt is not usable at the counter; `ReceiptSettings` is decorative |
| FUNC-09 | **Medium** | POS filter uses a hard-coded category list, so real categories are unreachable; barcode and "Member" buttons do nothing | `POS.tsx` `const categories = ["Semua","Makanan",…]`; `<Button …><Barcode/></Button>` has no handler; "Member" inert | Products outside five canned categories cannot be filtered; scanner workflow unimplemented; customer linkage impossible (see FUNC-15) |
| FUNC-10 | **Medium** | Shift expected cash is computed from `total_amount`, not from actual cash tendered, and card bucket never populates | `POSShifts.tsx` `calculateSummary` switch on `'cash'/'card'/'ewallet'/'qris'` | Variance analysis is structural rather than accurate; shift closing cannot detect till discrepancies reliably |

### 4.3 Inventory, purchasing, transfers

| ID | Sev | Finding | Evidence | Impact |
|---|---|---|---|---|
| FUNC-11 | **High** | Transfer workflow is collapsed into `pending → completed`; no approval, dispatch, in-transit, or receive-with-discrepancy states | `stock_transfers` inserted as `'pending'`, approve sets `'completed'`; `requirement.md` and `Backend.md` specify `draft/pending_approval/in_transit/received/cancelled` | Goods in transit are invisible, receiving shrinkage cannot be recorded, and the documented partial-receipt case (`quantity_received`) is unimplemented |
| FUNC-12 | **High** | Transfers lose batch traceability: `expiry_date` is not copied to the destination batch, and cost is flattened to a weighted average | `INSERT INTO product_batches (branch_id, product_id, batch_number, quantity_initial, quantity_current, cost_price, received_at)` — no `expiry_date`; `avgCost = totalCost / totalQtyMoved` | Expiry tracking (a stated FIFO requirement) breaks as soon as stock moves between branches |
| FUNC-13 | **High** | Transfer approval does not validate availability before deducting; shortfalls are silently swallowed | `handleApproveTransfer` keeps `remaining` but never errors when stock is insufficient; "we just transfer what's available" comment | Source stock can be partially moved with no alert; destination batch records only what was taken, so paperwork and stock diverge |
| FUNC-14 | **High** | Purchase Order does not persist an order. It immediately creates stock batches, records no payable, and cannot be received or cancelled | `Inventory.tsx` `handlePO` — comment "In a real app, we'd create a 'purchase_orders' table"; inserts `product_batches` only | Procurement is unauditable, unapprovable and invisible in AP/AR, unlike stock-in, which *does* create an expense. Two procurement paths produce different accounting |
| FUNC-15 | **High** | Deleting a product hard-deletes its batches and units, severing history for past transactions | `handleDeleteProduct`: `DELETE FROM product_batches` → `DELETE FROM product_units` → `DELETE FROM products`, guarded by browser `confirm()` | Historical transactions lose product/batch references; stock value and gross-profit reporting become unreconstructable. This also contradicts the docs' "Safety Deletion via AlertDialog" rule |
| FUNC-16 | **Medium** | Stock opname has no session document; positive adjustments create batches, negative adjustments burn FIFO stock, without linking to an opname record or valuation entry | `Inventory.tsx` `handleOpname`; batches labelled `OPNAME-<timestamp>` | No audit-ready count sheet, no variance approval, no accounting entry for shrinkage |
| FUNC-17 | **Medium** | Stock-in via product edit auto-creates an expense each time quantity increases | `handleSaveProduct` → `INSERT INTO expenses ('Pembelian Stok', …)` for `diff > 0` | Editing a quantity is conflated with purchasing; repeated edits inflate expenses and cashflow |

### 4.4 Employees, HR, payroll

| ID | Sev | Finding | Evidence | Impact |
|---|---|---|---|---|
| FUNC-18 | **Medium** | Employee creation depends on an unauthenticated admin call with a session-hijacking fallback | `Employees.tsx` — `/admin/create-user`, else `/sign-up/email` + toast "Jika sesi Anda berubah, silakan login kembali" | Unreliable onboarding; administrator can be logged out mid-flow (overlaps SEC-06) |
| FUNC-19 | **Medium** | Roles and permissions defined in `src/config/roles.ts` are never enforced; only ad-hoc string checks exist in two handlers | `PERMISSION_GROUPS`/`DEFAULT_ROLE_PERMISSIONS` referenced only by the settings screen; `handleApproveTransfer` does its own `includes()` check | The documented permission matrix is documentation only. `store_manager` can reach finance, payroll and settings screens freely |
| FUNC-20 | **Medium** | Attendance is manual data entry; no check-in/check-out tied to the signed-in user, no overtime capture, no leave approval workflow | `EmployeeReports.tsx` inserts `attendance` rows with `overtime = 0` and `leaves` with `status = 'approved'` directly | requirement.md's attendance/leave/payroll chain is only partially realised; leave approval cannot be audited |
| FUNC-21 | **Low** | `/backoffice/hr/attendance` and `/backoffice/hr/payroll` resolve to the same page; `/hr/schedule` shows the employee list, not a schedule | `App.tsx` routes → `EmployeeReports` / `Employees` | Navigation implies capabilities that do not exist |

### 4.5 Finance, CRM, reporting

| ID | Sev | Finding | Evidence | Impact |
|---|---|---|---|---|
| FUNC-22 | **High** | Finance is a read-time derivation, not a ledger: the journal is synthesised from `transactions` + `expenses`; AP/AR is the `expenses` table; there is no chart of accounts or journal table | `finance/Journal.tsx` builds debit/credit pairs in memory; `ApAr.tsx` reads/writes `expenses` | No closing entries, no trial balance, no period locking, no corrections. Journal and AP/AR can disagree with each other and with stock valuation |
| FUNC-23 | **Medium** | AP/AR supports creating payables but not recording payments against them | `ApAr.tsx` inserts with `status='unpaid'`, `amount_paid=0`; no payment mutation found | Payables only ever grow; cashflow and aging are meaningless |
| FUNC-24 | **Medium** | Dashboard/report scoping is incomplete: statistics are tenant-wide with no branch or period selector, and the built-in period-over-period comparison is never supplied | `Dashboard.tsx` queries have no branch filter; `ClickableStatCard` supports `change` but no caller passes it | Store managers see group-wide numbers; the "x% vs last month" affordance is dead |
| FUNC-25 | **Medium** | CRM is isolated from selling: customers cannot be attached to a transaction | `Customer` entity exists, `transactions.customer_id` exists, but POS never sets it (FUNC-09) | No customer history, loyalty, or receivables from credit sales |
| FUNC-26 | **Medium** | Notifications are hard-coded; the `notifications` table is unused | `Header.tsx` — literal array of 3 items, badge count `3` | Low-stock and transfer alerts promised in the docs do not exist |

### 4.6 Settings and shell

| ID | Sev | Finding | Evidence | Impact |
|---|---|---|---|---|
| FUNC-27 | **High** | Settings are non-persistent and misleading. Receipt, tax/discount, bank, company, notification and security panels hold local state only; the page-level "Simpan Pengaturan" button has no handler | `Settings.tsx` (`<Button className="gap-2">Simpan…</Button>` — no `onClick`); `ReceiptSettings.tsx`, `TaxDiscountSettings.tsx` (`initialItems` + `useState`), `BankSettings.tsx` (`initialBanks`) | Users adjust tax rates, bank accounts and receipt footers, get success toasts, and lose everything on reload. Tax configured here never reaches POS anyway |
| FUNC-28 | **Medium** | Header branch selector and global search are decorative | `Header.tsx` — hard-coded 4 branches (`Cabang Pusat Jakarta`, …) with local `useState`; search `Input` has no handler | Users believe they switched branch/scope when nothing changed — actively misleading in a multi-branch product |
| FUNC-29 | **Medium** | Only `EmployeeRoleSettings` genuinely persists (to `tenants.settings.role_permissions`), and it governs nothing at runtime | `settings/EmployeeRoleSettings.tsx` reads/writes `tenants.settings`; no consumer of those permissions | Configurable-looking access control that has no effect (pairs with FUNC-19) |

---

## 5. Documentation vs implementation (`DOC`)

| ID | Sev | Drift | Reference |
|---|---|---|---|
| DOC-01 | **Medium** | Role model is inconsistent: docs specify 5 roles; `config/roles.ts` defines 7 (`+ warehouse`, `staff`); `types/index.ts` defines 6 (`+ admin`, no warehouse/staff) | `requirement.md` §2.A, `Backend.md` §3, `src/config/roles.ts`, `src/types/index.ts` |
| DOC-02 | **Medium** | Transfer state machine differs: documented `draft/pending_approval/in_transit/received/cancelled` vs implemented `pending/completed` | `Backend.md` §2.D, §4.C vs `BranchTransfers.tsx`, `Inventory.tsx` |
| DOC-03 | **Medium** | Product model differs from `types/index.ts`: DB uses `category`, `cost_price`, `min_stock_level`, `supplier_id`; the type declares `price`, `cost`, `unit_type`, `min_stock_alert`, `stock_by_branch`. Selling price actually lives on `product_units` | `Inventory.tsx` `fetchProducts` SELECT vs `src/types/index.ts` |
| DOC-04 | **Low** | `requirement.md` still marks POS integration and stock management as unimplemented (`[ ]`) although both exist | `requirement.md` §Checklist |
| DOC-05 | **Low** | `Backend.md` "Next Steps" describes creating the schema and seed data; neither exists in the repo | `Backend.md` §5, empty `scripts/` |
| DOC-06 | **Low** | README is the untouched Lovable template (placeholder project URL, no product context, no setup/env documentation) | `README.md` |
| DOC-07 | **Low** | `categories` table is used by the product form but not by POS filtering, and is not tenant-scoped in the documented DDL | `TECHNICAL_DOCS.md` §3.1, `AddProductModal.tsx`, `POS.tsx` |

---

## 6. Maintainability and code quality (`QUAL`)

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| QUAL-01 | **Medium** | FIFO logic implemented twice with different semantics (POS: per-batch cost preserved; transfer: weighted average, expiry dropped) | `POS.tsx` `handlePaymentComplete` vs `BranchTransfers.tsx` `handleApproveTransfer` |
| QUAL-02 | **Medium** | Currency formatting duplicated in at least four places despite a shared helper | `lib/formatters.ts` + local copies in `POS.tsx`, `POSTransactions.tsx`, `PaymentModal.tsx`, `Dashboard.tsx` |
| QUAL-03 | **Low** | Local `cn()` re-implemented instead of importing from `lib/utils` | `POSShifts.tsx` bottom of file |
| QUAL-04 | **Low** | Browser `confirm()` used for destructive actions, contrary to the project's own AlertDialog convention | `Inventory.tsx` `handleDeleteProduct` |
| QUAL-05 | **Low** | Inline debug comments and abandoned reasoning committed to source ("Wait, let's check if transactions table has shift_id…") | `POSShifts.tsx` `calculateSummary` |
| QUAL-06 | **Low** | `eslint-disable` suppressions used broadly to mask `any` at DB boundaries | Pervasive in `db.ts`, `POS.tsx`, `Inventory.tsx` |
| QUAL-07 | **Low** | No formatting/type-check gate in scripts (`build` runs Vite only; `tsc` is not part of it) | `package.json` |

---

## 7. Remediation roadmap

### P0 — Before any real user or data (security + trust boundary)

| # | Action | Closes |
|---|---|---|
| 1 | Rotate the `neondb_owner` and `retailpro_app` passwords; add `.env` to `.gitignore`; purge from git history; move secrets to server-side env | SEC-01 |
| 2 | Introduce a server boundary (Vercel/Neon functions or a thin API). The browser must never hold a DB connection string or call auth admin endpoints | SEC-02, SEC-06, ARCH-01 |
| 3 | Derive tenant/branch/role from the verified JWT inside the server layer; delete client-driven `set_config` of identity GUCs. RLS policies must reference the trusted session identity | SEC-03, ARCH-05 |
| 4 | Make authorization deny-by-default and server-enforced; publish the resolved identity (role/tenant/branch) to the UI through one session provider | SEC-04, SEC-05, FUNC-04 |
| 5 | Commit schema: migrations + RLS policies + seed script under `scripts/` (or `db/`), with a documented recreate procedure | ARCH-02, DOC-05 |
| 6 | Guard all routes behind a single auth gate; implement `/forgot-password` or remove the link | SEC-08, SEC-09 |

**Exit criteria (P0):** cloning the repo + running one documented command provisions an empty environment; no credential appears in the bundle or git history; an anonymous request to any app route is redirected; a user of tenant A receives zero rows for tenant B even when tampering with request payloads.

### P1 — Correctness of money and stock

| # | Action | Closes |
|---|---|---|
| 7 | Implement tenant onboarding end to end (tenant + owner user + branch + default settings, status `pending`), plus a platform-owner approval screen | FUNC-01, FUNC-02 |
| 8 | Fix POS branch resolution (use the session's branch, offer an explicit switch only for roles allowed to cross branches) and merge the two shift flows into one persisted implementation | FUNC-05, FUNC-06, FUNC-28 |
| 9 | Persist full payment detail: cash tendered, change, card type + issuer, wallet brand, discount amount, tax lines | FUNC-07, FUNC-10 |
| 10 | Implement receipt rendering (print + reprint + PDF/ESC-POS adapter) driven by persisted receipt settings | FUNC-08, FUNC-27 |
| 11 | Wrap every multi-write flow in a single transaction; add `SELECT … FOR UPDATE` on batch rows during deduction and transfer | ARCH-03, ARCH-04 |
| 12 | Restore the documented transfer FSM with dispatch/receive steps, availability validation, `quantity_received`, and expiry/cost propagation per batch | FUNC-11, FUNC-12, FUNC-13, DOC-02 |
| 13 | Create a real `purchase_orders` + `purchase_order_items` model with receive/cancel, and post payable on receipt | FUNC-14 |
| 14 | Replace hard deletes with soft delete/archive; block deletion when transactions reference the product | FUNC-15 |
| 15 | Enforce the permission matrix in one place (route guard + action guard) and make `EmployeeRoleSettings` authoritative | FUNC-19, FUNC-29 |

**Exit criteria (P1):** two concurrent checkouts cannot oversell a batch; a shift closed from any screen is closed in the DB with full tender breakdown; a transferred batch keeps its expiry date; no product referenced by a transaction can be deleted; every privilege in `roles.ts` is enforced server-side.

### P2 — Reliability, finance and UX debt

| # | Action | Closes |
|---|---|---|
| 16 | Persist or remove the non-functional settings panels; wire tax/discount and receipt config into POS | FUNC-27 |
| 17 | Introduce a real ledger (accounts, journal_entries, journal_lines) or explicitly scope the product as cash-basis and remove the "Jurnal Umum" label; add AP payment recording | FUNC-22, FUNC-23 |
| 18 | Attach customers to transactions (Member/scan flow) and surface customer history | FUNC-09, FUNC-25 |
| 19 | Replace the derived notification mock with the `notifications` table and low-stock/transfer triggers | FUNC-26 |
| 20 | Complete audit coverage (POS void/refund, employees, expenses, settings) with IP/user agent | SEC-10 |
| 21 | Migrate reads to TanStack Query with keys/invalidation; add pagination to large tables | ARCH-06, ARCH-14 |
| 22 | Add error boundaries, structured error mapping (RLS/permission/constraint), and use the logger in all mutations | ARCH-08, ARCH-09 |
| 23 | Split the monolith pages into feature modules; consolidate FIFO, currency and `cn` helpers | ARCH-07, ARCH-11, QUAL-01…03 |
| 24 | Add tests: unit for FIFO/costing/shift math, integration for checkout and transfer, one E2E cashier journey; add `test` and `typecheck` scripts plus CI | ARCH-10, QUAL-07 |
| 25 | Align types with the DB (generated from schema), refresh README/docs, remove dead files | ARCH-13, DOC-01…07 |

---

## Appendix A — Evidence index

| Area | Primary files |
|---|---|
| Data access / RLS | `src/lib/db.ts`, `src/lib/auth-client.ts`, `src/lib/audit.ts`, `src/lib/logger.ts` |
| Access control | `src/hooks/use-auth.ts`, `src/components/auth/RoleBasedRoute.tsx`, `src/config/roles.ts`, `src/components/layout/Sidebar.tsx` |
| Routing / shell | `src/App.tsx`, `src/components/layout/{POSLayout,BackOfficeLayout,Header,Sidebar}.tsx` |
| POS | `src/pages/POS.tsx`, `src/components/pos/{PaymentModal,ShiftModal}.tsx`, `src/pages/POSShifts.tsx`, `src/pages/POSTransactions.tsx` |
| Inventory | `src/pages/Inventory.tsx`, `src/components/inventory/{AddProductModal,StockTransferModal,StockOpnameModal,PurchaseOrderModal,ProductImportExport}.tsx` |
| Transfers | `src/pages/BranchTransfers.tsx`, `src/pages/Inventory.tsx` (`handleApproveTransfer`) |
| HR | `src/pages/Employees.tsx`, `src/pages/EmployeeReports.tsx`, `src/components/branches/BranchDetailModal.tsx` |
| Finance / CRM | `src/pages/finance/*`, `src/pages/crm/*`, `src/pages/FinanceReports.tsx` |
| Settings | `src/pages/Settings.tsx`, `src/components/settings/*` |
| Config / ops | `package.json`, `vite.config.ts`, `vercel.json`, `.env`, `.gitignore`, git history |

## Appendix B — Requires runtime verification

These findings follow from static reading and should be confirmed against the live environment before planning work around them:

1. **Session role presence (SEC-05):** sign in and inspect `authClient.getSession()` — confirm whether `session.user.role`, `tenant_id` and `assigned_branch_id` exist. If they do, the RBAC failure mode changes (still fail-open, but for a different reason).
2. **Actual RLS policies (SEC-03, ARCH-05):** export `pg_policies` for `products`, `transactions`, `users`, `stock_transfers`, and confirm whether policies reference only the `app.*` GUCs or also `auth.uid()`-style identity.
3. **Grants of the application role:** confirm `retailpro_app` cannot `set_config` outside RLS-relevant settings and cannot read `public.users` cross-tenant.
4. **Live schema:** dump `information_schema.columns` — the register's DB column list is inferred from SQL usage, not from DDL, because no DDL is committed.
5. **Neon Auth admin endpoints:** confirm whether `/admin/create-user` and `/admin/update-user` succeed from the browser without an admin token in the deployed environment (SEC-06).
6. **Data currently in the database:** check whether any production-like data exists — this determines whether credential rotation (P0-1) must be paired with an integrity audit.

---

## Appendix C — Closed by the Turso database-per-tenant migration

Status as of the migration to Turso (libSQL) with one cloud database per tenant. Evidence is in the repository and reproducible with the commands given.

| ID | Status | Resolution and evidence |
|---|---|---|
| SEC-01 | **Closed (rotate still required)** | `.env` is no longer tracked (`.gitignore` covers `.env`, `.env.local`, `.env.*.local`, `.data/`) and `.env.example` documents every variable with empty values. There are no Neon/Postgres credentials left to leak: `grep -r "neon" src/ package.json` returns nothing. The **leaked Turso organization token must still be revoked in the dashboard** — that action is not automatable from the repo |
| SEC-02 | **Closed** | The browser no longer receives a database password. It receives a 60-minute, `full-access`, single-tenant token minted server-side by `POST /api/tenant/bootstrap` (`api/tenant/bootstrap.ts`, `server/turso-platform.ts`) and kept in memory only (`src/lib/tenant-session.ts`). No `VITE_*` variable carries a credential |
| SEC-03 | **Closed by design** | Client-supplied identity GUCs are gone: `grep -rn "set_config\|current_setting" src/` returns nothing. Tenant isolation no longer rests on RLS — it is a physical boundary, one Turso database per company. `db/schema/tenant.sql` has no `tenant_id` column and `src/lib/db/__tests__/schema.test.ts` asserts that across `sqlite_master` |
| SEC-04 | **Closed** | `src/components/auth/RoleBasedRoute.tsx` is deny-by-default (loading → spinner, no user → `/login`, missing role → `/login`, wrong role → `/mode-select`), and every `/pos*` and `/backoffice/*` route in `src/App.tsx` is wrapped with an explicit `allowedRoles` list |
| SEC-05 | **Closed** | `role`, `tenantId` and `branchId` are Better Auth `additionalFields` declared in `server/auth.ts`, so they exist on every session. Verified at runtime: `/api/auth/get-session` returns `role`/`tenantId`, and `src/hooks/use-auth.ts` projects them onto the legacy field names the pages read |
| SEC-06 | **Closed** | Employee creation and password reset no longer call auth admin endpoints from the browser. `api/admin/users.ts` and `api/admin/users/[id]/password.ts` require an admin session (`server/auth-helpers.ts` → `requireAdminSession`) and return a generated temporary password exactly once |
| ARCH-02 | **Closed** | The schema is committed and is the single source of truth: `db/schema/tenant.sql` (applied to every tenant database), `db/schema/control.sql` (Better Auth + `tenant_databases` registry), `db/schema/seed.sql` (rendered per tenant), plus `scripts/bootstrap-control.mjs` and `scripts/apply-schema-all.mjs` for fleet drift. `schema_version` records the applied version |
| FUNC-01 | **Closed** | `src/pages/auth/RegisterTenant.tsx` posts to `POST /api/tenant/provision`, which creates the database, applies schema + seed, writes the registry row and stamps the owner. `db/__tests__/seed.test.ts` executes that exact payload against a real libSQL database, including idempotency and single-quote escaping |
| ARCH-03 | **Closed** | Every multi-table write now runs inside one `runTransaction`: POS checkout + audit, transfer create and approval (`BranchTransfers.tsx`, `Inventory.tsx`, batch-by-batch with expiry and per-batch cost), stock opname, product create/update with units, batches and the stock-purchase expense, and purchase-order receiving with its payable. A failed write rolls back completely instead of leaving orphan batches or half-applied transfers |
| FUNC-27 | **Closed (wired panels only)** | Receipt, tax/discount, bank, employee-role and stock-issue panels read and write `tenants.settings` through `src/lib/tenant-settings.ts` (read → merge → write) with per-panel saving/saved indicators; the handler-less page button was removed so the page no longer pretends a global save exists. Company, notification and security panels remain placeholders and are labelled as such |

Phase 2 and Phase 3 items from the migration plan landed with this work: branch scoping without RLS (POS switcher, reports filter, dashboard filter), shift persistence, tender fidelity, per-batch deduction hardening plus a per-tenant issue policy (FIFO/LIFO/FEFO in `tenants.settings`), transfer cost/expiry fidelity, purchase orders + payables, query budgets, report date ranges and pagination, settings persistence into `tenants.settings`, and `audit_logs` coverage for checkout, employees, expenses, products, transfers and stock adjustments. `npm run audit:sql` replays every SQL literal in `src/` against `db/schema/tenant.sql` to keep call sites and schema in step.

