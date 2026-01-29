import { useState, useEffect } from "react";
import { BackOfficeLayout } from "@/components/layout/BackOfficeLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { query } from "@/lib/db";
import { Loader2, TrendingUp, TrendingDown, DollarSign } from "lucide-react";
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

export default function Cashflow() {
  const [data, setData] = useState<{ name: string; income: number; expense: number }[]>([]);
  const [summary, setSummary] = useState({ totalIncome: 0, totalExpense: 0, balance: 0 });
  const [isLoading, setIsLoading] = useState(true);

  const fetchCashflow = async () => {
    setIsLoading(true);
    try {
      // Fetch Income (Sales) by Month (Last 6 months)
      const incomeRes = await query(`
        SELECT 
          to_char(created_at, 'Mon') as month,
          to_char(created_at, 'YYYY-MM') as sort_key,
          SUM(total_amount) as total
        FROM transactions
        WHERE status = 'completed' AND created_at >= date_trunc('month', CURRENT_DATE - INTERVAL '5 months')
        GROUP BY 1, 2
        ORDER BY 2
      `);

      // Fetch Expenses by Month (Last 6 months)
      const expenseRes = await query(`
        SELECT 
          to_char(date, 'Mon') as month,
          to_char(date, 'YYYY-MM') as sort_key,
          SUM(amount) as total
        FROM expenses
        WHERE date >= date_trunc('month', CURRENT_DATE - INTERVAL '5 months')
        GROUP BY 1, 2
        ORDER BY 2
      `);

      // Merge Data
      const mergedData = [];
      const incomeMap = new Map();
      const expenseMap = new Map();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      incomeRes.rows.forEach((row: any) => incomeMap.set(row.month, parseFloat(row.total)));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expenseRes.rows.forEach((row: any) => expenseMap.set(row.month, parseFloat(row.total)));

      // Get all unique months from both
      const months = Array.from(new Set([...incomeMap.keys(), ...expenseMap.keys()]));
      // Sort months logic (simplified, assuming query order is mostly correct or we rely on sort_key if we stored it)
      // Since we can't easily sort 'Mon' strings without a map, let's rely on the DB sort order mostly, 
      // but here we just iterate the months set which might be unordered.
      // Better approach: use the sort_key from query to sort.
      
      const allRows = [...incomeRes.rows, ...expenseRes.rows].map((r: any) => ({
        month: r.month,
        sort_key: r.sort_key
      })).sort((a, b) => a.sort_key.localeCompare(b.sort_key));
      
      const uniqueMonths = Array.from(new Set(allRows.map(r => r.month)));

      let tIncome = 0;
      let tExpense = 0;

      uniqueMonths.forEach(month => {
        const income = incomeMap.get(month) || 0;
        const expense = expenseMap.get(month) || 0;
        mergedData.push({
          name: month,
          income,
          expense
        });
        tIncome += income;
        tExpense += expense;
      });

      setData(mergedData);
      setSummary({
        totalIncome: tIncome,
        totalExpense: tExpense,
        balance: tIncome - tExpense
      });

    } catch (error) {
      console.error("Failed to fetch cashflow:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCashflow();
  }, []);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(value);
  };

  return (
    <BackOfficeLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Cash Flow</h1>
          <p className="text-muted-foreground">Analisis arus kas masuk dan keluar</p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Pemasukan</CardTitle>
              <TrendingUp className="h-4 w-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(summary.totalIncome)}</div>
              <p className="text-xs text-muted-foreground">6 bulan terakhir</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Pengeluaran</CardTitle>
              <TrendingDown className="h-4 w-4 text-rose-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(summary.totalExpense)}</div>
              <p className="text-xs text-muted-foreground">6 bulan terakhir</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Saldo Bersih</CardTitle>
              <DollarSign className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${summary.balance >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                {formatCurrency(summary.balance)}
              </div>
              <p className="text-xs text-muted-foreground">Net Cash Flow</p>
            </CardContent>
          </Card>
        </div>

        {/* Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Arus Kas Bulanan</CardTitle>
            <CardDescription>Perbandingan Pemasukan vs Pengeluaran</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[400px]">
              {isLoading ? (
                <div className="h-full flex items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="name" />
                    <YAxis tickFormatter={(value) => `${(value / 1000000).toFixed(0)}jt`} />
                    <Tooltip 
                      formatter={(value: number) => formatCurrency(value)}
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}
                    />
                    <Legend />
                    <Bar name="Pemasukan" dataKey="income" fill="#10b981" radius={[4, 4, 0, 0]} />
                    <Bar name="Pengeluaran" dataKey="expense" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </BackOfficeLayout>
  );
}
