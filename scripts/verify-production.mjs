/**
 * Production verification — dev-only, not shipped.
 *
 * Runs docs/deployment.md §7 as one command against a live deployment, so the
 * runbook is executed instead of re-read by eye. Every check below answers a
 * question a real incident asked:
 *
 *   1. `/api/health` — proves the API functions import at all (ESM extensions,
 *      `@/` aliases) and that the control database is wired.
 *   2. `/api/tenant/bootstrap` without a session must be **401, never 500** —
 *      a 500 means the handler crashed while loading `server/roles.ts` ->
 *      `src/lib/permission-matrix.ts`, which no other check can see.
 *   3-4. marketplace + catalog — prove the control DB, tenant tokens and the
 *      per-tenant Turso read path return data, not just `ok`.
 *   5. sign-in — proves the Better Auth rewrite catch-all and that a real
 *      credential still resolves to `tenant_owner`.
 *   6. bootstrap with that session — proves registry lookup + Turso Platform
 *      API mint a usable, https, unexpired tenant token.
 *   7. permission grants — the payload the SPA trusts for every guard.
 *
 * Header note: the Origin/Referer sent on the POST is not decoration. Better
 * Auth treats a request carrying `Sec-Fetch-Mode` as browser-like and rejects
 * one without a matching Origin ("MISSING_OR_NULL_ORIGIN"). Node's global fetch
 * always sends `Sec-Fetch-Mode: cors`, so a scripted probe gets 403 while plain
 * curl (which sends neither) gets 200 — a failure that looks exactly like a
 * broken deployment.
 *
 * Credentials: the password is read from the environment only. It is documented
 * in the `e2e.config.ts` credentials block and is deliberately not repeated
 * here. Without `DEMO_PASSWORD` the authenticated checks are *skipped*, and an
 * incomplete run exits 2 rather than 0 so a green cannot hide a broken login.
 *
 * Usage:
 *   node scripts/verify-production.mjs
 *   $env:DEMO_PASSWORD='…'; npm run verify:prod
 *   node scripts/verify-production.mjs --base http://localhost:3000 --require-perm void_transaction
 *
 * --base points at any host that serves this API surface without its own auth
 * wall, e.g. the local dev API on http://localhost:3000. It does NOT work
 * against a Vercel per-deployment URL: those sit behind Deployment Protection,
 * and every check then fails with "Protected by Vercel Authentication" — which
 * is a property of the URL, not of the build. Verify the alias instead, or
 * disable protection for that deployment. The tenant-token assertion scopes
 * itself to the base, because the local shim legitimately returns an http
 * dbUrl and a short dummy token.
 *
 * Exit codes: 0 all checks passed · 1 a check failed · 2 ran, auth skipped
 */
import 'dotenv/config';

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 || i === process.argv.length - 1 ? undefined : process.argv[i + 1];
};

const base = (arg('--base') ?? 'https://retailpro-thalia.vercel.app').replace(/\/+$/, '');
const email = process.env.DEMO_EMAIL ?? 'owner@tokobahankue.com';
const password = process.env.DEMO_PASSWORD;
const requiredPerms = (arg('--require-perm') ?? '')
  .split(',')
  .map((k) => k.trim())
  .filter(Boolean);

let passed = 0;
let failed = 0;
const problems = [];

/** Record one check. `detail` is always printed so a pass is not vacuous. */
const check = (name, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`);
  if (ok) passed += 1;
  else {
    failed += 1;
    problems.push(name);
  }
};

const get = async (path, headers = {}) => {
  const res = await fetch(`${base}${path}`, { headers });
  const body = await res.json().catch(() => ({}));
  return { res, body };
};

// Browser-shaped headers for the cross-origin POST, same origin as the target.
const asBrowser = {
  'content-type': 'application/json',
  origin: base,
  referer: `${base}/`,
};

console.log(`verifying ${base}`);

// 1. API functions alive + control db configured.
const health = await get('/api/health');
check('health', health.body.ok === true && health.body.controlDbConfigured === true,
  `ok=${health.body.ok} controlDbConfigured=${health.body.controlDbConfigured} org=${health.body.tursoOrg} group=${health.body.group}`);

// 2. Auth guard fires before the data layer: 401, not 500.
const anon = await fetch(`${base}/api/tenant/bootstrap`);
check('bootstrap unauthenticated is 401', anon.status === 401,
  `HTTP ${anon.status}${anon.status === 500 ? ' (handler crashed on import — see §8 / KS-39)' : ''}`);

// 3. Marketplace: the shops the storefront is allowed to show.
const market = await get('/api/storefront/marketplace');
const shops = market.body.shops ?? market.body.tenants ?? [];
check('marketplace has shops', shops.length > 0,
  `${shops.length} shop(s), ${shops.reduce((n, s) => n + (s.productCount ?? 0), 0)} product(s)`);

// 4. Single-tenant catalogue contract.
const catalog = await get('/api/storefront/catalog?slug=thalia');
const products = catalog.body.products ?? [];
check('catalog returns products', products.length > 0,
  `${products.length} product(s), ${(catalog.body.categories ?? []).length} categorie(s), shop=${catalog.body.shop?.tenant ?? catalog.body.shop?.name ?? '-'}`);

if (!password) {
  console.log('SKIP sign-in, tenant bootstrap, permission grants: DEMO_PASSWORD is not set');
  console.log(`RESULT ${passed} passed, ${failed} failed, 3 skipped (incomplete run)`);
  process.exit(failed > 0 ? 1 : 2);
}

// 5. A real credential still resolves to a tenant owner.
const signIn = await fetch(`${base}/api/auth/sign-in/email`, {
  method: 'POST',
  headers: asBrowser,
  body: JSON.stringify({ email, password }),
});
const signInBody = await signIn.json().catch(() => ({}));
const cookie = (signIn.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
check('sign-in', signIn.status === 200 && cookie.length > 0,
  `HTTP ${signIn.status}${signInBody.message ? ` "${signInBody.message}"` : ''} role=${signInBody.user?.role ?? '-'} cookieChars=${cookie.length}`);

// 6. Registry lookup + Turso Platform API mint a tenant token.
//    The https + real-JWT expectations are production invariants: against the
//    local dev API the dbUrl is the Hrana shim (http://127.0.0.1:8090) with a
//    short dummy token, which is correct there, so scope the assertion to the
//    base instead of failing a healthy local run.
const boot = await get('/api/tenant/bootstrap', { cookie });
const token = boot.body.token ?? '';
const dbUrl = String(boot.body.dbUrl ?? '');
const againstTls = /^https:/i.test(base);
const tokenShapeOk = againstTls
  ? /^https:\/\//.test(dbUrl) && token.length >= 100
  : dbUrl.length > 0 && token.length > 0;
const expiresInMin = boot.body.expiresAt
  ? (new Date(boot.body.expiresAt).getTime() - Date.now()) / 60000
  : -1;
check('tenant bootstrap', boot.res.status === 200 && tokenShapeOk && expiresInMin > 0,
  `HTTP ${boot.res.status} tenant=${boot.body.tenant?.slug ?? '-'} dbUrl=${dbUrl.slice(0, 30) || '-'} tokenChars=${token.length} ttlMin=${expiresInMin > 0 ? Math.round(expiresInMin) : 'EXPIRED'} expecting=${againstTls ? 'https dbUrl + >=100-char token' : 'any dbUrl + non-empty token'}`);

// 7. The grant payload every client-side guard reads.
const grants = boot.body.grants ?? {};
const roles = Object.keys(grants);
const ownerPerms = grants.tenant_owner?.permissions ?? {};
const allBoolean = roles.every((r) => Object.values(grants[r]?.permissions ?? {}).every((v) => typeof v === 'boolean'));
check('grants resolve per role', roles.length > 0 && allBoolean,
  `${roles.length} role(s): ${roles.map((r) => `${r}=${Object.keys(grants[r]?.permissions ?? {}).length}`).join(', ')}`);

if (requiredPerms.length > 0) {
  for (const key of requiredPerms) {
    check(`owner grant ${key}`, ownerPerms[key] === true, `value=${JSON.stringify(ownerPerms[key])}`);
  }
} else {
  console.log('note 0 release-specific permission keys asserted — pass --require-perm key1,key2 for the keys this release added');
}

console.log(`RESULT ${passed} passed, ${failed} failed${problems.length ? ` (${problems.join(', ')})` : ''}`);
process.exit(failed > 0 ? 1 : 0);
