/**
 * Local demo tenant: "Thalia Toko Bahan Kue" on localhost.
 *
 * Creates the pieces a login needs on this machine only:
 *   1. control-plane schema in CONTROL_DB_URL (default `.data/control.db`),
 *   2. a Better Auth owner account with a known password,
 *   3. a `tenant_databases` row pointing at the loopback libSQL server,
 *   4. the seeded shop database (`--database`, default `.data/demo/thalia.db`).
 *
 * Run the database server first, then this script, then the API and the SPA:
 *
 *   npm run demo:local          # builds the control DB + demo tenant
 *   npm run dev:db              # serves the tenant DB to the browser
 *   npm run dev:api
 *   npm run dev
 *
 * Everything it touches is local: it never calls the Turso Platform API. The
 * tenant file is recreated from scratch, because `tenant.sql` only creates
 * missing tables — a file seeded with an older schema would keep its old shape.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

interface CliOptions {
  database: string;
  dbHostname: string;
  password: string;
  slug: string;
  company: string;
  email: string;
  name: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    database: '.data/demo/thalia.db',
    dbHostname: 'http://127.0.0.1:8090',
    password: process.env.DEMO_PASSWORD ?? 'Thalia2026!',
    slug: 'thalia',
    company: 'Thalia Toko Bahan Kue',
    email: 'owner@tokobahankue.com',
    name: 'Surya',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--database':
        options.database = argv[++index] ?? options.database;
        break;
      case '--db-host':
        options.dbHostname = argv[++index] ?? options.dbHostname;
        break;
      case '--password':
        options.password = argv[++index] ?? options.password;
        break;
      case '--slug':
        options.slug = argv[++index] ?? options.slug;
        break;
      case '--email':
        options.email = argv[++index] ?? options.email;
        break;
      case '--name':
        options.name = argv[++index] ?? options.name;
        break;
      case '--help':
      case '-h':
        console.log('Usage: npm run demo:local -- [--database <file>] [--db-host <url>] [--password <pw>]');
        process.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        process.exit(1);
    }
  }

  return options;
}

function fail(message: string): never {
  console.error(`\n[x] ${message}\n`);
  process.exit(1);
}

const CONTROL_DB_URL = process.env.CONTROL_DB_URL?.trim();
const options = parseArgs(process.argv.slice(2));

if (!CONTROL_DB_URL) {
  fail('CONTROL_DB_URL is not set. Add CONTROL_DB_URL=file:./.data/control.db to .env.');
}
if (!process.env.BETTER_AUTH_SECRET?.trim()) {
  fail('BETTER_AUTH_SECRET is not set. Add a random secret to .env.');
}

const controlClient = createClient({ url: CONTROL_DB_URL });
const now = new Date().toISOString();

async function resetDemoRows(userId?: string): Promise<void> {
  await controlClient.execute({
    sql: 'DELETE FROM tenant_databases WHERE slug = ?',
    args: [options.slug],
  });
  if (userId) {
    await controlClient.execute({ sql: 'DELETE FROM session WHERE userId = ?', args: [userId] });
    await controlClient.execute({ sql: 'DELETE FROM account WHERE userId = ?', args: [userId] });
    await controlClient.execute({ sql: 'DELETE FROM user WHERE id = ?', args: [userId] });
  }
}

async function main(): Promise<void> {
  console.log(`[i] control database : ${CONTROL_DB_URL}`);
  console.log(`[i] tenant database  : ${resolve(options.database)}`);
  console.log(`[i] tenant db url    : ${options.dbHostname}`);

  const controlSchema = readFileSync(join(repoRoot, 'db', 'schema', 'control.sql'), 'utf8');
  await controlClient.executeMultiple(controlSchema);

  // Remove any previous run so the script is idempotent.
  const existing = await controlClient.execute({
    sql: 'SELECT id, owner_user_id FROM tenant_databases WHERE slug = ?',
    args: [options.slug],
  });
  const previousOwner = existing.rows[0]?.owner_user_id
    ? String(existing.rows[0].owner_user_id)
    : undefined;
  await resetDemoRows(previousOwner);

  const previousUser = await controlClient.execute({
    sql: 'SELECT id FROM user WHERE email = ?',
    args: [options.email],
  });
  if (previousUser.rows[0]?.id) {
    await resetDemoRows(String(previousUser.rows[0].id));
  }

  // Better Auth owns password hashing; creating the identity through its API
  // keeps this script from re-implementing the credential format.
  const { auth } = await import('../server/auth');
  const signedUp = await auth.api.signUpEmail({
    body: { email: options.email, password: options.password, name: options.name },
  });
  const ownerId = signedUp.user.id;
  console.log(`[+] owner account   : ${options.email} (${ownerId})`);

  const { seedDemoTenant, describeTenant } = await import('../server/demo/seed');
  const tenantId = randomUUID();
  const tenantFile = resolve(options.database);

  // `tenant.sql` is CREATE TABLE IF NOT EXISTS, so a stale file would keep an
  // older column set; recreate it instead of silently mixing schemas.
  if (existsSync(tenantFile)) {
    rmSync(tenantFile, { force: true });
    console.log(`[i] removed previous ${tenantFile}`);
  }

  const tenantClient = createClient({ url: `file:${tenantFile}` });

  let branchId: string | null = null;
  let snapshot: Awaited<ReturnType<typeof describeTenant>>;
  try {
    const result = await seedDemoTenant(tenantClient, { reset: true, tenantId, ownerId });
    branchId = result.identity.branches[0]?.id ?? null;
    snapshot = await describeTenant(tenantClient);
  } finally {
    tenantClient.close();
  }

  await controlClient.execute({
    sql: `UPDATE user
             SET role = 'tenant_owner', tenantId = ?, branchId = ?, status = 'active', updatedAt = ?
           WHERE id = ?`,
    args: [tenantId, branchId, now, ownerId],
  });

  await controlClient.execute({
    sql: `INSERT INTO tenant_databases
            (id, owner_user_id, slug, company_name, db_name, db_hostname, group_name, status)
          VALUES (?, ?, ?, ?, ?, ?, 'local', 'active')`,
    args: [
      tenantId,
      ownerId,
      options.slug,
      options.company,
      `local-${options.slug}`,
      options.dbHostname,
    ],
  });

  console.log(`[+] tenant registry : ${options.slug} -> ${options.dbHostname}`);
  console.log(
    `[+] seeded          : ${snapshot.products} products, ${snapshot.transactions} transactions, ` +
      `${snapshot.suppliers} vendors`
  );

  console.log('\n--- Login ---------------------------------------------------');
  console.log(`  URL       http://localhost:8080`);
  console.log(`  Email     ${options.email}`);
  console.log(`  Password  ${options.password}`);
  console.log(`  Role      tenant_owner (back office + POS)`);
  console.log('------------------------------------------------------------\n');
  console.log('Start the rest with: npm run dev:api  and  npm run dev\n');
}

main()
  .catch((error: unknown) => {
    console.error(`\nLocal demo setup failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    controlClient.close();
  });
