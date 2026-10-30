import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BackOfficeLayout } from "@/components/layout/BackOfficeLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ClipboardList,
  Download,
  Eye,
  Loader2,
  Plus,
  Search,
  Truck,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { batchQuery, query, runTransaction } from "@/lib/db";
import { logAuditTx } from "@/lib/audit";
import { useAuth } from "@/hooks/use-auth";
import { getStockIssueMethod } from "@/lib/tenant-settings";
import { WAREHOUSES_SQL, resolveSupplyWarehouse, type WarehouseOption } from "@/lib/warehouse";
import {
  cancelTransfer,
  committedQuantities,
  createTransfer,
  dispatchTransfer,
  receiveTransfer,
  shipOutOfStock,
  stockOnHand,
} from "@/lib/stock-movement";
import {
  canPerform,
  nextOrderNumber,
  orderNumberPrefix,
  roleHasPermission,
  summarizeOrder,
  validateApproval,
  validateDispatch,
  validateReceipt,
  STOCK_REQUEST_PRIORITY_LABEL,
  STOCK_REQUEST_STATUS_LABEL,
  type StockRequestStatus,
} from "@/lib/branch-orders";
import {
  BranchOrderModal,
  type BranchOrderDraft,
  type OrderBranchOption,
  type OrderProductOption,
} from "@/components/branches/BranchOrderModal";
import {
  BranchOrderDetailModal,
  type OrderDetail,
  type OrderDetailLine,
} from "@/components/branches/BranchOrderDetailModal";

/** One row of the list: the request header plus the names the table shows. */
interface OrderRow {
  id: string;
  request_number: string;
  branch_id: string;
  branch_name: string | null;
  warehouse_name: string | null;
  status: StockRequestStatus;
  priority: string;
  source: string;
  needed_date: string | null;
  notes: string | null;
  rejection_reason: string | null;
  created_at: string;
  approved_at: string | null;
  dispatched_at: string | null;
  received_at: string | null;
  requested_by_name: string | null;
  approved_by_name: string | null;
  dispatched_by_name: string | null;
  received_by_name: string | null;
  transfer_id: string | null;
  transfer_number: string | null;
  items_count: number;
}

interface BranchRow extends OrderBranchOption {
  type: string;
}

interface MappingRow {
  branch_id: string;
  warehouse_id: string;
  is_default: number;
  priority: number;
}

const ORDERS_SQL = `
  SELECT
    r.id,
    r.request_number,
    r.branch_id,
    r.status,
    r.priority,
    r.source,
    r.needed_date,
    r.notes,
    r.rejection_reason,
    r.created_at,
    r.approved_at,
    r.dispatched_at,
    r.received_at,
    r.transfer_id,
    b.name AS branch_name,
    b.code AS branch_code,
    w.name AS warehouse_name,
    tr.reference_number AS transfer_number,
    ru.name AS requested_by_name,
    au.name AS approved_by_name,
    du.name AS dispatched_by_name,
    rcu.name AS received_by_name,
    (SELECT COUNT(*) FROM stock_request_items i WHERE i.request_id = r.id) AS items_count
  FROM stock_requests r
  LEFT JOIN branches b ON b.id = r.branch_id
  LEFT JOIN warehouses w ON w.id = r.warehouse_id
  LEFT JOIN stock_transfers tr ON tr.id = r.transfer_id
  LEFT JOIN users ru ON ru.id = r.requested_by
  LEFT JOIN users au ON au.id = r.approved_by
  LEFT JOIN users du ON du.id = r.dispatched_by
  LEFT JOIN users rcu ON rcu.id = r.received_by
  ORDER BY r.created_at DESC
`;

const BRANCHES_SQL = `SELECT id, code, name, type FROM branches WHERE status = 'active' ORDER BY name ASC`;

const MAPPINGS_SQL = `SELECT branch_id, warehouse_id, is_default, priority FROM branch_warehouses`;

/** Gudang stock per product, which is what a shop is asking for. */
const ORDER_PRODUCTS_SQL = `
  SELECT
    p.id,
    p.sku,
    p.name,
    p.min_stock_level,
    COALESCE((
      SELECT json_group_array(json_object('name', name, 'conversion_factor', conversion_factor))
      FROM product_units WHERE product_id = p.id
    ), '[]') AS units,
    COALESCE((
      SELECT SUM(quantity_current) FROM product_batches
       WHERE product_id = p.id AND warehouse_id = $1
    ), 0) AS stock
  FROM products p
  ORDER BY p.name ASC
`;

/** Tabs are a reading of the status machine, not a second one. */
const TABS: { value: string; label: string; statuses?: StockRequestStatus[] }[] = [
  { value: "all", label: "Semua" },
  { value: "submitted", label: "Menunggu", statuses: ["submitted"] },
  { value: "approved", label: "Disiapkan", statuses: ["approved"] },
  { value: "in_transit", label: "Dikirim", statuses: ["in_transit"] },
  { value: "finished", label: "Selesai", statuses: ["received", "rejected", "cancelled"] },
];

const PAGE_SIZE = 10;

const STATUS_CLASS: Record<StockRequestStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-warning/20 text-warning",
  approved: "bg-info/20 text-info",
  rejected: "bg-destructive/20 text-destructive",
  in_transit: "bg-primary/20 text-primary",
  received: "bg-success/20 text-success",
  cancelled: "bg-muted text-muted-foreground",
};

export default function BranchOrders() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [mappings, setMappings] = useState<MappingRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [products, setProducts] = useState<OrderProductOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [activeTab, setActiveTab] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [branchFilter, setBranchFilter] = useState("all");
  const [page, setPage] = useState(1);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [prefill, setPrefill] = useState<{ productId: string; quantity?: number } | null>(null);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  // A store manager only ever works for one shop: the queue, the filter and the
  // create form are all locked to it.
  const lockedBranchId =
    user?.role === "store_manager" ? user?.assigned_branch_id ?? null : null;
  const role = user?.role;

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const supplyWarehouseId = await resolveSupplyWarehouse(lockedBranchId);
      const [orderRes, branchRes, warehouseRes, mappingRes, productRes] = await batchQuery([
        { sql: ORDERS_SQL },
        { sql: BRANCHES_SQL },
        { sql: WAREHOUSES_SQL },
        { sql: MAPPINGS_SQL },
        { sql: ORDER_PRODUCTS_SQL, params: [supplyWarehouseId ?? ""] },
      ]);

      setOrders(orderRes.rows as unknown as OrderRow[]);
      setBranches(branchRes.rows as unknown as BranchRow[]);
      setWarehouses(warehouseRes.rows as unknown as WarehouseOption[]);
      setMappings(mappingRes.rows as unknown as MappingRow[]);
      setProducts(
        (productRes.rows as unknown as {
          id: string;
          sku: string;
          name: string;
          min_stock_level: number;
          units: string;
          stock: number;
        }[]).map((row) => ({
          id: row.id,
          sku: row.sku,
          name: row.name,
          minStock: Number(row.min_stock_level),
          stock: Number(row.stock),
          units: JSON.parse(row.units) as { name: string; conversion_factor: number }[],
        }))
      );
    } catch (error) {
      console.error("Failed to load branch orders:", error);
      toast.error("Gagal memuat pesanan cabang");
    } finally {
      setIsLoading(false);
    }
  }, [lockedBranchId]);

  useEffect(() => {
    load();
  }, [load]);

  /** `?product=<id>` opens the create form already carrying that line. */
  useEffect(() => {
    const productId = searchParams.get("product");
    if (!productId) return;
    const quantity = Number(searchParams.get("qty") ?? 0);
    setPrefill({ productId, quantity: quantity > 0 ? quantity : undefined });
    setIsCreateOpen(true);
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  /** The shop's own rack, if it has one: goods move gudang → rak on dispatch. */
  const rackFor = useCallback(
    (branchId: string): string | null => {
      const mapped = mappings
        .filter((mapping) => mapping.branch_id === branchId)
        .sort(
          (a, b) => Number(b.is_default) - Number(a.is_default) || a.priority - b.priority
        );
      for (const mapping of mapped) {
        const warehouse = warehouses.find((item) => item.id === mapping.warehouse_id);
        if (warehouse && warehouse.type === "store") return warehouse.id;
      }
      return null;
    },
    [mappings, warehouses]
  );

  const openDetail = async (row: OrderRow) => {
    try {
      const res = await query<OrderDetailLine & { product_name: string; sku: string }>(
        `SELECT i.id, i.product_id, i.unit_name, i.conversion_factor,
                i.quantity_requested, i.quantity_approved, i.quantity_dispatched,
                i.quantity_received, p.name AS product_name, p.sku
           FROM stock_request_items i
           JOIN products p ON p.id = i.product_id
          WHERE i.request_id = $1
          ORDER BY p.name ASC`,
        [row.id]
      );
      setDetail({ ...row, items: res.rows as unknown as OrderDetailLine[] });
      setIsDetailOpen(true);
    } catch (error) {
      console.error("Failed to load order lines:", error);
      toast.error("Gagal memuat rincian pesanan");
    }
  };

  const handleCreate = async (draft: BranchOrderDraft) => {
    setBusy(true);
    try {
      const branch = branches.find((item) => item.id === draft.branchId);
      const branchCode = branch?.code || "CAB";
      const warehouseId = await resolveSupplyWarehouse(draft.branchId);
      if (!warehouseId) throw new Error("Belum ada gudang yang bisa memenuhi pesanan");

      await runTransaction(async (tx) => {
        const now = new Date();
        const existing = await tx.query<{ request_number: string }>(
          `SELECT request_number FROM stock_requests WHERE request_number LIKE $1`,
          [`${orderNumberPrefix(now, branchCode)}%`]
        );
        const requestNumber = nextOrderNumber(
          now,
          branchCode,
          existing.rows.map((row) => row.request_number)
        );

        const header = await tx.query<{ id: string }>(
          `INSERT INTO stock_requests
             (request_number, branch_id, warehouse_id, status, priority, source,
              needed_date, notes, requested_by)
           VALUES ($1, $2, $3, $4, $5, 'branch', $6, $7, $8)
           RETURNING id`,
          [
            requestNumber,
            draft.branchId,
            warehouseId,
            draft.submit ? "submitted" : "draft",
            draft.priority,
            draft.neededDate || null,
            draft.notes || null,
            user?.id ?? null,
          ]
        );
        const requestId = header.rows[0].id;

        for (const item of draft.items) {
          await tx.query(
            `INSERT INTO stock_request_items
               (request_id, product_id, unit_name, conversion_factor,
                quantity_requested, quantity_approved)
             VALUES ($1, $2, $3, $4, $5, 0)`,
            [requestId, item.productId, item.unitName, item.conversionFactor, item.quantity]
          );
        }

        await logAuditTx(tx, {
          action: draft.submit ? "submit_stock_request" : "create_stock_request",
          entity: "stock_requests",
          entityId: requestId,
          details: {
            request_number: requestNumber,
            branch_id: draft.branchId,
            warehouse_id: warehouseId,
            lines: draft.items.length,
            priority: draft.priority,
            source: "branch",
          },
          userId: user?.id,
        });
      });

      toast.success(draft.submit ? "Pesanan dikirim ke gudang" : "Draf pesanan disimpan");
      setIsCreateOpen(false);
      setPrefill(null);
      load();
    } catch (error) {
      console.error("Create order failed:", error);
      toast.error("Gagal membuat pesanan: " + (error instanceof Error ? error.message : "Unknown error"));
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = async (approved: Record<string, number>) => {
    if (!detail) return;
    setBusy(true);
    try {
      await runTransaction(async (tx) => {
        const current = await tx.query<{ id: string }>(
          `SELECT id FROM stock_requests WHERE id = $1 AND status = 'submitted'`,
          [detail.id]
        );
        if (!current.rows[0]) throw new Error("Pesanan sudah diproses, muat ulang halaman");

        const lines = detail.items.map((item) => ({
          quantity_requested: item.quantity_requested,
          quantity_approved: approved[item.id] ?? item.quantity_requested,
        }));
        const invalid = validateApproval(lines);
        if (invalid) throw new Error(invalid);

        for (const item of detail.items) {
          await tx.query(
            `UPDATE stock_request_items SET quantity_approved = $1 WHERE id = $2 AND request_id = $3`,
            [approved[item.id] ?? item.quantity_requested, item.id, detail.id]
          );
        }

        await tx.query(
          `UPDATE stock_requests
              SET status = 'approved', approved_by = $1,
                  approved_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
            WHERE id = $2`,
          [user?.id ?? null, detail.id]
        );

        await logAuditTx(tx, {
          action: "approve_stock_request",
          entity: "stock_requests",
          entityId: detail.id,
          details: { request_number: detail.request_number, lines },
          userId: user?.id,
        });
      });

      toast.success("Pesanan disetujui");
      setIsDetailOpen(false);
      setDetail(null);
      load();
    } catch (error) {
      console.error("Approve failed:", error);
      toast.error("Gagal menyetujui: " + (error instanceof Error ? error.message : "Unknown error"));
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async (reason: string) => {
    if (!detail) return;
    setBusy(true);
    try {
      await runTransaction(async (tx) => {
        const res = await tx.query(
          `UPDATE stock_requests
              SET status = 'rejected', rejection_reason = $1, approved_by = $2,
                  approved_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
            WHERE id = $3 AND status = 'submitted'`,
          [reason, user?.id ?? null, detail.id]
        );
        if (res.rowCount !== 1) throw new Error("Pesanan sudah diproses, muat ulang halaman");

        await logAuditTx(tx, {
          action: "reject_stock_request",
          entity: "stock_requests",
          entityId: detail.id,
          details: { request_number: detail.request_number, reason },
          userId: user?.id,
        });
      });

      toast.success("Pesanan ditolak");
      setIsDetailOpen(false);
      setDetail(null);
      load();
    } catch (error) {
      console.error("Reject failed:", error);
      toast.error("Gagal menolak: " + (error instanceof Error ? error.message : "Unknown error"));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Ships an approved request.
   *
   * Stock leaves the gudang here (decision recorded in the transfer module):
   * a shop with a rack gets a transfer whose destination is that rack, while a
   * channel without one — the online shop — has its goods leave the building.
   * Both go through the same deduction, so the batches are picked identically.
   */
  const handleDispatch = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      const issueMethod = await getStockIssueMethod();
      const destination = rackFor(detail.branch_id);

      await runTransaction(async (tx) => {
        const current = await tx.query<{ warehouse_id: string; status: string }>(
          `SELECT warehouse_id, status FROM stock_requests WHERE id = $1 AND status = 'approved'`,
          [detail.id]
        );
        const sourceWarehouseId = current.rows[0]?.warehouse_id;
        if (!sourceWarehouseId) throw new Error("Pesanan sudah diproses, muat ulang halaman");

        // Another approved order may already have claimed the same units.
        const committed = await committedQuantities(
          tx,
          sourceWarehouseId,
          detail.items.map((item) => item.product_id),
          detail.id
        );
        const guardLines = [];
        for (const item of detail.items) {
          guardLines.push({
            quantity_approved: Number(item.quantity_approved),
            onHand: await stockOnHand(tx, sourceWarehouseId, item.product_id),
            committed: committed[item.product_id] ?? 0,
          });
        }
        const invalid = validateDispatch(guardLines);
        if (invalid) throw new Error(invalid);

        const shipped = detail.items.filter((item) => Number(item.quantity_approved) > 0);
        if (shipped.length === 0) throw new Error("Tidak ada jumlah yang disetujui untuk dikirim");

        let transferId: string | null = null;
        if (destination && destination !== sourceWarehouseId) {
          transferId = await createTransfer(tx, {
            referenceNumber: `TRF-${Date.now()}`,
            sourceWarehouseId,
            destinationWarehouseId: destination,
            notes: `Pesanan ${detail.request_number}`,
            requestedBy: user?.id ?? null,
            requestId: detail.id,
            items: shipped.map((item) => ({
              productId: item.product_id,
              quantity: Number(item.quantity_approved),
            })),
          });
          await dispatchTransfer(tx, { transferId, userId: user?.id ?? null, issueMethod });
        } else {
          await shipOutOfStock(tx, {
            warehouseId: sourceWarehouseId,
            items: shipped.map((item) => ({
              productId: item.product_id,
              quantity: Number(item.quantity_approved),
            })),
            issueMethod,
          });
        }

        for (const item of detail.items) {
          await tx.query(`UPDATE stock_request_items SET quantity_dispatched = $1 WHERE id = $2`, [
            Number(item.quantity_approved),
            item.id,
          ]);
        }

        await tx.query(
          `UPDATE stock_requests
              SET status = 'in_transit', transfer_id = $1, dispatched_by = $2,
                  dispatched_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
            WHERE id = $3`,
          [transferId, user?.id ?? null, detail.id]
        );

        await logAuditTx(tx, {
          action: "dispatch_stock_request",
          entity: "stock_requests",
          entityId: detail.id,
          details: {
            request_number: detail.request_number,
            transfer_id: transferId,
            shipped_lines: shipped.length,
            stock_issue_method: issueMethod,
          },
          userId: user?.id,
        });
      });

      toast.success(destination ? "Barang dikirim ke rak toko" : "Barang dikirim dari gudang");
      setIsDetailOpen(false);
      setDetail(null);
      load();
    } catch (error) {
      console.error("Dispatch failed:", error);
      toast.error("Gagal mengirim: " + (error instanceof Error ? error.message : "Unknown error"));
    } finally {
      setBusy(false);
    }
  };

  const handleReceive = async (received: Record<string, number>) => {
    if (!detail) return;
    setBusy(true);
    try {
      await runTransaction(async (tx) => {
        const current = await tx.query<{ id: string }>(
          `SELECT id FROM stock_requests WHERE id = $1 AND status = 'in_transit'`,
          [detail.id]
        );
        if (!current.rows[0]) throw new Error("Pesanan belum dikirim atau sudah diterima");

        const lines = detail.items.map((item) => ({
          quantity_requested: item.quantity_requested,
          quantity_dispatched: item.quantity_dispatched,
          quantity_received: received[item.id] ?? item.quantity_dispatched,
        }));
        const invalid = validateReceipt(lines);
        if (invalid) throw new Error(invalid);

        for (const item of detail.items) {
          await tx.query(`UPDATE stock_request_items SET quantity_received = $1 WHERE id = $2`, [
            received[item.id] ?? item.quantity_dispatched,
            item.id,
          ]);
        }

        await tx.query(
          `UPDATE stock_requests
              SET status = 'received', received_by = $1,
                  received_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
            WHERE id = $2`,
          [user?.id ?? null, detail.id]
        );

        // The movement document closes with the receipt; the stock itself
        // moved at dispatch, so this only stamps who confirmed it.
        if (detail.transfer_id) {
          await receiveTransfer(tx, { transferId: detail.transfer_id, userId: user?.id ?? null });
        }

        await logAuditTx(tx, {
          action: "receive_stock_request",
          entity: "stock_requests",
          entityId: detail.id,
          details: { request_number: detail.request_number, lines },
          userId: user?.id,
        });
      });

      toast.success("Penerimaan pesanan dikonfirmasi");
      setIsDetailOpen(false);
      setDetail(null);
      load();
    } catch (error) {
      console.error("Receive failed:", error);
      toast.error(
        "Gagal mengonfirmasi penerimaan: " + (error instanceof Error ? error.message : "Unknown error")
      );
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      await runTransaction(async (tx) => {
        // A queued movement, if one exists, dies with the request.
        if (detail.transfer_id) {
          await cancelTransfer(tx, detail.transfer_id);
        }

        const res = await tx.query(
          `UPDATE stock_requests
              SET status = 'cancelled', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
            WHERE id = $1 AND status IN ('draft', 'submitted', 'approved')`,
          [detail.id]
        );
        if (res.rowCount !== 1) throw new Error("Pesanan sudah dikirim dan tidak bisa dibatalkan");

        await logAuditTx(tx, {
          action: "cancel_stock_request",
          entity: "stock_requests",
          entityId: detail.id,
          details: { request_number: detail.request_number },
          userId: user?.id,
        });
      });

      toast.success("Pesanan dibatalkan");
      setIsDetailOpen(false);
      setDetail(null);
      load();
    } catch (error) {
      console.error("Cancel failed:", error);
      toast.error("Gagal membatalkan: " + (error instanceof Error ? error.message : "Unknown error"));
    } finally {
      setBusy(false);
    }
  };

  const visibleOrders = useMemo(() => {
    const tab = TABS.find((entry) => entry.value === activeTab);
    const query = searchQuery.trim().toLowerCase();

    return orders.filter((order) => {
      if (lockedBranchId && order.branch_id !== lockedBranchId) return false;
      if (branchFilter !== "all" && order.branch_id !== branchFilter) return false;
      if (tab?.statuses && !tab.statuses.includes(order.status)) return false;
      if (!query) return true;
      return (
        order.request_number.toLowerCase().includes(query) ||
        (order.branch_name ?? "").toLowerCase().includes(query) ||
        (order.transfer_number ?? "").toLowerCase().includes(query)
      );
    });
  }, [orders, activeTab, searchQuery, branchFilter, lockedBranchId]);

  const pageCount = Math.max(1, Math.ceil(visibleOrders.length / PAGE_SIZE));
  const pageRows = visibleOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [activeTab, searchQuery, branchFilter]);

  const stats = useMemo(() => {
    const forMe = orders.filter((order) => !lockedBranchId || order.branch_id === lockedBranchId);
    return {
      waiting: forMe.filter((order) => order.status === "submitted").length,
      toShip: forMe.filter((order) => order.status === "approved").length,
      shipping: forMe.filter((order) => order.status === "in_transit").length,
      done: forMe.filter((order) => order.status === "received").length,
    };
  }, [orders, lockedBranchId]);

  const handleExport = () => {
    if (visibleOrders.length === 0) {
      toast.error("Tidak ada pesanan untuk diexport");
      return;
    }

    const rows = visibleOrders.map((order) => ({
      "No. Pesanan": order.request_number,
      Cabang: order.branch_name ?? "-",
      Gudang: order.warehouse_name ?? "-",
      Status: STOCK_REQUEST_STATUS_LABEL[order.status],
      Prioritas: STOCK_REQUEST_PRIORITY_LABEL[order.priority] ?? order.priority,
      "Jumlah Baris": order.items_count,
      "Transfer Stok": order.transfer_number ?? "-",
      Dibuat: new Date(order.created_at).toLocaleString("id-ID"),
      Catatan: order.notes ?? "-",
    }));

    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet["!cols"] = [
      { wch: 26 },
      { wch: 20 },
      { wch: 20 },
      { wch: 20 },
      { wch: 12 },
      { wch: 12 },
      { wch: 26 },
      { wch: 22 },
      { wch: 30 },
    ];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Pesanan Cabang");
    XLSX.writeFile(book, `Pesanan_Cabang_${new Date().toISOString().split("T")[0]}.xlsx`);
    toast.success("Berhasil export pesanan cabang");
  };

  const canCreate = roleHasPermission(role, "request_stock");
  const branchOptions = lockedBranchId
    ? branches.filter((branch) => branch.id === lockedBranchId)
    : branches;

  return (
    <BackOfficeLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold">Pesanan Cabang</h1>
            <p className="text-muted-foreground mt-1">
              Permintaan stok dari cabang ke gudang pusat
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={handleExport}>
              <Download className="w-4 h-4" />
              Export
            </Button>
            {canCreate && (
              <Button
                className="gap-2"
                onClick={() => {
                  setPrefill(null);
                  setIsCreateOpen(true);
                }}
              >
                <Plus className="w-4 h-4" />
                Buat Pesanan
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Menunggu Persetujuan", value: stats.waiting, icon: Clock, tone: "text-warning" },
            { label: "Siap Dikirim", value: stats.toShip, icon: ClipboardList, tone: "text-info" },
            { label: "Dalam Pengiriman", value: stats.shipping, icon: Truck, tone: "text-primary" },
            { label: "Selesai", value: stats.done, icon: CheckCircle2, tone: "text-success" },
          ].map((card) => (
            <div key={card.label} className="bg-card rounded-xl border p-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-muted">
                  <card.icon className={`w-5 h-5 ${card.tone}`} />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{card.label}</p>
                  <p className="text-2xl font-bold">{card.value}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Cari no. pesanan, cabang, atau transfer..."
              className="pl-10"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </div>
          {!lockedBranchId && (
            <Select value={branchFilter} onValueChange={setBranchFilter}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Semua cabang" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua cabang</SelectItem>
                {branches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            {TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="bg-card rounded-xl border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>No. Pesanan</TableHead>
                <TableHead>Cabang</TableHead>
                <TableHead>Gudang</TableHead>
                <TableHead className="text-center">Baris</TableHead>
                <TableHead className="text-center">Prioritas</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead>Dibuat</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center">
                    <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" />
                  </TableCell>
                </TableRow>
              ) : pageRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                    Belum ada pesanan
                  </TableCell>
                </TableRow>
              ) : (
                pageRows.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell>
                      <div className="font-mono font-medium">{order.request_number}</div>
                      {order.transfer_number && (
                        <div className="text-xs text-muted-foreground">
                          Transfer {order.transfer_number}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{order.branch_name ?? "-"}</TableCell>
                    <TableCell>{order.warehouse_name ?? "-"}</TableCell>
                    <TableCell className="text-center">{order.items_count}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant={order.priority === "urgent" ? "destructive" : "secondary"}>
                        {STOCK_REQUEST_PRIORITY_LABEL[order.priority] ?? order.priority}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge className={STATUS_CLASS[order.status]}>
                        {STOCK_REQUEST_STATUS_LABEL[order.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {new Date(order.created_at).toLocaleDateString("id-ID")}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" className="gap-1" onClick={() => openDetail(order)}>
                        <Eye className="w-3 h-3" />
                        Detail
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {pageCount > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, visibleOrders.length)} dari{" "}
              {visibleOrders.length} pesanan
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                Sebelumnya
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pageCount}
                onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
              >
                Berikutnya
              </Button>
            </div>
          </div>
        )}

        <BranchOrderModal
          open={isCreateOpen}
          onOpenChange={(open) => {
            setIsCreateOpen(open);
            if (!open) setPrefill(null);
          }}
          branches={branchOptions}
          products={products}
          lockedBranchId={lockedBranchId}
          prefill={prefill}
          onSubmit={handleCreate}
          isSaving={busy}
        />

        <BranchOrderDetailModal
          open={isDetailOpen}
          onOpenChange={(open) => {
            setIsDetailOpen(open);
            if (!open) setDetail(null);
          }}
          order={detail}
          role={role}
          onApprove={handleApprove}
          onReject={handleReject}
          onDispatch={handleDispatch}
          onReceive={handleReceive}
          onCancel={handleCancel}
          busy={busy}
        />
      </div>
    </BackOfficeLayout>
  );
}

/** Kept next to the page: the detail modal's read model is the same shape. */
export type { OrderDetail };
