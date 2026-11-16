/**
 * The one writer for a product and everything that hangs off it.
 *
 * This body used to live inside `Inventory.tsx`, which is why the vendor detail
 * screen grew its own copy of the same inserts and the two drifted. A screen
 * should decide *whether* a write is allowed and then call here; it should never
 * re-type the SQL that keeps a product, its variants, its packs, its stock, its
 * expense, its vendor catalogue row and its agreed buy price consistent.
 *
 * Everything one save touches happens in a single `runTransaction`: a failure
 * halfway can no longer leave a variant without packs, stock that finance never
 * recorded, or a product whose vendor row is missing.
 *
 * Design notes: `docs/spec-vendor-produk-terintegrasi.md`.
 */
import { runTransaction, type Transaction } from "@/lib/db";
import { logAuditTx } from "@/lib/audit";
import { getStockIssueMethod } from "@/lib/tenant-settings";
import { sortBatchesForIssue } from "@/lib/stock-issue";
import {
  variantLabel,
  variantSku,
  type VariantAttributeGroup,
  type VariantAttributes,
} from "@/lib/variants";
import type { WarehouseOption } from "@/lib/warehouse";
import {
  markPreferredVendor,
  resolveOrCreateVendor,
  upsertVendorCatalogLink,
  upsertVendorPrice,
} from "@/lib/vendor-catalog";

/**
 * One sellable pack of one variant (a "pecahan"): "Karton" holds 24 base units
 * and carries its OWN buy and sell price. Nothing here is derived from another
 * pack — a carton is not automatically 24 x the pcs price, which is exactly the
 * mistake this screen used to make.
 */
export interface ProductUnit {
  id?: string;
  /** Owning `product_variants.id`, filled in when rows are read back. */
  variant_id?: string | null;
  name: string;
  conversion_factor: number;
  /** Sell price for THIS pack, in rupiah. */
  price: number;
  /** Buy price for THIS pack, in rupiah; `cost / conversion_factor` is per base. */
  cost: number;
  barcode: string;
}

/** One row of the variant matrix: attributes, its packs, its opening stock. */
export interface ProductVariantDraft {
  /** `variantKey(attributes)`; empty string for a product without variants. */
  key: string;
  /** `product_variants.id` when the row already exists. */
  id?: string;
  attributes: VariantAttributes;
  sku: string;
  barcode: string;
  units: ProductUnit[];
  /** Opening/on-hand target per warehouse id, in base units. */
  stock: Record<string, number>;
}

/**
 * Exactly what the form hands the writer, so the SQL never has to re-derive it.
 *
 * `supplierId` is the vendor picked from the master list; `supplier` is the text
 * the operator typed. When only the text is known, `resolveOrCreateVendor` turns
 * it into a real master row — which is what stops a typed vendor name from
 * becoming a `suppliers` row without a code or a category.
 */
export interface ProductFormPayload {
  sku: string;
  name: string;
  category: string;
  /** Model summary: factor-1 sell price of the first variant. */
  price: number;
  /** Model summary: factor-1 buy price of the first variant. */
  cost: number;
  /** Sum of every variant's opening stock. */
  stock: number;
  minStock: number;
  supplier: string;
  /** `suppliers.id` behind the vendor, when the caller already knows it. */
  supplierId?: string | null;
  /** Per-warehouse total, for the table's stock column. */
  warehouses: Record<string, number>;
  /** `products.variant_attributes`; empty means a single default variant. */
  variantGroups: VariantAttributeGroup[];
  variants: ProductVariantDraft[];
}

/** The stored variant fields the writer needs to diff against the form. */
export interface StoredVariantView {
  id: string;
  attributes: VariantAttributes;
  /** On-hand per warehouse id, in base units. */
  warehouses: Record<string, number>;
}

/** The part of a stored product this writer reads. Structurally satisfied. */
export interface StoredProductView {
  id: string;
  variants: StoredVariantView[];
}

/** One `runTransaction`'s worth of vendor intent for a single product save. */
export interface VendorLinkIntent {
  vendorId: string;
  minOrderQty?: number | null;
  /** Whether this vendor owns the product's preferred flag. Defaults to true. */
  isPreferred?: boolean;
}

export interface SaveProductParams {
  product: ProductFormPayload;
  /** Present when editing; absent for a new product. */
  editing?: StoredProductView | null;
  /** The gudang rows the operator may put stock in, with their owning branch. */
  warehouses: WarehouseOption[];
  userId?: string | null;
  /** The operator's branch, used only when nobody owns the receiving warehouse. */
  branchId?: string | null;
  /** `manage_variants`: without it the whole template write is refused here. */
  mayEditVariant: boolean;
  /**
   * `manage_vendor_prices`: with it, the buy prices typed on the form become the
   * agreement and replace what was stored. Without it they only fill gaps, so a
   * negotiated price can never be stepped on by someone who may not negotiate.
   */
  mayEditVendorPrice: boolean;
  /**
   * A vendor the caller already resolved — the vendor detail screen knows whose
   * catalogue it is filling. Takes precedence over the form's own supplier.
   */
  vendorLink?: VendorLinkIntent | null;
}

/** Rounds money the way every other write in this app does. */
function money(value: number): number {
  return Math.round(Number(value) || 0);
}

/**
 * The vendor behind this save, created when only a name was offered.
 *
 * A caller-supplied `vendorLink` wins: the vendor screen knows the catalogue it
 * is writing, and re-resolving the typed name could point the product at a
 * different spelling of the same company.
 */
async function vendorForSave(
  tx: Transaction,
  product: ProductFormPayload,
  vendorLink: VendorLinkIntent | null | undefined
): Promise<string | null> {
  if (vendorLink?.vendorId) return vendorLink.vendorId;
  if (product.supplierId) return product.supplierId;
  return resolveOrCreateVendor(tx, product.supplier);
}

/**
 * Saves one product with its variants, packs, stock, vendor catalogue and prices.
 *
 * Order matters: a pack points at its variant and a batch points at both, so
 * variants are written first, then packs, then the stock movements, then the
 * vendor rows that quote the prices the packs just got.
 *
 * @returns the product's id.
 * @throws when the caller lacks `manage_variants`, when stock changed under the
 * form, or when a dropped variant still holds stock.
 */
export async function saveProductDraft(params: SaveProductParams): Promise<string> {
  const { product, editing, warehouses, userId, branchId, vendorLink } = params;
  if (!params.mayEditVariant) {
    throw new Error("Tidak berwenang mengelola template produk.");
  }

  let savedProductId = editing?.id ?? "";
  let createdProduct = false;

  // The axis list lives on the product, not on every variant row: the variants
  // carry the values only, and the render order comes from here.
  const variantGroups = product.variantGroups ?? [];

  // Stock reductions drain batches through the tenant's issue policy
  // (FIFO / LIFO / FEFO), read before the transaction opens.
  const issueMethod = await getStockIssueMethod();

  await runTransaction(async (tx) => {
    const vendorId = await vendorForSave(tx, product, vendorLink);

    /**
     * A warehouse may be shared between branches, so an expense is booked
     * against the branch that owns it — and against the operator's own branch
     * only when nobody owns the stock.
     */
    const branchForWarehouse = (warehouseId: string) =>
      warehouses.find((warehouse) => warehouse.id === warehouseId)?.branch_id ?? branchId ?? null;

    /** Books the purchase of newly added stock as an expense. */
    const bookStockPurchase = async (
      warehouseId: string,
      qty: number,
      unitCost: number,
      label: string
    ) => {
      // `unitCost` is per base unit, because that is what `qty` counts.
      const totalCost = Math.round(qty * unitCost);
      const isUnpaid = Boolean(vendorId);
      await tx.query(
        `INSERT INTO expenses (category, amount, date, description, status, amount_paid, supplier_id, branch_id)
         VALUES ('Pembelian Stok', $1, date('now'), $2, $3, $4, $5, $6)`,
        [
          totalCost,
          `${label}: ${product.name}`,
          isUnpaid ? "unpaid" : "paid",
          isUnpaid ? 0 : totalCost,
          vendorId,
          branchForWarehouse(warehouseId),
        ]
      );
    };

    /**
     * Removes stock of ONE variant through the tenant's issue policy. A negative
     * adjustment used to be written as a batch with a negative quantity, which
     * corrupted every later stock sum and every later batch deduction.
     *
     * The variant filter is not optional: without it a reduction on a carton of
     * coffee could drain the tea sitting in the same warehouse.
     */
    const reduceStock = async (warehouseId: string, variantId: string, qty: number) => {
      let remaining = qty;
      const batches = await tx.query<{
        id: string;
        quantity_current: number;
        received_at: string | null;
        expiry_date: string | null;
      }>(
        `SELECT id, quantity_current, received_at, expiry_date
           FROM product_batches
          WHERE product_id = $1 AND variant_id = $2 AND warehouse_id = $3 AND quantity_current > 0`,
        [savedProductId, variantId, warehouseId]
      );

      for (const batch of sortBatchesForIssue(batches.rows, issueMethod)) {
        if (remaining <= 1e-9) break;
        const take = Math.min(Number(batch.quantity_current), remaining);
        const updated = await tx.query(
          `UPDATE product_batches SET quantity_current = quantity_current - $1
            WHERE id = $2 AND quantity_current >= $1`,
          [take, batch.id]
        );
        if (updated.rowCount !== 1) {
          throw new Error("Stok berubah selama penyimpanan, silakan ulangi");
        }
        remaining -= take;
      }

      if (remaining > 1e-9) {
        throw new Error(`Stok gudang tidak mencukupi untuk dikurangi ${remaining} unit`);
      }
    };

    // 1. The product row. `cost_price` stays a summary — the factor-1 buy price
    // of the first variant — because the table and the PO screen read a single
    // cost per product.
    if (editing) {
      await tx.query(
        `UPDATE products
            SET sku=$1, name=$2, category=$3, min_stock_level=$4, supplier_id=$5,
                cost_price=$6, variant_attributes=$7
          WHERE id=$8`,
        [
          product.sku,
          product.name,
          product.category,
          product.minStock,
          vendorId,
          product.cost,
          JSON.stringify(variantGroups),
          editing.id,
        ]
      );
    } else {
      const productRes = await tx.query<{ id: string }>(
        `INSERT INTO products
           (sku, name, category, min_stock_level, is_tracked, supplier_id, cost_price, variant_attributes)
         VALUES ($1, $2, $3, $4, 1, $5, $6, $7)
         RETURNING id`,
        [
          product.sku,
          product.name,
          product.category,
          product.minStock,
          vendorId,
          product.cost,
          JSON.stringify(variantGroups),
        ]
      );
      savedProductId = productRes.rows[0].id;
      createdProduct = true;
    }

    // 2. Variants the form dropped. A variant that still holds stock is NOT
    // deleted: its batches would be orphaned and the quantity would vanish from
    // every stock sum. The owner is asked to empty it first.
    const storedVariants = editing?.variants ?? [];
    const incomingVariantIds = new Set(
      product.variants.map((variant) => variant.id).filter((id): id is string => Boolean(id))
    );

    for (const stored of storedVariants) {
      if (incomingVariantIds.has(stored.id)) continue;
      const qtyRes = await tx.query<{ qty: number }>(
        `SELECT COALESCE(SUM(quantity_current), 0) AS qty
           FROM product_batches
          WHERE variant_id = $1`,
        [stored.id]
      );
      if (Number(qtyRes.rows[0]?.qty ?? 0) > 1e-9) {
        throw new Error(
          `Varian "${variantLabel(stored.attributes, variantGroups)}" masih punya stok; ` +
            "kosongkan dulu sebelum dihapus"
        );
      }
      await tx.query(`DELETE FROM product_units WHERE variant_id = $1`, [stored.id]);
      await tx.query(`DELETE FROM product_variants WHERE id = $1`, [stored.id]);
    }

    // 3. Each variant with its own packs and its own stock. A carton of one
    // flavour is priced and counted on its own row, never through another.
    for (const draft of product.variants) {
      const attributes = draft.attributes ?? {};
      const label = variantLabel(attributes, variantGroups);
      const sku = (draft.sku || variantSku(product.sku, attributes)).trim() || product.sku;
      const basePack =
        draft.units.find((unit) => Number(unit.conversion_factor) === 1) ?? draft.units[0];
      const variantCost = money(basePack?.cost ?? product.cost);
      const variantPrice = money(basePack?.price ?? product.price);

      let variantId = draft.id ?? "";
      if (variantId) {
        await tx.query(
          `UPDATE product_variants
              SET sku=$1, name=$2, attributes=$3, barcode=$4,
                  cost_price=$5, price=$6, status='active'
            WHERE id=$7`,
          [sku, label, JSON.stringify(attributes), draft.barcode || "", variantCost, variantPrice, variantId]
        );
      } else {
        const variantRes = await tx.query<{ id: string }>(
          `INSERT INTO product_variants
             (product_id, sku, name, attributes, barcode, cost_price, price)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [
            savedProductId,
            sku,
            label,
            JSON.stringify(attributes),
            draft.barcode || "",
            variantCost,
            variantPrice,
          ]
        );
        variantId = variantRes.rows[0].id;
      }

      // Packs of THIS variant: drop the ones the form removed, update the rest,
      // add the new ones. `variant_id` is what keeps two variants from colliding
      // on "Pcs".
      const existingUnitsRes = await tx.query<{ id: string }>(
        `SELECT id FROM product_units WHERE variant_id = $1`,
        [variantId]
      );
      const incomingUnitIds = draft.units
        .map((unit) => unit.id)
        .filter((id): id is string => Boolean(id));

      for (const existing of existingUnitsRes.rows) {
        if (!incomingUnitIds.includes(existing.id)) {
          await tx.query(`DELETE FROM product_units WHERE id = $1`, [existing.id]);
        }
      }

      for (const unit of draft.units) {
        const values = [
          unit.name,
          Number(unit.conversion_factor) || 1,
          Number(unit.cost) || 0,
          Number(unit.price) || 0,
          unit.barcode || "",
        ];
        if (unit.id) {
          await tx.query(
            `UPDATE product_units
                SET name=$1, conversion_factor=$2, cost=$3, price=$4, barcode=$5
              WHERE id=$6`,
            [...values, unit.id]
          );
        } else {
          await tx.query(
            `INSERT INTO product_units
               (product_id, variant_id, name, conversion_factor, cost, price, barcode)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [savedProductId, variantId, ...values]
          );
        }

        // The buy price the operator just typed is also what this vendor quotes
        // for this pack, so the price list (the "template PO") has to follow it.
        // Without `manage_vendor_prices` a zero-cost gap is filled but an
        // existing agreement is never replaced.
        if (vendorId && money(unit.cost) > 0) {
          await upsertVendorPrice(tx, {
            vendorId,
            variantId,
            unitName: unit.name,
            conversionFactor: Number(unit.conversion_factor) || 1,
            buyPrice: money(unit.cost),
            userId: userId ?? null,
            mode: params.mayEditVendorPrice ? "overwrite" : "gap-only",
            source: "form produk",
          });
        }
      }

      // Stock of THIS variant, per warehouse. The form sends the target, so the
      // difference against what the row already holds is the movement.
      for (const [warehouseId, target] of Object.entries(draft.stock ?? {})) {
        const previous =
          editing?.variants.find((row) => row.id === variantId)?.warehouses[warehouseId] ?? 0;
        const diff = Number(target) - previous;
        if (Math.abs(diff) < 1e-9) continue;

        if (diff > 0) {
          await tx.query(
            `INSERT INTO product_batches
             (warehouse_id, product_id, variant_id, batch_number, quantity_initial, quantity_current, cost_price, received_at, supplier_id)
             VALUES ($1, $2, $3, $4, $5, $5, $6, strftime('%Y-%m-%dT%H:%M:%fZ','now'), $7)`,
            [
              warehouseId,
              savedProductId,
              variantId,
              `${createdProduct ? "BATCH" : "ADJ"}-${Date.now()}`,
              diff,
              variantCost,
              vendorId,
            ]
          );
          await bookStockPurchase(
            warehouseId,
            diff,
            variantCost,
            createdProduct ? "Pembelian Stok Awal" : "Pembelian Stok Tambahan"
          );
        } else {
          await reduceStock(warehouseId, variantId, Math.abs(diff));
        }
      }
    }

    // 4. The product's vendor is also its catalogue entry, and the vendor the PO
    // screen should default to. `is_preferred` is moved explicitly so a product
    // can never end up with two preferred suppliers — an auto-fill that depended
    // on row order is not an auto-fill.
    if (vendorId) {
      await upsertVendorCatalogLink(tx, {
        vendorId,
        productId: savedProductId,
        lastCost: money(product.cost),
        minOrderQty: vendorLink?.minOrderQty ?? null,
        isPreferred: vendorLink ? vendorLink.isPreferred !== false : true,
      });
      await markPreferredVendor(tx, { vendorId, productId: savedProductId });
    }

    await logAuditTx(tx, {
      action: createdProduct ? "create_product" : "update_product",
      entity: "products",
      entityId: savedProductId,
      details: { sku: product.sku, name: product.name },
      userId: userId ?? undefined,
    });
  });

  return savedProductId;
}

/** One extra pack a sheet row adds beside the base unit. */
export interface ImportedPack {
  unitName: string;
  conversionFactor: number;
  /** Buy price PER PACK, exactly as the vendor quoted it. */
  cost: number;
  /** Sell price PER PACK. */
  price: number;
}

/**
 * One flat sheet row of a product, as the importer hands it over.
 *
 * A row without a vendor or an attribute axis becomes the single `Default`
 * variant — the same shape migration 006 backfilled.
 */
export interface ImportedProductRow {
  sku: string;
  name: string;
  category: string;
  price: number;
  cost: number;
  stock: number;
  minStock: number;
  /** Base pack name; blank means "Pcs". */
  unitName?: string;
  /** Packs beyond the base one, each with its own buy and sell price. */
  packs?: ImportedPack[];
  /** Vendor minimum order for this product, when the sheet carries one. */
  minOrderQty?: number | null;
  /** That vendor's own article number for this product. */
  vendorSku?: string | null;
}

/**
 * Inserts one imported product: the row, its default variant, its base pack, the
 * vendor catalogue link and the opening batch — in the CALLER's transaction.
 *
 * Bulk imports deliberately take the executor instead of opening a transaction:
 * a cloud round-trip per row would make a 500-line sheet crawl, while one
 * transaction per vendor block keeps a failure's blast radius inside that vendor.
 *
 * @returns the new product's id.
 */
export async function insertImportedProduct(
  tx: Transaction,
  row: ImportedProductRow,
  options: {
    warehouseId: string | null;
    vendorId: string | null;
    userId?: string | null;
    isPreferredVendor?: boolean;
    /** Provenance written to `vendor_price_list.notes`. */
    priceSource?: "import" | "form produk" | "katalog vendor";
    /**
     * Whether the operator may replace an agreed buy price. The key is
     * `manage_vendor_prices`; a sheet imported without it still fills the gaps
     * but never steps on a negotiated price. Default: `gap-only`.
     */
    priceMode?: "overwrite" | "gap-only";
  }
): Promise<string> {
  const unitName = String(row.unitName ?? "").trim() || "Pcs";
  const cost = money(row.cost);
  const price = money(row.price);

  const res = await tx.query<{ id: string }>(
    `INSERT INTO products (sku, name, category, cost_price, min_stock_level, supplier_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [row.sku, row.name, row.category, cost, row.minStock, options.vendorId]
  );
  const productId = res.rows[0].id;

  // Every product owns at least one variant. An imported row has no attribute
  // axes, so it becomes the single `Default` variant.
  const variantRes = await tx.query<{ id: string }>(
    `INSERT INTO product_variants (product_id, sku, name, attributes, cost_price, price)
     VALUES ($1, $2, 'Default', '{}', $3, $4)
     RETURNING id`,
    [productId, row.sku, cost, price]
  );
  const variantId = variantRes.rows[0].id;

  // The factor-1 pack is where a product's buy and sell price live; a product
  // without one has no price the POS could charge.
  await tx.query(
    `INSERT INTO product_units (product_id, variant_id, name, conversion_factor, cost, price)
     VALUES ($1, $2, $3, 1, $4, $5)
     ON CONFLICT (variant_id, conversion_factor) DO UPDATE SET
       cost = excluded.cost,
       price = excluded.price`,
    [productId, variantId, unitName, cost, price]
  );

  const writtenPacks: Array<{ unitName: string; conversionFactor: number; cost: number }> = [
    { unitName, conversionFactor: 1, cost },
  ];

  // A flat sheet gives one line per pack: a carton is stocked and priced on its
  // own row, never derived from the piece.
  for (const pack of row.packs ?? []) {
    const factor = Number(pack.conversionFactor) || 1;
    const name = String(pack.unitName ?? "").trim();
    if (!name || factor === 1 || name.toLowerCase() === unitName.toLowerCase()) continue;
    const packCost = money(pack.cost);
    await tx.query(
      `INSERT INTO product_units (product_id, variant_id, name, conversion_factor, cost, price)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (variant_id, conversion_factor) DO UPDATE SET
         name = excluded.name,
         cost = excluded.cost,
         price = excluded.price`,
      [productId, variantId, name, factor, packCost, money(pack.price)]
    );
    writtenPacks.push({ unitName: name, conversionFactor: factor, cost: packCost });
  }

  // Rows that name a vendor register the catalogue link, so the vendor screen
  // and the PO auto-fill see the product immediately.
  if (options.vendorId) {
    await upsertVendorCatalogLink(tx, {
      vendorId: options.vendorId,
      productId,
      vendorSku: row.vendorSku ?? null,
      lastCost: cost,
      minOrderQty: row.minOrderQty ?? null,
      isPreferred: options.isPreferredVendor !== false,
    });
    await markPreferredVendor(tx, { vendorId: options.vendorId, productId });

    // Import may write the agreed buy price: the owner typed it into the sheet,
    // so it *is* the agreement. One row per pack, because that is how the vendor
    // quoted it.
    for (const pack of writtenPacks) {
      await upsertVendorPrice(tx, {
        vendorId: options.vendorId,
        variantId,
        unitName: pack.unitName,
        conversionFactor: pack.conversionFactor,
        buyPrice: pack.cost,
        minQty: row.minOrderQty ?? null,
        userId: options.userId ?? null,
        mode: options.priceMode ?? "gap-only",
        source: options.priceSource ?? "import",
      });
    }
  }

  if (options.warehouseId && Number(row.stock) > 0) {
    await tx.query(
      `INSERT INTO product_batches
         (warehouse_id, product_id, variant_id, batch_number, quantity_initial, quantity_current, cost_price)
       VALUES ($1, $2, $3, $4, $5, $5, $6)`,
      [options.warehouseId, productId, variantId, "INITIAL-IMPORT", row.stock, cost]
    );
  }

  await logAuditTx(tx, {
    action: "create_product",
    entity: "products",
    entityId: productId,
    details: { sku: row.sku, name: row.name, via: "import" },
    userId: options.userId ?? undefined,
  });

  return productId;
}
