import { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { BackOfficeLayout } from "@/components/layout/BackOfficeLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search,
  Plus,
  MoreHorizontal,
  Package,
  AlertTriangle,
  TrendingUp,
  Filter,
  Edit,
  Trash2,
  Eye,
  BarChart3,
  ArrowLeftRight,
  ClipboardCheck,
  ShoppingCart,
  Loader2,
  ClipboardList,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from "lucide-react";
import { ProductImportExport } from "@/components/inventory/ProductImportExport";
import { AddProductModal } from "@/components/inventory/AddProductModal";
import { StockTransferModal } from "@/components/inventory/StockTransferModal";
import { StockOpnameModal } from "@/components/inventory/StockOpnameModal";
import { PurchaseOrderPanel } from "@/components/inventory/PurchaseOrderPanel";
import type { VendorOption } from "@/components/inventory/PurchaseOrderModal";
import { toast } from "sonner";
import { query, parseJson, runTransaction, batchQuery } from "@/lib/db";
import { mintSkuForCategory } from "@/lib/inventory-utils";
import { logAudit, logAuditTx } from "@/lib/audit";
import {
  WAREHOUSES_SQL,
  resolveBranchWarehouse,
  resolveWarehouseBranch,
  warehouseLabel,
  type WarehouseOption,
} from "@/lib/warehouse";
import { getStockIssueMethod } from "@/lib/tenant-settings";
import { sortBatchesForIssue } from "@/lib/stock-issue";
import {
  appendImportedVariants,
  insertImportedProduct,
  saveProductDraft,
  type ImportedVariantRow,
} from "@/lib/product-write";
import type {
  ImportedProductSeed,
  ImportVariantPlan,
  ProductImportPlan,
} from "@/lib/product-import";
import type { ProductImportContext } from "@/components/inventory/ProductImportExport";
import { resolveOrCreateVendor } from "@/lib/vendor-catalog";
import {
  createTransfer,
  dispatchTransfer,
  receiveTransfer,
  transferStatusLabel,
} from "@/lib/stock-movement";
import { usePermissions } from "@/hooks/use-permissions";
import { warehouseInScope, type RoleScope } from "@/lib/permission-matrix";
import { useBarcodeScanner } from "@/hooks/use-barcode-scanner";

import { ProductUnit, type ProductFormPayload } from "@/components/inventory/AddProductModal";
import {
  parseVariantAttributes,
  parseVariantGroups,
  variantLabel,
  type VariantAttributeGroup,
  type VariantAttributes,
} from "@/lib/variants";
import { cn } from "@/lib/utils";
import {
  defaultSortDirection,
  sortInventoryRows,
  type InventorySortKey,
  type SortDirection,
} from "@/lib/inventory-sort";

/**
 * One sellable variant of a product, as the table and the edit form need it.
 *
 * `units` holds this variant's own packs, each with its own buy and sell price:
 * a carton of one flavour is not priced from the piece of another.
 */
export interface ProductVariantRow {
  id: string;
  attributes: VariantAttributes;
  sku: string;
  barcode: string;
  /** Buy price of this variant's base pack. */
  cost: number;
  /** Sell price of this variant's base pack. */
  price: number;
  /** On-hand quantity per warehouse id, in base units. */
  warehouses: Record<string, number>;
  units: ProductUnit[];
}

interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  price: number;
  cost: number;
  stock: number;
  minStock: number;
  /** On-hand quantity per warehouse id. */
  warehouses: Record<string, number>;
  lastRestock: string;
  supplier: string;
  /** Vendor master id behind `supplier`, used by the PO screen. */
  supplierId: string | null;
  /** Vendor the PO should default to: `vendor_products.is_preferred`. */
  preferredVendorId: string | null;
  /** Vendors that also supply this product through vendor_products. */
  vendorIds: string[];
  /** `vendor_products.last_cost` per vendor, so a PO starts from the right price. */
  vendorCosts: Record<string, number>;
  units: ProductUnit[];
  /** `products.variant_attributes`; empty means a single Default variant. */
  variantGroups: VariantAttributeGroup[];
  /** One row per sellable variant, each with its own packs and stock. */
  variants: ProductVariantRow[];
}

/**
 * A sortable column header. The label is a real button so it toggles on click
 * or Enter, and the caret shows which column and direction is active so a
 * dense table never loses its sort state.
 */
function SortableHead({
  label,
  columnKey,
  activeKey,
  direction,
  onSort,
  align = "left",
}: {
  label: string;
  columnKey: InventorySortKey;
  activeKey: InventorySortKey | null;
  direction: SortDirection;
  onSort: (key: InventorySortKey) => void;
  align?: "left" | "center" | "right";
}) {
  const active = activeKey === columnKey;
  const Icon = !active ? ArrowUpDown : direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead
      className={cn(
        "select-none",
        align === "right" && "text-right",
        align === "center" && "text-center",
      )}
    >
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        title={`Urutkan berdasarkan ${label}`}
        className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
      >
        {label}
        <Icon className={cn("h-3.5 w-3.5", active ? "text-foreground" : "opacity-40")} />
      </button>
    </TableHead>
  );
}

/**
 * Statements for the inventory screen. They live at module scope so the mount
 * load can send them all in one `batchQuery()` round-trip instead of four
 * sequential trips to the tenant database.
 */
const PRODUCTS_SQL = `
  SELECT 
    p.id, 
    p.sku, 
    p.name, 
    p.category, 
    p.min_stock_level,
    p.variant_attributes,
    (
      SELECT price 
      FROM product_units 
      WHERE product_id = p.id AND conversion_factor = 1 
      ORDER BY created_at ASC 
      LIMIT 1
    ) as price,
    COALESCE(p.cost_price, 0) as cost,
    COALESCE((
      SELECT SUM(quantity_current) 
      FROM product_batches 
      WHERE product_id = p.id
    ), 0) as stock,
    COALESCE((
      SELECT json_group_object(w.id, COALESCE(sum_qty, 0))
      FROM warehouses w
      LEFT JOIN (
        SELECT warehouse_id, SUM(quantity_current) as sum_qty
        FROM product_batches
        WHERE product_id = p.id
        GROUP BY warehouse_id
      ) pb_sum ON w.id = pb_sum.warehouse_id
    ), '{}') as warehouse_stock,
    (
      SELECT s.name 
      FROM suppliers s 
      WHERE s.id = p.supplier_id
    ) as supplier,
    p.supplier_id,
    (
      SELECT vendor_id
      FROM vendor_products
      WHERE product_id = p.id AND is_preferred = 1
      LIMIT 1
    ) as preferred_vendor_id,
    COALESCE((
      SELECT json_group_array(vendor_id)
      FROM vendor_products
      WHERE product_id = p.id
    ), '[]') as vendor_ids,
    COALESCE((
      SELECT json_group_object(vendor_id, last_cost)
      FROM vendor_products
      WHERE product_id = p.id
    ), '{}') as vendor_costs,
    COALESCE((
       SELECT json_group_array(json_object(
         'id', id, 
         'name', name, 
         'conversion_factor', conversion_factor, 
         'price', price,
         'cost', cost,
         'variant_id', variant_id,
         'barcode', barcode
       ))
       FROM product_units 
       WHERE product_id = p.id
    ), '[]') as units,
    p.created_at
  FROM products p
  ORDER BY p.created_at DESC
`;

/**
 * Variants, their packs and their stock arrive as three FLAT projections instead
 * of one nested `json_group_array`.
 *
 * libSQL gives no ordering guarantee across nesting levels, so a nested
 * aggregate can land a pack on the wrong variant. Three flat lists stitched by
 * id in `mapProductRows` keep the ordering explicit and still fit in the one
 * `batchQuery()` round-trip the screen already made.
 */
const VARIANTS_SQL = `
  SELECT id, product_id, sku, name, attributes, barcode, cost_price, price
  FROM product_variants
  ORDER BY created_at ASC
`;

const VARIANT_UNITS_SQL = `
  SELECT id, product_id, variant_id, name, conversion_factor, price, cost, barcode
  FROM product_units
  WHERE variant_id IS NOT NULL
  ORDER BY conversion_factor ASC
`;

const VARIANT_STOCK_SQL = `
  SELECT variant_id, warehouse_id, SUM(quantity_current) AS qty
  FROM product_batches
  WHERE variant_id IS NOT NULL AND quantity_current > 0
  GROUP BY variant_id, warehouse_id
`;

const TRANSFERS_SQL = `
  SELECT 
    st.id,
    st.reference_number,
    w1.name as source_warehouse_name,
    w2.name as destination_warehouse_name,
    st.status,
    st.created_at,
    (SELECT COUNT(*) FROM transfer_items ti WHERE ti.transfer_id = st.id) as items_count
  FROM stock_transfers st
  LEFT JOIN warehouses w1 ON st.source_warehouse_id = w1.id
  LEFT JOIN warehouses w2 ON st.destination_warehouse_id = w2.id
  ORDER BY st.created_at DESC
`;

/** Row shape of `TRANSFERS_SQL` below. */
interface TransferRow {
  id: string;
  reference_number: string;
  source_warehouse_name: string | null;
  destination_warehouse_name: string | null;
  status: string;
  created_at: string;
  items_count: number;
}

const SUPPLIERS_SQL = `
  SELECT id, name, code, payment_terms_days, lead_time_days, status, ppn_enabled
  FROM suppliers
  ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, name ASC
`;

/**
 * Route segment <-> tab.
 *
 * The four "Inventory" menu entries in the sidebar are four routes that all
 * render this one component, and React keeps the same component instance alive
 * across them. The tab therefore has to be read from the URL on every render:
 * seeding `Tabs` with `defaultValue` showed the first tab forever, so clicking
 * "Purchase Order" changed the address bar while the screen stayed on Produk.
 */
const TAB_PATHS = {
  products: "/backoffice/inventory/products",
  "stock-in": "/backoffice/inventory/stock-in",
  opname: "/backoffice/inventory/opname",
  po: "/backoffice/inventory/po",
} as const;

type InventoryTab = keyof typeof TAB_PATHS;

/** Unknown paths fall back to the tab that has content for them. */
function tabFromPath(pathname: string): InventoryTab {
  const segment = pathname.split("/").filter(Boolean).pop() ?? "";
  return segment in TAB_PATHS ? (segment as InventoryTab) : "products";
}

/**
 * Stitches the four product queries into rows the screen can render.
 *
 * The variant side is joined in memory on purpose: `VARIANTS_SQL`,
 * `VARIANT_UNITS_SQL` and `VARIANT_STOCK_SQL` are independent flat lists, so a
 * pack or a warehouse total can never be attributed to the wrong variant.
 */
function mapProductRows(
  rows: unknown[],
  variantRows: unknown[],
  unitRows: unknown[],
  stockRows: unknown[]
): Product[] {
  const packsByVariant = new Map<string, ProductUnit[]>();
  for (const row of unitRows as Array<Record<string, unknown>>) {
    const variantId = String(row.variant_id ?? "");
    if (!variantId) continue;
    const pack: ProductUnit = {
      id: String(row.id),
      variant_id: variantId,
      name: String(row.name ?? ""),
      conversion_factor: Number(row.conversion_factor ?? 1) || 1,
      price: Number(row.price ?? 0),
      cost: Number(row.cost ?? 0),
      barcode: String(row.barcode ?? ""),
    };
    const bucket = packsByVariant.get(variantId);
    if (bucket) bucket.push(pack);
    else packsByVariant.set(variantId, [pack]);
  }

  const stockByVariant = new Map<string, Record<string, number>>();
  for (const row of stockRows as Array<Record<string, unknown>>) {
    const variantId = String(row.variant_id ?? "");
    if (!variantId) continue;
    const bucket = stockByVariant.get(variantId) ?? {};
    bucket[String(row.warehouse_id)] = Number(row.qty ?? 0);
    stockByVariant.set(variantId, bucket);
  }

  const variantsByProduct = new Map<string, ProductVariantRow[]>();
  for (const row of variantRows as Array<Record<string, unknown>>) {
    const id = String(row.id);
    const productId = String(row.product_id);
    const list = variantsByProduct.get(productId) ?? [];
    list.push({
      id,
      attributes: parseVariantAttributes(row.attributes),
      sku: String(row.sku ?? ""),
      barcode: String(row.barcode ?? ""),
      cost: Number(row.cost_price ?? 0),
      price: Number(row.price ?? 0),
      warehouses: stockByVariant.get(id) ?? {},
      units: packsByVariant.get(id) ?? [],
    });
    variantsByProduct.set(productId, list);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (rows as any[]).map((row) => {
    const variants = variantsByProduct.get(row.id) ?? [];
    return {
      id: row.id,
      sku: row.sku,
      name: row.name,
      category: row.category || "Uncategorized",
      price: parseFloat(row.price) || 0,
      cost: parseFloat(row.cost),
      stock: parseFloat(row.stock),
      minStock: row.min_stock_level,
      // JSON columns arrive as TEXT — parse them before use.
      warehouses: parseJson<Record<string, number>>(row.warehouse_stock, {}),
      lastRestock: row.created_at,
      supplier: row.supplier || "-",
      supplierId: row.supplier_id ?? null,
      preferredVendorId: row.preferred_vendor_id ?? null,
      vendorIds: parseJson<string[]>(row.vendor_ids, []),
      vendorCosts: parseJson<Record<string, number>>(row.vendor_costs, {}),
      // Falls back to the product's own packs so a row written before
      // migration 006 keeps showing its units.
      units: variants[0]?.units ?? parseJson<ProductUnit[]>(row.units, []),
      variantGroups: parseVariantGroups(row.variant_attributes),
      variants,
    };
  });
}

/**
 * The gudang rows a role may transact with.
 *
 * Module-level on purpose: the loaders below read the scope through a ref, so
 * narrowing the list stays a filter on the data rather than a dependency that
 * re-fetches the whole screen.
 */
const inScopeWarehouses = (
  scope: RoleScope | undefined,
  rows: WarehouseOption[]
): WarehouseOption[] => rows.filter((row) => warehouseInScope(scope, row.id));

export default function Inventory() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  // A shop asks the gudang for stock; a purchasing clerk does not. Read from
  // the resolved matrix so switching it off in Settings really hides the button.
  const { can, scope } = usePermissions();
  const canRequestStock = can("request_stock");
  /**
   * Which gudang this role may transact with.
   *
   * An owner who scopes a role to one warehouse should not have to trust that
   * the wrong warehouse is merely not preselected: every dropdown on this
   * screen lists only the in-scope rows. `status = 'active'` still applies —
   * scope narrows the list, it never resurrects a closed warehouse.
   *
   * Held in a ref rather than the loaders' dependency list, because the mount
   * load is one batch of seven queries: a matrix edit made in another tab should
   * narrow the list on the next load, not reload this screen underneath someone
   * half-way through a stock-in.
   */
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [isLoading, setIsLoading] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [suppliers, setSuppliers] = useState<VendorOption[]>([]);
  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [isOpnameOpen, setIsOpnameOpen] = useState(false);

  // Filter State
  const [searchQuery, setSearchQuery] = useState("");
  const scanSearchRef = useRef<HTMLInputElement>(null);
  const [selectedCategory, setSelectedCategory] = useState("Semua");
  const [stockFilter, setStockFilter] = useState("all");
  const [selectedWarehouse, setSelectedWarehouse] = useState("all");

  // Sorting state for the product table (Fitur "sortir barang"). Null keeps the
  // natural query order until the operator clicks a column header.
  const [sortKey, setSortKey] = useState<InventorySortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>("asc");

  const toggleSort = (key: InventorySortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(defaultSortDirection(key));
    }
  };

  const categories = Array.from(new Set(products.map(p => p.category).filter(c => c && c.trim() !== "")));

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(value);
  };

  // Fetch Warehouses
  const fetchWarehouses = async () => {
    try {
      const res = await query(WAREHOUSES_SQL);
      setWarehouses(inScopeWarehouses(scopeRef.current, res.rows as unknown as WarehouseOption[]));
    } catch (error) {
      console.error("Failed to fetch warehouses:", error);
    }
  };

  // Fetch Suppliers
  const fetchSuppliers = async () => {
    try {
      const res = await query(SUPPLIERS_SQL);
      setSuppliers(res.rows as unknown as VendorOption[]);
    } catch (error) {
      console.error("Failed to fetch suppliers:", error);
    }
  };

  // Fetch Products
  useEffect(() => {
    if (!isAddProductOpen) {
      document.body.style.pointerEvents = "auto";
    }
  }, [isAddProductOpen]);

  const fetchProducts = async () => {
    try {
      setIsLoading(true);
      const [productRes, variantRes, unitRes, stockRes] = await batchQuery([
        { sql: PRODUCTS_SQL },
        { sql: VARIANTS_SQL },
        { sql: VARIANT_UNITS_SQL },
        { sql: VARIANT_STOCK_SQL },
      ]);
      setProducts(
        mapProductRows(productRes.rows, variantRes.rows, unitRes.rows, stockRes.rows)
      );
    } catch (error) {
      console.error("Failed to fetch products:", error);
      toast.error("Gagal mengambil data produk");
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch Transfers
  const fetchTransfers = async () => {
    try {
      const res = await query(TRANSFERS_SQL);
      setTransfers(res.rows);
    } catch (error) {
      console.error("Failed to fetch transfers:", error);
    }
  };

  /**
   * Mount load: products, their variants, transfers, warehouses and suppliers in
   * ONE round-trip. Issued as separate `query()` calls this screen paid a
   * sequential trip to the tenant database for each of them.
   */
  const loadInventory = async () => {
    try {
      setIsLoading(true);
      const [
        productRes,
        transferRes,
        warehouseRes,
        supplierRes,
        variantRes,
        unitRes,
        stockRes,
      ] = await batchQuery([
        { sql: PRODUCTS_SQL },
        { sql: TRANSFERS_SQL },
        { sql: WAREHOUSES_SQL },
        { sql: SUPPLIERS_SQL },
        { sql: VARIANTS_SQL },
        { sql: VARIANT_UNITS_SQL },
        { sql: VARIANT_STOCK_SQL },
      ]);
      setProducts(
        mapProductRows(productRes.rows, variantRes.rows, unitRes.rows, stockRes.rows)
      );
      setTransfers(transferRes.rows as unknown as TransferRow[]);
      setWarehouses(
        inScopeWarehouses(scopeRef.current, warehouseRes.rows as unknown as WarehouseOption[])
      );
      setSuppliers(supplierRes.rows as unknown as VendorOption[]);
    } catch (error) {
      console.error("Failed to load inventory:", error);
      toast.error("Gagal mengambil data inventori");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadInventory();
  }, []);


  // The URL owns the tab; the tab list and the sidebar can never disagree.
  const activeTab = tabFromPath(location.pathname);

  const handleTabChange = (value: string) => {
    navigate(TAB_PATHS[value as InventoryTab] ?? TAB_PATHS.products);
  };

  /** One planned variant in the shape the writer wants. */
  const variantRowOf = (
    variant: ImportVariantPlan,
    seed: ImportedProductSeed
  ): ImportedVariantRow => {
    const base =
      variant.seed.packs.find((pack) => pack.conversionFactor === 1) ??
      variant.seed.packs[0];
    return {
      attributes: variant.seed.attributes,
      sku: variant.sku,
      barcode: variant.seed.barcode,
      unitName: base?.unitName,
      cost: base?.buyPrice ?? 0,
      price: base?.sellPrice ?? 0,
      packs: variant.seed.packs
        .filter((pack) => pack !== base)
        .map((pack) => ({
          unitName: pack.unitName,
          conversionFactor: pack.conversionFactor,
          cost: pack.buyPrice,
          price: pack.sellPrice,
        })),
      stock: variant.seed.stock,
      minOrderQty: base?.minOrderQty ?? seed.minOrderQty ?? null,
      vendorSku: base?.vendorSku ?? seed.vendorSku ?? null,
    };
  };

  /**
   * Executes the plan the preview showed, one transaction per product.
   *
   * Nothing here decides what a sheet means — `planProductImport` already did,
   * against the rows the dialog read. This loop only writes: a brand-new product
   * through the same writer the vendor sheet uses, an existing one through
   * `appendImportedVariants`, which adds and never rewrites. A product that
   * fails costs its own transaction and is reported; the others still land.
   */
  const handleImport = async (plan: ProductImportPlan, context: ProductImportContext) => {
    // The product template (variants, packs, prices) is owner-managed; refuse
    // the bulk write without the key, mirroring handleSaveProduct.
    if (!can("manage_variants")) {
      toast.error("Tidak berwenang mengelola template produk.");
      return;
    }
    try {
      // Initial stock has to land in a real warehouse. The dialog picked one;
      // an operator without a branch gets the company default.
      const warehouseId =
        context.warehouseId ??
        (await resolveBranchWarehouse(user?.assigned_branch_id ?? null)) ??
        warehouses[0]?.id ??
        null;

      const today = new Date();
      /** Numbers this run already minted, so two blank-SKU rows cannot collide. */
      const minted: string[] = [];
      let created = 0;
      let extended = 0;
      let addedVariants = 0;
      let addedPacks = 0;
      let skipped = 0;
      let failed = 0;
      let priceRows = 0;

      for (const product of plan.products) {
        // A conflict is a code the file cannot claim; a `nochange` product adds
        // nothing. Both are reported by the preview and skipped here.
        const writable = product.variants.filter((variant) => variant.action !== "conflict");
        if (product.action === "nochange" || writable.length === 0) {
          skipped += 1;
          continue;
        }
        if (!writable.some((variant) => variant.action === "create" || variant.packs.length > 0)) {
          skipped += 1;
          continue;
        }

        priceRows += writable
          .flatMap((variant) => variant.packs)
          .filter((pack) => pack.buyPrice > 0 && pack.action !== "skip").length;

        try {
          await runTransaction(async (tx) => {
            // A vendor named in the sheet becomes a real master row — code,
            // category, status — rather than a name-only stub. The planner
            // already matched by code first, so this only creates what is new.
            let vendorId = product.vendorId;
            if (!vendorId && (product.seed.vendorName || product.seed.vendorCode)) {
              vendorId = await resolveOrCreateVendor(tx, {
                name: product.seed.vendorName ?? "",
                code: product.seed.vendorCode,
              });
            }
            const variants = writable.map((variant) => variantRowOf(variant, product.seed));

            if (product.action === "create") {
              const sku =
                product.seed.sku || (await mintSkuForCategory(tx, product.seed.category, today, minted));
              if (!product.seed.sku) minted.push(sku);
              await insertImportedProduct(
                tx,
                {
                  sku,
                  name: product.seed.name,
                  category: product.seed.category || "Umum",
                  price: variants[0]?.price ?? 0,
                  cost: variants[0]?.cost ?? 0,
                  stock: 0,
                  minStock: product.seed.minStock,
                  variantGroups: product.seed.variantGroups,
                  variants,
                  minOrderQty: product.seed.minOrderQty,
                  vendorSku: product.seed.vendorSku,
                },
                {
                  warehouseId,
                  vendorId,
                  userId: user?.id ?? null,
                  isPreferredVendor: product.claimPreference,
                  priceMode: context.priceMode,
                  priceSource: "import",
                }
              );
              created += 1;
              return;
            }

            // An existing product is only ever extended: same name, same packs,
            // same prices, plus whatever variant the file actually brings.
            if (!product.productId) return;
            const result = await appendImportedVariants(
              tx,
              product.productId,
              {
                sku: product.seed.sku,
                variantGroups: product.seed.variantGroups,
                variants,
              },
              {
                warehouseId,
                vendorId,
                userId: user?.id ?? null,
                priceMode: context.priceMode,
                priceSource: "import",
                minOrderQty: product.seed.minOrderQty,
                vendorSku: product.seed.vendorSku,
                claimPreference: product.claimPreference,
              }
            );
            extended += result.addedVariants + result.addedPacks > 0 ? 1 : 0;
            addedVariants += result.addedVariants;
            addedPacks += result.addedPacks;
          });
        } catch (error) {
          // One bad product must not undo the fifty that were fine.
          console.error(`Import of ${product.seed.sku || product.seed.name} failed:`, error);
          failed += 1;
        }
      }

      const parts: string[] = [];
      if (created > 0) parts.push(`${created} produk baru`);
      if (extended > 0) parts.push(`${extended} produk ditambah variannya`);
      if (addedVariants > 0) parts.push(`${addedVariants} varian baru`);
      if (addedPacks > 0) parts.push(`${addedPacks} pecahan baru`);
      if (priceRows > 0) parts.push(`${priceRows} harga beli`);
      if (minted.length > 0) parts.push(`${minted.length} SKU dibuat otomatis`);
      if (skipped > 0) parts.push(`${skipped} dilewati (tidak ada yang baru)`);
      if (failed > 0) parts.push(`${failed} gagal ditulis`);
      if (failed > 0) toast.error(parts.join(" · "));
      else toast.success(parts.length > 0 ? parts.join(" · ") : "Tidak ada yang berubah");
      fetchProducts();
    } catch (error) {
      console.error("Import failed:", error);
      toast.error("Gagal mengimport produk");
    }
  };

  /**
   * Saves one product through `@/lib/product-write`.
   *
   * The SQL moved out of this screen so the vendor detail screen can save the
   * same product without a second copy of the inserts. What stays here is the
   * permission check, the toast, and the reload.
   */
  const handleSaveProduct = async (productData: ProductFormPayload) => {
    // The product template (variants, packs, prices) is owner-managed. Hide the
    // controls above, and refuse the write here so a stale tab cannot post.
    const mayEditVariant = can("manage_variants");
    if (!mayEditVariant) {
      toast.error("Tidak berwenang mengelola template produk.");
      return;
    }
    try {
      await saveProductDraft({
        product: productData,
        editing: editingProduct,
        warehouses,
        userId: user?.id ?? null,
        branchId: user?.assigned_branch_id ?? null,
        mayEditVariant,
        // A buyer may quote a price the owner has not agreed to yet, but never
        // replace one that was negotiated. The writer enforces the difference.
        mayEditVendorPrice: can("manage_vendor_prices"),
      });

      setIsAddProductOpen(false);
      setEditingProduct(null);
      toast.success(
        editingProduct ? "Produk berhasil diperbarui" : "Produk berhasil ditambahkan"
      );
      fetchProducts();
    } catch (error) {
      console.error("Failed to save product:", error);
      toast.error(
        "Gagal menyimpan produk: " + (error instanceof Error ? error.message : "Unknown error")
      );
    }
  };


  /**
   * Queuing and shipping a transfer are delegated to `@/lib/stock-movement`.
   *
   * This screen used to carry its own copy of the stock math, which had already
   * drifted from the transfer page (no expiry on the destination batch, no
   * issue-policy guard). Keeping only the calls means the two screens can no
   * longer disagree about what a transfer does.
   */
  const handleTransfer = async (transfer: {
    from: string;
    to: string;
    items: Array<{
      productId: string;
      quantity: number;
      unitName?: string;
      conversionFactor?: number;
      /** Which variant moves; omitted means "the whole product". */
      variantId?: string | null;
    }>;
    notes: string;
  }) => {
    try {
      const reference = `TRF-${Date.now()}`;

      // Header, lines and the stock pre-flight are one unit of work, and the
      // audit entry records the reference actually stored on the row.
      const transferId = await runTransaction((tx) =>
        createTransfer(tx, {
          referenceNumber: reference,
          sourceWarehouseId: transfer.from,
          destinationWarehouseId: transfer.to,
          notes: transfer.notes ?? null,
          requestedBy: user?.id ?? null,
          items: transfer.items,
        })
      );

      await logAudit({
        action: "create_transfer",
        entity: "stock_transfers",
        entityId: transferId,
        details: {
          reference_number: reference,
          from: transfer.from,
          to: transfer.to,
          items: transfer.items,
          notes: transfer.notes,
        },
        userId: user?.id,
      });

      toast.success("Permintaan transfer berhasil dibuat");
      setIsTransferOpen(false);
      fetchTransfers();
    } catch (error) {
      console.error("Transfer failed:", error);
      throw error;
    }
  };

  /** Ships a queued transfer: the stock leaves the source warehouse here. */
  const handleApproveTransfer = async (transferId: string) => {
    // RBAC Check — shipping drains a gudang, so it is the `dispatch_stock`
    // permission, not a list of roles remembered page by page.
    if (!can("dispatch_stock")) {
      toast.error("Anda tidak memiliki akses untuk mengirim transfer");
      return;
    }

    try {
      // Same policy as the till: the source warehouse is drained in FIFO, LIFO
      // or FEFO order depending on the tenant setting.
      const issueMethod = await getStockIssueMethod();

      // One write transaction: either every batch moves and the transfer is
      // marked in transit, or nothing moves at all.
      await runTransaction(async (tx) => {
        const result = await dispatchTransfer(tx, {
          transferId,
          userId: user?.id ?? null,
          issueMethod,
        });

        await logAuditTx(tx, {
          action: "dispatch_transfer",
          entity: "stock_transfers",
          entityId: transferId,
          details: {
            reference_number: result.referenceNumber,
            itemCount: result.itemCount,
            stock_issue_method: issueMethod,
          },
          userId: user?.id,
        });
      });

      toast.success("Barang dikirim dari gudang asal");
      fetchTransfers();
      fetchProducts();
    } catch (error) {
      console.error("Dispatch failed:", error);
      toast.error(
        "Gagal mengirim transfer: " + (error instanceof Error ? error.message : "Unknown error")
      );
    }
  };

  /** Confirms arrival; the stock already moved when the transfer was shipped. */
  const handleReceiveTransfer = async (transferId: string) => {
    try {
      await runTransaction(async (tx) => {
        const result = await receiveTransfer(tx, { transferId, userId: user?.id ?? null });

        await logAuditTx(tx, {
          action: "receive_transfer",
          entity: "stock_transfers",
          entityId: transferId,
          details: { reference_number: result.referenceNumber },
          userId: user?.id,
        });
      });

      toast.success("Penerimaan barang dikonfirmasi");
      fetchTransfers();
    } catch (error) {
      console.error("Receipt failed:", error);
      toast.error(
        "Gagal mengonfirmasi penerimaan: " + (error instanceof Error ? error.message : "Unknown error")
      );
    }
  };

  const handleOpname = async (opname: {
    warehouseId: string;
    items: Array<{
      productId: string;
      /** Which variant was counted; null means "the whole product". */
      variantId: string | null;
      actualStock: number;
      notes?: string;
    }>;
  }) => {
    try {
      // Shortfalls are written off through the tenant's issue policy.
      const issueMethod = await getStockIssueMethod();

      // All adjustments commit together: an opname that half-applied would
      // leave the ledger disagreeing with the shelf count the user just typed.
      await runTransaction(async (tx) => {
        for (const item of opname.items) {
          const prodRes = await tx.query<{ current_stock: number }>(
            `SELECT COALESCE(SUM(quantity_current), 0) as current_stock
             FROM product_batches
             WHERE product_id = $1 AND warehouse_id = $2
               AND ($3 IS NULL OR variant_id = $3)`,
            [item.productId, opname.warehouseId, item.variantId]
          );
          const currentStock = Number(prodRes.rows[0]?.current_stock ?? 0);
          const diff = item.actualStock - currentStock;

          if (diff === 0) continue;

          if (diff > 0) {
            // Surplus is booked as a new batch at the variant's own buy price.
            // `products.cost_price` is only a summary of the first variant, so
            // it must not price the stock of a different flavour.
            const pRes = await tx.query<{ cost_price: number }>(
              `SELECT COALESCE(v.cost_price, p.cost_price, 0) AS cost_price
                 FROM products p
                 LEFT JOIN product_variants v ON v.id = $2
                WHERE p.id = $1`,
              [item.productId, item.variantId ?? ""]
            );
            const cost = Number(pRes.rows[0]?.cost_price ?? 0);

            await tx.query(
              `INSERT INTO product_batches
               (warehouse_id, product_id, variant_id, batch_number, quantity_initial, quantity_current, cost_price, received_at)
               VALUES ($1, $2, $3, $4, $5, $5, $6, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
              [
                opname.warehouseId,
                item.productId,
                item.variantId,
                `OPNAME-${Date.now()}`,
                diff,
                cost,
              ]
            );
          } else {
            // Shortfall is written off in the configured issue order.
            let remainingToReduce = Math.abs(diff);
            const batchesRes = await tx.query<{
              id: string;
              quantity_current: number;
              received_at: string | null;
              expiry_date: string | null;
            }>(
              `SELECT id, quantity_current, received_at, expiry_date
               FROM product_batches
               WHERE product_id = $1 AND warehouse_id = $2
                 AND ($3 IS NULL OR variant_id = $3)
                 AND quantity_current > 0`,
              [item.productId, opname.warehouseId, item.variantId]
            );

            for (const batch of sortBatchesForIssue(batchesRes.rows, issueMethod)) {
              if (remainingToReduce <= 1e-9) break;
              const reduce = Math.min(Number(batch.quantity_current), remainingToReduce);

              const reduced = await tx.query(
                `UPDATE product_batches SET quantity_current = quantity_current - $1
                  WHERE id = $2 AND quantity_current >= $1`,
                [reduce, batch.id]
              );
              if (reduced.rowCount !== 1) {
                throw new Error("Stok berubah selama opname, silakan ulangi");
              }
              remainingToReduce -= reduce;
            }
          }

          await logAuditTx(tx, {
            action: "stock_adjustment",
            entity: "product_batches",
            entityId: item.productId,
            details: {
              reason: "Stock Opname",
              warehouseId: opname.warehouseId,
              variantId: item.variantId,
              diff,
              actualStock: item.actualStock,
              notes: item.notes || "Stock Opname Adjustment",
              // Which batches this shortfall drained is only recoverable from
              // the policy in force, so it is part of the audit record.
              stock_issue_method: issueMethod,
            },
            userId: user?.id,
          });
        }
      });

      toast.success("Stock opname berhasil disimpan");
      setIsOpnameOpen(false);
      fetchProducts();
    } catch (error) {
      console.error("Opname failed:", error);
      toast.error(
        "Gagal menyimpan opname: " + (error instanceof Error ? error.message : "Unknown error")
      );
    }
  };

  const handleDeleteProduct = async (productId: string) => {
    if (!can("manage_variants")) {
      toast.error("Tidak berwenang menghapus produk.");
      return;
    }
    if (!confirm("Apakah Anda yakin ingin menghapus produk ini?")) return;
    try {
      // Deleting the product without its batches/units would leave stock rows
      // pointing at a missing product and inflate inventory value.
      await runTransaction(async (tx) => {
        await tx.query(`DELETE FROM product_batches WHERE product_id = $1`, [productId]);
        await tx.query(`DELETE FROM product_units WHERE product_id = $1`, [productId]);
        await tx.query(`DELETE FROM products WHERE id = $1`, [productId]);
      });
      toast.success("Produk berhasil dihapus");
      fetchProducts();
    } catch (error) {
      console.error("Failed to delete product:", error);
      toast.error("Gagal menghapus produk (mungkin sudah ada transaksi)");
    }
  };

  const filteredProducts = products.filter((product) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      product.name.toLowerCase().includes(q) ||
      product.sku.toLowerCase().includes(q) ||
      product.units.some((u) => u.barcode?.toLowerCase().includes(q)) ||
      product.variants.some((v) => v.sku.toLowerCase().includes(q) || v.barcode?.toLowerCase().includes(q) || v.units.some((u) => u.barcode?.toLowerCase().includes(q)));
    const matchesCategory =
      selectedCategory === "Semua" || product.category === selectedCategory;
    const matchesStock =
      stockFilter === "all" ||
      (stockFilter === "low" && product.stock <= product.minStock) ||
      (stockFilter === "normal" && product.stock > product.minStock);
    
    if (selectedWarehouse !== "all") {
      const locationStock = product.warehouses[selectedWarehouse] || 0;
      if (stockFilter === "low") {
        return matchesSearch && matchesCategory && locationStock <= product.minStock / 5;
      }
    }
    
    return matchesSearch && matchesCategory && matchesStock;
  });

  // Column sorting is applied last so the operator sees the sort order on
  // whatever the search and filters already narrowed down.
  const visibleProducts = sortInventoryRows(filteredProducts, sortKey, sortDir);

  // A scan on the Products tab drops the code into the search box, which now
  // matches name/SKU/barcode. Disabled while a dialog (add/edit, transfer,
  // opname) is open so its own inputs keep the keyboard.
  useBarcodeScanner({
    enabled: activeTab === "products" && !isAddProductOpen && !isTransferOpen && !isOpnameOpen,
    scanInput: scanSearchRef,
    onScan: (code) => setSearchQuery(code),
  });

  const totalProducts = products.length;
  const lowStockProducts = products.filter((p) => p.stock <= p.minStock).length;
  const totalValue = products.reduce((sum, p) => sum + (parseFloat(String(p.stock)) * parseFloat(String(p.cost || 0))), 0);
  const avgMargin = products.length > 0 
    ? products.reduce((sum, p) => {
        const price = parseFloat(String(p.price || 0));
        const cost = parseFloat(String(p.cost || 0));
        return sum + (price > 0 ? ((price - cost) / price) * 100 : 0);
      }, 0) / products.length 
    : 0;

  return (
    <BackOfficeLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl lg:text-2xl font-bold">Inventory Produk</h1>
            <p className="text-muted-foreground mt-1">
              Kelola stok produk di semua gudang
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {/*
             * The whole row goes to the dialog: the rich export writes the
             * variant matrix and each variant's own packs, which a flat summary
             * cannot carry.
             */}
            <ProductImportExport
              products={products}
              onImport={handleImport}
            />
            {can("manage_variants") && (
              <Button size="sm" className="gap-1.5" onClick={() => setIsAddProductOpen(true)}>
                <Plus className="w-3.5 h-3.5" />
                Tambah Produk
              </Button>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-card rounded-xl border p-3 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-primary/10">
                <Package className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Produk</p>
                <p className="text-lg font-bold">{totalProducts}</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border p-3 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-warning/10">
                <AlertTriangle className="w-5 h-5 text-warning" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Stok Rendah</p>
                <p className="text-lg font-bold text-warning">{lowStockProducts}</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border p-3 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-success/10">
                <TrendingUp className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Nilai Inventory</p>
                <p className="text-base font-bold">{formatCurrency(totalValue)}</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border p-3 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-info/10">
                <BarChart3 className="w-5 h-5 text-info" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Avg. Margin</p>
                <p className="text-lg font-bold">{avgMargin.toFixed(1)}%</p>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
          <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-flex">
            <TabsTrigger value="products" className="gap-2">
              <Package className="w-4 h-4" />
              <span className="hidden sm:inline">Produk</span>
            </TabsTrigger>
            {/* A tab only navigates now. These used to open their modal on
                click as well, so switching panels threw a dialog over the page. */}
            <TabsTrigger value="stock-in" className="gap-2">
              <ArrowLeftRight className="w-4 h-4" />
              <span className="hidden sm:inline">Transfer</span>
            </TabsTrigger>
            <TabsTrigger value="opname" className="gap-2">
              <ClipboardCheck className="w-4 h-4" />
              <span className="hidden sm:inline">Opname</span>
            </TabsTrigger>
            <TabsTrigger value="po" className="gap-2">
              <ShoppingCart className="w-4 h-4" />
              <span className="hidden sm:inline">PO</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="products" className="space-y-4">
            {/* Search & Filter */}
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  ref={scanSearchRef}
                  placeholder="Cari nama, SKU, atau barcode..."
                  className="pl-10"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <Select value={selectedWarehouse} onValueChange={setSelectedWarehouse}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Gudang" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Gudang</SelectItem>
                  {warehouses.map((warehouse) => (
                    <SelectItem key={warehouse.id} value={warehouse.id}>
                      {warehouseLabel(warehouse)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Kategori" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Semua">Semua Kategori</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={stockFilter} onValueChange={setStockFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Filter Stok" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Stok</SelectItem>
                  <SelectItem value="low">Stok Rendah</SelectItem>
                  <SelectItem value="normal">Stok Normal</SelectItem>
                </SelectContent>
              </Select>
              {stockFilter === "low" && canRequestStock && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 shrink-0"
                  onClick={() => navigate("/backoffice/branches/orders")}
                >
                  <ClipboardList className="w-3.5 h-3.5" />
                  Buat Pesanan Outlet
                </Button>
              )}
            </div>

            {/* Products Table */}
            <div className="bg-card rounded-xl border overflow-hidden animate-fade-in">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHead label="Produk" columnKey="name" activeKey={sortKey} direction={sortDir} onSort={toggleSort} />
                    <SortableHead label="Kategori" columnKey="category" activeKey={sortKey} direction={sortDir} onSort={toggleSort} />
                    <SortableHead label="Harga Jual" columnKey="price" activeKey={sortKey} direction={sortDir} onSort={toggleSort} align="right" />
                    <SortableHead label="Harga Modal" columnKey="cost" activeKey={sortKey} direction={sortDir} onSort={toggleSort} align="right" />
                    <SortableHead label="Total Stok" columnKey="stock" activeKey={sortKey} direction={sortDir} onSort={toggleSort} align="center" />
                    {selectedWarehouse === "all" && warehouses.map((warehouse) => (
                      <TableHead key={warehouse.id} className="text-center">{warehouseLabel(warehouse)}</TableHead>
                    ))}
                    {selectedWarehouse !== "all" && (
                      <TableHead className="text-center">Stok Gudang</TableHead>
                    )}
                    <SortableHead label="Supplier" columnKey="supplier" activeKey={sortKey} direction={sortDir} onSort={toggleSort} />
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && products.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={8 + (selectedWarehouse === "all" ? warehouses.length : 1)}
                        className="py-12 text-center text-muted-foreground"
                      >
                        <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                        Memuat data produk…
                      </TableCell>
                    </TableRow>
                  )}
                  {!isLoading && visibleProducts.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={8 + (selectedWarehouse === "all" ? warehouses.length : 1)}
                        className="py-12 text-center text-muted-foreground"
                      >
                        Tidak ada produk yang cocok dengan pencarian atau filter ini
                      </TableCell>
                    </TableRow>
                  )}
                  {visibleProducts.map((product) => {
                    const isLowStock = product.stock <= product.minStock;
                    const margin = ((product.price - product.cost) / product.price) * 100;
                    const locationStock = selectedWarehouse !== "all" ? (product.warehouses[selectedWarehouse] || 0) : null;
                    
                    return (
                      <TableRow key={product.id} className={`group ${isLowStock ? "bg-red-50 dark:bg-red-950/10" : ""}`}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary/20 to-info/20 flex items-center justify-center text-xl">
                              📦
                            </div>
                            <div>
                              <p className="font-medium">{product.name}</p>
                              <p className="text-sm text-muted-foreground">
                                {product.sku}
                                {product.variants.length > 1 &&
                                  ` · ${product.variants.length} varian`}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{product.category}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(product.price)}
                        </TableCell>
                        <TableCell className="text-right">
                          <p>{formatCurrency(product.cost)}</p>
                          <p className="text-xs text-success">+{margin.toFixed(1)}%</p>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex flex-col items-center">
                            <div className="flex items-center gap-1">
                              {isLowStock && <AlertTriangle className="w-4 h-4 text-warning" />}
                              <p className={`font-bold ${isLowStock ? "text-warning" : ""}`}>
                                {product.stock.toLocaleString()}
                              </p>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Min: {product.minStock}
                            </p>
                          </div>
                        </TableCell>
                        {selectedWarehouse === "all" && warehouses.map((warehouse) => (
                          <TableCell key={warehouse.id} className="text-center">
                            {product.warehouses[warehouse.id] || 0}
                          </TableCell>
                        ))}
                        {selectedWarehouse !== "all" && locationStock !== null && (
                          <TableCell className="text-center">
                            <p className={`font-bold ${locationStock <= product.minStock / 5 ? "text-warning" : ""}`}>
                              {locationStock}
                            </p>
                          </TableCell>
                        )}
                        <TableCell>
                          <p className="text-sm">{product.supplier}</p>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant={isLowStock ? "destructive" : "default"}
                            className={
                              !isLowStock
                                ? "bg-success/20 text-success hover:bg-success/30"
                                : "bg-warning/20 text-warning hover:bg-warning/30"
                            }
                          >
                            {isLowStock ? "Stok Rendah" : "Normal"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => {
                                setEditingProduct(product);
                                setIsAddProductOpen(true);
                              }}>
                                <Eye className="w-4 h-4 mr-2" />
                                Lihat Detail
                              </DropdownMenuItem>
                              {can("manage_variants") && (
                                <DropdownMenuItem onClick={() => {
                                  setEditingProduct(product);
                                  setIsAddProductOpen(true);
                                }}>
                                  <Edit className="w-4 h-4 mr-2" />
                                  Edit
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => setIsTransferOpen(true)}>
                                <ArrowLeftRight className="w-4 h-4 mr-2" />
                                Transfer Stok
                              </DropdownMenuItem>
                              {can("manage_variants") && (
                                <DropdownMenuItem 
                                  className="text-destructive"
                                  onClick={() => handleDeleteProduct(product.id)}
                                >
                                  <Trash2 className="w-4 h-4 mr-2" />
                                  Hapus
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="stock-in">
            <div className="bg-card rounded-xl border p-6">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="text-lg font-semibold">Transfer Stok</h3>
                  <p className="text-muted-foreground">Kelola perpindahan stok antar gudang</p>
                </div>
                <Button onClick={() => setIsTransferOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Transfer Baru
                </Button>
              </div>

              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ref Number</TableHead>
                      <TableHead>Dari</TableHead>
                      <TableHead>Ke</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Tanggal</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transfers.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                          Belum ada transfer stok
                        </TableCell>
                      </TableRow>
                    )}
                    {transfers.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium">{t.reference_number}</TableCell>
                        <TableCell>{t.source_warehouse_name}</TableCell>
                        <TableCell>{t.destination_warehouse_name}</TableCell>
                        <TableCell>
                          <Badge variant={t.status === 'completed' ? 'default' : t.status === 'cancelled' ? 'destructive' : 'secondary'}>
                            {transferStatusLabel(t.status)}
                          </Badge>
                        </TableCell>
                        <TableCell>{new Date(t.created_at).toLocaleDateString()}</TableCell>
                        <TableCell className="text-right">
                          {t.status === 'pending' && (
                             can('dispatch_stock') ? (
                              <Button size="sm" onClick={() => handleApproveTransfer(t.id)}>
                                Kirim
                              </Button>
                             ) : (
                               <span className="text-xs text-muted-foreground italic">Menunggu dikirim</span>
                             )
                          )}
                          {t.status === 'in_transit' && (
                            <Button size="sm" variant="outline" onClick={() => handleReceiveTransfer(t.id)}>
                              Terima
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {transfers.length === 0 && (
                       <TableRow>
                         <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                           Belum ada data transfer
                         </TableCell>
                       </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="opname">
            <div className="text-center py-12">
              <ClipboardCheck className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">Stock Opname</h3>
              <p className="text-muted-foreground mb-4">Lakukan stock opname per lokasi</p>
              <Button onClick={() => setIsOpnameOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Mulai Opname
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="po">
            <PurchaseOrderPanel
              products={products}
              warehouses={warehouses}
              vendors={suppliers}
              onChanged={fetchProducts}
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* Modals */}
      <AddProductModal
        open={isAddProductOpen}
        onOpenChange={(open) => {
          setIsAddProductOpen(open);
          if (!open) setEditingProduct(null);
        }}
        onAdd={handleSaveProduct}
        categories={categories}
        warehouses={warehouses}
        mode={editingProduct ? "edit" : "add"}
        initialData={editingProduct}
        canManageVariants={can("manage_variants")}
        canManageSellPrices={can("manage_sell_prices")}
      />

      <StockTransferModal
        open={isTransferOpen}
        onOpenChange={setIsTransferOpen}
        products={products.map((product) => ({
          ...product,
          tenant_id: user?.tenant_id || '',
          unit_type: 'Pcs',
          min_stock_alert: product.minStock,
          stock_by_warehouse: product.warehouses,
          // The transfer sheet picks a variant first and then a pack of THAT
          // variant, because the stock and the packs belong to the variant.
          variants: product.variants.map((variant) => ({
            id: variant.id,
            label: variantLabel(variant.attributes, product.variantGroups),
            sku: variant.sku || product.sku,
            barcode: variant.barcode,
            warehouses: variant.warehouses,
            units: variant.units.map((unit) => ({
              name: unit.name,
              conversion_factor: unit.conversion_factor,
              barcode: unit.barcode,
            })),
          })),
        }))}
        warehouses={warehouses}
        onTransfer={handleTransfer}
      />

      <StockOpnameModal
        open={isOpnameOpen}
        onOpenChange={setIsOpnameOpen}
        products={products.map((product) => ({
          id: product.id,
          sku: product.sku,
          name: product.name,
          stock: product.stock,
          warehouses: product.warehouses,
          // One counting row per variant: a carton and a piece are separate
          // counts, so the sheet cannot be built per product.
          variants: product.variants.map((variant) => ({
            id: variant.id,
            label: variantLabel(variant.attributes, product.variantGroups),
            sku: variant.sku || product.sku,
            warehouses: variant.warehouses,
          })),
        }))}
        warehouses={warehouses}
        onSave={handleOpname}
      />
    </BackOfficeLayout>
  );
}
