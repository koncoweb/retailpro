/**
 * GET /api/storefront/marketplace
 *
 * Public, read-only catalogue of **every active tenant** in one list: the online
 * shop is no longer one shop's window but a marketplace, so a visitor browses
 * goods from all RetailPro tenants side by side.
 *
 * Each row of the control-plane `tenant_databases` table is read in turn through
 * the same reader `/api/storefront/catalog` uses, with the tenant attached to
 * every product as its seller. One tenant failing (no branch, no warehouse, an
 * unreachable database) never takes the marketplace down: it is skipped and
 * counted, so the page can say "3 dari 4 toko tampil" instead of showing
 * nothing. The failure detail stays in the server log — this endpoint is public
 * and a libSQL error message readily names tables and columns.
 *
 * No credential reaches the browser: each tenant gets its own short-lived token
 * minted server-side and the client is closed before the response is written.
 */
import { createClient } from '@libsql/client';
import { getControlDb } from '../../server/control-db.js';
import { methodNotAllowed, sendJson, withErrors, type ApiRequest, type ApiResponse } from '../../server/http.js';
import { mintTenantToken } from '../../server/provision.js';
import { readTenantCatalog, type CatalogProduct, type TenantCatalog } from '../../server/storefront-catalog.js';
import { browserDbUrl } from '../../server/turso-platform.js';

/** A product plus who sells it — the only thing a marketplace adds to a shelf. */
interface MarketProduct extends CatalogProduct {
  /** Tenant slug: the seller's stable identity in URLs. */
  tenant: string;
  /** Registered company name, rendered on the tile. */
  seller: string;
  /** The branch/channel that fulfils the order. */
  branch: string;
}

interface MarketShop {
  slug: string;
  name: string;
  branch: string;
  warehouse: string;
  address: string | null;
  phone: string | null;
  productCount: number;
  categories: string[];
  /** Items in stock right now, so a shop tile can be shown without a catalogue. */
  inStock: number;
}

interface SkippedTenant {
  slug: string;
  /**
   * Why the shop is missing, at the level of detail a stranger may see. The
   * real error goes to the server log: a libSQL message ("no such column:
   * variant_attributes") would hand out the tenant schema.
   */
  reason: "unavailable";
}

/** The control-plane row this endpoint needs; everything else is the reader's. */
interface TenantRow {
  slug: string;
  company_name: string;
  db_name: string;
  db_hostname: string;
}

function allowCors(res: ApiResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/**
 * Reads one tenant without letting its failure abort the marketplace.
 *
 * The row travels back with the result so the caller never has to look the
 * tenant up again by slug — the two halves of a result can never drift apart.
 */
async function readOne(
  tenant: TenantRow
): Promise<{ tenant: TenantRow; catalog: TenantCatalog } | { tenant: TenantRow; error: unknown }> {
  try {
    const { token } = await mintTenantToken(tenant.db_name, tenant.db_hostname);
    const client = createClient({ url: browserDbUrl(tenant.db_hostname), authToken: token });
    try {
      // The prefix keeps two tenants' UUIDs apart once both lists are merged.
      return { tenant, catalog: await readTenantCatalog(client, tenant, `${tenant.slug}:`) };
    } finally {
      client.close();
    }
  } catch (error) {
    return { tenant, error };
  }
}

async function handler(req: ApiRequest, res: ApiResponse) {
  allowCors(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET', 'OPTIONS']);

  const tenants = await getControlDb()
    .selectFrom('tenant_databases')
    .select(['slug', 'company_name', 'db_name', 'db_hostname'])
    .where('status', '=', 'active')
    .orderBy('created_at', 'asc')
    .execute();

  // Sequential on purpose: each tenant is a separate database, and a burst of
  // parallel token mints plus six queries each is the fastest way to be rate
  // limited by the platform. A handful of tenants keeps this well under a
  // second; batching can wait until it measurably hurts.
  const results: Awaited<ReturnType<typeof readOne>>[] = [];
  for (const tenant of tenants) {
    results.push(await readOne(tenant));
  }

  const shops: MarketShop[] = [];
  const products: MarketProduct[] = [];
  const skipped: SkippedTenant[] = [];
  const categoryCounts = new Map<string, number>();

  for (const result of results) {
    const { tenant } = result;
    if ('error' in result) {
      console.error(
        `[storefront] tenant "${tenant.slug}" skipped:`,
        result.error instanceof Error ? result.error.message : result.error
      );
      skipped.push({ slug: tenant.slug, reason: 'unavailable' });
      continue;
    }
    const { catalog } = result;

    shops.push({
      slug: tenant.slug,
      name: tenant.company_name || catalog.shop.tenant,
      branch: catalog.shop.branch,
      warehouse: catalog.shop.warehouse,
      address: catalog.shop.address,
      phone: catalog.shop.phone,
      productCount: catalog.products.length,
      categories: catalog.categories.map((category) => category.name),
      inStock: catalog.products.filter((product) => product.stock > 0).length,
    });

    for (const product of catalog.products) {
      products.push({
        ...product,
        tenant: tenant.slug,
        seller: tenant.company_name || catalog.shop.tenant,
        branch: catalog.shop.branch,
      });
      if (!product.category) continue;
      categoryCounts.set(product.category, (categoryCounts.get(product.category) ?? 0) + 1);
    }
  }

  sendJson(res, 200, {
    shops,
    categories: [...categoryCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'id')),
    products,
    /** Tenants that answered, out of those registered — drives the status line. */
    tenants: { total: tenants.length, live: shops.length },
    skipped,
    syncedAt: new Date().toISOString(),
  });
}

export default withErrors(handler);
