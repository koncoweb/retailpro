import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
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
} from "lucide-react";
import { ProductImportExport } from "@/components/inventory/ProductImportExport";
import { AddProductModal } from "@/components/inventory/AddProductModal";
import { StockTransferModal } from "@/components/inventory/StockTransferModal";
import { StockOpnameModal } from "@/components/inventory/StockOpnameModal";
import { PurchaseOrderModal } from "@/components/inventory/PurchaseOrderModal";
import { toast } from "sonner";
import { query } from "@/lib/db";
import { logAudit } from "@/lib/audit";

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
  branches: Record<string, number>;
  lastRestock: string;
  supplier: string;
  units: ProductUnit[];
}

interface Branch {
  id: string;
  name: string;
}

export default function Inventory() {
  const { user } = useAuth();
  const location = useLocation();
  const [isLoading, setIsLoading] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [isOpnameOpen, setIsOpnameOpen] = useState(false);
  const [isPOOpen, setIsPOOpen] = useState(false);

  // Filter State
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Semua");
  const [stockFilter, setStockFilter] = useState("all");
  const [selectedLocation, setSelectedLocation] = useState("all");

  const categories = Array.from(new Set(products.map(p => p.category)));

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(value);
  };

  // Fetch Branches
  const fetchBranches = async () => {
    try {
      const res = await query(`SELECT id, name FROM branches ORDER BY name ASC`);
      setBranches(res.rows);
    } catch (error) {
      console.error("Failed to fetch branches:", error);
    }
  };

  // Fetch Products
  const fetchProducts = async () => {
    try {
      setIsLoading(true);
      const res = await query(`
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
          COALESCE((
            SELECT AVG(pb.cost_price) 
            FROM product_batches pb 
            WHERE pb.product_id = p.id AND pb.quantity_current > 0
          ), 0) as cost,
          COALESCE((
            SELECT SUM(pb.quantity_current) 
            FROM product_batches pb 
            WHERE pb.product_id = p.id
          ), 0) as stock,
          (
            SELECT jsonb_object_agg(b.id, COALESCE(sum_qty, 0))
            FROM branches b
            LEFT JOIN (
              SELECT branch_id, SUM(quantity_current) as sum_qty
              FROM product_batches
              WHERE product_id = p.id
              GROUP BY branch_id
            ) pb_sum ON b.id = pb_sum.branch_id
          ) as branch_stock,
          (
            SELECT s.name 
            FROM product_batches pb 
            JOIN suppliers s ON pb.supplier_id = s.id 
            WHERE pb.product_id = p.id 
            ORDER BY pb.received_at DESC 
            LIMIT 1
          ) as supplier,
          (
             SELECT json_agg(json_build_object(
               'id', id, 
               'name', name, 
               'conversion_factor', conversion_factor, 
               'price', price,
               'barcode', barcode
             ))
             FROM product_units 
             WHERE product_id = p.id
          ) as units,
          p.created_at
        FROM products p
        ORDER BY p.created_at DESC
      `);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mappedProducts: Product[] = res.rows.map((row: any) => ({
        id: row.id,
        sku: row.sku,
        name: row.name,
        category: row.category || "Uncategorized",
        price: parseFloat(row.price) || 0,
        cost: parseFloat(row.cost),
        stock: parseFloat(row.stock),
        minStock: row.min_stock_level,
        branches: row.branch_stock || {},
        lastRestock: row.created_at,
        supplier: row.supplier || "-",
        units: row.units || []
      }));
      
      setProducts(mappedProducts);
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
      const res = await query(`
        SELECT 
          st.id,
          st.reference_number,
          b1.name as source_branch_name,
          b2.name as destination_branch_name,
          st.status,
          st.created_at,
          (SELECT COUNT(*) FROM transfer_items ti WHERE ti.transfer_id = st.id) as items_count
        FROM stock_transfers st
        LEFT JOIN branches b1 ON st.source_branch_id = b1.id
        LEFT JOIN branches b2 ON st.destination_branch_id = b2.id
        ORDER BY st.created_at DESC
      `);
      setTransfers(res.rows);
    } catch (error) {
      console.error("Failed to fetch transfers:", error);
    }
  };

  useEffect(() => {
    fetchProducts();
    fetchTransfers();
    fetchBranches();
  }, []);


  // Determine active tab based on route
  const getActiveTab = () => {
    if (location.pathname.includes("stock-in")) return "stock-in";
    if (location.pathname.includes("opname")) return "opname";
    if (location.pathname.includes("po")) return "po";
    return "products";
  };

  const handleImport = (importedProducts: Array<{
    sku: string;
    name: string;
    category: string;
    price: number;
    cost: number;
    stock: number;
    minStock: number;
    supplier: string;
  }>) => {
    const newProducts = importedProducts.map((p, index) => {
      const existingProduct = products.find(ep => ep.sku === p.sku);
      if (existingProduct) {
        return {
          ...existingProduct,
          name: p.name,
          category: p.category,
          price: p.price,
          cost: p.cost,
          stock: p.stock,
          minStock: p.minStock,
          supplier: p.supplier,
        };
      }
      return {
        id: String(Date.now() + index),
        sku: p.sku,
        name: p.name,
        category: p.category,
        price: p.price,
        cost: p.cost,
        stock: p.stock,
        minStock: p.minStock,
        branches: { pusat: p.stock },
        lastRestock: new Date().toISOString().split("T")[0],
        supplier: p.supplier,
        units: [],
      };
    });

    const updatedProducts = products.map(p => {
      const imported = newProducts.find(np => np.sku === p.sku);
      return imported || p;
    });

    const existingSKUs = products.map(p => p.sku);
    const trulyNewProducts = newProducts.filter(np => !existingSKUs.includes(np.sku));
    
    setProducts([...updatedProducts, ...trulyNewProducts]);
    toast.success(`${importedProducts.length} produk berhasil diimport`);
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
    branches: Record<string, number>;
    units: ProductUnit[];
  }) => {
    try {
      // Handle Supplier (Find or Create) - Common for both Add and Edit
      let supplierId: string | null = null;
      if (productData.supplier) {
        const supplierRes = await query(
          `SELECT id FROM suppliers WHERE name = $1`,
          [productData.supplier]
        );
        if (supplierRes.rows.length > 0) {
          supplierId = supplierRes.rows[0].id;
        } else {
          const newSupplierRes = await query(
            `INSERT INTO suppliers (name) VALUES ($1) RETURNING id`,
            [productData.supplier]
          );
          supplierId = newSupplierRes.rows[0].id;
        }
      }

      if (editingProduct) {
        // UPDATE Product
        await query(
          `UPDATE products SET sku=$1, name=$2, category=$3, min_stock_level=$4 WHERE id=$5`,
          [productData.sku, productData.name, productData.category, productData.minStock, editingProduct.id]
        );

        // Update Units
        // 1. Get existing unit IDs
        const existingUnitsRes = await query(`SELECT id FROM product_units WHERE product_id = $1`, [editingProduct.id]);
        const existingIds = existingUnitsRes.rows.map((row: any) => row.id);
        
        // 2. Identify IDs to keep and update
        const incomingIds = productData.units.map(u => u.id).filter(id => id);
        
        // 3. Delete IDs not in incoming
        const idsToDelete = existingIds.filter((id: string) => !incomingIds.includes(id));
        for (const id of idsToDelete) {
          await query(`DELETE FROM product_units WHERE id = $1`, [id]);
        }

        // 4. Upsert (Update existing, Insert new)
        for (const unit of productData.units) {
          if (unit.id) {
            await query(
              `UPDATE product_units SET name=$1, price=$2, conversion_factor=$3, barcode=$4 WHERE id=$5`,
              [unit.name, unit.price, unit.conversion_factor, unit.barcode || '', unit.id]
            );
          } else {
            await query(
              `INSERT INTO product_units (product_id, name, price, conversion_factor, barcode) VALUES ($1, $2, $3, $4, $5)`,
              [editingProduct.id, unit.name, unit.price, unit.conversion_factor, unit.barcode || '']
            );
          }
        }

        // Update Stock (Adjustment via Batches)
        for (const [branchId, newQty] of Object.entries(productData.branches)) {
          const oldQty = editingProduct.branches[branchId] || 0;
          const diff = newQty - oldQty;
          
          if (diff !== 0) {
            await query(
              `INSERT INTO product_batches 
               (branch_id, product_id, batch_number, quantity_initial, quantity_current, cost_price, received_at, supplier_id)
               VALUES ($1, $2, $3, $4, $4, $5, NOW(), $6)`,
              [branchId, editingProduct.id, `ADJ-${Date.now()}`, diff, productData.cost, supplierId]
            );
          }
        }

        toast.success("Produk berhasil diperbarui");
      } else {
        // INSERT (Create)
        const productRes = await query(
          `INSERT INTO products (sku, name, category, min_stock_level, is_tracked) 
           VALUES ($1, $2, $3, $4, true) 
           RETURNING id`,
          [productData.sku, productData.name, productData.category, productData.minStock]
        );
        const productId = productRes.rows[0].id;

        // Insert Product Units
        for (const unit of productData.units) {
          await query(
            `INSERT INTO product_units (product_id, name, price, conversion_factor, barcode) 
             VALUES ($1, $2, $3, $4, $5)`,
            [productId, unit.name, unit.price, unit.conversion_factor, unit.barcode || '']
          );
        }

        // Insert Initial Batches
        const batchPromises = Object.entries(productData.branches).map(async ([branchId, qty]) => {
           if (qty > 0) {
              await query(
                `INSERT INTO product_batches 
                 (branch_id, product_id, batch_number, quantity_initial, quantity_current, cost_price, received_at, supplier_id)
                 VALUES ($1, $2, $3, $4, $4, $5, NOW(), $6)`,
                [branchId, productId, `BATCH-${Date.now()}`, qty, productData.cost, supplierId]
              );
           }
        });
        await Promise.all(batchPromises);

        await logAudit({
          action: "create_product",
          entity: "products",
          entityId: productId,
          details: { sku: productData.sku, name: productData.name },
          userId: user?.id
        });

        toast.success("Produk berhasil ditambahkan");
      }

      setIsAddProductOpen(false);
      setEditingProduct(null);
      fetchProducts();
    } catch (error) {
      console.error("Failed to save product:", error);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toast.error("Gagal menyimpan produk: " + (error as any).message);
    }
  };

  const handleTransfer = async (transfer: {
    from: string;
    to: string;
    items: Array<{ productId: string; quantity: number }>;
    notes: string;
  }) => {
    try {
      const res = await query(
        `INSERT INTO stock_transfers 
         (reference_number, source_branch_id, destination_branch_id, status, created_at)
         VALUES ($1, $2, $3, 'pending', NOW())
         RETURNING id`,
        [`TRF-${Date.now()}`, transfer.from, transfer.to]
      );
      const transferId = res.rows[0].id;

      for (const item of transfer.items) {
        await query(
          `INSERT INTO transfer_items (transfer_id, product_id, quantity_sent, notes)
           VALUES ($1, $2, $3, $4)`,
          [transferId, item.productId, item.quantity, transfer.notes]
        );
      }

      await logAudit({
        action: "create",
        entity: "stock_transfers",
        entityId: transferId,
        details: { 
          reference_number: `TRF-${Date.now()}`,
          from: transfer.from, 
          to: transfer.to, 
          items: transfer.items, 
          notes: transfer.notes 
        },
        userId: user?.id
      });

      toast.success("Permintaan transfer berhasil dibuat");
      setIsTransferOpen(false);
      fetchTransfers();
    } catch (error) {
      console.error("Transfer failed:", error);
      toast.error("Gagal membuat transfer");
    }
  };

  const handleApproveTransfer = async (transferId: string) => {
    // RBAC Check
    if (!user || !['store_manager', 'tenant_admin', 'tenant_owner', 'platform_owner'].includes(user.role)) {
      toast.error("Anda tidak memiliki akses untuk menyetujui transfer");
      return;
    }

    try {
      const res = await query(`SELECT * FROM stock_transfers WHERE id = $1`, [transferId]);
      const transfer = res.rows[0];
      
      const itemsRes = await query(`SELECT * FROM transfer_items WHERE transfer_id = $1`, [transferId]);
      const items = itemsRes.rows;

      for (const item of items) {
        // Convert transfer quantity to base units
        const conversionFactor = parseFloat(item.conversion_factor || '1');
        const totalBaseQty = parseFloat(item.quantity_sent) * conversionFactor;
        let remaining = totalBaseQty;

        const sourceBatches = await query(
          `SELECT id, quantity_current, cost_price 
           FROM product_batches 
           WHERE product_id = $1 AND branch_id = $2 AND quantity_current > 0
           ORDER BY received_at ASC`,
          [item.product_id, transfer.source_branch_id]
        );

        let totalCost = 0;
        let totalQtyMoved = 0;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const batch of sourceBatches.rows as any[]) {
          if (remaining <= 0) break;
          const qty = parseFloat(batch.quantity_current);
          const take = Math.min(qty, remaining);
          
          await query(
            `UPDATE product_batches 
             SET quantity_current = quantity_current - $1 
             WHERE id = $2`,
            [take, batch.id]
          );
          
          remaining -= take;
          totalCost += take * parseFloat(batch.cost_price);
          totalQtyMoved += take;
        }
        
        const avgCost = totalQtyMoved > 0 ? totalCost / totalQtyMoved : 0;

        await query(
          `INSERT INTO product_batches 
           (branch_id, product_id, batch_number, quantity_initial, quantity_current, cost_price, received_at)
           VALUES ($1, $2, $3, $4, $4, $5, NOW())`,
          [transfer.destination_branch_id, item.product_id, `TRF-${transfer.reference_number}`, totalQtyMoved, avgCost]
        );
      }

      await query(
        `UPDATE stock_transfers SET status = 'completed', received_at = NOW() WHERE id = $1`,
        [transferId]
      );

      await logAudit({
        action: "approve_transfer",
        entity: "stock_transfers",
        entityId: transferId,
        details: {
           transferId,
           approvedBy: user.id,
           itemsCount: items.length
        },
        userId: user.id
      });

      toast.success("Transfer approved successfully");
      fetchTransfers();
      fetchProducts();
    } catch (error) {
      console.error("Approval failed:", error);
      toast.error("Approval failed");
    }
  };

  const handleOpname = async (opname: {
    location: string;
    items: Array<{ productId: string; actualStock: number }>;
  }) => {
    try {
      for (const item of opname.items) {
         const prodRes = await query(
            `SELECT SUM(quantity_current) as current_stock 
             FROM product_batches 
             WHERE product_id = $1 AND branch_id = $2`,
            [item.productId, opname.location]
         );
         const currentStock = parseFloat(prodRes.rows[0]?.current_stock || '0');
         const diff = item.actualStock - currentStock;

         if (diff !== 0) {
            if (diff > 0) {
                await query(
                  `INSERT INTO product_batches 
                   (branch_id, product_id, batch_number, quantity_initial, quantity_current, cost_price, received_at)
                   VALUES ($1, $2, $3, $4, $4, 0, NOW())`,
                  [opname.location, item.productId, `OPNAME-${Date.now()}`, diff]
                );
            } else {
                let remainingToReduce = Math.abs(diff);
                const batchesRes = await query(
                    `SELECT id, quantity_current 
                     FROM product_batches 
                     WHERE product_id = $1 AND branch_id = $2 AND quantity_current > 0
                     ORDER BY received_at ASC`,
                    [item.productId, opname.location]
                );
                
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                for (const batch of batchesRes.rows as any[]) {
                    if (remainingToReduce <= 0) break;
                    const qty = parseFloat(batch.quantity_current);
                    const reduce = Math.min(qty, remainingToReduce);
                    
                    await query(
                        `UPDATE product_batches 
                         SET quantity_current = quantity_current - $1 
                         WHERE id = $2`,
                        [reduce, batch.id]
                    );
                    remainingToReduce -= reduce;
                }
            }

            await logAudit({
              action: "stock_adjustment",
              entity: "product_batches",
              entityId: item.productId,
              details: {
                reason: "Stock Opname",
                branchId: opname.location,
                diff,
                actualStock: item.actualStock
              },
              userId: user?.id
            });
         }
      }
      toast.success("Stock opname berhasil disimpan");
      setIsOpnameOpen(false);
      fetchProducts();
    } catch (error) {
      console.error("Opname failed:", error);
      toast.error("Gagal menyimpan opname");
    }
  };

  const handlePO = (po: any) => {
    // In a real app, this would create a PO record
    console.log("PO Created:", po);
    toast.success(`Purchase Order ${po.poNumber} berhasil dibuat`);
    setIsPOOpen(false);
  };

  const handleDeleteProduct = async (productId: string) => {
    if (!confirm("Apakah Anda yakin ingin menghapus produk ini?")) return;
    try {
      await query(`DELETE FROM product_batches WHERE product_id = $1`, [productId]);
      await query(`DELETE FROM product_units WHERE product_id = $1`, [productId]);
      await query(`DELETE FROM products WHERE id = $1`, [productId]);
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
    
    if (selectedLocation !== "all") {
      const locationStock = product.branches[selectedLocation] || 0;
      if (stockFilter === "low") {
        return matchesSearch && matchesCategory && locationStock <= product.minStock / 5;
      }
    }
    
    return matchesSearch && matchesCategory && matchesStock;
  });

  const totalProducts = products.length;
  const lowStockProducts = products.filter((p) => p.stock <= p.minStock).length;
  const totalValue = products.reduce((sum, p) => sum + p.stock * p.cost, 0);
  const avgMargin =
    products.reduce((sum, p) => sum + ((p.price - p.cost) / p.price) * 100, 0) /
    products.length;

  return (
    <BackOfficeLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold">Inventory Produk</h1>
            <p className="text-muted-foreground mt-1">
              Kelola stok produk di semua cabang
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
        <Tabs defaultValue={getActiveTab()} className="space-y-4">
          <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-flex">
            <TabsTrigger value="products" className="gap-2">
              <Package className="w-4 h-4" />
              <span className="hidden sm:inline">Produk</span>
            </TabsTrigger>
            <TabsTrigger value="stock-in" className="gap-2" onClick={() => setIsTransferOpen(true)}>
              <ArrowLeftRight className="w-4 h-4" />
              <span className="hidden sm:inline">Transfer</span>
            </TabsTrigger>
            <TabsTrigger value="opname" className="gap-2" onClick={() => setIsOpnameOpen(true)}>
              <ClipboardCheck className="w-4 h-4" />
              <span className="hidden sm:inline">Opname</span>
            </TabsTrigger>
            <TabsTrigger value="po" className="gap-2" onClick={() => setIsPOOpen(true)}>
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
              <Select value={selectedLocation} onValueChange={setSelectedLocation}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Lokasi" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Lokasi</SelectItem>
                  {branches.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Kategori" />
                </SelectTrigger>
                <SelectContent>
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
                    {selectedLocation === "all" && branches.map((loc) => (
                      <TableHead key={loc.id} className="text-center">{loc.name}</TableHead>
                    ))}
                    {selectedLocation !== "all" && (
                      <TableHead className="text-center">Stok Lokasi</TableHead>
                    )}
                    <TableHead>Supplier</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProducts.map((product) => {
                    const isLowStock = product.stock <= product.minStock;
                    const margin = ((product.price - product.cost) / product.price) * 100;
                    const locationStock = selectedLocation !== "all" ? (product.branches[selectedLocation] || 0) : null;
                    
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
                        {selectedLocation === "all" && branches.map((loc) => (
                          <TableCell key={loc.id} className="text-center">
                            {product.branches[loc.id] || 0}
                          </TableCell>
                        ))}
                        {selectedLocation !== "all" && locationStock !== null && (
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

          <TabsContent value="transfers">
            <div className="bg-card rounded-xl border p-6">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="text-lg font-semibold">Transfer Stok</h3>
                  <p className="text-muted-foreground">Kelola perpindahan stok antar cabang</p>
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
                    {transfers.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium">{t.reference_number}</TableCell>
                        <TableCell>{t.source_branch_name}</TableCell>
                        <TableCell>{t.destination_branch_name}</TableCell>
                        <TableCell>
                          <Badge variant={t.status === 'completed' ? 'default' : 'secondary'}>
                            {t.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{new Date(t.created_at).toLocaleDateString()}</TableCell>
                        <TableCell className="text-right">
                          {t.status === 'pending' && (
                             (user?.role === 'store_manager' || user?.role === 'tenant_admin' || user?.role === 'tenant_owner' || user?.role === 'platform_owner') ? (
                              <Button size="sm" onClick={() => handleApproveTransfer(t.id)}>
                                Approve
                              </Button>
                             ) : (
                               <span className="text-xs text-muted-foreground italic">Menunggu Approval</span>
                             )
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
            <div className="text-center py-12">
              <ShoppingCart className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">Purchase Order</h3>
              <p className="text-muted-foreground mb-4">Buat permintaan pembelian untuk stok yang menipis</p>
              <Button onClick={() => setIsPOOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Buat PO Baru
              </Button>
            </div>
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
        branches={branches}
        mode={editingProduct ? "edit" : "add"}
        initialData={editingProduct}
      />

      <StockTransferModal
        open={isTransferOpen}
        onOpenChange={setIsTransferOpen}
        products={products.map(p => ({
          ...p,
          tenant_id: (user as any)?.tenant_id || '',
          unit_type: 'Pcs',
          min_stock_alert: p.minStock,
          stock_by_branch: p.branches,
        }))}
        branches={branches}
        onTransfer={handleTransfer}
      />

      <StockOpnameModal
        open={isOpnameOpen}
        onOpenChange={setIsOpnameOpen}
        products={products}
        branches={branches}
        onSave={handleOpname}
      />

      <PurchaseOrderModal
        open={isPOOpen}
        onOpenChange={setIsPOOpen}
        products={products}
        branches={branches}
        onSubmit={handlePO}
      />
    </BackOfficeLayout>
  );
}
