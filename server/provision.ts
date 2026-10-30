/**
 * Tenant provisioning: create a Turso database, apply the schema + seed, and
 * register it in the control plane. Every step is either idempotent or undone on
 * failure, so a retry after an error never leaves an orphan database.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import { getControlDb, type TenantDatabaseRow } from './control-db.js';
import { BROWSER_TOKEN_TTL, maxTenantDatabases, tursoGroup } from './env.js';
import {
  browserDbUrl,
  createDatabase,
  createToken,
  deleteDatabase,
  type TursoDatabase,
} from './turso-platform.js';

export class ProvisionError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Schema files
// ---------------------------------------------------------------------------

const SQL_CACHE = new Map<string, string>();

/**
 * Reads `db/schema/<name>` from the deployment bundle.
 *
 * `vercel.json` ships `db/schema/**` with the API functions; `process.cwd()` is
 * the bundle root both locally and on Vercel. The parent-directory fallbacks
 * cover running the scripts from a subdirectory.
 */
export function loadSchemaFile(name: string): string {
  const cached = SQL_CACHE.get(name);
  if (cached) return cached;

  const candidates = [
    join(process.cwd(), 'db', 'schema', name),
    join(process.cwd(), '..', 'db', 'schema', name),
    join(process.cwd(), '..', '..', 'db', 'schema', name),
  ];

  for (const candidate of candidates) {
    try {
      const sql = readFileSync(candidate, 'utf8');
      SQL_CACHE.set(name, sql);
      return sql;
    } catch {
      // try next candidate
    }
  }

  throw new Error(
    `Cannot locate db/schema/${name}. Looked in: ${candidates.join(', ')}`
  );
}

/** SQL string literal escaping for the seed template. */
function sqlString(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export interface SeedContext {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  branchId: string;
  branchName: string;
  branchAddress: string;
  /** Stockroom created with the first branch: the tenant's default warehouse. */
  warehouseId: string;
  warehouseName: string;
  ownerId: string;
  ownerEmail: string;
  ownerName: string;
}

/**
 * Substitutes `{{PLACEHOLDER}}` tokens in `db/schema/seed.sql`.
 * Values are escaped exactly once, here.
 */
export function renderSeed(context: SeedContext): string {
  const template = loadSchemaFile('seed.sql');
  const values: Record<string, string> = {
    TENANT_ID: sqlString(context.tenantId),
    TENANT_NAME: sqlString(context.tenantName),
    TENANT_SLUG: sqlString(context.tenantSlug),
    BRANCH_ID: sqlString(context.branchId),
    BRANCH_NAME: sqlString(context.branchName),
    BRANCH_ADDRESS: sqlString(context.branchAddress),
    WAREHOUSE_ID: sqlString(context.warehouseId),
    WAREHOUSE_NAME: sqlString(context.warehouseName),
    OWNER_ID: sqlString(context.ownerId),
    OWNER_EMAIL: sqlString(context.ownerEmail),
    OWNER_NAME: sqlString(context.ownerName),
    CATEGORY_1_ID: sqlString(randomUUID()),
    CATEGORY_2_ID: sqlString(randomUUID()),
    CATEGORY_3_ID: sqlString(randomUUID()),
    CATEGORY_4_ID: sqlString(randomUUID()),
    CATEGORY_5_ID: sqlString(randomUUID()),
  };

  const rendered = template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key: string) => {
    if (!(key in values)) {
      throw new Error(`db/schema/seed.sql uses unknown placeholder ${match}`);
    }
    return values[key];
  });

  if (/\{\{[A-Z0-9_]+\}\}/.test(rendered)) {
    throw new Error('db/schema/seed.sql still contains unreplaced placeholders');
  }

  return rendered;
}

// ---------------------------------------------------------------------------
// Naming helpers
// ---------------------------------------------------------------------------

const RESERVED_SLUGS = new Set([
  'www',
  'api',
  'app',
  'admin',
  'auth',
  'login',
  'register',
  'dashboard',
  'pos',
  'internal',
  'system',
  'support',
]);

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

/** `rp-acme-8f3k2` — lowercase, dash-only, always <= 64 characters. */
export function buildDatabaseName(slug: string): string {
  const base = slugify(slug) || 'tenant';
  const suffix = Math.random().toString(36).slice(2, 7).padEnd(5, '0');
  return `rp-${base.slice(0, 48)}-${suffix}`.slice(0, 64);
}

export function assertUsableSlug(slug: string): string {
  const normalised = slugify(slug);
  if (normalised.length < 3) {
    throw new ProvisionError(400, 'invalid_slug', 'Slug must be at least 3 characters.');
  }
  if (RESERVED_SLUGS.has(normalised)) {
    throw new ProvisionError(409, 'slug_reserved', `"${normalised}" is reserved.`);
  }
  return normalised;
}

// ---------------------------------------------------------------------------
// Registry access
// ---------------------------------------------------------------------------

export async function countTenantDatabases(): Promise<number> {
  const db = getControlDb();
  const row = await db
    .selectFrom('tenant_databases')
    .select(({ fn }) => fn.countAll<string>().as('total'))
    .executeTakeFirst();
  return Number(row?.total ?? 0);
}

export async function findTenantByOwner(userId: string): Promise<TenantDatabaseRow | null> {
  const db = getControlDb();
  const row = await db
    .selectFrom('tenant_databases')
    .selectAll()
    .where('owner_user_id', '=', userId)
    .executeTakeFirst();
  return row ?? null;
}

export async function findTenantById(tenantId: string): Promise<TenantDatabaseRow | null> {
  const db = getControlDb();
  const row = await db
    .selectFrom('tenant_databases')
    .selectAll()
    .where('id', '=', tenantId)
    .executeTakeFirst();
  return row ?? null;
}

/**
 * Resolves the tenant for a signed-in identity.
 *
 * Owners reached their own row through `owner_user_id`; invited employees carry
 * `user.tenantId` instead. Both paths are needed because every user of a company
 * sign in through the same control-plane auth.
 */
export async function resolveTenantForUser(
  userId: string,
  tenantId?: string | null
): Promise<TenantDatabaseRow | null> {
  if (tenantId) {
    const byId = await findTenantById(tenantId);
    if (byId) return byId;
  }
  return findTenantByOwner(userId);
}

/**
 * Placeholder token accepted by `scripts/dev-db-server.mjs`, which serves a local
 * libSQL file and performs no authentication.
 */
const LOCAL_DEV_TOKEN = 'local-dev';

/** True for a database served by the loopback dev server, not by Turso. */
function isLoopbackHost(hostname?: string | null): boolean {
  if (!hostname) return false;
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\/?$/.test(hostname.trim());
}

export async function mintTenantToken(
  dbName: string,
  dbHostname?: string | null
): Promise<{ token: string; expiresAt: string }> {
  const ttlMs = parseTtl(BROWSER_TOKEN_TTL);

  // A local run has no Turso platform token: the dev server ignores the JWT, so
  // minting via the Platform API would only make localhost unusable.
  if (isLoopbackHost(dbHostname)) {
    return { token: LOCAL_DEV_TOKEN, expiresAt: new Date(Date.now() + ttlMs).toISOString() };
  }

  const { jwt } = await createToken(dbName, BROWSER_TOKEN_TTL, 'full-access');
  return { token: jwt, expiresAt: new Date(Date.now() + ttlMs).toISOString() };
}

function parseTtl(ttl: string): number {
  const match = /^(\d+)\s*(s|m|h|d)$/.exec(ttl.trim());
  if (!match) return 60 * 60 * 1000;
  const amount = Number(match[1]);
  const unit = match[2];
  const factor = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return amount * factor;
}

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

/** Applies the tenant schema + seed to an existing database. */
export async function applyTenantSchema(
  dbUrl: string,
  authToken: string,
  seed: SeedContext
): Promise<void> {
  const client = createClient({ url: dbUrl, authToken });
  try {
    const schema = loadSchemaFile('tenant.sql');
    const seedSql = renderSeed(seed);
    await client.executeMultiple(`BEGIN;\n${schema}\n${seedSql}\nCOMMIT;`);
  } finally {
    client.close();
  }
}

export interface ProvisionInput {
  userId: string;
  userEmail: string;
  userName: string;
  companyName: string;
  slug: string;
  branchName?: string;
  branchAddress?: string;
}

export interface ProvisionResult {
  tenantId: string;
  slug: string;
  dbName: string;
  hostname: string;
  dbUrl: string;
}

/**
 * Sequence (per the migration plan):
 *  1. reject if this user already owns a tenant
 *  2. enforce the free-tier database budget
 *  3. pick a database name
 *  4. create the database
 *  5. mint a short-lived token for the DDL
 *  6. apply schema + seed
 *  7. write the registry row and stamp the owner's user row
 *  8. on failure delete the database and the registry row
 */
export async function provisionTenant(input: ProvisionInput): Promise<ProvisionResult> {
  const existing = await findTenantByOwner(input.userId);
  if (existing) {
    throw new ProvisionError(409, 'tenant_exists', 'This account already owns a tenant.');
  }

  const slug = assertUsableSlug(input.slug);
  const budget = maxTenantDatabases();
  const used = await countTenantDatabases();
  if (used >= budget) {
    throw new ProvisionError(
      429,
      'tenant_limit_reached',
      `Tenant database limit reached (${used}/${budget}).`
    );
  }

  const slugOwner = await getControlDb()
    .selectFrom('tenant_databases')
    .select(['id'])
    .where('slug', '=', slug)
    .executeTakeFirst();
  if (slugOwner) {
    throw new ProvisionError(409, 'slug_taken', `The slug "${slug}" is already in use.`);
  }

  const dbName = buildDatabaseName(slug);
  const group = tursoGroup();
  let created: TursoDatabase | null = null;
  let registered = false;

  try {
    created = await createDatabase(dbName, group);
    if (!created.hostname) {
      throw new ProvisionError(502, 'turso_no_hostname', 'Turso did not return a hostname.');
    }

    const tenantId = randomUUID();
    const branchId = randomUUID();
    const warehouseId = randomUUID();
    const { jwt } = await createToken(dbName, '10m', 'full-access');

    const branchName = input.branchName?.trim() || 'Cabang Utama';

    await applyTenantSchema(browserDbUrl(created.hostname), jwt, {
      tenantId,
      tenantName: input.companyName,
      tenantSlug: slug,
      branchId,
      branchName,
      branchAddress: input.branchAddress?.trim() || '',
      warehouseId,
      warehouseName: `${branchName} - Gudang`,
      ownerId: input.userId,
      ownerEmail: input.userEmail,
      ownerName: input.userName,
    });

    const now = new Date().toISOString();
    const control = getControlDb();
    await control
      .insertInto('tenant_databases')
      .values({
        id: tenantId,
        owner_user_id: input.userId,
        slug,
        company_name: input.companyName,
        db_name: dbName,
        db_hostname: created.hostname,
        group_name: group,
        status: 'active',
        created_at: now,
        updated_at: now,
      })
      .execute();
    registered = true;

    await control
      .updateTable('user')
      .set({
        tenantId,
        role: 'tenant_owner',
        branchId,
        updatedAt: now,
      })
      .where('id', '=', input.userId)
      .execute();

    return {
      tenantId,
      slug,
      dbName,
      hostname: created.hostname,
      dbUrl: browserDbUrl(created.hostname),
    };
  } catch (error) {
    if (registered) {
      await getControlDb()
        .deleteFrom('tenant_databases')
        .where('db_name', '=', dbName)
        .execute()
        .catch(() => undefined);
    }
    if (created?.name) {
      await deleteDatabase(created.name).catch((cleanupError) => {
        console.error(`[provision] could not delete ${created?.name}:`, cleanupError);
      });
    }
    throw error;
  }
}
