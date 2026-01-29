import { useEffect, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { query } from "@/lib/db";

interface ChartData {
  name: string; // Day name (Sen, Sel, etc.)
  date: string; // YYYY-MM-DD for sorting/debugging
  [key: string]: string | number; // Dynamic branch keys
}

interface Branch {
  id: string;
  name: string;
}

const COLORS = [
  "hsl(173, 80%, 40%)", // Jakarta/Teal
  "hsl(199, 89%, 48%)", // Surabaya/Blue
  "hsl(142, 76%, 36%)", // Bandung/Green
  "hsl(280, 65%, 60%)", // Purple
  "hsl(350, 80%, 60%)", // Red
];

const dayMap: Record<string, string> = {
  Sun: "Min", Mon: "Sen", Tue: "Sel", Wed: "Rab", Thu: "Kam", Fri: "Jum", Sat: "Sab"
};

export function SalesChart() {
  const [data, setData] = useState<ChartData[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // 1. Fetch Branches
        const branchRes = await query("SELECT id, name FROM branches ORDER BY name");
        const branchList = branchRes.rows;
        setBranches(branchList);

        // 2. Fetch Sales Data (Last 7 Days)
        // Group by Date and Branch
        const salesRes = await query(`
          SELECT 
            to_char(created_at, 'Dy') as day_name,
            to_char(created_at, 'YYYY-MM-DD') as date_key,
            branch_id,
            SUM(amount_paid) as total
          FROM transactions
          WHERE created_at >= CURRENT_DATE - INTERVAL '6 days'
          GROUP BY 1, 2, 3
          ORDER BY 2 ASC
        `);

        // 3. Process Data
        // Initialize last 7 days array to ensure continuous axis
        const processedData: ChartData[] = [];
        const today = new Date();
        
        for (let i = 6; i >= 0; i--) {
          const d = new Date(today);
          d.setDate(today.getDate() - i);
          const dateKey = d.toISOString().split('T')[0];
          const dayNameEng = d.toLocaleDateString('en-US', { weekday: 'short' });
          
          const dayData: ChartData = {
            name: dayMap[dayNameEng] || dayNameEng,
            date: dateKey,
          };

          // Initialize all branches to 0
          branchList.forEach(b => {
            dayData[b.id] = 0;
          });

          processedData.push(dayData);
        }

        // Fill in actual sales
        salesRes.rows.forEach((row: any) => {
          const dayEntry = processedData.find(d => d.date === row.date_key);
          if (dayEntry) {
            dayEntry[row.branch_id] = parseFloat(row.total);
          }
        });

        setData(processedData);

      } catch (error) {
        console.error("Failed to fetch sales chart data:", error);
      }
    };

    fetchData();
  }, []);

  return (
    <div className="bg-card rounded-xl border p-5 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold">Penjualan Mingguan</h3>
          <p className="text-sm text-muted-foreground">Per cabang (dalam Rupiah)</p>
        </div>
        <div className="flex items-center gap-4 text-sm flex-wrap justify-end">
          {branches.map((branch, index) => (
            <div key={branch.id} className="flex items-center gap-2">
              <div 
                className="w-3 h-3 rounded-full" 
                style={{ backgroundColor: COLORS[index % COLORS.length] }} 
              />
              <span>{branch.name}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              {branches.map((branch, index) => {
                const color = COLORS[index % COLORS.length];
                return (
                  <linearGradient key={branch.id} id={`color-${branch.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                );
              })}
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis 
              dataKey="name" 
              className="text-xs" 
              tick={{ fill: 'hsl(var(--muted-foreground))' }} 
            />
            <YAxis 
              className="text-xs" 
              tick={{ fill: 'hsl(var(--muted-foreground))' }}
              tickFormatter={(value) => {
                if (value >= 1000000) return `${(value / 1000000).toFixed(1)}Jt`;
                if (value >= 1000) return `${(value / 1000).toFixed(0)}k`;
                return value;
              }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px',
              }}
              formatter={(value: number) => 
                new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value)
              }
            />
            {branches.map((branch, index) => (
              <Area
                key={branch.id}
                type="monotone"
                dataKey={branch.id}
                name={branch.name}
                stroke={COLORS[index % COLORS.length]}
                strokeWidth={2}
                fillOpacity={1}
                fill={`url(#color-${branch.id})`}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
