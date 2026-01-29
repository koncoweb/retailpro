import { useEffect, useState } from "react";
import { Building2, Users, Package } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { query } from "@/lib/db";

interface BranchData {
  id: string;
  name: string;
  sales: number;
  target: number;
  employees: number;
  products: number;
  trend: number;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function BranchPerformance() {
  const [branches, setBranches] = useState<BranchData[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await query(`
          SELECT 
            b.id, 
            b.name, 
            COALESCE(b.sales_target, 0) as sales_target,
            COALESCE(curr_sales.total, 0) as sales_current,
            COALESCE(prev_sales.total, 0) as sales_prev,
            COALESCE(emp.count, 0) as employee_count,
            COALESCE(prod.count, 0) as product_count
          FROM branches b
          LEFT JOIN (
            SELECT branch_id, SUM(amount_paid) as total 
            FROM transactions 
            WHERE created_at >= date_trunc('month', CURRENT_DATE) 
            GROUP BY branch_id
          ) curr_sales ON b.id = curr_sales.branch_id
          LEFT JOIN (
            SELECT branch_id, SUM(amount_paid) as total 
            FROM transactions 
            WHERE created_at >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month') 
            AND created_at < date_trunc('month', CURRENT_DATE) 
            GROUP BY branch_id
          ) prev_sales ON b.id = prev_sales.branch_id
          LEFT JOIN (
            SELECT assigned_branch_id, COUNT(*) as count 
            FROM users 
            WHERE is_active = true 
            GROUP BY assigned_branch_id
          ) emp ON b.id = emp.assigned_branch_id
          LEFT JOIN (
            SELECT branch_id, COUNT(DISTINCT product_id) as count 
            FROM product_batches 
            WHERE quantity_current > 0 
            GROUP BY branch_id
          ) prod ON b.id = prod.branch_id
          ORDER BY b.name
        `);

        const data = res.rows.map((row: any) => {
          const current = parseFloat(row.sales_current);
          const prev = parseFloat(row.sales_prev);
          let trend = 0;
          
          if (prev > 0) {
            trend = ((current - prev) / prev) * 100;
          } else if (current > 0) {
            trend = 100; // 100% growth if prev was 0 and now we have sales
          }

          return {
            id: row.id,
            name: row.name,
            sales: current,
            target: parseFloat(row.sales_target) || 100000000, // Default target 100jt if 0
            employees: parseInt(row.employee_count),
            products: parseInt(row.product_count),
            trend: parseFloat(trend.toFixed(1))
          };
        });

        setBranches(data);
      } catch (error) {
        console.error("Failed to fetch branch performance:", error);
      }
    };

    fetchData();
  }, []);

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
        {branches.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            Belum ada data cabang
          </div>
        ) : (
          branches.map((branch, index) => {
            const progress = Math.min((branch.sales / branch.target) * 100, 100);
            return (
              <div
                key={branch.id}
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
          })
        )}
      </div>
    </div>
  );
}
