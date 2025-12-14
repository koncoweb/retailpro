import { useState } from "react";
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
import {
  Search,
  Plus,
  MoreHorizontal,
  Package,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Filter,
  Download,
  Edit,
  Trash2,
  Eye,
  BarChart3,
} from "lucide-react";

const products = [
  {
    id: 1,
    sku: "PRD-001",
    name: "Indomie Goreng Original",
    category: "Makanan",
    price: 3500,
    cost: 2800,
    stock: 1250,
    minStock: 200,
    branches: { jakarta: 450, surabaya: 380, bandung: 280, medan: 140 },
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
    branches: { jakarta: 20, surabaya: 10, bandung: 10, medan: 5 },
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
    branches: { jakarta: 1000, surabaya: 800, bandung: 600, medan: 400 },
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
    branches: { jakarta: 5, surabaya: 3, bandung: 3, medan: 1 },
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
    branches: { jakarta: 250, surabaya: 180, bandung: 150, medan: 100 },
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
    branches: { jakarta: 1200, surabaya: 900, bandung: 700, medan: 400 },
    lastRestock: "2024-01-10",
    supplier: "PT Santos Jaya",
  },
];

const categories = ["Semua", "Makanan", "Minuman", "Personal Care", "Snack"];

function formatCurrency(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(value);
}

export default function Inventory() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Semua");
  const [stockFilter, setStockFilter] = useState("all");

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
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2">
              <Download className="w-4 h-4" />
              Export
            </Button>
            <Button className="gap-2">
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
                <TableHead>Supplier</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProducts.map((product) => {
                const isLowStock = product.stock <= product.minStock;
                const margin = ((product.price - product.cost) / product.price) * 100;
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
                      <p
                        className={`font-bold ${isLowStock ? "text-warning" : ""}`}
                      >
                        {product.stock.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Min: {product.minStock}
                      </p>
                    </TableCell>
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
                          <DropdownMenuItem>
                            <TrendingUp className="w-4 h-4 mr-2" />
                            Tambah Stok
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
      </div>
    </MainLayout>
  );
}
