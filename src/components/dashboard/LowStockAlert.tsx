import { useEffect, useState } from "react";
import { AlertTriangle, Package, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { query } from "@/lib/db";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { roleHasPermission } from "@/lib/branch-orders";

interface LowStockItem {
  id: string;
  sku: string;
  name: string;
  stock: number;
  minStock: number;
  warehouse: string;
}

interface LowStockQueryRow {
  id: string;
  sku: string;
  name: string;
  warehouse_name: string;
  current_stock: number | string;
  min_stock_level: number | string;
}

export function LowStockAlert() {
  const [lowStockItems, setLowStockItems] = useState<LowStockItem[]>([]);
  const navigate = useNavigate();
  const { user } = useAuth();
  // Only the shop side asks the gudang for goods.
  const canRequest = roleHasPermission(user?.role, "request_stock");

  useEffect(() => {
    const fetchLowStock = async () => {
      try {
        const res = await query<LowStockQueryRow>(`
          SELECT 
            p.id,
            p.sku,
            p.name,
            w.name as warehouse_name,
            COALESCE(SUM(pb.quantity_current), 0) as current_stock,
            p.min_stock_level
          FROM products p
          CROSS JOIN warehouses w
          -- Shortage is a warehouse fact, not a branch fact: several branches
          -- can draw on the same stockroom, so counting per branch would list
          -- the same shortfall once per shop. Only the gudang that fulfils the
          -- orders is measured — a rak is refilled from it, not from vendors.
          LEFT JOIN product_batches pb ON p.id = pb.product_id AND pb.warehouse_id = w.id
          WHERE w.status = 'active' AND w.branch_id IS NULL
          GROUP BY p.id, p.sku, p.name, w.id, w.name, p.min_stock_level
          HAVING COALESCE(SUM(pb.quantity_current), 0) <= p.min_stock_level
          ORDER BY current_stock ASC
          LIMIT 5
        `);
        
        setLowStockItems(res.rows.map((row) => ({
          id: row.id,
          sku: row.sku,
          name: row.name,
          stock: Number(row.current_stock),
          minStock: Number(row.min_stock_level),
          warehouse: row.warehouse_name
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
              key={`${item.sku}-${item.warehouse}`}
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
                  {item.warehouse}
                </Badge>
              </div>
              {canRequest && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 shrink-0 ml-3"
                  title="Buat pesanan cabang untuk produk ini"
                  onClick={() =>
                    navigate(
                      `/backoffice/branches/orders?product=${item.id}&qty=${Math.max(
                        item.minStock - item.stock,
                        1
                      )}`
                    )
                  }
                >
                  <Send className="w-3.5 h-3.5" />
                  Pesan ke Gudang
                </Button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
