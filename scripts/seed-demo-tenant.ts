/**
 * Creates the "Thalia Toko Bahan Kue" demo tenant.
 *
 *   npm run demo:tenant                          # .data/demo/thalia.db
 *   npm run demo:tenant -- --reset               # rebuild from scratch
 *   npm run demo:tenant -- --database .data/demo/thalia-2.db
 *   npm run demo:tenant -- --url libsql://rp-thalia-xxxx.turso.io --token <jwt>
 *   npm run demo:tenant -- --tenant thalia --reset
 *
 * The last form fills a tenant that was already provisioned through
 * `/register-tenant`: it reads the control-plane registry, mints a short-lived
 * database token, and seeds the shop under the real tenant and owner ids so the
 * owner's login lands on it. That path needs TURSO_API_TOKEN, TURSO_ORG_SLUG and
 * the CONTROL_DB_* variables.
 *
 * The local file is a normal libSQL database: open it with any SQLite viewer to
 * inspect the seeded shop.
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createClient } from '@libsql/client';
import { getControlDb } from '../server/control-db';
import { browserDbUrl, createToken } from '../server/turso-platform';
import {
  DemoSeedError,
  describeTenant,
  seedDemoTenant,
  type TenantSnapshot,
} from '../server/demo/seed';

interface CliOptions {
  database: string;
  url?: string;
  token?: string;
  /** Slug in the control-plane registry. */
  tenant?: string;
  tenantId?: string;
  ownerId?: string;
  reset: boolean;
}

const DEFAULT_DATABASE = '.data/demo/thalia.db';

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { database: DEFAULT_DATABASE, reset: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--reset':
        options.reset = true;
        break;
      case '--database':
        options.database = argv[++index] ?? options.database;
        break;
      case '--url':
        options.url = argv[++index];
        break;
      case '--token':
        options.token = argv[++index];
        break;
      case '--tenant':
        options.tenant = argv[++index];
        break;
      case '--tenant-id':
        options.tenantId = argv[++index];
        break;
      case '--owner-id':
        options.ownerId = argv[++index];
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        printUsage();
        process.exit(1);
    }
  }

  return options;
}

function printUsage(): void {
  console.log(`
Usage: npm run demo:tenant -- [options]

  --database <path>   Local database file (default ${DEFAULT_DATABASE})
  --url <url>         Seed a remote libSQL/Turso database instead of a file
  --token <jwt>       Auth token for --url (or set TURSO_TENANT_TOKEN)
  --tenant <slug>     Seed the tenant registered under this slug (needs the
                      control-plane env vars); implies --url
  --tenant-id <id>    Override the tenant id written into the seed
  --owner-id <id>     Override the owner id (Better Auth user id)
  --reset             Wipe the target before seeding
  -h, --help          Show this message
`);
}

const rupiah = (value: number) => `Rp ${new Intl.NumberFormat('id-ID').format(Math.round(value))}`;
const count = (value: number) => new Intl.NumberFormat('id-ID').format(value);

function printSnapshot(target: string, statements: number, snapshot: TenantSnapshot): void {
  const margin =
    snapshot.revenue30d > 0 ? (snapshot.grossMargin30d / snapshot.revenue30d) * 100 : 0;

  console.log('');
  console.log(`  ${snapshot.tenantName}`);
  console.log(`  ${'-'.repeat(Math.max(snapshot.tenantName.length, 12) + 18)}`);
  console.log(`  database          ${target}`);
  console.log(`  statements        ${count(statements)}`);
  console.log('');
  console.log(`  branches          ${count(snapshot.branches)}`);
  console.log(`  users             ${count(snapshot.users)}`);
  console.log(`  suppliers         ${count(snapshot.suppliers)}`);
  console.log(`  customers         ${count(snapshot.customers)}`);
  console.log(`  products          ${count(snapshot.products)} (${count(snapshot.units)} selling units)`);
  console.log(`  batches           ${count(snapshot.batches)}`);
  console.log(`  stock on hand     ${count(snapshot.stockBaseUnits)} base units, ${rupiah(snapshot.stockValue)} at cost`);
  console.log(`  low stock         ${count(snapshot.lowStock.length)} products`);
  for (const item of snapshot.lowStock) {
    console.log(`                    ${item.sku}  ${item.name} (${item.stock} / min ${item.min})`);
  }
  console.log('');
  console.log(`  sales             ${count(snapshot.transactions)} transactions, ${count(snapshot.transactionItems)} lines`);
  console.log(`  revenue (30 d)    ${rupiah(snapshot.revenue30d)}`);
  console.log(`  gross margin      ${rupiah(snapshot.grossMargin30d)} (${margin.toFixed(1)}%)`);
  console.log(`  expenses (30 d)   ${rupiah(snapshot.expenses30d)}`);
  console.log(`  receivables       ${rupiah(snapshot.receivables)}`);
  console.log(`  payables          ${rupiah(snapshot.payables)}`);
  console.log(`  open shifts       ${count(snapshot.openShifts)}`);
  console.log(`  pending transfer  ${count(snapshot.pendingTransfers)}`);
  console.log('');
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  let token = options.token ?? process.env.TURSO_TENANT_TOKEN ?? '';
  let tenantId = options.tenantId;
  let ownerId = options.ownerId;
  const remote = Boolean(options.url || options.tenant);

  let target: string;
  if (options.tenant) {
    // Seed a tenant that was already provisioned through the UI, keeping the
    // registry ids so the owner's session resolves to this database.
    const registry = await getControlDb()
      .selectFrom('tenant_databases')
      .selectAll()
      .where('slug', '=', options.tenant)
      .executeTakeFirst();
    if (!registry) {
      throw new DemoSeedError(`No tenant is registered with the slug "${options.tenant}".`);
    }
    const { jwt } = await createToken(registry.db_name, '10m', 'full-access');
    target = browserDbUrl(registry.db_hostname);
    token = jwt;
    tenantId = registry.id;
    ownerId = registry.owner_user_id;
    console.log(`Registered tenant "${registry.slug}" -> ${registry.db_name}`);
  } else if (options.url) {
    target = options.url;
    if (!token) {
      throw new DemoSeedError('--url needs --token (or TURSO_TENANT_TOKEN).');
    }
  } else {
    const filePath = resolve(options.database);
    target = `file:${filePath}`;
    if (options.reset && existsSync(filePath)) {
      rmSync(filePath, { force: true });
      console.log(`Removed ${filePath}`);
    }
    mkdirSync(dirname(filePath), { recursive: true });
  }

  const client = createClient({ url: target, authToken: token || undefined });
  try {
    const result = await seedDemoTenant(client, { reset: options.reset, tenantId, ownerId });
    const snapshot = await describeTenant(client);
    printSnapshot(target, result.statementCount, snapshot);

    if (!remote) {
      console.log(`  Open ${resolve(options.database)} with any SQLite viewer to browse it.`);
      console.log('  To fill a provisioned Turso tenant instead:');
      console.log('    npm run demo:tenant -- --tenant <slug> --reset');
      console.log('');
    }
  } finally {
    client.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nDemo tenant failed: ${message}\n`);
  process.exit(1);
});
