import { useQuery } from "@tanstack/react-query";
import { query } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { 
  Building2, 
  Users, 
  TrendingUp, 
  Store,
  ArrowUpRight,
  ArrowDownRight,
  DollarSign,
  Download
} from "lucide-react";
import { formatCurrency } from "@/lib/formatters";
import { Skeleton } from "@/components/ui/skeleton";
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
  Legend
} from "recharts";

interface DashboardStats {
  totalBranches: number;
  activeBranches: number;
  totalEmployees: number;
  totalSales: number;
}

interface BranchPerformance {
  id: string;
  name: string;
  transactions: number;
  sales: number;
  status: string;
}

export default function BranchDashboard() {
  // Fetch Aggregate Stats
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["branch-dashboard-stats"],
    queryFn: async () => {
      const res = await query(`
        SELECT 
          COUNT(*) as total_branches,
          COUNT(CASE WHEN status = 'active' THEN 1 END) as active_branches,
          (SELECT COUNT(*) FROM users WHERE assigned_branch_id IS NOT NULL) as total_employees,
          (SELECT COALESCE(SUM(total_amount), 0) FROM transactions WHERE created_at >= date_trunc('month', CURRENT_DATE)) as total_sales
        FROM branches
      `);
      
      const row = res.rows[0];
      return {
        totalBranches: parseInt(row.total_branches),
        activeBranches: parseInt(row.active_branches),
        totalEmployees: parseInt(row.total_employees),
        totalSales: parseFloat(row.total_sales)
      } as DashboardStats;
    }
  });

  // Fetch Branch Performance
  const { data: performance, isLoading: perfLoading } = useQuery({
    queryKey: ["branch-dashboard-performance"],
    queryFn: async () => {
      const res = await query(`
        SELECT 
          b.id,
          b.name,
          b.status,
          COUNT(t.id) as transaction_count,
          COALESCE(SUM(t.total_amount), 0) as total_sales
        FROM branches b
        LEFT JOIN transactions t ON b.id = t.branch_id AND t.created_at >= date_trunc('month', CURRENT_DATE)
        GROUP BY b.id, b.name, b.status
        ORDER BY total_sales DESC
      `);
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return res.rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        transactions: parseInt(row.transaction_count),
        sales: parseFloat(row.total_sales)
      })) as BranchPerformance[];
    }
  });

  const handleExport = () => {
    if (!performance || performance.length === 0) {
      toast.error("Tidak ada data performa untuk diexport");
      return;
    }

    const exportData = performance.map(b => ({
      "Nama Cabang": b.name,
      "Status": b.status,
      "Jumlah Transaksi": b.transactions,
      "Total Penjualan": b.sales
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Performa Cabang");

    const wscols = [
      { wch: 25 }, // Nama
      { wch: 10 }, // Status
      { wch: 15 }, // Transaksi
      { wch: 20 }, // Penjualan
    ];
    ws['!cols'] = wscols;

    XLSX.writeFile(wb, `Performa_Cabang_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success("Berhasil export data performa cabang");
  };

  if (statsLoading || perfLoading) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="space-y-6 p-6 pb-16">
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Dashboard Percabangan</h1>
          <p className="text-muted-foreground">
            Ringkasan performa dan statistik seluruh cabang bulan ini.
          </p>
        </div>
        <Button variant="outline" className="gap-2" onClick={handleExport}>
          <Download className="w-4 h-4" />
          Export
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard 
          title="Total Cabang" 
          value={stats?.totalBranches || 0} 
          icon={Building2} 
          description={`${stats?.activeBranches || 0} Aktif`}
        />
        <StatCard 
          title="Total Penjualan (Bulan Ini)" 
          value={formatCurrency(stats?.totalSales || 0)} 
          icon={DollarSign} 
          description="Revenue gabungan"
        />
        <StatCard 
          title="Total Karyawan" 
          value={stats?.totalEmployees || 0} 
          icon={Users} 
          description="Terdaftar di cabang"
        />
        <StatCard 
          title="Rata-rata Penjualan" 
          value={formatCurrency(stats?.totalBranches ? (stats.totalSales / stats.totalBranches) : 0)} 
          icon={TrendingUp} 
          description="Per cabang"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        {/* Chart Section */}
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Performa Penjualan Cabang</CardTitle>
          </CardHeader>
          <CardContent className="pl-2">
            <div className="h-[350px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={performance}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    dataKey="name" 
                    stroke="#888888" 
                    fontSize={12} 
                    tickLine={false} 
                    axisLine={false} 
                  />
                  <YAxis 
                    stroke="#888888" 
                    fontSize={12} 
                    tickLine={false} 
                    axisLine={false} 
                    tickFormatter={(value) => `Rp${value/1000000}jt`} 
                  />
                  <Tooltip 
                    formatter={(value: number) => formatCurrency(value)}
                    cursor={{ fill: 'transparent' }}
                  />
                  <Legend />
                  <Bar dataKey="sales" name="Penjualan" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Top Branches List */}
        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>Peringkat Cabang</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                <TableRow>
                  <TableHead>Cabang</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Penjualan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {performance?.slice(0, 5).map((branch) => (
                  <TableRow key={branch.id}>
                    <TableCell className="font-medium">
                      <div className="flex flex-col">
                        <span>{branch.name}</span>
                        <span className="text-xs text-muted-foreground">{branch.transactions} Transaksi</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={branch.status === 'active' ? 'default' : 'secondary'}>
                        {branch.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-bold">
                      {formatCurrency(branch.sales)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Helper Components
function StatCard({ title, value, icon: Icon, description }: { title: string, value: string | number, icon: React.ElementType, description: string }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">
          {title}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground">
          {description}
        </p>
      </CardContent>
    </Card>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6 p-6">
      <div className="h-8 w-64 bg-muted rounded animate-pulse" />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-32 bg-muted rounded animate-pulse" />
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-7">
        <div className="col-span-4 h-[400px] bg-muted rounded animate-pulse" />
        <div className="col-span-3 h-[400px] bg-muted rounded animate-pulse" />
      </div>
    </div>
  )
}
