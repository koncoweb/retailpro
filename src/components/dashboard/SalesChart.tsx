import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const data = [
  { name: "Sen", jakarta: 4200, surabaya: 2400, bandung: 1800 },
  { name: "Sel", jakarta: 3800, surabaya: 2100, bandung: 2200 },
  { name: "Rab", jakarta: 5100, surabaya: 2800, bandung: 2100 },
  { name: "Kam", jakarta: 4600, surabaya: 3200, bandung: 2400 },
  { name: "Jum", jakarta: 5800, surabaya: 3600, bandung: 2800 },
  { name: "Sab", jakarta: 7200, surabaya: 4100, bandung: 3500 },
  { name: "Min", jakarta: 6400, surabaya: 3800, bandung: 3200 },
];

export function SalesChart() {
  return (
    <div className="bg-card rounded-xl border p-5 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold">Penjualan Mingguan</h3>
          <p className="text-sm text-muted-foreground">Per cabang (dalam juta)</p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-chart-1" />
            <span>Jakarta</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-chart-2" />
            <span>Surabaya</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-chart-3" />
            <span>Bandung</span>
          </div>
        </div>
      </div>
      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="colorJakarta" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(173, 80%, 40%)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(173, 80%, 40%)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorSurabaya" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(199, 89%, 48%)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(199, 89%, 48%)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorBandung" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(142, 76%, 36%)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(142, 76%, 36%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="name" className="text-xs" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
            <YAxis className="text-xs" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px',
              }}
            />
            <Area
              type="monotone"
              dataKey="jakarta"
              stroke="hsl(173, 80%, 40%)"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorJakarta)"
            />
            <Area
              type="monotone"
              dataKey="surabaya"
              stroke="hsl(199, 89%, 48%)"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorSurabaya)"
            />
            <Area
              type="monotone"
              dataKey="bandung"
              stroke="hsl(142, 76%, 36%)"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorBandung)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
