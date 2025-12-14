import { Building2, TrendingUp, Users, Package } from "lucide-react";
import { Progress } from "@/components/ui/progress";

const branches = [
  {
    name: "Cabang Jakarta Pusat",
    sales: 156000000,
    target: 180000000,
    employees: 24,
    products: 1250,
    trend: 12.5,
  },
  {
    name: "Cabang Surabaya",
    sales: 98000000,
    target: 100000000,
    employees: 18,
    products: 980,
    trend: 8.2,
  },
  {
    name: "Cabang Bandung",
    sales: 72000000,
    target: 80000000,
    employees: 12,
    products: 750,
    trend: -2.4,
  },
  {
    name: "Cabang Medan",
    sales: 45000000,
    target: 60000000,
    employees: 10,
    products: 620,
    trend: 5.8,
  },
];

function formatCurrency(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function BranchPerformance() {
  return (
    <div className="bg-card rounded-xl border p-5 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold">Performa Cabang</h3>
          <p className="text-sm text-muted-foreground">Ringkasan bulan ini</p>
        </div>
        <Building2 className="w-5 h-5 text-muted-foreground" />
      </div>
      <div className="space-y-5">
        {branches.map((branch, index) => {
          const progress = (branch.sales / branch.target) * 100;
          return (
            <div
              key={branch.name}
              className="p-4 rounded-lg bg-muted/50 hover:bg-muted transition-colors animate-slide-up"
              style={{ animationDelay: `${index * 100}ms` }}
            >
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-medium">{branch.name}</h4>
                <span
                  className={`text-sm font-medium ${
                    branch.trend >= 0 ? "text-success" : "text-destructive"
                  }`}
                >
                  {branch.trend >= 0 ? "+" : ""}
                  {branch.trend}%
                </span>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Penjualan</span>
                  <span className="font-medium">{formatCurrency(branch.sales)}</span>
                </div>
                <Progress value={progress} className="h-2" />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Target: {formatCurrency(branch.target)}</span>
                  <span>{progress.toFixed(0)}%</span>
                </div>
              </div>
              <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border">
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Users className="w-4 h-4" />
                  <span>{branch.employees}</span>
                </div>
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Package className="w-4 h-4" />
                  <span>{branch.products}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
