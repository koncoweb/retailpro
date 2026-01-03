import { useState } from "react";
import { useLocation } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
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
} from "lucide-react";
import { ProductImportExport } from "@/components/inventory/ProductImportExport";
import { AddProductModal } from "@/components/inventory/AddProductModal";
import { StockTransferModal } from "@/components/inventory/StockTransferModal";
import { StockOpnameModal } from "@/components/inventory/StockOpnameModal";
import { PurchaseOrderModal } from "@/components/inventory/PurchaseOrderModal";
import { toast } from "sonner";

interface Product {
  id: number;
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

const initialProducts: Product[] = [
  {
    id: 1,
    sku: "PRD-001",
    name: "Indomie Goreng Original",
    category: "Makanan",
    price: 3500,
    cost: 2800,
    stock: 1250,
    minStock: 200,
    branches: { pusat: 300, jakarta: 450, surabaya: 250, bandung: 150, medan: 100 },
    lastRestock: "2024-01-10",
    supplier: "PT Indofood",
  },
  {
    id: 2,
    sku: "PRD-002",
    name: "Susu Ultra 1L Full Cream",
    category: "Minuman",
    price: 18500,
    cost: 15000,
    stock: 45,
    minStock: 100,
    branches: { pusat: 10, jakarta: 15, surabaya: 10, bandung: 5, medan: 5 },
    lastRestock: "2024-01-08",
    supplier: "PT Ultra Jaya",
  },
  {
    id: 3,
    sku: "PRD-003",
    name: "Aqua Botol 600ml",
    category: "Minuman",
    price: 4000,
    cost: 3200,
    stock: 2800,
    minStock: 500,
    branches: { pusat: 800, jakarta: 700, surabaya: 600, bandung: 400, medan: 300 },
    lastRestock: "2024-01-12",
    supplier: "PT Danone",
  },
  {
    id: 4,
    sku: "PRD-004",
    name: "Roti Tawar Sari Roti",
    category: "Makanan",
    price: 16000,
    cost: 12500,
    stock: 12,
    minStock: 50,
    branches: { pusat: 5, jakarta: 3, surabaya: 2, bandung: 1, medan: 1 },
    lastRestock: "2024-01-11",
    supplier: "PT Nippon Indosari",
  },
  {
    id: 5,
    sku: "PRD-005",
    name: "Sabun Lifebuoy 100g",
    category: "Personal Care",
    price: 5500,
    cost: 4200,
    stock: 680,
    minStock: 150,
    branches: { pusat: 200, jakarta: 180, surabaya: 150, bandung: 80, medan: 70 },
    lastRestock: "2024-01-09",
    supplier: "PT Unilever",
  },
  {
    id: 6,
    sku: "PRD-006",
    name: "Kopi Kapal Api Special Mix",
    category: "Minuman",
    price: 2000,
    cost: 1500,
    stock: 3200,
    minStock: 400,
    branches: { pusat: 1000, jakarta: 800, surabaya: 700, bandung: 400, medan: 300 },
    lastRestock: "2024-01-10",
    supplier: "PT Santos Jaya",
  },
];

const categories = ["Semua", "Makanan", "Minuman", "Personal Care", "Snack"];

const locations = [
  { id: "pusat", name: "Gudang Pusat" },
  { id: "jakarta", name: "Cabang Jakarta" },
  { id: "surabaya", name: "Cabang Surabaya" },
  { id: "bandung", name: "Cabang Bandung" },
  { id: "medan", name: "Cabang Medan" },
];

function formatCurrency(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(value);
}

export default function Inventory() {
  const location = useLocation();
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Semua");
  const [stockFilter, setStockFilter] = useState("all");
  const [selectedLocation, setSelectedLocation] = useState("all");
  
  // Modal states
  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [isOpnameOpen, setIsOpnameOpen] = useState(false);
  const [isPOOpen, setIsPOOpen] = useState(false);

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
        id: Date.now() + index,
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

  const handleAddProduct = (newProduct: {
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
    const product: Product = {
      id: Date.now(),
      ...newProduct,
      lastRestock: new Date().toISOString().split("T")[0],
    };
    setProducts([...products, product]);
  };

  const handleTransfer = (transfer: {
    from: string;
    to: string;
    items: Array<{ productId: number; quantity: number }>;
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
    items: Array<{ productId: number; actualStock: number }>;
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
    items: Array<{ productId: number; quantity: number }>;
  }) => {
    // In a real app, this would create a PO record
    console.log("PO Created:", po);
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
    <MainLayout>
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
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Lokasi" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Lokasi</SelectItem>
                  {locations.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Kategori" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
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
                              <DropdownMenuItem>
                                <Edit className="w-4 h-4 mr-2" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setIsTransferOpen(true)}>
                                <ArrowLeftRight className="w-4 h-4 mr-2" />
                                Transfer Stok
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive">
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
        onOpenChange={setIsAddProductOpen}
        onAdd={handleAddProduct}
        categories={categories}
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
    </MainLayout>
  );
}
