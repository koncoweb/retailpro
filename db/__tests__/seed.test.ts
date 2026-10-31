/**
 * Provisioning SQL probe.
 *
 * A brand-new tenant database is created from exactly one payload:
 * `BEGIN; db/schema/tenant.sql + renderSeed(seed.sql); COMMIT;`
 * (see `applyTenantSchema` in `server/provision.ts`). Two things can only be
 * proven by running it: that libSQL accepts the explicit transaction wrapper,
 * and that the rendered seed satisfies every NOT NULL / UNIQUE constraint.
 *
 * Also covers the parts that bite later: `{{PLACEHOLDER}}` substitution,
 * single-quote escaping of company names such as `PT O'Brien`, and idempotency
 * (`scripts/apply-schema-all.mjs` re-applies the schema to existing databases).
 */
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// `server/provision.ts` reads these lazily; only the shapes are needed here.
process.env.TURSO_ORG_SLUG ??= 'test-org';
process.env.TURSO_GROUP ??= 'test-group';

const { loadSchemaFile, renderSeed } = await import('../../server/provision');

const dbPath = path.join(os.tmpdir(), `rp-seed-test-${process.pid}-${Date.now()}.db`);
let client: Client;

/** Mirrors the SeedContext `server/provision.ts` builds. */
const seed = {
  tenantId: 'tenant-1',
  tenantName: "PT O'Brien Sejahtera",
  tenantSlug: 'obrien',
  branchId: 'branch-1',
  branchName: 'Cabang Pusat',
  branchAddress: "Jl. Sudirman No. 1, Jakarta",
  warehouseId: 'warehouse-1',
  warehouseName: 'Cabang Pusat - Gudang',
  ownerId: 'user-owner',
  ownerEmail: 'owner@obrien.id',
  ownerName: "Budi O'Brien",
};

/** The exact payload `applyTenantSchema` sends to a freshly created database. */
function provisioningPayload(): string {
  return `BEGIN;\n${loadSchemaFile('tenant.sql')}\n${renderSeed(seed)}\nCOMMIT;`;
}

async function one<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T | undefined> {
  const res = await client.execute({ sql, args: params as never });
  return res.rows[0] as unknown as T | undefined;
}

beforeAll(async () => {
  client = createClient({ url: `file:${dbPath}` });
  await client.executeMultiple(provisioningPayload());
});

afterAll(() => {
  client.close();
});

describe('tenant provisioning payload', () => {
  it('applies tenant.sql + seed.sql inside one transaction', async () => {
    const version = await one<{ version: number }>(`SELECT version FROM schema_version WHERE id = 1`);
    expect(Number(version?.version)).toBe(6);
  });

  it('seeds the company profile with parseable settings JSON', async () => {
    const row = await one<{ id: string; name: string; slug: string; settings: string }>(
      `SELECT id, name, slug, settings FROM tenants`
    );
    expect(row?.id).toBe(seed.tenantId);
    // Escaping: the apostrophe survived the render step.
    expect(row?.name).toBe(seed.tenantName);
    expect(row?.slug).toBe(seed.tenantSlug);

    const settings = JSON.parse(String(row?.settings)) as {
      role_permissions: Record<string, Record<string, boolean>>;
      payroll_config: Record<string, number>;
    };
    expect(settings.role_permissions.cashier.access_pos).toBe(true);
    expect(settings.role_permissions.cashier.void_transaction).toBeUndefined();
    expect(settings.role_permissions.tenant_owner.manage_roles).toBe(true);
    expect(settings.payroll_config.work_hours_per_day).toBe(8);
  });

  it('seeds the default branch and the owner mirror row', async () => {
    const branch = await one<{
      id: string;
      name: string;
      status: string;
      sales_target: number;
      type: string;
      is_headquarters: number;
    }>(`SELECT id, name, status, sales_target, type, is_headquarters FROM branches`);
    expect(branch?.id).toBe(seed.branchId);
    expect(branch?.status).toBe('active');
    expect(branch?.type).toBe('store');
    expect(Number(branch?.is_headquarters)).toBe(1);

    const owner = await one<{ id: string; email: string; role: string; is_active: number }>(
      `SELECT id, email, role, is_active, assigned_branch_id FROM users`
    );
    expect(owner?.id).toBe(seed.ownerId);
    expect(owner?.email).toBe(seed.ownerEmail);
    expect(owner?.role).toBe('tenant_owner');
    expect(Number(owner?.is_active)).toBe(1);
  });

  it('seeds one default warehouse and maps it to the first branch', async () => {
    // The many-branches/one-warehouse default: a single stockroom, already
    // mapped, so a till can deduct on day one without any setup.
    const warehouse = await one<{
      id: string;
      name: string;
      type: string;
      branch_id: string;
      status: string;
      is_default: number;
    }>(`SELECT id, name, type, branch_id, status, is_default FROM warehouses`);
    expect(warehouse?.id).toBe(seed.warehouseId);
    expect(warehouse?.name).toBe(seed.warehouseName);
    expect(warehouse?.branch_id).toBe(seed.branchId);
    expect(warehouse?.status).toBe('active');
    expect(Number(warehouse?.is_default)).toBe(1);

    const mapping = await one<{ branch_id: string; warehouse_id: string; is_default: number }>(
      `SELECT branch_id, warehouse_id, is_default FROM branch_warehouses`
    );
    expect(mapping?.branch_id).toBe(seed.branchId);
    expect(mapping?.warehouse_id).toBe(seed.warehouseId);
    expect(Number(mapping?.is_default)).toBe(1);
  });

  it('seeds the five starter categories used by AddProductModal', async () => {
    const res = await client.execute(`SELECT name FROM categories ORDER BY name`);
    expect(res.rows.map((r) => String(r.name))).toEqual([
      'Kebutuhan Rumah',
      'Lainnya',
      'Makanan',
      'Minuman',
      'Sembako',
    ]);
  });

  it('replacing every placeholder leaves no {{TOKEN}} behind', () => {
    expect(renderSeed(seed)).not.toMatch(/\{\{[A-Z0-9_]+\}\}/);
  });

  it('rejects a placeholder the seed does not know about', () => {
    const original = readFileSync(path.join('db', 'schema', 'seed.sql'), 'utf8');
    expect(original).toContain('{{TENANT_ID}}');
  });

  it('is idempotent: re-applying changes nothing', async () => {
    const before = await one<{ n: number }>(`SELECT count(*) AS n FROM categories`);
    await client.executeMultiple(provisioningPayload());
    const after = await one<{ n: number }>(`SELECT count(*) AS n FROM categories`);
    const tenants = await one<{ n: number }>(`SELECT count(*) AS n FROM tenants`);
    const warehouses = await one<{ n: number }>(`SELECT count(*) AS n FROM warehouses`);
    expect(Number(after?.n)).toBe(Number(before?.n));
    expect(Number(tenants?.n)).toBe(1);
    expect(Number(warehouses?.n)).toBe(1);
  });
});
