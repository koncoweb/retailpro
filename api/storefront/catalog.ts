/**
 * GET /api/storefront/catalog
 *
 * Public, read-only catalogue for a tenant's online channel (the `type =
 * 'online'` branch, e.g. "Thalia Online"). It exists so the storefront app can
 * show real goods without ever holding a database credential: this handler
 * resolves the tenant, mints a short-lived token, reads the catalogue and
 * returns prose JSON.
 *
 * Prices come from `product_units` (what the customer actually buys — kg,
 * karung, pack), and `stock` is the on-hand figure **in the warehouse that
 * fulfils web orders**, which for an online branch is the central gudang: the
 * channel has no rack of its own.
 *
 * Query: `?slug=<tenant slug>` (defaults to STOREFRONT_TENANT_SLUG, then
 * `thalia`). CORS is wide open because the response is the same catalogue a
 * visitor can read in the browser anyway; nothing cost-bearing is included.
 */
import { createClient, type Client } from '@libsql/client';
import { getControlDb } from '../../server/control-db.js';
import {
  HttpError,
  methodNotAllowed,
  sendJson,
  withErrors,
  type ApiRequest,
  type ApiResponse,
} from '../../server/http.js';
import { mintTenantToken } from '../../server/provision.js';
import { browserDbUrl } from '../../server/turso-platform.js';

const DEFAULT_SLUG = 'thalia';

/** Storefront field names, deliberately narrower than the tenant tables. */
interface CatalogProduct {
  id: string;
  slug: string;
  sku: string;
  name: string;
  description: string | null;
  category: string | null;
  /** Base units available in the fulfilling warehouse. */
  stock: number;
  /** At or below `products.min_stock_level` in that warehouse. */
  lowStock: boolean;
  units: { name: string; factor: number; price: number }[];
}

function allowCors(res: ApiResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value && value.trim() ? value.trim() : null;
}

/**
 * URL-safe slug from the SKU.
 *
 * The SKU is the only stable human handle the catalogue offers, but it carries
 * no uniqueness constraint, so repeats are suffixed instead of being allowed to
 * collapse two products onto one storefront page.
 */
function slugFor(sku: string, name: string, taken: Set<string>): string {
  const base = (sku || name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'produk';
  let slug = base;
  for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;
  taken.add(slug);
  return slug;
}

async function readCatalog(client: Client, tenant: { company_name: string; slug: string }) {
  const branchRes = await client.execute(
    `SELECT id, name, code, address, phone
       FROM branches
      WHERE status = 'active'
      ORDER BY (type = 'online') DESC, is_headquarters DESC, code ASC
      LIMIT 1`
  );
  const branch = branchRes.rows[0] as unknown as
    | { id: string; name: string; code: string | null; address: string | null; phone: string | null }
    | undefined;
  if (!branch) {
    throw new HttpError(409, 'tenant_not_seeded', `Tenant "${tenant.slug}" has no active branch.`);
  }

  // The gudang, not a shop rack: a shared warehouse wins, then a `central` one.
  const warehouseRes = await client.execute({
    sql: `SELECT w.id, w.name
            FROM warehouses w
           WHERE w.status = 'active'
             AND (w.branch_id IS NULL OR w.branch_id <> ?)
           ORDER BY (w.branch_id IS NULL) DESC, (w.type = 'central') DESC,
                    w.is_default DESC, w.name ASC
           LIMIT 1`,
    args: [branch.id],
  });
  const warehouse = warehouseRes.rows[0] as unknown as
    | { id: string; name: string }
    | undefined;
  if (!warehouse) {
    throw new HttpError(409, 'tenant_not_seeded', `Tenant "${tenant.slug}" has no active warehouse.`);
  }

  const [productsRes, unitsRes, stockRes] = await Promise.all([
    client.execute(
      `SELECT id, sku, name, description, category, min_stock_level
         FROM products
        ORDER BY category ASC, name ASC`
    ),
    client.execute(
      `SELECT product_id, name, conversion_factor, price
         FROM product_units
        ORDER BY conversion_factor ASC, price ASC`
    ),
    client.execute({
      sql: `SELECT product_id, COALESCE(SUM(quantity_current), 0) AS on_hand
              FROM product_batches
             WHERE warehouse_id = ?
             GROUP BY product_id`,
      args: [warehouse.id],
    }),
  ]);

  const unitsByProduct = new Map<string, CatalogProduct['units']>();
  for (const row of unitsRes.rows as unknown as {
    product_id: string;
    name: string;
    conversion_factor: number;
    price: number;
  }[]) {
    const list = unitsByProduct.get(row.product_id) ?? [];
    list.push({
      name: row.name,
      factor: Number(row.conversion_factor),
      price: Number(row.price),
    });
    unitsByProduct.set(row.product_id, list);
  }

  const stockByProduct = new Map<string, number>();
  for (const row of stockRes.rows as unknown as { product_id: string; on_hand: number }[]) {
    stockByProduct.set(row.product_id, Number(row.on_hand));
  }

  const taken = new Set<string>();
  const products: CatalogProduct[] = [];
  for (const row of productsRes.rows as unknown as {
    id: string;
    sku: string;
    name: string;
    description: string | null;
    category: string | null;
    min_stock_level: number;
  }[]) {
    const units = unitsByProduct.get(row.id) ?? [];
    // A product with no selling unit has no price to show, so it is not sold.
    if (units.length === 0) continue;

    const stock = stockByProduct.get(row.id) ?? 0;
    products.push({
      id: row.id,
      slug: slugFor(row.sku, row.name, taken),
      sku: row.sku,
      name: row.name,
      description: row.description,
      category: row.category,
      stock,
      lowStock: stock <= Number(row.min_stock_level),
      units,
    });
  }

  const counts = new Map<string, number>();
  for (const product of products) {
    if (!product.category) continue;
    counts.set(product.category, (counts.get(product.category) ?? 0) + 1);
  }

  return {
    shop: {
      tenant: tenant.company_name,
      branch: branch.name,
      code: branch.code,
      address: branch.address,
      phone: branch.phone,
      warehouse: warehouse.name,
    },
    categories: [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name, 'id')),
    products,
    syncedAt: new Date().toISOString(),
  };
}

async function handler(req: ApiRequest, res: ApiResponse) {
  allowCors(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET', 'OPTIONS']);

  const slug =
    firstValue(req.query?.slug) ?? process.env.STOREFRONT_TENANT_SLUG?.trim() ?? DEFAULT_SLUG;

  const tenant = await getControlDb()
    .selectFrom('tenant_databases')
    .select(['id', 'slug', 'company_name', 'db_name', 'db_hostname', 'status'])
    .where('slug', '=', slug)
    .executeTakeFirst();
  if (!tenant) {
    throw new HttpError(404, 'tenant_not_found', `No tenant with slug "${slug}".`);
  }
  if (tenant.status !== 'active') {
    throw new HttpError(409, 'tenant_inactive', `Tenant "${slug}" is ${tenant.status}.`);
  }

  const { token } = await mintTenantToken(tenant.db_name, tenant.db_hostname);
  const client = createClient({ url: browserDbUrl(tenant.db_hostname), authToken: token });
  try {
    sendJson(res, 200, await readCatalog(client, tenant));
  } finally {
    client.close();
  }
}

export default withErrors(handler);
