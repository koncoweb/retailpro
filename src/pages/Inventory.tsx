import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
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
}

interface Branch {
  id: string;
  name: string;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(value);
}

export default function Inventory() {
  const location = useLocation();
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Semua");
  const [stockFilter, setStockFilter] = useState("all");
  const [selectedLocation, setSelectedLocation] = useState("all");
  const [branches, setBranches] = useState<Branch[]>([]);
  
  // Modal states
  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [isOpnameOpen, setIsOpnameOpen] = useState(false);
  const [isPOOpen, setIsPOOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const categories = ["Semua", "Makanan", "Minuman", "Personal Care", "Snack", "Elektronik", "Pakaian", "Lainnya"];

  // Fetch Branches
  useEffect(() => {
    const fetchBranches = async () => {
      try {
        const res = await query('SELECT id, name FROM branches WHERE status = \'active\' ORDER BY name');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setBranches(res.rows.map((r: any) => ({ id: r.id, name: r.name })));
      } catch (error) {
        console.error("Failed to fetch branches:", error);
      }
    };
    fetchBranches();
  }, []);

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
          COALESCE(pu.price, 0) as price,
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
          p.created_at
        FROM products p
        LEFT JOIN product_units pu ON p.id = pu.product_id
        ORDER BY p.created_at DESC
      `);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mappedProducts: Product[] = res.rows.map((row: any) => ({
        id: row.id, // Keep as string or number? Interface says number but UUID is string. Need to update interface.
        sku: row.sku,
        name: row.name,
        category: row.category || "Uncategorized",
        price: parseFloat(row.price),
        cost: parseFloat(row.cost),
        stock: parseFloat(row.stock),
        minStock: row.min_stock_level,
        branches: row.branch_stock || {},
        lastRestock: row.created_at, // Simplification
        supplier: row.supplier || "-"
      }));
      
      // Update interface to accept string ID or cast UUID to number (not possible safely). 
      // Better to update interface to string | number or just string.
      // For now I will cast to any to avoid TS error until I update interface
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setProducts(mappedProducts as any);
    } catch (error) {
      console.error("Failed to fetch products:", error);
      toast.error("Gagal mengambil data produk");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
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
        // UPDATE
        await query(
          `UPDATE products SET sku=$1, name=$2, category=$3, min_stock_level=$4 WHERE id=$5`,
          [productData.sku, productData.name, productData.category, productData.minStock, editingProduct.id]
        );

        // Update Price
        await query(
          `UPDATE product_units SET price=$1 WHERE product_id=$2 AND name='Pcs'`,
          [productData.price, editingProduct.id]
        );

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

        // Insert Product Unit
        await query(
          `INSERT INTO product_units (product_id, name, price, conversion_factor) 
           VALUES ($1, 'Pcs', $2, 1)`,
          [productId, productData.price]
        );

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

  const handleTransfer = (transfer: {
    from: string;
    to: string;
    items: Array<{ productId: string; quantity: number }>;
    notes: string;
  }) => {
    setProducts(products.map(p => {
      const transferItem = transfer.items.find(item => item.productId === p.id);
      if (transferItem) {
        const newBranches = { ...p.branches };
        newBranches[transfer.from] = (newBranches[transfer.from] || 0) - transferItem.quantity;
        newBranches[transfer.to] = (newBranches[transfer.to] || 0) + transferItem.quantity;
        return {
          ...p,
          branches: newBranches,
        };
      }
      return p;
    }));
  };

  const handleOpname = (opname: {
    location: string;
    items: Array<{ productId: string; actualStock: number }>;
  }) => {
    setProducts(products.map(p => {
      const opnameItem = opname.items.find(item => item.productId === p.id);
      if (opnameItem) {
        const newBranches = { ...p.branches };
        newBranches[opname.location] = opnameItem.actualStock;
        const newStock = Object.values(newBranches).reduce((sum, val) => sum + val, 0);
        return {
          ...p,
          branches: newBranches,
          stock: newStock,
        };
      }
      return p;
    }));
  };

  const handlePO = (po: {
    destination: string;
    items: Array<{ productId: string; quantity: number }>;
  }) => {
    // In a real app, this would create a PO record
    console.log("PO Created:", po);
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
                      <TableRow key={product.id} className="group">
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
                          <p className={`font-bold ${isLowStock ? "text-warning" : ""}`}>
                            {product.stock.toLocaleString()}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Min: {product.minStock}
                          </p>
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

          <TabsContent value="stock-in">
            <div className="text-center py-12">
              <ArrowLeftRight className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">Transfer Stok</h3>
              <p className="text-muted-foreground mb-4">Transfer stok antar cabang dan gudang pusat</p>
              <Button onClick={() => setIsTransferOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Buat Transfer Baru
              </Button>
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
        products={products}
        onTransfer={handleTransfer}
      />

      <StockOpnameModal
        open={isOpnameOpen}
        onOpenChange={setIsOpnameOpen}
        products={products}
        onSave={handleOpname}
      />

      <PurchaseOrderModal
        open={isPOOpen}
        onOpenChange={setIsPOOpen}
        products={products}
        onSubmit={handlePO}
      />
    </BackOfficeLayout>
  );
}
