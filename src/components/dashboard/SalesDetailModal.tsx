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
import { DollarSign, TrendingUp, Building2 } from "lucide-react";
import { query } from "@/lib/db";

interface SalesDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface BranchSales {
  branch: string;
  sales: number;
  transactions: number;
  growth: number;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(value);
}

export function SalesDetailModal({ open, onOpenChange }: SalesDetailModalProps) {
  const [branchSales, setBranchSales] = useState<BranchSales[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      fetchData();
    }
  }, [open]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Get current date stats
      const todayRes = await query(`
        SELECT 
          b.name as branch_name, 
          COALESCE(SUM(t.amount_paid), 0) as total_sales,
          COUNT(t.id) as tx_count
        FROM branches b
        LEFT JOIN transactions t ON b.id = t.branch_id 
          AND t.created_at >= CURRENT_DATE
        GROUP BY b.id, b.name
        ORDER BY total_sales DESC
      `);

      // Get yesterday stats for growth calculation
      const yesterdayRes = await query(`
        SELECT 
          b.name as branch_name, 
          COALESCE(SUM(t.amount_paid), 0) as total_sales
        FROM branches b
        LEFT JOIN transactions t ON b.id = t.branch_id 
          AND t.created_at >= CURRENT_DATE - INTERVAL '1 day'
          AND t.created_at < CURRENT_DATE
        GROUP BY b.id, b.name
      `);

      const yesterdayMap = new Map(yesterdayRes.rows.map((row: any) => [row.branch_name, parseFloat(row.total_sales)]));

      const data = todayRes.rows.map((row: any) => {
        const currentSales = parseFloat(row.total_sales);
        const prevSales = yesterdayMap.get(row.branch_name) || 0;
        let growth = 0;
        if (prevSales > 0) {
          growth = ((currentSales - prevSales) / prevSales) * 100;
        } else if (currentSales > 0) {
          growth = 100; // New sales from 0
        }

        return {
          branch: row.branch_name,
          sales: currentSales,
          transactions: parseInt(row.tx_count),
          growth: growth
        };
      });

      setBranchSales(data);
    } catch (error) {
      console.error("Failed to fetch sales detail:", error);
    } finally {
      setLoading(false);
    }
  };

  const totalSales = branchSales.reduce((sum, b) => sum + b.sales, 0);

  const chartData = branchSales.map((b) => ({
    name: b.branch, // Keep full name or split if too long
    sales: b.sales / 1000000, // Convert to millions for chart
  }));

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
                <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                <YAxis
                  tickFormatter={(value) => `${value}Jt`}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                  formatter={(value: number) => [`Rp ${value.toFixed(1)}Jt`, "Penjualan"]}
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
