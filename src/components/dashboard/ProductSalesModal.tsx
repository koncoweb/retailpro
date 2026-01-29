import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Package, Building2 } from "lucide-react";
import { query } from "@/lib/db";

interface ProductSalesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ProductSale {
  name: string;
  sku: string;
  sold: number;
  branch: string;
  revenue: number;
}

interface BranchProductStat {
  branch: string;
  products: number;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(value);
}

export function ProductSalesModal({ open, onOpenChange }: ProductSalesModalProps) {
  const [productSales, setProductSales] = useState<ProductSale[]>([]);
  const [branchProductData, setBranchProductData] = useState<BranchProductStat[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      fetchData();
    }
  }, [open]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch top selling products (grouped by product and branch)
      const prodRes = await query(`
        SELECT 
          p.name, 
          p.sku, 
          b.name as branch_name, 
          SUM(ti.quantity) as total_sold, 
          SUM(ti.subtotal) as total_revenue
        FROM transaction_items ti
        JOIN transactions t ON ti.transaction_id = t.id
        JOIN products p ON ti.product_id = p.id
        JOIN branches b ON t.branch_id = b.id
        WHERE t.created_at >= CURRENT_DATE
        GROUP BY p.id, p.name, p.sku, b.id, b.name
        ORDER BY total_sold DESC
        LIMIT 5
      `);

      setProductSales(prodRes.rows.map((row: any) => ({
        name: row.name,
        sku: row.sku,
        sold: parseInt(row.total_sold),
        branch: row.branch_name,
        revenue: parseFloat(row.total_revenue)
      })));

      // Fetch products sold per branch
      const branchRes = await query(`
        SELECT 
          b.name as branch_name, 
          COALESCE(SUM(ti.quantity), 0) as total_products
        FROM branches b
        LEFT JOIN transactions t ON b.id = t.branch_id AND t.created_at >= CURRENT_DATE
        LEFT JOIN transaction_items ti ON t.id = ti.transaction_id
        GROUP BY b.id, b.name
        ORDER BY total_products DESC
      `);

      setBranchProductData(branchRes.rows.map((row: any) => ({
        branch: row.branch_name,
        products: parseInt(row.total_products)
      })));

    } catch (error) {
      console.error("Failed to fetch product sales:", error);
    } finally {
      setLoading(false);
    }
  };

  const totalProducts = productSales.reduce((sum, p) => sum + p.sold, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-5 h-5 text-success" />
            Detail Produk Terjual
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Summary */}
          <div className="p-4 bg-gradient-to-br from-success/10 to-success/5 rounded-xl border border-success/20">
            <p className="text-sm text-muted-foreground">Total Produk Terjual Hari Ini</p>
            <p className="text-3xl font-bold text-success">{totalProducts.toLocaleString()}</p>
          </div>

          {/* Chart by Branch */}
          <div>
            <h4 className="font-semibold mb-3">Produk Terjual per Cabang</h4>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={branchProductData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="branch" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                  <Bar dataKey="products" name="Produk" fill="hsl(142, 76%, 36%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Top Products Table */}
          <div>
            <h4 className="font-semibold mb-3">Produk Terlaris</h4>
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produk</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Cabang</TableHead>
                    <TableHead className="text-center">Terjual</TableHead>
                    <TableHead className="text-right">Pendapatan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && productSales.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-4">Loading...</TableCell>
                    </TableRow>
                  ) : productSales.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-4">Belum ada penjualan produk hari ini</TableCell>
                    </TableRow>
                  ) : (
                    productSales.map((product, index) => (
                      <TableRow key={`${product.sku}-${product.branch}`}>
                        <TableCell className="flex items-center gap-2">
                          <Badge variant="outline" className="w-6 h-6 rounded-full flex items-center justify-center text-xs">
                            {index + 1}
                          </Badge>
                          {product.name}
                        </TableCell>
                        <TableCell className="font-mono text-sm">{product.sku}</TableCell>
                        <TableCell className="flex items-center gap-1">
                          <Building2 className="w-3 h-3 text-muted-foreground" />
                          {product.branch}
                        </TableCell>
                        <TableCell className="text-center font-bold">{product.sold}</TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(product.revenue)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
