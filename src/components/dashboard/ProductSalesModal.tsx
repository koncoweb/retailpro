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

interface ProductSalesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const productSales = [
  { name: "Indomie Goreng", sku: "PRD-001", sold: 245, branch: "Jakarta", revenue: 857500 },
  { name: "Susu Ultra 1L", sku: "PRD-002", sold: 189, branch: "Surabaya", revenue: 3496500 },
  { name: "Aqua 600ml", sku: "PRD-003", sold: 312, branch: "Jakarta", revenue: 1248000 },
  { name: "Roti Tawar", sku: "PRD-004", sold: 156, branch: "Bandung", revenue: 2496000 },
  { name: "Kopi Kapal Api", sku: "PRD-006", sold: 278, branch: "Medan", revenue: 556000 },
];

const branchProductData = [
  { branch: "Jakarta", products: 580 },
  { branch: "Surabaya", products: 420 },
  { branch: "Bandung", products: 350 },
  { branch: "Medan", products: 192 },
];

function formatCurrency(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(value);
}

export function ProductSalesModal({ open, onOpenChange }: ProductSalesModalProps) {
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
                  <XAxis dataKey="branch" tick={{ fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))" }} />
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
                  {productSales.map((product, index) => (
                    <TableRow key={product.sku}>
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
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
