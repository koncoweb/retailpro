import { AlertTriangle, Package } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const lowStockItems = [
  {
    sku: "PRD-001",
    name: "Susu UHT Indomilk 1L",
    stock: 5,
    minStock: 20,
    branch: "Jakarta",
  },
  {
    sku: "PRD-042",
    name: "Mie Indomie Goreng",
    stock: 12,
    minStock: 50,
    branch: "Surabaya",
  },
  {
    sku: "PRD-103",
    name: "Sabun Lifebuoy 100g",
    stock: 3,
    minStock: 15,
    branch: "Bandung",
  },
  {
    sku: "PRD-087",
    name: "Kopi Kapal Api Sachet",
    stock: 8,
    minStock: 30,
    branch: "Jakarta",
  },
];

export function LowStockAlert() {
  return (
    <div className="bg-card rounded-xl border p-5 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-warning" />
          <div>
            <h3 className="text-lg font-semibold">Stok Minimum Alert</h3>
            <p className="text-sm text-muted-foreground">
              {lowStockItems.length} produk perlu restok
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm">
          Lihat Semua
        </Button>
      </div>
      <div className="space-y-3">
        {lowStockItems.map((item, index) => (
          <div
            key={item.sku}
            className="flex items-center justify-between p-3 rounded-lg bg-warning/5 border border-warning/20 animate-slide-up"
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-warning/10 flex items-center justify-center">
                <Package className="w-5 h-5 text-warning" />
              </div>
              <div>
                <p className="font-medium text-sm">{item.name}</p>
                <p className="text-xs text-muted-foreground">{item.sku}</p>
              </div>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-warning">{item.stock}</span>
                <span className="text-sm text-muted-foreground">/ {item.minStock}</span>
              </div>
              <Badge variant="secondary" className="text-xs mt-1">
                {item.branch}
              </Badge>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
