import { useEffect, useState } from "react";
import { AlertTriangle, Package } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { query } from "@/lib/db";
import { useNavigate } from "react-router-dom";

interface LowStockItem {
  sku: string;
  name: string;
  stock: number;
  minStock: number;
  branch: string;
}

export function LowStockAlert() {
  const [lowStockItems, setLowStockItems] = useState<LowStockItem[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchLowStock = async () => {
      try {
        const res = await query(`
          SELECT 
            p.sku,
            p.name,
            b.name as branch_name,
            COALESCE(SUM(pb.quantity_current), 0) as current_stock,
            p.min_stock_level
          FROM products p
          CROSS JOIN branches b
          LEFT JOIN product_batches pb ON p.id = pb.product_id AND b.id = pb.branch_id
          GROUP BY p.id, p.sku, p.name, b.id, b.name, p.min_stock_level
          HAVING COALESCE(SUM(pb.quantity_current), 0) <= p.min_stock_level
          ORDER BY current_stock ASC
          LIMIT 5
        `);
        
        setLowStockItems(res.rows.map((row: any) => ({
          sku: row.sku,
          name: row.name,
          stock: parseFloat(row.current_stock),
          minStock: row.min_stock_level,
          branch: row.branch_name
        })));
      } catch (error) {
        console.error("Failed to fetch low stock items:", error);
      }
    };

    fetchLowStock();
  }, []);

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
        <Button variant="outline" size="sm" onClick={() => navigate('/backoffice/inventory')}>
          Lihat Semua
        </Button>
      </div>
      <div className="space-y-3">
        {lowStockItems.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            Stok aman terkendali
          </div>
        ) : (
          lowStockItems.map((item, index) => (
            <div
              key={`${item.sku}-${item.branch}`}
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
                <div className="flex items-center gap-2 justify-end">
                  <span className="text-lg font-bold text-warning">{item.stock}</span>
                  <span className="text-sm text-muted-foreground">/ {item.minStock}</span>
                </div>
                <Badge variant="secondary" className="text-xs mt-1">
                  {item.branch}
                </Badge>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
