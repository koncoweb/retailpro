/**
 * Tenant catalogue reader shared by the public storefront endpoints.
 *
 * `/api/storefront/catalog` uses it for a single tenant and
 * `/api/storefront/marketplace` fans it out over every active tenant, so both
 * return identical shop/product shapes and a product looks the same whichever
 * endpoint a client read it from.
 *
 * Prices come from `product_units` (what the customer actually buys — kg,
 * karung, pack), and `stock` is the on-hand figure **in the warehouse that
 * fulfils web orders**, which for an online branch is the central gudang: the
 * channel has no rack of its own.
 */
import type { Client } from '@libsql/client';
import { HttpError } from './http.js';
import { parseVariantAttributes, parseVariantGroups, variantLabel } from '../src/lib/variants.js';

/** One sellable SKU: the flavour or size a web customer actually orders. */
export interface CatalogVariant {
  id: string;
  sku: string;
  /** "Susu 250ml", in the product's own attribute order. */
  label: string;
  attributes: Record<string, string>;
  /** Base units of THIS variant in the fulfilling warehouse. */
  stock: number;
  units: { name: string; factor: number; price: number }[];
}

/** Storefront field names, deliberately narrower than the tenant tables. */
export interface CatalogProduct {
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
  /**
   * Product-wide pack summary for clients that do not read `variants`: every
   * pack name once, at the cheapest price any variant charges for it. A shop
   * that models flavours therefore still shows one coherent price list instead
   * of two rows named "kaleng" with different prices.
   */
  units: { name: string; factor: number; price: number }[];
  /** Every sellable SKU, each with its own stock and packs. */
  variants: CatalogVariant[];
}

/** The shop behind a catalogue: which tenant, which branch, which gudang. */
export interface CatalogShop {
  tenant: string;
  branch: string;
  code: string | null;
  address: string | null;
  phone: string | null;
  warehouse: string;
}

export interface TenantCatalog {
  shop: CatalogShop;
  categories: { name: string; count: number }[];
  products: CatalogProduct[];
  syncedAt: string;
}

/**
 * URL-safe slug from the SKU.
 *
 * The SKU is the only stable human handle the catalogue offers, but it carries
 * no uniqueness constraint, so repeats are suffixed instead of being allowed to
 * collapse two products onto one storefront page.
 */
function slugFor(sku: string, name: string, taken: Set<string>): string {
  const base =
    (sku || name)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'produk';
  let slug = base;
  for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;
  taken.add(slug);
  return slug;
}

/**
 * Reads one tenant's sellable catalogue.
 *
 * `prefix` namespaces product ids so the same UUID coming from two tenant
 * databases cannot collide once a marketplace merges them into one list.
 */
export async function readTenantCatalog(
  client: Client,
  tenant: { company_name: string; slug: string },
  prefix = ''
): Promise<TenantCatalog> {
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

  const [productsRes, unitsRes, stockRes, variantsRes, variantUnitsRes, variantStockRes] =
    await Promise.all([
      client.execute(
        `SELECT id, sku, name, description, category, min_stock_level, variant_attributes
           FROM products
          ORDER BY category ASC, name ASC`
      ),
      client.execute(
        `SELECT product_id, name, conversion_factor, price
           FROM product_units
          WHERE variant_id IS NULL
          ORDER BY conversion_factor ASC, price ASC`
      ),
      client.execute({
        sql: `SELECT product_id, COALESCE(SUM(quantity_current), 0) AS on_hand
                FROM product_batches
               WHERE warehouse_id = ?
               GROUP BY product_id`,
        args: [warehouse.id],
      }),
      client.execute(
        `SELECT id, product_id, sku, attributes
           FROM product_variants
          WHERE status = 'active'
          ORDER BY created_at ASC`
      ),
      client.execute(
        `SELECT variant_id, name, conversion_factor, price
           FROM product_units
          WHERE variant_id IS NOT NULL
          ORDER BY conversion_factor ASC, price ASC`
      ),
      client.execute({
        sql: `SELECT variant_id, COALESCE(SUM(quantity_current), 0) AS on_hand
                FROM product_batches
               WHERE warehouse_id = ? AND variant_id IS NOT NULL
               GROUP BY variant_id`,
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

  // A variant's packs and stock are stitched in memory: the three lists are
  // flat, so a carton of one flavour can never land on another.
  const variantUnitsById = new Map<string, CatalogVariant['units']>();
  for (const row of variantUnitsRes.rows as unknown as {
    variant_id: string;
    name: string;
    conversion_factor: number;
    price: number;
  }[]) {
    const list = variantUnitsById.get(row.variant_id) ?? [];
    list.push({
      name: row.name,
      factor: Number(row.conversion_factor),
      price: Number(row.price),
    });
    variantUnitsById.set(row.variant_id, list);
  }

  const variantStockById = new Map<string, number>();
  for (const row of variantStockRes.rows as unknown as { variant_id: string; on_hand: number }[]) {
    variantStockById.set(row.variant_id, Number(row.on_hand));
  }

  const variantsByProduct = new Map<string, CatalogVariant[]>();
  for (const row of variantsRes.rows as unknown as {
    id: string;
    product_id: string;
    sku: string;
    attributes: string;
  }[]) {
    const list = variantsByProduct.get(row.product_id) ?? [];
    list.push({
      id: row.id,
      sku: row.sku,
      // Filled in with the product's group order further down.
      label: '',
      attributes: parseVariantAttributes(row.attributes),
      stock: variantStockById.get(row.id) ?? 0,
      units: variantUnitsById.get(row.id) ?? [],
    });
    variantsByProduct.set(row.product_id, list);
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
    variant_attributes: string | null;
  }[]) {
    const units = unitsByProduct.get(row.id) ?? [];
    const groups = parseVariantGroups(row.variant_attributes);
    const variants = (variantsByProduct.get(row.id) ?? []).map((variant) => ({
      ...variant,
      label: variantLabel(variant.attributes, groups),
    }));
    // A product with no selling unit has no price to show, so it is not sold.
    if (units.length === 0 && variants.length === 0) continue;

    // Legacy pack list: one row per (pack, factor), cheapest price wins, so a
    // client without variant support cannot show two contradicting prices for
    // what it must believe is one product.
    const summary = new Map<string, CatalogProduct['units'][number]>();
    for (const pack of [...units, ...variants.flatMap((variant) => variant.units)]) {
      const key = `${pack.name}|${pack.factor}`;
      const seen = summary.get(key);
      if (!seen || pack.price < seen.price) summary.set(key, pack);
    }

    const stock = stockByProduct.get(row.id) ?? 0;
    products.push({
      id: `${prefix}${row.id}`,
      slug: slugFor(row.sku, row.name, taken),
      sku: row.sku,
      name: row.name,
      description: row.description,
      category: row.category,
      stock,
      lowStock: stock <= Number(row.min_stock_level),
      units: [...summary.values()].sort(
        (a, b) => a.factor - b.factor || a.price - b.price
      ),
      variants,
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
