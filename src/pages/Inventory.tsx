import { useState, useEffect } from "react";
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
} from "lucide-react";
import { ProductImportExport } from "@/components/inventory/ProductImportExport";
import { AddProductModal } from "@/components/inventory/AddProductModal";
import { StockTransferModal } from "@/components/inventory/StockTransferModal";
import { StockOpnameModal } from "@/components/inventory/StockOpnameModal";
import { PurchaseOrderPanel } from "@/components/inventory/PurchaseOrderPanel";
import type { VendorOption } from "@/components/inventory/PurchaseOrderModal";
import { toast } from "sonner";
import { query, parseJson, runTransaction, batchQuery } from "@/lib/db";
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
  createTransfer,
  dispatchTransfer,
  receiveTransfer,
  transferStatusLabel,
} from "@/lib/stock-movement";
import { roleHasPermission } from "@/lib/branch-orders";

import { ProductUnit } from "@/components/inventory/AddProductModal";

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
  /** Vendors that also supply this product through vendor_products. */
  vendorIds: string[];
  /** `vendor_products.last_cost` per vendor, so a PO starts from the right price. */
  vendorCosts: Record<string, number>;
  units: ProductUnit[];
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
         'barcode', barcode
       ))
       FROM product_units 
       WHERE product_id = p.id
    ), '[]') as units,
    p.created_at
  FROM products p
  ORDER BY p.created_at DESC
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
  SELECT id, name, code, payment_terms_days, lead_time_days, status
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

function mapProductRows(rows: unknown[]): Product[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (rows as any[]).map((row) => ({
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
    vendorIds: parseJson<string[]>(row.vendor_ids, []),
    vendorCosts: parseJson<Record<string, number>>(row.vendor_costs, {}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    units: parseJson<any[]>(row.units, []),
  }));
}

export default function Inventory() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  // A shop asks the gudang for stock; a purchasing clerk does not.
  const canRequestStock = roleHasPermission(user?.role, "request_stock");
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
  const [selectedCategory, setSelectedCategory] = useState("Semua");
  const [stockFilter, setStockFilter] = useState("all");
  const [selectedWarehouse, setSelectedWarehouse] = useState("all");

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
      setWarehouses(res.rows as unknown as WarehouseOption[]);
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
      const res = await query(PRODUCTS_SQL);
      setProducts(mapProductRows(res.rows));
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
   * Mount load: products, transfers, warehouses and suppliers in ONE round-trip.
   * Issued as four `query()` calls this screen paid four sequential trips to
   * the tenant database before rendering anything.
   */
  const loadInventory = async () => {
    try {
      setIsLoading(true);
      const [productRes, transferRes, warehouseRes, supplierRes] = await batchQuery([
        { sql: PRODUCTS_SQL },
        { sql: TRANSFERS_SQL },
        { sql: WAREHOUSES_SQL },
        { sql: SUPPLIERS_SQL },
      ]);
      setProducts(mapProductRows(productRes.rows));
      setTransfers(transferRes.rows as unknown as TransferRow[]);
      setWarehouses(warehouseRes.rows as unknown as WarehouseOption[]);
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

  const handleImport = async (importedProducts: Array<{
    sku: string;
    name: string;
    category: string;
    price: number;
    cost: number;
    stock: number;
    minStock: number;
    supplier: string;
  }>) => {
    try {
      // Initial stock has to land in a real warehouse. Prefer the one the
      // signed-in user's branch sells from; an owner without a branch gets the
      // company default warehouse. Stock is never keyed by branch any more.
      const receivingWarehouseId =
        (await resolveBranchWarehouse(user?.assigned_branch_id ?? null)) ?? warehouses[0]?.id ?? null;

      for (const p of importedProducts) {
        // Find or Create Supplier
        let supplierId: string | null = null;
        if (p.supplier) {
          const supplierRes = await query("SELECT id FROM suppliers WHERE name = $1", [p.supplier]);
          if (supplierRes.rows.length > 0) {
            supplierId = supplierRes.rows[0].id;
          } else {
            const newSupRes = await query("INSERT INTO suppliers (name) VALUES ($1) RETURNING id", [p.supplier]);
            supplierId = newSupRes.rows[0].id;
          }
        }

        // Product row and its opening batch commit together, so an import can
        // never leave a product behind with no stock record.
        await runTransaction(async (tx) => {
          let productId: string;
          const existingRes = await tx.query<{ id: string }>("SELECT id FROM products WHERE sku = $1", [p.sku]);
          if (existingRes.rows.length > 0) {
            // Update
            productId = existingRes.rows[0].id;
            await tx.query(
              `UPDATE products SET name=$1, category=$2, cost_price=$3, min_stock_level=$4, supplier_id=$5 WHERE sku=$6`,
              [p.name, p.category, p.cost, p.minStock, supplierId, p.sku]
            );
          } else {
            // Insert
            const res = await tx.query<{ id: string }>(
              `INSERT INTO products (sku, name, category, cost_price, min_stock_level, supplier_id) 
               VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
              [p.sku, p.name, p.category, p.cost, p.minStock, supplierId]
            );
            productId = res.rows[0].id;
          }

          // Imported rows name their vendor, so register the catalogue link too.
          if (supplierId) {
            await tx.query(
              `INSERT INTO vendor_products (vendor_id, product_id, last_cost, min_order_qty)
               VALUES ($1, $2, $3, 1)
               ON CONFLICT (vendor_id, product_id) DO UPDATE SET last_cost = excluded.last_cost`,
              [supplierId, productId, p.cost]
            );
          }

          if (receivingWarehouseId && p.stock > 0) {
            await tx.query(
              `INSERT INTO product_batches (warehouse_id, product_id, batch_number, quantity_initial, quantity_current, cost_price)
               VALUES ($1, $2, $3, $4, $4, $5)`,
              [receivingWarehouseId, productId, 'INITIAL-IMPORT', p.stock, p.cost]
            );
          }
        });
      }
      toast.success(`${importedProducts.length} produk berhasil diimport`);
      fetchProducts();
    } catch (error) {
      console.error("Import failed:", error);
      toast.error("Gagal mengimport produk");
    }
  };

  const handleSaveProduct = async (productData: {
    sku: string;
    name: string;
    category: string;
    price: number;
    cost: number;
    stock: number;
    minStock: number;
    supplier: string;
    warehouses: Record<string, number>;
    units: ProductUnit[];
  }) => {
    try {
      // The product row, its units, every stock movement and the expense booked
      // for new stock are one unit of work. This used to be a series of
      // independent round-trips, so a failure halfway could leave a product with
      // no units, or stock on the shelf that finance never recorded.
      let savedProductId = editingProduct?.id ?? "";
      let createdProduct = false;

      // Stock reductions below drain batches through the tenant's issue policy
      // (FIFO / LIFO / FEFO), read before the transaction opens.
      const issueMethod = await getStockIssueMethod();

      await runTransaction(async (tx) => {
        // Handle Supplier (Find or Create) - Common for both Add and Edit
        let supplierId: string | null = null;
        if (productData.supplier) {
          const supplierRes = await tx.query<{ id: string }>(
            `SELECT id FROM suppliers WHERE name = $1`,
            [productData.supplier]
          );
          if (supplierRes.rows.length > 0) {
            supplierId = supplierRes.rows[0].id;
          } else {
            const newSupplierRes = await tx.query<{ id: string }>(
              `INSERT INTO suppliers (name) VALUES ($1) RETURNING id`,
              [productData.supplier]
            );
            supplierId = newSupplierRes.rows[0].id;
          }
        }

        /**
         * A warehouse may be shared between branches, so an expense is booked
         * against the branch that owns it — and against the operator's own
         * branch only when nobody owns the stock.
         */
        const branchForWarehouse = (warehouseId: string) =>
          warehouses.find((warehouse) => warehouse.id === warehouseId)?.branch_id ??
          user?.assigned_branch_id ??
          null;

        /** Books the purchase of newly added stock as an expense. */
        const bookStockPurchase = async (warehouseId: string, qty: number, label: string) => {
          const totalCost = qty * productData.cost;
          const isUnpaid = Boolean(supplierId);
          await tx.query(
            `INSERT INTO expenses (category, amount, date, description, status, amount_paid, supplier_id, branch_id)
             VALUES ('Pembelian Stok', $1, date('now'), $2, $3, $4, $5, $6)`,
            [
              totalCost,
              `${label}: ${productData.name}`,
              isUnpaid ? "unpaid" : "paid",
              isUnpaid ? 0 : totalCost,
              supplierId,
              branchForWarehouse(warehouseId),
            ]
          );
        };

        /**
         * Removes stock through the tenant's issue policy. A negative
         * adjustment used to be written as a batch with a negative quantity,
         * which corrupted every later stock sum and every later batch deduction.
         */
        const reduceStock = async (warehouseId: string, qty: number) => {
          let remaining = qty;
          const batches = await tx.query<{
            id: string;
            quantity_current: number;
            received_at: string | null;
            expiry_date: string | null;
          }>(
            `SELECT id, quantity_current, received_at, expiry_date
               FROM product_batches
              WHERE product_id = $1 AND warehouse_id = $2 AND quantity_current > 0`,
            [savedProductId, warehouseId]
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

        if (editingProduct) {
          // UPDATE Product
          await tx.query(
            `UPDATE products SET sku=$1, name=$2, category=$3, min_stock_level=$4, supplier_id=$5, cost_price=$6 WHERE id=$7`,
            [productData.sku, productData.name, productData.category, productData.minStock, supplierId, productData.cost, editingProduct.id]
          );

          // Units: drop the ones the form removed, update the rest, add new ones.
          const existingUnitsRes = await tx.query<{ id: string }>(
            `SELECT id FROM product_units WHERE product_id = $1`,
            [editingProduct.id]
          );
          const incomingIds = productData.units.map((u) => u.id).filter(Boolean);

          for (const existing of existingUnitsRes.rows) {
            if (!incomingIds.includes(existing.id)) {
              await tx.query(`DELETE FROM product_units WHERE id = $1`, [existing.id]);
            }
          }

          for (const unit of productData.units) {
            if (unit.id) {
              await tx.query(
                `UPDATE product_units SET name=$1, price=$2, conversion_factor=$3, barcode=$4 WHERE id=$5`,
                [unit.name, unit.price, unit.conversion_factor, unit.barcode || "", unit.id]
              );
            } else {
              await tx.query(
                `INSERT INTO product_units (product_id, name, price, conversion_factor, barcode) VALUES ($1, $2, $3, $4, $5)`,
                [editingProduct.id, unit.name, unit.price, unit.conversion_factor, unit.barcode || ""]
              );
            }
          }

          // Stock adjustments, per warehouse, as real batch movements.
          for (const [warehouseId, newQty] of Object.entries(productData.warehouses)) {
            const diff = newQty - (editingProduct.warehouses[warehouseId] || 0);
            if (diff === 0) continue;

            if (diff > 0) {
              await tx.query(
                `INSERT INTO product_batches
                 (warehouse_id, product_id, batch_number, quantity_initial, quantity_current, cost_price, received_at, supplier_id)
                 VALUES ($1, $2, $3, $4, $4, $5, strftime('%Y-%m-%dT%H:%M:%fZ','now'), $6)`,
                [warehouseId, editingProduct.id, `ADJ-${Date.now()}`, diff, productData.cost, supplierId]
              );
              await bookStockPurchase(warehouseId, diff, "Pembelian Stok Tambahan");
            } else {
              await reduceStock(warehouseId, Math.abs(diff));
            }
          }
        } else {
          const productRes = await tx.query<{ id: string }>(
            `INSERT INTO products (sku, name, category, min_stock_level, is_tracked, supplier_id, cost_price)
             VALUES ($1, $2, $3, $4, 1, $5, $6)
             RETURNING id`,
            [productData.sku, productData.name, productData.category, productData.minStock, supplierId, productData.cost]
          );
          savedProductId = productRes.rows[0].id;
          createdProduct = true;

          for (const unit of productData.units) {
            await tx.query(
              `INSERT INTO product_units (product_id, name, price, conversion_factor, barcode)
               VALUES ($1, $2, $3, $4, $5)`,
              [savedProductId, unit.name, unit.price, unit.conversion_factor, unit.barcode || ""]
            );
          }

          for (const [warehouseId, qty] of Object.entries(productData.warehouses)) {
            if (!(qty > 0)) continue;
            await tx.query(
              `INSERT INTO product_batches
               (warehouse_id, product_id, batch_number, quantity_initial, quantity_current, cost_price, received_at, supplier_id)
               VALUES ($1, $2, $3, $4, $4, $5, strftime('%Y-%m-%dT%H:%M:%fZ','now'), $6)`,
              [warehouseId, savedProductId, `BATCH-${Date.now()}`, qty, productData.cost, supplierId]
            );
            await bookStockPurchase(warehouseId, qty, "Pembelian Stok Awal");
          }
        }

        // The product's vendor is also its catalogue entry, so last cost and
        // lead time can be read back on the vendor detail screen.
        if (supplierId) {
          await tx.query(
            `INSERT INTO vendor_products (vendor_id, product_id, last_cost, min_order_qty)
             VALUES ($1, $2, $3, 1)
             ON CONFLICT (vendor_id, product_id) DO UPDATE SET last_cost = excluded.last_cost`,
            [supplierId, savedProductId, productData.cost]
          );
        }

        await logAuditTx(tx, {
          action: createdProduct ? "create_product" : "update_product",
          entity: "products",
          entityId: savedProductId,
          details: { sku: productData.sku, name: productData.name },
          userId: user?.id,
        });
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
      toast.error("Gagal membuat transfer");
    }
  };

  /** Ships a queued transfer: the stock leaves the source warehouse here. */
  const handleApproveTransfer = async (transferId: string) => {
    // RBAC Check
    if (!user || !['store_manager', 'warehouse', 'tenant_admin', 'tenant_owner', 'platform_owner', 'admin'].includes(user.role)) {
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
    items: Array<{ productId: string; actualStock: number; notes?: string }>;
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
             WHERE product_id = $1 AND warehouse_id = $2`,
            [item.productId, opname.warehouseId]
          );
          const currentStock = Number(prodRes.rows[0]?.current_stock ?? 0);
          const diff = item.actualStock - currentStock;

          if (diff === 0) continue;

          if (diff > 0) {
            // Surplus is booked as a new batch at the product's standard cost.
            const pRes = await tx.query<{ cost_price: number }>(
              `SELECT cost_price FROM products WHERE id = $1`,
              [item.productId]
            );
            const cost = Number(pRes.rows[0]?.cost_price ?? 0);

            await tx.query(
              `INSERT INTO product_batches
               (warehouse_id, product_id, batch_number, quantity_initial, quantity_current, cost_price, received_at)
               VALUES ($1, $2, $3, $4, $4, $5, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
              [opname.warehouseId, item.productId, `OPNAME-${Date.now()}`, diff, cost]
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
               WHERE product_id = $1 AND warehouse_id = $2 AND quantity_current > 0`,
              [item.productId, opname.warehouseId]
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
    const matchesSearch =
      product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      product.sku.toLowerCase().includes(searchQuery.toLowerCase());
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
            <h1 className="text-2xl lg:text-3xl font-bold">Inventory Produk</h1>
            <p className="text-muted-foreground mt-1">
              Kelola stok produk di semua gudang
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ProductImportExport 
              products={products.map(p => ({
                sku: p.sku,
                name: p.name,
                category: p.category,
                price: p.price,
                cost: p.cost,
                stock: p.stock,
                minStock: p.minStock,
                supplier: p.supplier,
              }))} 
              onImport={handleImport} 
            />
            <Button className="gap-2" onClick={() => setIsAddProductOpen(true)}>
              <Plus className="w-4 h-4" />
              Tambah Produk
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-card rounded-xl border p-4 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-primary/10">
                <Package className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Produk</p>
                <p className="text-2xl font-bold">{totalProducts}</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border p-4 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-warning/10">
                <AlertTriangle className="w-5 h-5 text-warning" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Stok Rendah</p>
                <p className="text-2xl font-bold text-warning">{lowStockProducts}</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border p-4 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-success/10">
                <TrendingUp className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Nilai Inventory</p>
                <p className="text-xl font-bold">{formatCurrency(totalValue)}</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border p-4 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-info/10">
                <BarChart3 className="w-5 h-5 text-info" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Avg. Margin</p>
                <p className="text-2xl font-bold">{avgMargin.toFixed(1)}%</p>
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
                  placeholder="Cari produk atau SKU..."
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
                  className="gap-2 shrink-0"
                  onClick={() => navigate("/backoffice/branches/orders")}
                >
                  <ClipboardList className="w-4 h-4" />
                  Buat Pesanan Cabang
                </Button>
              )}
            </div>

            {/* Products Table */}
            <div className="bg-card rounded-xl border overflow-hidden animate-fade-in">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produk</TableHead>
                    <TableHead>Kategori</TableHead>
                    <TableHead className="text-right">Harga Jual</TableHead>
                    <TableHead className="text-right">Harga Modal</TableHead>
                    <TableHead className="text-center">Total Stok</TableHead>
                    {selectedWarehouse === "all" && warehouses.map((warehouse) => (
                      <TableHead key={warehouse.id} className="text-center">{warehouseLabel(warehouse)}</TableHead>
                    ))}
                    {selectedWarehouse !== "all" && (
                      <TableHead className="text-center">Stok Gudang</TableHead>
                    )}
                    <TableHead>Supplier</TableHead>
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
                  {!isLoading && filteredProducts.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={8 + (selectedWarehouse === "all" ? warehouses.length : 1)}
                        className="py-12 text-center text-muted-foreground"
                      >
                        Tidak ada produk yang cocok dengan pencarian atau filter ini
                      </TableCell>
                    </TableRow>
                  )}
                  {filteredProducts.map((product) => {
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
                              <p className="text-sm text-muted-foreground">{product.sku}</p>
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
                              <DropdownMenuItem>
                                <Eye className="w-4 h-4 mr-2" />
                                Lihat Detail
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => {
                                setEditingProduct(product);
                                setIsAddProductOpen(true);
                              }}>
                                <Edit className="w-4 h-4 mr-2" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setIsTransferOpen(true)}>
                                <ArrowLeftRight className="w-4 h-4 mr-2" />
                                Transfer Stok
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                className="text-destructive"
                                onClick={() => handleDeleteProduct(product.id)}
                              >
                                <Trash2 className="w-4 h-4 mr-2" />
                                Hapus
                              </DropdownMenuItem>
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
                             (user?.role === 'store_manager' || user?.role === 'warehouse' || user?.role === 'tenant_admin' || user?.role === 'tenant_owner' || user?.role === 'platform_owner' || user?.role === 'admin') ? (
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
      />

      <StockTransferModal
        open={isTransferOpen}
        onOpenChange={setIsTransferOpen}
        products={products.map(p => ({
          ...p,
          tenant_id: user?.tenant_id || '',
          unit_type: 'Pcs',
          min_stock_alert: p.minStock,
          stock_by_warehouse: p.warehouses,
        }))}
        warehouses={warehouses}
        onTransfer={handleTransfer}
      />

      <StockOpnameModal
        open={isOpnameOpen}
        onOpenChange={setIsOpnameOpen}
        products={products}
        warehouses={warehouses}
        onSave={handleOpname}
      />
    </BackOfficeLayout>
  );
}
