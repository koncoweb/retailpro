import { useEffect, useState } from "react";
import { BackOfficeLayout } from "@/components/layout/BackOfficeLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from "recharts";
import {
  Download,
  FileSpreadsheet,
  FileText,
  TrendingUp,
  DollarSign,
  Package,
  Users,
  Loader2,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { query } from "@/lib/db";
import { getPeriodRange, sqliteTzModifier, startOfMonthOffset } from "@/lib/date-range";
import * as XLSX from 'xlsx';
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

const COLORS = ["hsl(173, 80%, 40%)", "hsl(199, 89%, 48%)", "hsl(142, 76%, 36%)", "hsl(38, 92%, 50%)", "hsl(280, 70%, 50%)", "hsl(340, 70%, 50%)"];

function formatCurrency(value: number) {
  if (value >= 1000000000) {
    return `Rp ${(value / 1000000000).toFixed(1)}M`;
  }
  if (value >= 1000000) {
    return `Rp ${(value / 1000000).toFixed(0)}Jt`;
  }
  return `Rp ${value.toLocaleString()}`;
}

const reportTypes = [
  {
    title: "Laporan Penjualan",
    description: "Ringkasan penjualan per cabang dan periode",
    icon: DollarSign,
    color: "primary",
    type: "sales",
    path: "/backoffice/reports/sales"
  },
  {
    title: "Laporan Inventory",
    description: "Status stok dan pergerakan barang",
    icon: Package,
    color: "info",
    type: "inventory",
    path: "/backoffice/reports/inventory"
  },
  {
    title: "Laporan Karyawan",
    description: "Absensi, payroll, dan kinerja",
    icon: Users,
    color: "success",
    type: "employees",
    path: "/backoffice/hr/attendance"
  },
  {
    title: "Laporan Keuangan",
    description: "Jurnal, neraca, dan cash flow",
    icon: TrendingUp,
    color: "warning",
    type: "finance",
    path: "/backoffice/reports/finance"
  },
];

export default function Reports() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState("thismonth");
  /**
   * `all` is not a branch id — it means "aggregate every branch". Read-side
   * screens may aggregate; a write (a POS sale) never can.
   */
  const [branchFilter, setBranchFilter] = useState("all");
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    query<{ id: string; name: string }>("SELECT id, name FROM branches ORDER BY name")
      .then((res) => setBranches(res.rows))
      .catch((error) => console.error("Failed to load branches:", error));
  }, []);

  /**
   * `[start, endExclusive)` for the selected period. Both bounds are bound as
   * parameters instead of relying on `CURRENT_DATE` or an open-ended `>=`, so
   * the window is reproducible and the `idx_tx_created` index serves the scan.
   */
  const getDateRange = () => getPeriodRange(period);

  /**
   * Builds the shared `WHERE` fragment for the sales queries. The branch
   * predicate is appended only when a specific branch is selected, because the
   * aggregate view must still include every branch.
   */
  const scopeArgs = (start: string, end: string) =>
    branchFilter === "all" ? [start, end] : [start, end, branchFilter];
  const scopeWhere = (alias: string) =>
    branchFilter === "all"
      ? `${alias}.created_at >= $1 AND ${alias}.created_at < $2`
      : `${alias}.created_at >= $1 AND ${alias}.created_at < $2 AND ${alias}.branch_id = $3`;

  const { data: salesByBranch = [], isLoading: loadingBranch } = useQuery({
    queryKey: ['salesByBranch', period, branchFilter],
    queryFn: async () => {
      const [start, end] = getDateRange();
      const res = await query(`
        SELECT
          b.name,
          COALESCE(SUM(t.total_amount), 0) as value
        FROM transactions t
        JOIN branches b ON t.branch_id = b.id
        WHERE ${scopeWhere("t")}
        GROUP BY b.name
        ORDER BY value DESC
      `, scopeArgs(start, end));
      return res.rows.map(r => ({ name: r.name, value: Number(r.value) }));
    }
  });

  const { data: salesByCategory = [], isLoading: loadingCategory } = useQuery({
    queryKey: ['salesByCategory', period, branchFilter],
    queryFn: async () => {
      const [start, end] = getDateRange();
      const res = await query(`
        SELECT
          COALESCE(p.category, 'Uncategorized') as name,
          COALESCE(SUM(ti.subtotal), 0) as value
        FROM transaction_items ti
        JOIN products p ON ti.product_id = p.id
        JOIN transactions t ON ti.transaction_id = t.id
        WHERE ${scopeWhere("t")}
        GROUP BY p.category
        ORDER BY value DESC
      `, scopeArgs(start, end));
      
      const total = res.rows.reduce((acc, curr) => acc + Number(curr.value), 0);
      return res.rows.map(r => ({ 
        name: r.name, 
        value: Number(r.value),
        percentage: total > 0 ? Math.round((Number(r.value) / total) * 100) : 0
      }));
    }
  });

  const { data: monthlySales = [], isLoading: loadingMonthly } = useQuery({
    queryKey: ['monthlySales', branchFilter],
    queryFn: async () => {
      // Six-month rolling trend with both bounds bound, and the month bucket
      // shifted into local time: a sale at 00:30 local on the 1st is stored as
      // the previous day in UTC and would otherwise fall into the wrong month.
      const start = startOfMonthOffset(5);
      const end = new Date();
      end.setMonth(end.getMonth() + 1, 1);
      const branchClause = branchFilter === "all" ? "" : " AND branch_id = $4";
      const res = await query(`
        SELECT
          strftime('%Y-%m', created_at, $1) as month_key,
          COALESCE(SUM(total_amount), 0) as sales
        FROM transactions
        WHERE created_at >= $2 AND created_at < $3${branchClause}
        GROUP BY 1
        ORDER BY 1
      `, [sqliteTzModifier(), start, end.toISOString(), ...(branchFilter === "all" ? [] : [branchFilter])]);
      // SQLite has no locale-aware TO_CHAR; build the short month label in JS.
      const monthLabel = (key: string) => {
        const [year, month] = key.split("-");
        return new Date(Number(year), Number(month) - 1, 1)
          .toLocaleDateString("id-ID", { month: "short" });
      };
      return res.rows.map(r => ({ 
        month: monthLabel(r.month_key), 
        sales: Number(r.sales),
        target: Number(r.sales) * 1.1 // Mock target as 110% of sales
      }));
    }
  });

  const handleExport = async (type?: string) => {
    try {
        const wb = XLSX.utils.book_new();
        const filename = `Report_${period}_${new Date().getTime()}.xlsx`;

        if (type === 'sales' || !type) {
             // Sheet 1: Sales Summary
            const salesData = [
                ["Laporan Penjualan", `Periode: ${period}`],
                [""],
                ["Cabang", "Total Penjualan"],
                ...salesByBranch.map(s => [s.name, s.value]),
                [""],
                ["Kategori", "Total Penjualan", "Persentase"],
                ...salesByCategory.map(s => [s.name, s.value, `${s.percentage}%`])
            ];
            const wsSales = XLSX.utils.aoa_to_sheet(salesData);
            XLSX.utils.book_append_sheet(wb, wsSales, "Ringkasan Penjualan");

            // Sheet 2: Transactions Detail — same scope as the on-screen cards.
            const [detailStart, detailEnd] = getDateRange();
            const transactionsRes = await query(`
                SELECT 
                    t.invoice_number, 
                    t.created_at, 
                    b.name as branch, 
                    t.total_amount, 
                    t.payment_method,
                    t.status
                FROM transactions t
                JOIN branches b ON t.branch_id = b.id
                WHERE ${scopeWhere("t")}
                ORDER BY t.created_at DESC
            `, scopeArgs(detailStart, detailEnd));
            
            const transData = transactionsRes.rows.map(t => ({
                "Invoice": t.invoice_number,
                "Tanggal": new Date(t.created_at).toLocaleString(),
                "Cabang": t.branch,
                "Total": Number(t.total_amount),
                "Metode Pembayaran": t.payment_method,
                "Status": t.status
            }));
            const wsTrans = XLSX.utils.json_to_sheet(transData);
            XLSX.utils.book_append_sheet(wb, wsTrans, "Detail Transaksi");
        }

        if (type === 'inventory' || !type) {
            // Sheet 3: Inventory
             const inventoryRes = await query(`
                SELECT 
                    p.sku, 
                    p.name, 
                    p.category, 
                    p.min_stock_level,
                    COALESCE((SELECT pu.name FROM product_units pu WHERE pu.product_id = p.id ORDER BY pu.conversion_factor ASC LIMIT 1), '-') as unit_type
                FROM products p
                ORDER BY p.name ASC
            `);
             const invData = inventoryRes.rows.map(p => ({
                "SKU": p.sku,
                "Nama Produk": p.name,
                "Kategori": p.category,
                "Min Stock": p.min_stock_level,
                "Unit": p.unit_type
            }));
            const wsInv = XLSX.utils.json_to_sheet(invData);
            wsInv['!cols'] = [{wch: 15}, {wch: 30}, {wch: 15}, {wch: 10}, {wch: 10}];
            XLSX.utils.book_append_sheet(wb, wsInv, "Inventory");
        }

        if (type === 'employees' || !type) {
            // Sheet: Employees
            // This used to read a `employees` table that nothing ever wrote to,
            // so the sheet always came out empty. Employees are users with a
            // branch, which is what Employees.tsx maintains.
            try {
                const employeesRes = await query(`
                    SELECT 
                        u.name, 
                        u.role, 
                        u.email, 
                        b.name as branch, 
                        CASE WHEN u.is_active = 1 THEN 'active' ELSE 'inactive' END as status
                    FROM users u
                    LEFT JOIN branches b ON u.assigned_branch_id = b.id
                    ORDER BY u.name ASC
                `);
                const empData = employeesRes.rows.map(e => ({
                    "Nama": e.name,
                    "Role": e.role,
                    "Email": e.email,
                    "Cabang": e.branch || "-",
                    "Status": e.status
                }));
                const wsEmp = XLSX.utils.json_to_sheet(empData);
                wsEmp['!cols'] = [{wch: 20}, {wch: 15}, {wch: 25}, {wch: 15}, {wch: 10}];
                XLSX.utils.book_append_sheet(wb, wsEmp, "Karyawan");
            } catch (err) {
                console.error("Error exporting employees:", err);
            }
        }

        if (type === 'finance' || !type) {
             // Sheet: Finance Summary
             try {
                 const [finStart, finEnd] = getDateRange();
                 const expensesRes = await query(`
                    SELECT category, SUM(amount) as total
                    FROM expenses
                    WHERE date >= $1 AND date < $2
                    GROUP BY category
                 `, [finStart, finEnd]);
                 
                 const incomeRes = await query(`
                    SELECT SUM(total_amount) as total
                    FROM transactions t
                    WHERE ${scopeWhere("t")}
                 `, scopeArgs(finStart, finEnd));

                 const totalIncome = Number(incomeRes.rows[0].total || 0);
                 const totalExpense = expensesRes.rows.reduce((acc, curr) => acc + Number(curr.total), 0);

                 const financeData = [
                     ["Laporan Keuangan Ringkas", `Periode: ${period}`],
                     [""],
                     ["Pendapatan", totalIncome],
                     [""],
                     ["Pengeluaran per Kategori"],
                     ...expensesRes.rows.map(e => [e.category, Number(e.total)]),
                     [""],
                     ["Total Pengeluaran", totalExpense],
                     [""],
                     ["Estimasi Laba Bersih", totalIncome - totalExpense]
                 ];
                 const wsFin = XLSX.utils.aoa_to_sheet(financeData);
                 wsFin['!cols'] = [{wch: 30}, {wch: 20}];
                 XLSX.utils.book_append_sheet(wb, wsFin, "Ringkasan Keuangan");
             } catch (err) {
                 console.error("Error exporting finance:", err);
             }
        }

        XLSX.writeFile(wb, filename);
        toast.success("Laporan berhasil diexport");
    } catch (error) {
        console.error("Export error:", error);
        toast.error("Gagal export laporan");
    }
  };

  const isLoading = loadingBranch || loadingCategory || loadingMonthly;

  return (
    <BackOfficeLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold">Laporan & Analitik</h1>
            <p className="text-muted-foreground mt-1">
              Dashboard laporan dan export data
            </p>
          </div>
          <div className="flex gap-2">
            <Select value={branchFilter} onValueChange={setBranchFilter}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Cabang" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Cabang</SelectItem>
                {branches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Periode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Hari Ini</SelectItem>
                <SelectItem value="thisweek">Minggu Ini</SelectItem>
                <SelectItem value="thismonth">Bulan Ini</SelectItem>
                <SelectItem value="thisyear">Tahun Ini</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" className="gap-2" onClick={() => handleExport()}>
                <Download className="w-4 h-4" />
                Export Semua
            </Button>
          </div>
        </div>

        {/* Quick Export Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {reportTypes.map((report) => (
            <Card 
              key={report.title} 
              className="hover:shadow-lg transition-all cursor-pointer group"
              onClick={() => {
                if (report.path) {
                  navigate(report.path);
                }
              }}
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {report.title}
                </CardTitle>
                <div className={`p-2 rounded-full bg-${report.color}/10 group-hover:bg-${report.color}/20 transition-colors`}>
                  <report.icon className={`h-4 w-4 text-${report.color}`} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-xs text-muted-foreground mt-2">
                  {report.description}
                </div>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="w-full mt-4 justify-between"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleExport(report.type);
                  }}
                >
                  Quick Export
                  <Download className="h-4 w-4 ml-2" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        {isLoading ? (
             <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        ) : (
            <>
                {/* Charts Row */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Monthly Sales Trend */}
                <Card className="animate-fade-in">
                    <CardHeader>
                    <CardTitle>Tren Penjualan Bulanan</CardTitle>
                    <CardDescription>Perbandingan aktual vs target (6 bulan terakhir)</CardDescription>
                    </CardHeader>
                    <CardContent>
                    <div className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={monthlySales}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                            <XAxis dataKey="month" tick={{ fill: "hsl(var(--muted-foreground))" }} />
                            <YAxis
                            tickFormatter={(value) => `${(value / 1000000).toFixed(0)}Jt`}
                            tick={{ fill: "hsl(var(--muted-foreground))" }}
                            />
                            <Tooltip
                            contentStyle={{
                                backgroundColor: "hsl(var(--card))",
                                border: "1px solid hsl(var(--border))",
                                borderRadius: "8px",
                            }}
                            formatter={(value: number) => formatCurrency(value)}
                            />
                            <Line
                            type="monotone"
                            dataKey="sales"
                            name="Penjualan"
                            stroke="hsl(173, 80%, 40%)"
                            strokeWidth={3}
                            dot={{ fill: "hsl(173, 80%, 40%)" }}
                            />
                            <Line
                            type="monotone"
                            dataKey="target"
                            name="Target"
                            stroke="hsl(var(--muted-foreground))"
                            strokeWidth={2}
                            strokeDasharray="5 5"
                            />
                        </LineChart>
                        </ResponsiveContainer>
                    </div>
                    </CardContent>
                </Card>

                {/* Sales by Category */}
                <Card className="animate-fade-in">
                    <CardHeader>
                    <CardTitle>Penjualan per Kategori</CardTitle>
                    <CardDescription>Distribusi penjualan berdasarkan kategori produk</CardDescription>
                    </CardHeader>
                    <CardContent>
                    <div className="h-[300px] flex items-center">
                        <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                            data={salesByCategory}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={100}
                            paddingAngle={5}
                            dataKey="value"
                            >
                            {salesByCategory.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                            </Pie>
                            <Tooltip
                            contentStyle={{
                                backgroundColor: "hsl(var(--card))",
                                border: "1px solid hsl(var(--border))",
                                borderRadius: "8px",
                            }}
                            formatter={(value: number) => formatCurrency(value)}
                            />
                        </PieChart>
                        </ResponsiveContainer>
                        <div className="space-y-3 w-40">
                        {salesByCategory.map((item, index) => (
                            <div key={item.name} className="flex items-center gap-2">
                            <div
                                className="w-3 h-3 rounded-full shrink-0"
                                style={{ backgroundColor: COLORS[index % COLORS.length] }}
                            />
                            <div className="flex flex-col">
                                <span className="text-xs font-medium truncate w-24" title={item.name}>{item.name}</span>
                                <span className="text-xs text-muted-foreground">{item.percentage}%</span>
                            </div>
                            </div>
                        ))}
                        </div>
                    </div>
                    </CardContent>
                </Card>
                </div>

                {/* Sales by Branch */}
                <Card className="animate-fade-in">
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                    <CardTitle>Penjualan per Cabang</CardTitle>
                    <CardDescription>Perbandingan penjualan semua cabang</CardDescription>
                    </div>
                    <Button variant="outline" className="gap-2" onClick={() => handleExport('sales')}>
                    <Download className="w-4 h-4" />
                    Export
                    </Button>
                </CardHeader>
                <CardContent>
                    <div className="h-[350px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={salesByBranch} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis
                            type="number"
                            tickFormatter={(value) => `${(value / 1000000).toFixed(0)}Jt`}
                            tick={{ fill: "hsl(var(--muted-foreground))" }}
                        />
                        <YAxis
                            type="category"
                            dataKey="name"
                            tick={{ fill: "hsl(var(--muted-foreground))" }}
                            width={100}
                        />
                        <Tooltip
                            contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "8px",
                            }}
                            formatter={(value: number) => formatCurrency(value)}
                        />
                        <Bar
                            dataKey="value"
                            name="Penjualan"
                            fill="hsl(173, 80%, 40%)"
                            radius={[0, 4, 4, 0]}
                        />
                        </BarChart>
                    </ResponsiveContainer>
                    </div>
                </CardContent>
                </Card>
            </>
        )}
      </div>
    </BackOfficeLayout>
  );
}