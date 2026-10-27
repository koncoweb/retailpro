/**
 * Seeds the "Thalia Toko Bahan Kue" demo tenant into any libSQL database.
 *
 * Used two ways:
 *  - `npm run demo:tenant` / `scripts/seed-demo-tenant.ts` for a local file
 *    database you can inspect with any SQLite client;
 *  - the same script pointed at a real Turso database once the tenant has been
 *    provisioned, so the UI shows a shop with history instead of empty tables.
 *
 * The database must be empty (or `reset`): a demo tenant that silently merged
 * itself into real data would be worse than no demo at all.
 */
import type { Client } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import { loadSchemaFile, renderSeed } from '../provision';
import { THALIA } from './catalog';
import {
  buildDemoStatements,
  createThaliaIdentity,
  type DemoStatement,
  type ThaliaIdentity,
} from './ledger';

export { THALIA, createThaliaIdentity, buildDemoStatements };
export type { ThaliaIdentity };

/** Large enough to stay fast, small enough for one libSQL request body. */
const CHUNK_SIZE = 250;

export interface SeedDemoOptions {
  /** Reuse an existing tenant id (e.g. the one in the control-plane registry). */
  tenantId?: string;
  /** Better Auth user id of the owner, so their session resolves a role. */
  ownerId?: string;
  /** Anchor for every relative date. Defaults to `new Date()`. */
  now?: Date;
  /** Wipe an existing database first. Destructive, hence opt-in. */
  reset?: boolean;
}

export interface SeedDemoResult {
  tenantId: string;
  ownerId: string;
  statementCount: number;
  identity: ThaliaIdentity;
}

export class DemoSeedError extends Error {}

async function listTables(client: Client): Promise<string[]> {
  const result = await client.execute(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
  );
  return result.rows.map((row) => String(row.name));
}

/** Empties every tenant table except the schema version marker. */
async function wipeTenant(client: Client): Promise<void> {
  const tables = await listTables(client);
  for (const table of tables) {
    if (table === 'schema_version') continue;
    await client.execute(`DELETE FROM "${table}"`);
  }
}

export async function seedDemoTenant(
  client: Client,
  options: SeedDemoOptions = {}
): Promise<SeedDemoResult> {
  const now = options.now ?? new Date();
  const tables = await listTables(client);
  const hasTenantTable = tables.includes('tenants');

  if (hasTenantTable) {
    const existing = await client.execute(`SELECT count(*) AS n FROM tenants`);
    const tenantCount = Number(existing.rows[0]?.n ?? 0);
    if (tenantCount > 0) {
      if (!options.reset) {
        throw new DemoSeedError(
          'This database already holds a tenant. Re-run with --reset to replace its data.'
        );
      }
      await wipeTenant(client);
    }
  }

  // `tenant.sql` is idempotent; applying it also repairs a half-provisioned db.
  const schema = loadSchemaFile('tenant.sql');
  await client.executeMultiple(schema);

  const identity = createThaliaIdentity({
    tenantId: options.tenantId ?? randomUUID(),
    ownerId: options.ownerId ?? randomUUID(),
  });

  // The seed owns the tenant row, the primary branch and the owner mirror, so
  // those ids must be the demo's ids — the rest of the dataset joins on them.
  await client.executeMultiple(
    `BEGIN;\n${renderSeed({
      tenantId: identity.tenantId,
      tenantName: THALIA.name,
      tenantSlug: THALIA.slug,
      branchId: identity.branches[0].id,
      branchName: identity.branches[0].name,
      branchAddress: identity.branches[0].address,
      warehouseId: identity.branches[0].warehouseId,
      warehouseName: `${identity.branches[0].name} - Gudang`,
      ownerId: identity.ownerId,
      ownerEmail: identity.owner.email,
      ownerName: identity.owner.name,
    })}\nCOMMIT;`
  );

  const statements = buildDemoStatements(identity, now);
  for (let offset = 0; offset < statements.length; offset += CHUNK_SIZE) {
    await runChunk(client, statements.slice(offset, offset + CHUNK_SIZE));
  }

  return {
    tenantId: identity.tenantId,
    ownerId: identity.ownerId,
    statementCount: statements.length,
    identity,
  };
}

async function runChunk(client: Client, chunk: DemoStatement[]): Promise<void> {
  try {
    await client.batch(chunk, 'write');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new DemoSeedError(`Demo seed failed: ${detail}`);
  }
}

// ---------------------------------------------------------------------------
// Verification helpers (the CLI prints these; the tests assert on them)
// ---------------------------------------------------------------------------

export interface LowStockRow {
  sku: string;
  name: string;
  stock: number;
  min: number;
}

export interface TenantSnapshot {
  tenantName: string;
  branches: number;
  users: number;
  customers: number;
  suppliers: number;
  products: number;
  units: number;
  batches: number;
  stockBaseUnits: number;
  stockValue: number;
  lowStock: LowStockRow[];
  transactions: number;
  transactionItems: number;
  revenueAllTime: number;
  revenue30d: number;
  grossMargin30d: number;
  expensesAllTime: number;
  expenses30d: number;
  receivables: number;
  payables: number;
  openShifts: number;
  pendingTransfers: number;
}

async function scalar(client: Client, sql: string, args: (string | number)[] = []): Promise<number> {
  const result = await client.execute({ sql, args });
  return Number(result.rows[0]?.value ?? 0);
}

export async function describeTenant(
  client: Client,
  now = new Date()
): Promise<TenantSnapshot> {
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const thirtyDaysAgoDate = thirtyDaysAgo.slice(0, 10);
  const tenantRow = await client.execute(`SELECT name FROM tenants LIMIT 1`);

  const lowStockResult = await client.execute(
    `SELECT p.sku, p.name,
            COALESCE(SUM(b.quantity_current), 0) AS stock,
            p.min_stock_level AS min
       FROM products p
       LEFT JOIN product_batches b ON b.product_id = p.id
      GROUP BY p.id
     HAVING stock < p.min_stock_level
      ORDER BY stock * 1.0 / NULLIF(p.min_stock_level, 0)`
  );

  const soldCost = await scalar(
    client,
    `SELECT COALESCE(SUM(ti.cost_price * ti.quantity), 0) AS value
       FROM transaction_items ti
       JOIN transactions t ON t.id = ti.transaction_id
      WHERE t.created_at >= ?`,
    [thirtyDaysAgo]
  );
  const revenue30d = await scalar(
    client,
    `SELECT COALESCE(SUM(total_amount), 0) AS value FROM transactions WHERE created_at >= ?`,
    [thirtyDaysAgo]
  );
  const expenses30d = await scalar(
    client,
    `SELECT COALESCE(SUM(amount), 0) AS value FROM expenses WHERE date >= ?`,
    [thirtyDaysAgoDate]
  );

  return {
    tenantName: String(tenantRow.rows[0]?.name ?? ''),
    branches: await scalar(client, `SELECT count(*) AS value FROM branches`),
    users: await scalar(client, `SELECT count(*) AS value FROM users`),
    customers: await scalar(client, `SELECT count(*) AS value FROM customers`),
    suppliers: await scalar(client, `SELECT count(*) AS value FROM suppliers`),
    products: await scalar(client, `SELECT count(*) AS value FROM products`),
    units: await scalar(client, `SELECT count(*) AS value FROM product_units`),
    batches: await scalar(client, `SELECT count(*) AS value FROM product_batches`),
    stockBaseUnits: await scalar(
      client,
      `SELECT COALESCE(SUM(quantity_current), 0) AS value FROM product_batches`
    ),
    stockValue: await scalar(
      client,
      `SELECT COALESCE(SUM(quantity_current * cost_price), 0) AS value FROM product_batches`
    ),
    lowStock: lowStockResult.rows.map((row) => ({
      sku: String(row.sku),
      name: String(row.name),
      stock: Number(row.stock),
      min: Number(row.min),
    })),
    transactions: await scalar(client, `SELECT count(*) AS value FROM transactions`),
    transactionItems: await scalar(client, `SELECT count(*) AS value FROM transaction_items`),
    revenueAllTime: await scalar(
      client,
      `SELECT COALESCE(SUM(total_amount), 0) AS value FROM transactions`
    ),
    revenue30d,
    grossMargin30d: revenue30d - soldCost,
    expensesAllTime: await scalar(
      client,
      `SELECT COALESCE(SUM(amount), 0) AS value FROM expenses`
    ),
    expenses30d,
    // Unpaid sales / purchases: what the Hutang & Piutang screen shows.
    receivables: await scalar(
      client,
      `SELECT COALESCE(SUM(total_amount - amount_paid), 0) AS value
         FROM transactions WHERE total_amount > amount_paid`
    ),
    payables: await scalar(
      client,
      `SELECT COALESCE(SUM(amount - amount_paid), 0) AS value
         FROM expenses WHERE amount > amount_paid`
    ),
    openShifts: await scalar(
      client,
      `SELECT count(*) AS value FROM shifts WHERE status = 'open'`
    ),
    pendingTransfers: await scalar(
      client,
      `SELECT count(*) AS value FROM stock_transfers WHERE status = 'pending'`
    ),
  };
}
