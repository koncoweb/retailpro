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
import { DollarSign, TrendingUp, Building2 } from "lucide-react";

interface SalesDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const branchSales = [
  { branch: "Jakarta Pusat", sales: 18500000, transactions: 85, growth: 12.5 },
  { branch: "Surabaya", sales: 12300000, transactions: 62, growth: 8.2 },
  { branch: "Bandung", sales: 8900000, transactions: 45, growth: -2.4 },
  { branch: "Medan", sales: 6100000, transactions: 32, growth: 15.3 },
];

const chartData = branchSales.map((b) => ({
  name: b.branch.split(" ")[0],
  sales: b.sales / 1000000,
}));

function formatCurrency(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(value);
}

export function SalesDetailModal({ open, onOpenChange }: SalesDetailModalProps) {
  const totalSales = branchSales.reduce((sum, b) => sum + b.sales, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-primary" />
            Detail Penjualan Hari Ini
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Total Summary */}
          <div className="p-4 bg-gradient-to-br from-primary/10 to-primary/5 rounded-xl border border-primary/20">
            <p className="text-sm text-muted-foreground">Total Penjualan Hari Ini</p>
            <p className="text-3xl font-bold text-primary">{formatCurrency(totalSales)}</p>
          </div>

          {/* Chart */}
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))" }} />
                <YAxis
                  tickFormatter={(value) => `${value}Jt`}
                  tick={{ fill: "hsl(var(--muted-foreground))" }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                  formatter={(value: number) => [`Rp ${value}Jt`, "Penjualan"]}
                />
                <Bar dataKey="sales" fill="hsl(173, 80%, 40%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Branch Table */}
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cabang</TableHead>
                  <TableHead className="text-right">Penjualan</TableHead>
                  <TableHead className="text-center">Transaksi</TableHead>
                  <TableHead className="text-right">Pertumbuhan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {branchSales.map((branch) => (
                  <TableRow key={branch.branch}>
                    <TableCell className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-muted-foreground" />
                      {branch.branch}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(branch.sales)}
                    </TableCell>
                    <TableCell className="text-center">{branch.transactions}</TableCell>
                    <TableCell className="text-right">
                      <Badge
                        variant={branch.growth >= 0 ? "default" : "secondary"}
                        className={
                          branch.growth >= 0
                            ? "bg-success/20 text-success"
                            : "bg-destructive/20 text-destructive"
                        }
                      >
                        <TrendingUp
                          className={`w-3 h-3 mr-1 ${branch.growth < 0 ? "rotate-180" : ""}`}
                        />
                        {Math.abs(branch.growth)}%
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
