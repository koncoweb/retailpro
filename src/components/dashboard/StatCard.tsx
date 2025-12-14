import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string;
  change?: number;
  icon: ReactNode;
  variant?: "default" | "primary" | "success" | "warning" | "info";
}

const variantStyles = {
  default: "bg-card",
  primary: "bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20",
  success: "bg-gradient-to-br from-success/10 to-success/5 border-success/20",
  warning: "bg-gradient-to-br from-warning/10 to-warning/5 border-warning/20",
  info: "bg-gradient-to-br from-info/10 to-info/5 border-info/20",
};

const iconStyles = {
  default: "bg-muted text-muted-foreground",
  primary: "bg-primary/20 text-primary",
  success: "bg-success/20 text-success",
  warning: "bg-warning/20 text-warning",
  info: "bg-info/20 text-info",
};

export function StatCard({ title, value, change, icon, variant = "default" }: StatCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border p-5 transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5 animate-fade-in",
        variantStyles[variant]
      )}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="text-2xl lg:text-3xl font-bold tracking-tight">{value}</p>
          {change !== undefined && (
            <div
              className={cn(
                "flex items-center gap-1 text-sm font-medium",
                change >= 0 ? "text-success" : "text-destructive"
              )}
            >
              {change >= 0 ? (
                <TrendingUp className="w-4 h-4" />
              ) : (
                <TrendingDown className="w-4 h-4" />
              )}
              <span>{Math.abs(change)}% dari bulan lalu</span>
            </div>
          )}
        </div>
        <div className={cn("p-3 rounded-xl", iconStyles[variant])}>{icon}</div>
      </div>
    </div>
  );
}
