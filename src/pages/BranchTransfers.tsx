import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { BackOfficeLayout } from "@/components/layout/BackOfficeLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search,
  Plus,
  ArrowLeftRight,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  XCircle,
  Clock,
  Eye,
  Loader2,
  Download,
} from "lucide-react";
import { StockTransferModal } from "@/components/inventory/StockTransferModal";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { query } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { Product, Branch } from "@/types";
import { Input } from "@/components/ui/input";

// Extended interface for Transfer to include item details if needed
interface Transfer {
  id: string;
  reference_number: string;
  source_branch_id: string;
  source_branch_name: string;
  destination_branch_id: string;
  destination_branch_name: string;
  status: 'pending' | 'completed' | 'cancelled';
  created_at: string;
  items_count: number;
  notes?: string;
}

export default function BranchTransfers() {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("all");

  // Fetch all necessary data
  const fetchData = async () => {
    setIsLoading(true);
    try {
      // Ensure Schema exists for multi-unit support
      try {
        await query(`ALTER TABLE transfer_items ADD COLUMN IF NOT EXISTS unit_name VARCHAR(50)`);
        await query(`ALTER TABLE transfer_items ADD COLUMN IF NOT EXISTS conversion_factor DECIMAL(10,2) DEFAULT 1`);
      } catch (e) {
        console.warn("Auto-migration for transfer_items failed (columns might exist or permission denied):", e);
      }

      await Promise.all([
        fetchBranches(),
        fetchProducts(),
        fetchTransfers()
      ]);
    } catch (error) {
      console.error("Error fetching data:", error);
      toast.error("Gagal memuat data");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const fetchBranches = async () => {
    const res = await query(`SELECT id, name FROM branches ORDER BY name ASC`);
    setBranches(res.rows);
  };

  const fetchProducts = async () => {
    // Fetch products with stock by branch for the transfer modal validation
    const res = await query(`
      SELECT 
        p.id, p.sku, p.name, p.category, p.min_stock_level,
        (SELECT json_agg(json_build_object(
           'id', id, 'name', name, 'conversion_factor', conversion_factor, 'price', price
         )) FROM product_units WHERE product_id = p.id) as units,
        (
          SELECT jsonb_object_agg(b.id, COALESCE(sum_qty, 0))
          FROM branches b
          LEFT JOIN (
            SELECT branch_id, SUM(quantity_current) as sum_qty
            FROM product_batches
            WHERE product_id = p.id
            GROUP BY branch_id
          ) pb_sum ON b.id = pb_sum.branch_id
        ) as branch_stock
      FROM products p
    `);
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mappedProducts: Product[] = res.rows.map((row: any) => ({
      id: row.id,
      sku: row.sku,
      name: row.name,
      category: row.category,
      price: 0, // Not needed for transfer logic strictly
      cost: 0,
      stock: 0,
      min_stock_alert: row.min_stock_level,
      unit_type: 'Pcs', // Default
      stock_by_branch: row.branch_stock || {},
      units: row.units || [],
      // Other required fields for Product interface
      tenant_id: '',
      description: '',
      image: '',
      is_active: true
    }));
    setProducts(mappedProducts);
  };

  const fetchTransfers = async () => {
    const res = await query(`
      SELECT 
        st.id,
        st.reference_number,
        st.source_branch_id,
        st.destination_branch_id,
        st.status,
        st.created_at,
        st.notes,
        b1.name as source_branch_name,
        b2.name as destination_branch_name,
        (SELECT COUNT(*) FROM transfer_items ti WHERE ti.transfer_id = st.id) as items_count
      FROM stock_transfers st
      LEFT JOIN branches b1 ON st.source_branch_id = b1.id
      LEFT JOIN branches b2 ON st.destination_branch_id = b2.id
      ORDER BY st.created_at DESC
    `);
    setTransfers(res.rows);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleCreateTransfer = async (transferData: any) => {
    try {
      const res = await query(
        `INSERT INTO stock_transfers 
         (reference_number, source_branch_id, destination_branch_id, status, created_at, notes)
         VALUES ($1, $2, $3, 'pending', NOW(), $4)
         RETURNING id`,
        [`TRF-${Date.now()}`, transferData.from, transferData.to, transferData.notes]
      );
      const transferId = res.rows[0].id;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const item of transferData.items) {
        await query(
          `INSERT INTO transfer_items (transfer_id, product_id, quantity_sent, unit_name, conversion_factor)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            transferId, 
            item.productId, 
            item.quantity, 
            item.unitName || 'Pcs', 
            item.conversionFactor || 1
          ]
        );
      }

      await logAudit({
        action: "create_transfer",
        entity: "stock_transfers",
        entityId: transferId,
        details: {
          from: transferData.from,
          to: transferData.to,
          itemsCount: transferData.items.length
        },
        userId: user?.id
      });

      toast.success("Permintaan transfer berhasil dibuat");
      setIsTransferOpen(false);
      fetchTransfers();
    } catch (error) {
      console.error("Create transfer failed:", error);
      toast.error("Gagal membuat transfer");
    }
  };

  const handleApproveTransfer = async (transferId: string) => {
    // RBAC Check: Only Store Manager, Tenant Admin/Owner can approve
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userRole = (user as any)?.role;
    if (!['store_manager', 'tenant_admin', 'tenant_owner', 'platform_owner'].includes(userRole)) {
      toast.error("Anda tidak memiliki akses untuk menyetujui transfer");
      return;
    }

    try {
      const res = await query(`SELECT * FROM stock_transfers WHERE id = $1`, [transferId]);
      const transfer = res.rows[0];
      
      const itemsRes = await query(`SELECT * FROM transfer_items WHERE transfer_id = $1`, [transferId]);
      const items = itemsRes.rows;

      for (const item of items) {
        // Convert transfer quantity to base units
        const conversionFactor = parseFloat(item.conversion_factor || '1');
        const totalBaseQty = parseFloat(item.quantity_sent) * conversionFactor;
        let remaining = totalBaseQty;

        // FIFO: Take from Source Branch Batches
        const sourceBatches = await query(
          `SELECT id, quantity_current, cost_price 
           FROM product_batches 
           WHERE product_id = $1 AND branch_id = $2 AND quantity_current > 0
           ORDER BY received_at ASC`,
          [item.product_id, transfer.source_branch_id]
        );

        let totalCost = 0;
        let totalQtyMoved = 0;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const batch of sourceBatches.rows as any[]) {
          if (remaining <= 0) break;
          const qty = parseFloat(batch.quantity_current);
          const take = Math.min(qty, remaining);
          
          await query(
            `UPDATE product_batches 
             SET quantity_current = quantity_current - $1 
             WHERE id = $2`,
            [take, batch.id]
          );
          
          remaining -= take;
          totalCost += take * parseFloat(batch.cost_price);
          totalQtyMoved += take;
        }
        
        // If source stock insufficient, we might have an issue (negative stock logic or partial transfer)
        // Here we assume validation happened before, or we just transfer what's available
        // But for consistency, we'll create the batch in destination even if partial (though logic above tries to take full)
        
        const avgCost = totalQtyMoved > 0 ? totalCost / totalQtyMoved : 0;

        // Add to Destination Branch Batches
        if (totalQtyMoved > 0) {
            await query(
            `INSERT INTO product_batches 
            (branch_id, product_id, batch_number, quantity_initial, quantity_current, cost_price, received_at)
            VALUES ($1, $2, $3, $4, $4, $5, NOW())`,
            [transfer.destination_branch_id, item.product_id, `TRF-${transfer.reference_number}`, totalQtyMoved, avgCost]
            );
        }
      }

      await query(
        `UPDATE stock_transfers SET status = 'completed', received_at = NOW() WHERE id = $1`,
        [transferId]
      );

      await logAudit({
        action: "approve_transfer",
        entity: "stock_transfers",
        entityId: transferId,
        details: { transferId, approvedBy: user?.id },
        userId: user?.id
      });

      toast.success("Transfer berhasil disetujui dan stok dipindahkan");
      fetchTransfers();
      fetchProducts(); // Refresh stock levels
    } catch (error) {
      console.error("Approval failed:", error);
      toast.error("Gagal menyetujui transfer");
    }
  };

  // Filter transfers based on tabs and search
  const filteredTransfers = transfers.filter(t => {
    // Search filter
    const searchMatch = 
      t.reference_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.source_branch_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.destination_branch_name?.toLowerCase().includes(searchQuery.toLowerCase());

    if (!searchMatch) return false;

    // Tab filter
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userBranchId = (user as any)?.assigned_branch_id;
    // If user has no assigned branch (e.g. admin), 'incoming'/'outgoing' might mean strictly source/dest logic if we had a filter for branch.
    // For now:
    // "Masuk" -> Destination is User's Branch
    // "Keluar" -> Source is User's Branch
    // If Admin, maybe show all?
    
    if (activeTab === "all") return true;
    
    if (userBranchId) {
        if (activeTab === "incoming") return t.destination_branch_id === userBranchId;
        if (activeTab === "outgoing") return t.source_branch_id === userBranchId;
    } else {
        // If no specific branch assigned, maybe filter by what?
        // Let's just assume Admin sees all for now, or we could add a Branch Selector filter later.
        return true; 
    }
    return true;
  });

  const handleExport = () => {
    if (filteredTransfers.length === 0) {
      toast.error("Tidak ada data transfer untuk diexport");
      return;
    }

    const exportData = filteredTransfers.map(t => ({
      "No. Referensi": t.reference_number,
      "Dari Cabang": t.source_branch_name,
      "Ke Cabang": t.destination_branch_name,
      "Tanggal": new Date(t.created_at).toLocaleDateString('id-ID'),
      "Jumlah Item": t.items_count,
      "Status": t.status === 'completed' ? 'Selesai' : t.status === 'pending' ? 'Pending' : 'Dibatalkan',
      "Catatan": t.notes || "-"
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Transfer Stok");

    const wscols = [
      { wch: 20 }, // Ref
      { wch: 20 }, // Source
      { wch: 20 }, // Dest
      { wch: 15 }, // Date
      { wch: 12 }, // Items
      { wch: 15 }, // Status
      { wch: 30 }, // Notes
    ];
    ws['!cols'] = wscols;

    XLSX.writeFile(wb, `Transfer_Stok_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success("Berhasil export data transfer");
  };

  return (
    <BackOfficeLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold">Transfer Stok Antar Cabang</h1>
            <p className="text-muted-foreground mt-1">
              Kelola perpindahan stok antar cabang
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={handleExport}>
              <Download className="w-4 h-4" />
              Export
            </Button>
            <Button onClick={() => setIsTransferOpen(true)} className="gap-2">
              <Plus className="w-4 h-4" />
              Buat Transfer Baru
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                placeholder="Cari No. Referensi atau Cabang..."
                className="pl-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                />
            </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList>
            <TabsTrigger value="all" className="gap-2">
                <ArrowLeftRight className="w-4 h-4" />
                Semua Transfer
            </TabsTrigger>
            <TabsTrigger value="incoming" className="gap-2">
                <ArrowDownLeft className="w-4 h-4 text-success" />
                Masuk (Incoming)
            </TabsTrigger>
            <TabsTrigger value="outgoing" className="gap-2">
                <ArrowUpRight className="w-4 h-4 text-warning" />
                Keluar (Outgoing)
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value={activeTab} className="mt-4">
            <div className="bg-card rounded-xl border overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>No. Referensi</TableHead>
                            <TableHead>Dari Cabang</TableHead>
                            <TableHead>Ke Cabang</TableHead>
                            <TableHead>Tanggal</TableHead>
                            <TableHead className="text-center">Items</TableHead>
                            <TableHead className="text-center">Status</TableHead>
                            <TableHead className="text-right">Aksi</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                             <TableRow>
                                <TableCell colSpan={7} className="h-24 text-center">
                                    <div className="flex justify-center items-center">
                                        <Loader2 className="w-6 h-6 animate-spin text-primary" />
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : filteredTransfers.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                                    Tidak ada data transfer
                                </TableCell>
                            </TableRow>
                        ) : (
                            filteredTransfers.map((t) => (
                                <TableRow key={t.id}>
                                    <TableCell className="font-mono font-medium">{t.reference_number}</TableCell>
                                    <TableCell>{t.source_branch_name}</TableCell>
                                    <TableCell>{t.destination_branch_name}</TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            <Clock className="w-3 h-3 text-muted-foreground" />
                                            {new Date(t.created_at).toLocaleDateString('id-ID')}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-center">{t.items_count}</TableCell>
                                    <TableCell className="text-center">
                                        <Badge 
                                            variant={t.status === 'completed' ? 'default' : t.status === 'cancelled' ? 'destructive' : 'secondary'}
                                            className={t.status === 'completed' ? 'bg-success/20 text-success hover:bg-success/30' : ''}
                                        >
                                            {t.status === 'completed' ? 'Selesai' : t.status === 'pending' ? 'Pending' : 'Dibatalkan'}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            {t.status === 'pending' && (
                                                <Button 
                                                    size="sm" 
                                                    variant="outline" 
                                                    className="gap-1 border-success text-success hover:bg-success/10"
                                                    onClick={() => handleApproveTransfer(t.id)}
                                                >
                                                    <CheckCircle2 className="w-3 h-3" />
                                                    Terima
                                                </Button>
                                            )}
                                            <Button size="icon" variant="ghost">
                                                <Eye className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
          </TabsContent>
        </Tabs>

        <StockTransferModal
            open={isTransferOpen}
            onOpenChange={setIsTransferOpen}
            products={products}
            branches={branches}
            onTransfer={handleCreateTransfer}
        />
      </div>
    </BackOfficeLayout>
  );
}
