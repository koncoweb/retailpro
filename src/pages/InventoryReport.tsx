import { useState } from "react";
import { BackOfficeLayout } from "@/components/layout/BackOfficeLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useQuery } from "@tanstack/react-query";
import { query } from "@/lib/db";
import { Download, Loader2, ArrowLeft, AlertTriangle, Package } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

export default function InventoryReport() {
  const navigate = useNavigate();
  const [selectedBranch, setSelectedBranch] = useState("all");

  const { data: branches = [] } = useQuery({
    queryKey: ["branches"],
    queryFn: async () => {
      const res = await query("SELECT id, name FROM branches ORDER BY name ASC");
      return res.rows;
    },
  });

  const { data: inventoryData = [], isLoading } = useQuery({
    queryKey: ["inventoryReport", selectedBranch],
    queryFn: async () => {
      let queryStr = `
        SELECT 
          p.sku,
          p.name,
          p.category,
          p.min_stock_level,
          (
            SELECT name 
            FROM product_units 
            WHERE product_id = p.id AND conversion_factor = 1 
            LIMIT 1
          ) as unit_type,
          (
            SELECT price 
            FROM product_units 
            WHERE product_id = p.id AND conversion_factor = 1 
            LIMIT 1
          ) as price,
          COALESCE((
            SELECT AVG(cost_price) 
            FROM product_batches 
            WHERE product_id = p.id AND quantity_current > 0
          ), 0) as cost_price,
          COALESCE(SUM(pb.quantity_current), 0) as current_stock,
          COALESCE(SUM(pb.quantity_current * pb.cost_price), 0) as total_asset_value
        FROM products p
        LEFT JOIN product_batches pb ON p.id = pb.product_id
      `;
      
      const params: any[] = [];
      if (selectedBranch !== "all") {
        queryStr += ` AND pb.branch_id = $1`;
        params.push(selectedBranch);
      }
      
      queryStr += ` GROUP BY p.id, p.sku, p.name, p.category, p.min_stock_level`;
      queryStr += ` ORDER BY p.name ASC`;
      
      const res = await query(queryStr, params);
      return res.rows.map((row: any) => ({
        ...row,
        current_stock: Number(row.current_stock),
        total_asset_value: Number(row.total_asset_value),
        min_stock_level: Number(row.min_stock_level),
        price: Number(row.price || 0),
        cost_price: Number(row.cost_price || 0),
      }));
    },
  });

  const handleExport = () => {
    if (inventoryData.length === 0) {
      toast.error("Tidak ada data untuk diexport");
      return;
    }

    const exportData = inventoryData.map((item: any) => ({
      "SKU": item.sku,
      "Nama Produk": item.name,
      "Kategori": item.category,
      "Stok Saat Ini": item.current_stock,
      "Min. Stok": item.min_stock_level,
      "Unit": item.unit_type,
      "Harga Beli": item.cost_price,
      "Harga Jual": item.price,
      "Nilai Aset": item.total_asset_value,
      "Status": item.current_stock <= item.min_stock_level ? "Low Stock" : "Normal"
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Laporan Inventory");

    // Auto-width
    const wscols = [
      { wch: 15 }, // SKU
      { wch: 30 }, // Nama
      { wch: 15 }, // Kategori
      { wch: 10 }, // Stok
      { wch: 10 }, // Min Stok
      { wch: 10 }, // Unit
      { wch: 15 }, // Harga Beli
      { wch: 15 }, // Harga Jual
      { wch: 15 }, // Nilai Aset
      { wch: 15 }, // Status
    ];
    ws["!cols"] = wscols;

    XLSX.writeFile(wb, `Laporan_Inventory_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success("Berhasil export laporan inventory");
  };

  const totalAssetValue = inventoryData.reduce((acc: number, curr: any) => acc + curr.total_asset_value, 0);
  const lowStockItems = inventoryData.filter((item: any) => item.current_stock <= item.min_stock_level);

  return (
    <BackOfficeLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/backoffice/reports")}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Laporan Inventory</h1>
            <p className="text-muted-foreground">Status stok dan valuasi aset</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 items-end sm:items-center justify-between">
          <div className="w-full sm:w-[250px]">
            <Select value={selectedBranch} onValueChange={setSelectedBranch}>
              <SelectTrigger>
                <SelectValue placeholder="Pilih Cabang" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Cabang</SelectItem>
                {branches.map((b: any) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleExport} className="gap-2">
            <Download className="w-4 h-4" /> Export Excel
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Nilai Aset</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR" }).format(totalAssetValue)}
              </div>
              <p className="text-xs text-muted-foreground">
                Berdasarkan harga beli (COGS)
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Low Stock Items</CardTitle>
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{lowStockItems.length}</div>
              <p className="text-xs text-muted-foreground">
                Produk di bawah minimum stok
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Stok Produk</CardTitle>
            <CardDescription>Daftar semua produk dan status stok</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Nama Produk</TableHead>
                  <TableHead>Kategori</TableHead>
                  <TableHead className="text-right">Stok</TableHead>
                  <TableHead className="text-right">Min. Stok</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Nilai Aset</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-24 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" /> Loading...
                      </div>
                    </TableCell>
                  </TableRow>
                ) : inventoryData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                      Tidak ada data produk
                    </TableCell>
                  </TableRow>
                ) : (
                  inventoryData.map((item: any) => (
                    <TableRow key={item.sku}>
                      <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell>{item.category}</TableCell>
                      <TableCell className="text-right">{item.current_stock}</TableCell>
                      <TableCell className="text-right">{item.min_stock_level}</TableCell>
                      <TableCell>{item.unit_type}</TableCell>
                      <TableCell className="text-right">
                        {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR" }).format(item.total_asset_value)}
                      </TableCell>
                      <TableCell>
                        {item.current_stock <= item.min_stock_level ? (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                            Low Stock
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            Normal
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </BackOfficeLayout>
  );
}
