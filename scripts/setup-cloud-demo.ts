/**
 * Cloud demo tenant: "Thalia Toko Bahan Kue" on Turso (no local files).
 *
 * Same outcome as `npm run demo:local`, but everything lives in Turso:
 *   1. create (or reuse) the control-plane database and the tenant database,
 *   2. apply `db/schema/control.sql` to the control database,
 *   3. create a Better Auth owner account with a known password,
 *   4. seed the tenant database with the Thalia ledger,
 *   5. register the tenant in `tenant_databases` with its Turso hostname.
 *
 * The databases and their tokens are what the Vercel deployment reads, so this
 * script prints the exact environment values to paste into the project.
 *
 *   npm run demo:cloud
 *
 * Requires TURSO_API_TOKEN, TURSO_ORG_SLUG, TURSO_GROUP and BETTER_AUTH_SECRET.
 * Safe to re-run: databases are reused, the demo rows are replaced.
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { tursoGroup, tursoOrg, tursoApiToken } from '../server/env';
import {
  TursoApiError,
  browserDbUrl,
  createDatabase,
  createToken,
  listDatabases,
  listGroups,
  type TursoDatabase,
} from '../server/turso-platform';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

const CONTROL_DB_NAME = process.env.CLOUD_CONTROL_DB?.trim() || 'retailpro-control';
const TENANT_DB_NAME = process.env.CLOUD_TENANT_DB?.trim() || 'rp-thalia';
const SLUG = 'thalia';
const COMPANY = 'Thalia Toko Bahan Kue';
const EMAIL = process.env.DEMO_OWNER_EMAIL?.trim() || 'owner@tokobahankue.com';
const OWNER_NAME = process.env.DEMO_OWNER_NAME?.trim() || 'Surya';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Thalia2026!';

function fail(message: string): never {
  console.error(`\n[x] ${message}\n`);
  process.exit(1);
}

function step(message: string): void {
  console.log(`\n[>] ${message}`);
}

/**
 * Rewrites the given keys in `.env` in place. Used by `--write-env` so the local
 * run points at the cloud databases without the token ever leaving the machine.
 */
function writeEnv(values: Record<string, string>): void {
  const envPath = join(repoRoot, '.env');
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  const written = new Set<string>();
  const next = lines.map((line) => {
    const match = /^([A-Z0-9_]+)=/.exec(line);
    if (match && match[1] in values) {
      written.add(match[1]);
      return `${match[1]}=${values[match[1]]}`;
    }
    return line;
  });
  for (const [key, value] of Object.entries(values)) {
    if (!written.has(key)) next.push(`${key}=${value}`);
  }
  writeFileSync(envPath, next.join('\n'), 'utf8');
  console.log(`[+] .env updated: ${Object.keys(values).join(', ')}`);
}

/** Reuses the database when it already exists, so re-runs are idempotent. */
async function ensureDatabase(name: string): Promise<TursoDatabase> {
  const existing = (await listDatabases()).find((database) => database.name === name);
  if (existing) {
    console.log(`[=] ${name} already exists (${existing.hostname})`);
    return existing;
  }

  const group = tursoGroup();
  try {
    const created = await createDatabase(name, group);
    console.log(`[+] created ${name} in group ${created.group ?? group} (${created.hostname})`);
    return created;
  } catch (error) {
    if (!(error instanceof TursoApiError) || error.status >= 500) throw error;
    // A fresh organization only has its automatically created location group, so
    // a custom TURSO_GROUP may simply not exist yet.
    const usable = (await listGroups()).find((candidate) => !candidate.archived && candidate.name);
    console.warn(
      `[!] group "${group}" unusable (${error.message}); ` +
        `retrying in "${usable?.name ?? 'none'}"`
    );
    if (!usable) throw error;
    const created = await createDatabase(name, usable.name);
    console.log(`[+] created ${name} in group ${created.group ?? usable.name} (${created.hostname})`);
    return created;
  }
}

/**
 * The control-plane token is stored in the deployment environment, so it has to
 * outlive the deploy. `never` is the correct request; `30d` keeps the script
 * working on plans that reject it.
 */
async function mintLongLivedToken(database: string): Promise<string> {
  try {
    return (await createToken(database, 'never')).jwt;
  } catch (error) {
    if (!(error instanceof TursoApiError) || error.status >= 500) throw error;
    console.warn(`[!] "never" expiry rejected (${error.message}); falling back to 30d`);
    return (await createToken(database, '30d')).jwt;
  }
}

async function main(): Promise<void> {
  tursoApiToken();
  console.log(`[i] organization    : ${tursoOrg()}`);
  console.log(`[i] control database: ${CONTROL_DB_NAME}`);
  console.log(`[i] tenant database : ${TENANT_DB_NAME}`);

  step('Databases');
  const control = await ensureDatabase(CONTROL_DB_NAME);
  if (!control.hostname) fail('Turso returned no hostname for the control database.');
  const tenant = await ensureDatabase(TENANT_DB_NAME);
  if (!tenant.hostname) fail('Turso returned no hostname for the tenant database.');

  const controlUrl = browserDbUrl(control.hostname);
  const controlToken = await mintLongLivedToken(control.name);

  step('Control-plane schema');
  const controlClient = createClient({ url: controlUrl, authToken: controlToken });
  try {
    await controlClient.executeMultiple(readFileSync(join(repoRoot, 'db', 'schema', 'control.sql'), 'utf8'));
    console.log('[+] control.sql applied');
  } finally {
    controlClient.close();
  }

  // Better Auth and the registry read these at import time (control-db caches the
  // first connection), so they must be in place before `server/auth` is loaded.
  process.env.CONTROL_DB_URL = controlUrl;
  process.env.CONTROL_DB_TOKEN = controlToken;

  const { auth } = await import('../server/auth');
  const registry = createClient({ url: controlUrl, authToken: controlToken });

  try {
    step('Owner account');
    const previousTenant = await registry.execute({
      sql: 'SELECT id, owner_user_id FROM tenant_databases WHERE slug = ?',
      args: [SLUG],
    });
    await registry.execute({ sql: 'DELETE FROM tenant_databases WHERE slug = ?', args: [SLUG] });

    const previousUser = await registry.execute({
      sql: 'SELECT id FROM user WHERE email = ?',
      args: [EMAIL],
    });
    for (const row of [...previousTenant.rows, ...previousUser.rows]) {
      const userId = String(row.owner_user_id ?? row.id ?? '');
      if (!userId) continue;
      await registry.execute({ sql: 'DELETE FROM session WHERE userId = ?', args: [userId] });
      await registry.execute({ sql: 'DELETE FROM account WHERE userId = ?', args: [userId] });
      await registry.execute({ sql: 'DELETE FROM user WHERE id = ?', args: [userId] });
    }

    const signedUp = await auth.api.signUpEmail({
      body: { email: EMAIL, password: PASSWORD, name: OWNER_NAME },
    });
    const ownerId = signedUp.user.id;
    console.log(`[+] owner ${EMAIL} (${ownerId})`);

    step('Tenant seed');
    const tenantToken = (await createToken(tenant.name, '10m')).jwt;
    const tenantClient = createClient({ url: browserDbUrl(tenant.hostname), authToken: tenantToken });
    const tenantId = randomUUID();
    let branchId: string | null = null;
    let summary = '';
    try {
      const { seedDemoTenant, describeTenant } = await import('../server/demo/seed');
      const seeded = await seedDemoTenant(tenantClient, { reset: true, tenantId, ownerId });
      branchId = seeded.identity.branches[0]?.id ?? null;
      const snapshot = await describeTenant(tenantClient);
      summary =
        `${snapshot.products} products, ${snapshot.transactions} transactions, ` +
        `${snapshot.suppliers} vendors`;
      console.log(`[+] seeded ${summary} in ${seeded.statementCount} statements`);
    } finally {
      tenantClient.close();
    }

    step('Registry');
    const now = new Date().toISOString();
    await registry.execute({
      sql: `UPDATE user SET role = 'tenant_owner', tenantId = ?, branchId = ?, status = 'active', updatedAt = ?
             WHERE id = ?`,
      args: [tenantId, branchId, now, ownerId],
    });
    await registry.execute({
      sql: `INSERT INTO tenant_databases
              (id, owner_user_id, slug, company_name, db_name, db_hostname, group_name, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
      args: [
        tenantId,
        ownerId,
        SLUG,
        COMPANY,
        tenant.name,
        tenant.hostname,
        tenant.group ?? tursoGroup(),
      ],
    });
    console.log(`[+] ${SLUG} -> ${tenant.hostname}`);

    const envValues: Record<string, string> = {
      TURSO_GROUP: tenant.group ?? tursoGroup(),
      CONTROL_DB_URL: controlUrl,
      CONTROL_DB_TOKEN: controlToken,
      STOREFRONT_TENANT_SLUG: SLUG,
    };

    if (process.argv.includes('--write-env')) {
      writeEnv(envValues);
      console.log(`[i] Vercel needs the same values plus TURSO_API_TOKEN and BETTER_AUTH_SECRET.`);
    } else {
      console.log('\n--- Local .env -------------------------------------------------');
      for (const [key, value] of Object.entries(envValues)) console.log(`${key}=${value}`);
      console.log('----------------------------------------------------------------');
      console.log('\n--- Vercel environment (both projects) -------------------------');
      console.log('TURSO_API_TOKEN=<the token already in .env>');
      console.log(`TURSO_ORG_SLUG=${tursoOrg()}`);
      for (const [key, value] of Object.entries(envValues)) console.log(`${key}=${value}`);
      console.log('BETTER_AUTH_SECRET=<the secret already in .env>');
      console.log('----------------------------------------------------------------');
    }

    console.log(`\nLogin: ${EMAIL} / ${PASSWORD}\n`);
  } finally {
    registry.close();
  }
}

main().catch((error: unknown) => {
  console.error(`\nCloud demo setup failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
