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
  Send,
} from "lucide-react";
import { StockTransferModal } from "@/components/inventory/StockTransferModal";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { query, parseJson, runTransaction } from "@/lib/db";
import { logAudit, logAuditTx } from "@/lib/audit";
import { Product, ProductUnit } from "@/types";
import { Input } from "@/components/ui/input";
import { WAREHOUSES_SQL, type WarehouseOption } from "@/lib/warehouse";
import { getStockIssueMethod } from "@/lib/tenant-settings";
import {
  createTransfer,
  dispatchTransfer,
  receiveTransfer,
  transferStatusLabel,
} from "@/lib/stock-movement";

/** Who may ship a queued transfer and confirm its receipt. */
const MOVEMENT_ROLES = ['store_manager', 'warehouse', 'tenant_admin', 'tenant_owner', 'platform_owner', 'admin'];

// Extended interface for Transfer to include item details if needed
interface Transfer {
  id: string;
  reference_number: string;
  source_warehouse_id: string;
  source_warehouse_name: string | null;
  destination_warehouse_id: string;
  destination_warehouse_name: string | null;
  /** Owning branch of each side; drives the incoming/outgoing tabs. */
  source_branch_id: string | null;
  destination_branch_id: string | null;
  status: 'pending' | 'in_transit' | 'completed' | 'cancelled';
  created_at: string;
  items_count: number;
  notes?: string;
  /** Set when a branch request asked for this movement. */
  request_id: string | null;
  request_number: string | null;
}

export default function BranchTransfers() {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("all");

  // Fetch all necessary data
  const fetchData = async () => {
    setIsLoading(true);
    try {
      await Promise.all([
        fetchWarehouses(),
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

  const fetchWarehouses = async () => {
    const res = await query(WAREHOUSES_SQL);
    setWarehouses(res.rows as unknown as WarehouseOption[]);
  };

  const fetchProducts = async () => {
    // Fetch products with stock by warehouse for the transfer modal validation
    const res = await query(`
      SELECT 
        p.id, p.sku, p.name, p.category, p.min_stock_level,
        COALESCE((SELECT json_group_array(json_object(
           'id', id, 'name', name, 'conversion_factor', conversion_factor, 'price', price
         )) FROM product_units WHERE product_id = p.id), '[]') as units,
        COALESCE((
          SELECT json_group_object(w.id, COALESCE(sum_qty, 0))
          FROM warehouses w
          LEFT JOIN (
            SELECT warehouse_id, SUM(quantity_current) as sum_qty
            FROM product_batches
            WHERE product_id = p.id
            GROUP BY warehouse_id
          ) pb_sum ON w.id = pb_sum.warehouse_id
        ), '{}') as warehouse_stock
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
      // JSON columns arrive as TEXT — parse them before use.
      stock_by_warehouse: parseJson<Record<string, number>>(row.warehouse_stock, {}),
      units: parseJson<ProductUnit[]>(row.units, []),
      // Other required fields for Product interface
      tenant_id: '',
      description: '',
    }));
    setProducts(mappedProducts);
  };

  const fetchTransfers = async () => {
    const res = await query(`
      SELECT 
        st.id,
        st.reference_number,
        st.source_warehouse_id,
        st.destination_warehouse_id,
        st.status,
        st.created_at,
        st.notes,
        st.request_id,
        sr.request_number,
        w1.name as source_warehouse_name,
        w2.name as destination_warehouse_name,
        w1.branch_id as source_branch_id,
        w2.branch_id as destination_branch_id,
        (SELECT COUNT(*) FROM transfer_items ti WHERE ti.transfer_id = st.id) as items_count
      FROM stock_transfers st
      LEFT JOIN warehouses w1 ON st.source_warehouse_id = w1.id
      LEFT JOIN warehouses w2 ON st.destination_warehouse_id = w2.id
      LEFT JOIN stock_requests sr ON sr.id = st.request_id
      ORDER BY st.created_at DESC
    `);
    setTransfers(res.rows as unknown as Transfer[]);
  };

  const handleCreateTransfer = async (transferData: {
    from: string;
    to: string;
    notes?: string;
    items: { productId: string; quantity: number; unitName?: string; conversionFactor?: number }[];
  }) => {
    try {
      // Header and lines commit together: a half-written transfer would show up
      // in the queue with no items and could never be shipped.
      const transferId = await runTransaction((tx) =>
        createTransfer(tx, {
          referenceNumber: `TRF-${Date.now()}`,
          sourceWarehouseId: transferData.from,
          destinationWarehouseId: transferData.to,
          notes: transferData.notes ?? null,
          requestedBy: user?.id ?? null,
          items: transferData.items,
        })
      );

      await logAudit({
        action: "create_transfer",
        entity: "stock_transfers",
        entityId: transferId,
        details: {
          from: transferData.from,
          to: transferData.to,
          itemsCount: transferData.items.length,
        },
        userId: user?.id,
      });

      toast.success("Permintaan transfer berhasil dibuat");
      setIsTransferOpen(false);
      fetchTransfers();
    } catch (error) {
      console.error("Create transfer failed:", error);
      toast.error(
        "Gagal membuat transfer: " + (error instanceof Error ? error.message : "Unknown error")
      );
    }
  };

  /**
   * Shipping a transfer moves stock batch by batch.
   *
   * The move itself lives in `@/lib/stock-movement` so this screen and
   * Inventory cannot disagree about it again; the module drains the source in
   * the tenant's issue order (FIFO / LIFO / FEFO) and creates one destination
   * batch per source leg, keeping cost and expiry.
   */
  const handleDispatchTransfer = async (transferId: string) => {
    if (!MOVEMENT_ROLES.includes(user?.role ?? '')) {
      toast.error("Anda tidak memiliki akses untuk mengirim transfer");
      return;
    }

    try {
      const issueMethod = await getStockIssueMethod();

      await runTransaction(async (tx) => {
        const result = await dispatchTransfer(tx, {
          transferId,
          userId: user?.id ?? null,
          issueMethod,
        });

        await logAuditTx(tx, {
          action: "dispatch_transfer",
          entity: "stock_transfers",
          entityId: transferId,
          details: {
            reference_number: result.referenceNumber,
            item_count: result.itemCount,
            stock_issue_method: issueMethod,
          },
          userId: user?.id,
        });
      });

      toast.success("Barang dikirim, stok sudah pindah ke gudang tujuan");
      fetchTransfers();
      fetchProducts(); // Refresh stock levels
    } catch (error) {
      console.error("Dispatch failed:", error);
      toast.error(
        "Gagal mengirim transfer: " + (error instanceof Error ? error.message : "Unknown error")
      );
    }
  };

  /** Receipt only confirms arrival: the stock already left the source warehouse. */
  const handleReceiveTransfer = async (transferId: string) => {
    if (!MOVEMENT_ROLES.includes(user?.role ?? '')) {
      toast.error("Anda tidak memiliki akses untuk menerima transfer");
      return;
    }

    try {
      await runTransaction(async (tx) => {
        const result = await receiveTransfer(tx, { transferId, userId: user?.id ?? null });

        await logAuditTx(tx, {
          action: "receive_transfer",
          entity: "stock_transfers",
          entityId: transferId,
          details: { reference_number: result.referenceNumber },
          userId: user?.id,
        });
      });

      toast.success("Penerimaan barang dikonfirmasi");
      fetchTransfers();
    } catch (error) {
      console.error("Receipt failed:", error);
      toast.error(
        "Gagal mengonfirmasi penerimaan: " + (error instanceof Error ? error.message : "Unknown error")
      );
    }
  };

  // Filter transfers based on tabs and search
  const filteredTransfers = transfers.filter(t => {
    // Search filter
    const searchMatch = 
      t.reference_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.request_number ?? '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.source_warehouse_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.destination_warehouse_name?.toLowerCase().includes(searchQuery.toLowerCase());

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
      "No. Pesanan": t.request_number || "-",
      "Dari Gudang": t.source_warehouse_name,
      "Ke Gudang": t.destination_warehouse_name,
      "Tanggal": new Date(t.created_at).toLocaleDateString('id-ID'),
      "Jumlah Item": t.items_count,
      "Status": transferStatusLabel(t.status),
      "Catatan": t.notes || "-"
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Transfer Stok");

    const wscols = [
      { wch: 20 }, // Ref
      { wch: 24 }, // Request
      { wch: 20 }, // Source
      { wch: 20 }, // Dest
      { wch: 15 }, // Date
      { wch: 12 }, // Items
      { wch: 18 }, // Status
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
            <h1 className="text-2xl lg:text-3xl font-bold">Transfer Stok Antar Gudang</h1>
            <p className="text-muted-foreground mt-1">
              Kelola perpindahan stok antar gudang
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
                            <TableHead>Dari Gudang</TableHead>
                            <TableHead>Ke Gudang</TableHead>
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
                                    <TableCell>
                                        <div className="font-mono font-medium">{t.reference_number}</div>
                                        {t.request_number && (
                                            <div className="text-xs text-muted-foreground">
                                                Pesanan {t.request_number}
                                            </div>
                                        )}
                                    </TableCell>
                                    <TableCell>{t.source_warehouse_name}</TableCell>
                                    <TableCell>{t.destination_warehouse_name}</TableCell>
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
                                            className={
                                                t.status === 'completed'
                                                    ? 'bg-success/20 text-success hover:bg-success/30'
                                                    : t.status === 'in_transit'
                                                        ? 'bg-warning/20 text-warning hover:bg-warning/30'
                                                        : ''
                                            }
                                        >
                                            {transferStatusLabel(t.status)}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            {t.status === 'pending' && (
                                                <Button 
                                                    size="sm" 
                                                    variant="outline" 
                                                    className="gap-1 border-warning text-warning hover:bg-warning/10"
                                                    onClick={() => handleDispatchTransfer(t.id)}
                                                >
                                                    <Send className="w-3 h-3" />
                                                    Kirim
                                                </Button>
                                            )}
                                            {t.status === 'in_transit' && (
                                                <Button 
                                                    size="sm" 
                                                    variant="outline" 
                                                    className="gap-1 border-success text-success hover:bg-success/10"
                                                    onClick={() => handleReceiveTransfer(t.id)}
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
            warehouses={warehouses}
            onTransfer={handleCreateTransfer}
        />
      </div>
    </BackOfficeLayout>
  );
}
