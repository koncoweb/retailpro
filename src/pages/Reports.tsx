import { MainLayout } from "@/components/layout/MainLayout";
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
  Building2,
} from "lucide-react";

const salesByBranch = [
  { name: "Jakarta", value: 156000000 },
  { name: "Surabaya", value: 98000000 },
  { name: "Bandung", value: 72000000 },
  { name: "Medan", value: 45000000 },
];

const salesByCategory = [
  { name: "Makanan", value: 45 },
  { name: "Minuman", value: 30 },
  { name: "Personal Care", value: 15 },
  { name: "Snack", value: 10 },
];

const monthlySales = [
  { month: "Jan", sales: 320000000, target: 350000000 },
  { month: "Feb", sales: 340000000, target: 350000000 },
  { month: "Mar", sales: 380000000, target: 370000000 },
  { month: "Apr", sales: 360000000, target: 370000000 },
  { month: "May", sales: 420000000, target: 400000000 },
  { month: "Jun", sales: 450000000, target: 420000000 },
];

const COLORS = ["hsl(173, 80%, 40%)", "hsl(199, 89%, 48%)", "hsl(142, 76%, 36%)", "hsl(38, 92%, 50%)"];

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
  },
  {
    title: "Laporan Inventory",
    description: "Status stok dan pergerakan barang",
    icon: Package,
    color: "info",
  },
  {
    title: "Laporan Karyawan",
    description: "Absensi, payroll, dan kinerja",
    icon: Users,
    color: "success",
  },
  {
    title: "Laporan Keuangan",
    description: "Jurnal, neraca, dan cash flow",
    icon: TrendingUp,
    color: "warning",
  },
];

export default function Reports() {
  return (
    <MainLayout>
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
            <Select defaultValue="thismonth">
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
          </div>
        </div>

        {/* Quick Export */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {reportTypes.map((report, index) => (
            <Card
              key={report.title}
              className="cursor-pointer hover:shadow-lg transition-all hover:-translate-y-0.5 animate-fade-in"
              style={{ animationDelay: `${index * 100}ms` }}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div
                    className={`p-2.5 rounded-lg ${
                      report.color === "primary"
                        ? "bg-primary/10"
                        : report.color === "info"
                        ? "bg-info/10"
                        : report.color === "success"
                        ? "bg-success/10"
                        : "bg-warning/10"
                    }`}
                  >
                    <report.icon
                      className={`w-5 h-5 ${
                        report.color === "primary"
                          ? "text-primary"
                          : report.color === "info"
                          ? "text-info"
                          : report.color === "success"
                          ? "text-success"
                          : "text-warning"
                      }`}
                    />
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="iconSm">
                      <FileText className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="iconSm">
                      <FileSpreadsheet className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <CardTitle className="text-base">{report.title}</CardTitle>
                <CardDescription className="text-xs mt-1">
                  {report.description}
                </CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Monthly Sales Trend */}
          <Card className="animate-fade-in">
            <CardHeader>
              <CardTitle>Tren Penjualan Bulanan</CardTitle>
              <CardDescription>Perbandingan aktual vs target</CardDescription>
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
                      formatter={(value: number) => `${value}%`}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-3">
                  {salesByCategory.map((item, index) => (
                    <div key={item.name} className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: COLORS[index] }}
                      />
                      <span className="text-sm">{item.name}</span>
                      <span className="text-sm font-semibold ml-auto">{item.value}%</span>
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
              <CardDescription>Perbandingan penjualan semua cabang bulan ini</CardDescription>
            </div>
            <Button variant="outline" className="gap-2">
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
                    width={80}
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
      </div>
    </MainLayout>
  );
}
