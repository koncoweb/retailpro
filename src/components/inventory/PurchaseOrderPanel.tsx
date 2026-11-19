import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PermissionGate } from "@/components/auth/PermissionGate";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  ClipboardList,
  Clock,
  Download,
  Loader2,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { batchQuery, query, runTransaction } from "@/lib/db";
import { logAuditTx } from "@/lib/audit";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/formatters";
import { printPurchaseOrder, purchaseOrderPrintInput } from "@/lib/print/purchase-order";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions, useWarehouseScope } from "@/hooks/use-permissions";
import { getStockIssueMethod } from "@/lib/tenant-settings";
import {
  activeWarehouses,
  resolveSupplyWarehouse,
  warehouseLabel,
  type WarehouseOption,
} from "@/lib/warehouse";
import {
  actionsForPurchaseOrder,
  checkApprovalRights,
  effectiveReceivedAmount,
  isoToday,
  nextDocumentNumber,
  normalizePurchaseOrderStatus,
  normalizePpnRate,
  procurementAmounts,
  vendorPpnRate,
  lineSubtotal,
  OPEN_PO_STATUSES,
  PO_ACTION_LABEL,
  PO_STATUS_LABEL,
  PO_STATUS_TONE,
  PURCHASE_ORDER_STATUSES,
  type PurchaseOrderAction,
  type PurchaseOrderStatus,
  type ReceiptAmountContext,
} from "@/lib/procurement";
import { receivePurchaseOrder } from "@/lib/goods-receipt";
import {
  PurchaseOrderModal,
  type PurchaseOrderDraftValues,
  type PurchaseOrderProduct,
  type VendorOption,
} from "@/components/inventory/PurchaseOrderModal";
import {
  GoodsReceiptModal,
  type GoodsReceiptPayload,
  type ReceiptLineSource,
} from "@/components/inventory/GoodsReceiptModal";
import {
  PurchaseOrderDetail,
  type PurchaseOrderDetailData,
  type PurchaseOrderLine,
  type PurchaseOrderReceipt,
  type PurchaseOrderRow,
} from "@/components/inventory/PurchaseOrderDetail";
import { PaginationBar } from "@/components/ui/pagination-bar";

const PAGE_SIZE = 20;

/**
 * One row per order, with the value of everything that has actually arrived.
 *
 * `received_amount` is a correlated subquery rather than a join + GROUP BY so a
 * PO with two deliveries still reads as one row.
 *
 * Every transition is attributed to a person in the schema, so the projection
 * also resolves each actor id to a name: "who approved this" is the first
 * question an owner asks of the history.
 */
const PO_ACTOR_COLUMNS = `
         po.submitted_by, po.approved_by, po.rejected_by, po.cancelled_by,
         po.rejected_at, po.cancelled_at,
         cu.name AS created_by_name, su.name AS submitted_by_name,
         au.name AS approved_by_name, ru.name AS rejected_by_name,
         xu.name AS cancelled_by_name,
`;

const PO_ACTOR_JOINS = `
    LEFT JOIN users cu ON cu.id = po.created_by
    LEFT JOIN users su ON su.id = po.submitted_by
    LEFT JOIN users au ON au.id = po.approved_by
    LEFT JOIN users ru ON ru.id = po.rejected_by
    LEFT JOIN users xu ON xu.id = po.cancelled_by
`;

const PO_LIST_SQL = `
  SELECT po.id, po.po_number, po.status, po.supplier_id, po.supplier_name, po.branch_id,
         po.warehouse_id, po.subtotal_amount, po.discount_type, po.discount_value, po.discount_amount, po.ppn_rate, po.ppn_amount, po.total_amount,
         po.expected_date, po.created_at, po.received_at,
         po.notes, po.payment_terms_days, po.created_by, po.submitted_at, po.approved_at,
         po.rejection_reason, po.cancel_reason,${PO_ACTOR_COLUMNS}
         COALESCE((SELECT SUM(gr.total_amount) FROM goods_receipts gr
                    WHERE gr.purchase_order_id = po.id), 0) AS received_amount,
         (SELECT COUNT(*) FROM goods_receipts gr WHERE gr.purchase_order_id = po.id) AS receipt_count
    FROM purchase_orders po${PO_ACTOR_JOINS}
   ORDER BY po.created_at DESC
`;

/** The same projection for one order, used by the detail sheet. */
const PO_HEADER_SQL = `
  SELECT po.id, po.po_number, po.status, po.supplier_id, po.supplier_name, po.branch_id,
         po.warehouse_id, po.subtotal_amount, po.discount_type, po.discount_value, po.discount_amount, po.ppn_rate, po.ppn_amount, po.total_amount,
         po.expected_date, po.created_at, po.received_at,
         po.notes, po.payment_terms_days, po.created_by, po.submitted_at, po.approved_at,
         po.rejection_reason, po.cancel_reason,${PO_ACTOR_COLUMNS}
         COALESCE((SELECT SUM(gr.total_amount) FROM goods_receipts gr
                    WHERE gr.purchase_order_id = po.id), 0) AS received_amount,
         (SELECT COUNT(*) FROM goods_receipts gr WHERE gr.purchase_order_id = po.id) AS receipt_count
    FROM purchase_orders po${PO_ACTOR_JOINS}
   WHERE po.id = $1
`;

const PO_LINES_SQL = `
  SELECT poi.id, poi.product_id, COALESCE(p.name, poi.product_id) AS product_name,
         COALESCE(p.sku, '') AS sku, poi.quantity,
         COALESCE(poi.quantity_received, 0) AS quantity_received,
         poi.unit_name, poi.conversion_factor, poi.unit_cost, poi.subtotal,
         poi.variant_id, COALESCE(v.name, '') AS variant_name
    FROM purchase_order_items poi
    LEFT JOIN products p ON p.id = poi.product_id
    LEFT JOIN product_variants v ON v.id = poi.variant_id
   WHERE poi.purchase_order_id = $1
   ORDER BY p.name ASC
`;

const PO_RECEIPTS_SQL = `
  SELECT gr.id, gr.grn_number, gr.received_at, gr.subtotal_amount, gr.ppn_rate,
         gr.ppn_amount, gr.discount_amount, gr.total_amount, gr.supplier_document,
         ru.name AS received_by_name,
         (SELECT COUNT(*) FROM goods_receipt_items i WHERE i.goods_receipt_id = gr.id) AS line_count
    FROM goods_receipts gr
    LEFT JOIN users ru ON ru.id = gr.received_by
   WHERE gr.purchase_order_id = $1
   ORDER BY gr.received_at DESC
`;

const RECEIPT_LINES_SQL = `
  SELECT poi.id AS purchase_order_item_id, poi.product_id,
         COALESCE(p.name, poi.product_id) AS product_name, COALESCE(p.sku, '') AS sku,
         poi.quantity AS ordered, COALESCE(poi.quantity_received, 0) AS already_received,
         COALESCE(poi.unit_name, 'Pcs') AS unit_name, poi.conversion_factor,
         poi.unit_cost,
         COALESCE((SELECT SUM(i.quantity * i.unit_cost) FROM goods_receipt_items i
                    WHERE i.purchase_order_item_id = poi.id), 0) AS previous_value,
         COALESCE((SELECT SUM(i.subtotal) FROM goods_receipt_items i
                    WHERE i.purchase_order_item_id = poi.id), 0) AS previous_subtotal
    FROM purchase_order_items poi
    LEFT JOIN products p ON p.id = poi.product_id
   WHERE poi.purchase_order_id = $1
   ORDER BY p.name ASC
`;

interface ReceiptLineRow {
  purchase_order_item_id: string;
  product_id: string;
  product_name: string;
  sku: string;
  ordered: number;
  already_received: number;
  previous_value: number;
  previous_subtotal: number;
  unit_name: string;
  conversion_factor: number;
  unit_cost: number;
}

interface PurchaseOrderPanelProps {
  products: PurchaseOrderProduct[];
  warehouses: WarehouseOption[];
  vendors: VendorOption[];
  /** Called after a write so the parent can refresh stock-derived data. */
  onChanged?: () => void;
}

/** `YYYY-MM-DDTHH:MM:SS.sssZ`, the shape every timestamp column in this schema uses. */
function nowIso(): string {
  return new Date().toISOString();
}

export function PurchaseOrderPanel({
  products,
  warehouses,
  vendors,
  onChanged,
}: PurchaseOrderPanelProps) {
  const { user } = useAuth();
  const { can } = usePermissions();
  const { warehouseIds } = useWarehouseScope();
  // Another screen (the vendor detail) links here with `?po=<id>` to open one
  // order; the panel stays the only place that can act on it.
  const [searchParams, setSearchParams] = useSearchParams();
  const focusId = searchParams.get("po");

  const [orders, setOrders] = useState<PurchaseOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const printPendingRef = useRef(false);

  // Owners arrive here to read history, so the list opens on every status;
  // "Perlu tindakan" is one click away as the working queue.
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [vendorFilter, setVendorFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(0);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorDraft, setEditorDraft] = useState<PurchaseOrderDraftValues | null>(null);
  const [defaultWarehouseId, setDefaultWarehouseId] = useState<string | null>(null);

  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptTarget, setReceiptTarget] = useState<{
    id: string;
    poNumber: string;
    vendorName: string;
    warehouseName: string;
    lines: ReceiptLineSource[];
    /** FEFO makes an expiry date mandatory; read once, on open. */
    requireExpiry: boolean;
    ppnRate: 0 | 11;
    amountContext: Omit<ReceiptAmountContext, "cumulativeOrderedValue" | "finalReceipt">;
  } | null>(null);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<PurchaseOrderDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [reasonDialog, setReasonDialog] = useState<{
    order: PurchaseOrderRow;
    action: "reject" | "cancel";
  } | null>(null);
  const [reasonText, setReasonText] = useState("");

  const warehouseName = useCallback(
    (id: string | null) => {
      if (!id) return "-";
      const found = warehouses.find((item) => item.id === id);
      return found ? warehouseLabel(found) : "Gudang tidak dikenal";
    },
    [warehouses]
  );

  // ---- loading --------------------------------------------------------------

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await query<PurchaseOrderRow>(PO_LIST_SQL);
      setOrders(
        res.rows.map((row) => ({
          ...row,
          status: normalizePurchaseOrderStatus(row.status),
          subtotal_amount: Number(row.subtotal_amount),
          ppn_rate: normalizePpnRate(row.ppn_rate),
          ppn_amount: Number(row.ppn_amount),
          total_amount: Number(row.total_amount),
          received_amount: Number(row.received_amount),
          receipt_count: Number(row.receipt_count),
          payment_terms_days: Number(row.payment_terms_days ?? 0),
        }))
      );
    } catch (error) {
      console.error("Failed to load purchase orders:", error);
      toast.error("Gagal memuat purchase order");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDetail = useCallback(async (orderId: string): Promise<PurchaseOrderDetailData> => {
    const [headerRes, linesRes, receiptsRes] = await batchQuery<Record<string, unknown>>([
      { sql: PO_HEADER_SQL, params: [orderId] },
      { sql: PO_LINES_SQL, params: [orderId] },
      { sql: PO_RECEIPTS_SQL, params: [orderId] },
    ]);

    const rawHeader = headerRes.rows[0] as unknown as PurchaseOrderRow | undefined;
    if (!rawHeader) throw new Error("Purchase order tidak ditemukan");

    return {
      ...rawHeader,
      status: normalizePurchaseOrderStatus(rawHeader.status),
      subtotal_amount: Number(rawHeader.subtotal_amount),
      ppn_rate: normalizePpnRate(rawHeader.ppn_rate),
      ppn_amount: Number(rawHeader.ppn_amount),
      total_amount: Number(rawHeader.total_amount),
      received_amount: Number(rawHeader.received_amount),
      receipt_count: Number(rawHeader.receipt_count),
      payment_terms_days: Number(rawHeader.payment_terms_days ?? 0),
      lines: (linesRes.rows as unknown as PurchaseOrderLine[]).map((line) => ({
        ...line,
        quantity: Number(line.quantity),
        quantity_received: Number(line.quantity_received),
        unit_cost: Number(line.unit_cost),
        subtotal: Number(line.subtotal),
      })),
      receipts: (receiptsRes.rows as unknown as PurchaseOrderReceipt[]).map((receipt) => ({
        ...receipt,
        subtotal_amount: Number(receipt.subtotal_amount),
        ppn_rate: normalizePpnRate(receipt.ppn_rate),
        ppn_amount: Number(receipt.ppn_amount),
        total_amount: Number(receipt.total_amount),
        line_count: Number(receipt.line_count),
      })),
    };
  }, []);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  // The gudang a branch orders from, not its own rack (spec §6.2, fix 7). A
  // scoped role may only book an order into a gudang it can see, so the
  // suggestion falls back to the first in-scope one when the assigned branch
  // supplies a gudang outside the scope.
  const visibleWarehouses = useMemo(
    () =>
      activeWarehouses(warehouses).filter(
        (warehouse) => !warehouseIds || warehouseIds.includes(warehouse.id)
      ),
    [warehouses, warehouseIds]
  );

  useEffect(() => {
    let cancelled = false;
    resolveSupplyWarehouse(user?.assigned_branch_id ?? null)
      .then((id) => {
        if (cancelled) return;
        if (id && warehouseIds && !warehouseIds.includes(id)) {
          setDefaultWarehouseId(visibleWarehouses[0]?.id ?? null);
          return;
        }
        setDefaultWarehouseId(id);
      })
      .catch(() => {
        if (!cancelled) setDefaultWarehouseId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.assigned_branch_id, warehouseIds, visibleWarehouses]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(searchQuery);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    setPage(0);
  }, [statusFilter, vendorFilter, fromDate, toDate]);

  const refresh = useCallback(
    async (orderId?: string) => {
      await loadOrders();
      onChanged?.();
      if (orderId) {
        try {
          setDetail(await fetchDetail(orderId));
        } catch {
          setDetailOpen(false);
        }
      } else if (detailOpen && detail) {
        try {
          setDetail(await fetchDetail(detail.id));
        } catch {
          setDetailOpen(false);
        }
      }
    },
    [loadOrders, onChanged, fetchDetail, detailOpen, detail]
  );

  // ---- filtering & KPIs -----------------------------------------------------

  const filtered = useMemo(() => {
    return orders.filter((order) => {
      if (statusFilter === "open") {
        if (!OPEN_PO_STATUSES.includes(order.status)) return false;
      } else if (statusFilter !== "all" && order.status !== (statusFilter as PurchaseOrderStatus)) {
        return false;
      }
      if (vendorFilter !== "all" && order.supplier_id !== vendorFilter) return false;
      if (searchTerm.trim()) {
        const term = searchTerm.trim().toLowerCase();
        const haystack = `${order.po_number} ${order.supplier_name ?? ""}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      const day = order.created_at.slice(0, 10);
      if (fromDate && day < fromDate) return false;
      if (toDate && day > toDate) return false;
      return true;
    });
  }, [orders, statusFilter, vendorFilter, searchTerm, fromDate, toDate]);

  const pageRows = useMemo(
    () => filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [filtered, page]
  );

  const kpi = useMemo(() => {
    const today = isoToday();
    const monthPrefix = today.slice(0, 7);
    let open = 0;
    let waiting = 0;
    let overdue = 0;
    let monthValue = 0;
    for (const order of orders) {
      if (OPEN_PO_STATUSES.includes(order.status)) open += 1;
      if (order.status === "submitted") waiting += 1;
      if (
        (order.status === "approved" || order.status === "partially_received") &&
        order.expected_date &&
        order.expected_date < today
      ) {
        overdue += 1;
      }
      if (order.created_at.slice(0, 7) === monthPrefix) monthValue += Number(order.total_amount);
    }
    return { open, waiting, overdue, monthValue };
  }, [orders]);

  // ---- writes ---------------------------------------------------------------

  const persistDraft = async (
    draft: PurchaseOrderDraftValues,
    options: { submit: boolean },
    orderId: string | null
  ) => {
    const branchId =
      warehouses.find((warehouse) => warehouse.id === draft.destinationWarehouseId)?.branch_id ??
      user?.assigned_branch_id ??
      null;
    const timestamp = nowIso();

    await runTransaction(async (tx) => {
      // Guard and tax snapshot are read inside the transaction: a second tab may
      // have submitted the draft, while a later vendor edit must not retax it.
      const currentVendorRate = async () => {
        const selected = await tx.query<{ ppn_enabled: number }>(
          `SELECT ppn_enabled FROM suppliers WHERE id = $1`,
          [draft.supplierId]
        );
        if (!selected.rows[0]) throw new Error("Vendor tidak ditemukan. Muat ulang halaman.");
        return vendorPpnRate(selected.rows[0].ppn_enabled);
      };

      let ppnRate = vendorPpnRate(null);
      if (orderId) {
        const guarded = await tx.query<{ status: string; supplier_id: string | null; ppn_rate: number }>(
          `SELECT status, supplier_id, ppn_rate FROM purchase_orders WHERE id = $1`,
          [orderId]
        );
        const stored = guarded.rows[0];
        if (stored?.status !== "draft") {
          throw new Error("Hanya draf yang bisa diubah. Muat ulang halaman.");
        }
        ppnRate =
          stored.supplier_id === draft.supplierId
            ? normalizePpnRate(stored.ppn_rate)
            : await currentVendorRate();
      } else {
        ppnRate = await currentVendorRate();
      }

      const pricedLines = draft.items.map((line) => ({
        ...line,
        subtotal: lineSubtotal(line.quantity, line.unitCost),
      }));
      const amounts = procurementAmounts(pricedLines, ppnRate, { type: draft.discountType, value: draft.discountValue });
      const status: PurchaseOrderStatus = options.submit ? "submitted" : "draft";
      let targetId = orderId;

      if (targetId) {
        await tx.query(`DELETE FROM purchase_order_items WHERE purchase_order_id = $1`, [targetId]);
        await tx.query(
          `UPDATE purchase_orders
              SET supplier_id = $2, supplier_name = $3, branch_id = $4, warehouse_id = $5,
                  subtotal_amount = $6, ppn_rate = $7, ppn_amount = $8, total_amount = $9,
                  notes = $10, expected_date = $11, payment_terms_days = $12, status = $13,
                  submitted_by = COALESCE(submitted_by, $14),
                  submitted_at = COALESCE($15, submitted_at), updated_at = $15,
                  discount_type = $16, discount_value = $17, discount_amount = $18
            WHERE id = $1`,
          [
            targetId,
            draft.supplierId,
            draft.supplierName,
            branchId,
            draft.destinationWarehouseId,
            amounts.subtotal,
            amounts.ppnRate,
            amounts.ppnAmount,
            amounts.total,
            draft.notes || null,
            draft.expectedDate || null,
            draft.paymentTermsDays,
            status,
            options.submit ? user?.id ?? null : null,
            timestamp,
            amounts.discountType, amounts.discountValue, amounts.discountAmount,
          ]
        );
      } else {
        // Number allocated inside the write: a retry reuses it instead of
        // burning a second one.
        const poNumber = await nextDocumentNumber(tx, "PO");
        const inserted = await tx.query<{ id: string }>(
          `INSERT INTO purchase_orders
             (po_number, supplier_id, supplier_name, branch_id, warehouse_id, status,
              subtotal_amount, ppn_rate, ppn_amount, total_amount, notes, expected_date,
              payment_terms_days, created_by, submitted_by, submitted_at, created_at, updated_at,
              discount_type, discount_value, discount_amount)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                   CASE WHEN $6 = 'submitted' THEN $16 ELSE NULL END, $16, $16, $17, $18, $19)
           RETURNING id`,
          [
            poNumber,
            draft.supplierId,
            draft.supplierName,
            branchId,
            draft.destinationWarehouseId,
            status,
            amounts.subtotal,
            amounts.ppnRate,
            amounts.ppnAmount,
            amounts.total,
            draft.notes || null,
            draft.expectedDate || null,
            draft.paymentTermsDays,
            user?.id ?? null,
            options.submit ? user?.id ?? null : null,
            timestamp,
            amounts.discountType, amounts.discountValue, amounts.discountAmount,
          ]
        );
        targetId = inserted.rows[0].id;
      }

      for (const line of pricedLines) {
        await tx.query(
          `INSERT INTO purchase_order_items
             (purchase_order_id, product_id, variant_id, quantity, unit_name,
              conversion_factor, unit_cost, subtotal)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            targetId,
            line.productId,
            line.variantId ?? null,
            line.quantity,
            line.unitName,
            line.conversionFactor,
            line.unitCost,
            line.subtotal,
          ]
        );
      }

      await logAuditTx(tx, {
        action: options.submit ? "submit_po" : orderId ? "update" : "create_po",
        entity: "purchase_orders",
        entityId: targetId ?? undefined,
        details: {
          supplier: draft.supplierName,
          warehouseId: draft.destinationWarehouseId,
          itemsCount: draft.items.length,
          subtotalAmount: amounts.subtotal,
          discountType: amounts.discountType, discountValue: amounts.discountValue, discountAmount: amounts.discountAmount,
          ppnRate: amounts.ppnRate,
          ppnAmount: amounts.ppnAmount,
          totalAmount: amounts.total,
          status,
        },
        userId: user?.id,
      });
    });

    toast.success(
      options.submit ? "Purchase order diajukan untuk persetujuan" : "Draf purchase order disimpan"
    );
    await refresh();
  };

  const submitOrder = async (order: PurchaseOrderRow) => {
    setBusy(true);
    try {
      await runTransaction(async (tx) => {
        const lines = await tx.query<{ total: number }>(
          `SELECT COUNT(*) AS total FROM purchase_order_items WHERE purchase_order_id = $1`,
          [order.id]
        );
        if (Number(lines.rows[0]?.total ?? 0) === 0) {
          throw new Error("Tambahkan minimal 1 produk sebelum mengajukan");
        }
        const res = await tx.query(
          `UPDATE purchase_orders
              SET status = 'submitted', submitted_by = COALESCE(submitted_by, $2),
                  submitted_at = $3, updated_at = $3
            WHERE id = $1 AND status = 'draft'`,
          [order.id, user?.id ?? null, nowIso()]
        );
        if (res.rowCount === 0) throw new Error("Purchase order sudah berubah, muat ulang halaman");
        await logAuditTx(tx, {
          action: "submit_po",
          entity: "purchase_orders",
          entityId: order.id,
          details: { poNumber: order.po_number },
          userId: user?.id,
        });
      });
      toast.success(`${order.po_number} diajukan untuk persetujuan`);
      await refresh(order.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal mengajukan purchase order");
    } finally {
      setBusy(false);
    }
  };

  const approveOrder = async (order: PurchaseOrderRow) => {
    const refusal = checkApprovalRights({
      role: user?.role,
      actorId: user?.id,
      createdBy: order.created_by,
      can,
    });
    if (refusal) {
      toast.error(refusal);
      return;
    }

    setBusy(true);
    try {
      await runTransaction(async (tx) => {
        const res = await tx.query(
          `UPDATE purchase_orders
              SET status = 'approved', approved_by = $2, approved_at = $3, updated_at = $3
            WHERE id = $1 AND status = 'submitted'`,
          [order.id, user?.id ?? null, nowIso()]
        );
        if (res.rowCount === 0) throw new Error("Purchase order sudah berubah, muat ulang halaman");
        await logAuditTx(tx, {
          action: "approve_po",
          entity: "purchase_orders",
          entityId: order.id,
          details: { poNumber: order.po_number, totalAmount: Number(order.total_amount) },
          userId: user?.id,
        });
      });
      toast.success(`${order.po_number} disetujui`);
      await refresh(order.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menyetujui purchase order");
    } finally {
      setBusy(false);
    }
  };

  const rejectOrder = async (order: PurchaseOrderRow, reason: string) => {
    setBusy(true);
    try {
      await runTransaction(async (tx) => {
        const res = await tx.query(
          `UPDATE purchase_orders
              SET status = 'rejected', rejected_by = $2, rejected_at = $3,
                  rejection_reason = $4, updated_at = $3
            WHERE id = $1 AND status = 'submitted'`,
          [order.id, user?.id ?? null, nowIso(), reason]
        );
        if (res.rowCount === 0) throw new Error("Purchase order sudah berubah, muat ulang halaman");
        await logAuditTx(tx, {
          action: "reject_po",
          entity: "purchase_orders",
          entityId: order.id,
          details: { poNumber: order.po_number, reason },
          userId: user?.id,
        });
      });
      toast.success(`${order.po_number} ditolak`);
      await refresh(order.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menolak purchase order");
    } finally {
      setBusy(false);
    }
  };

  const cancelOrder = async (order: PurchaseOrderRow, reason: string) => {
    setBusy(true);
    try {
      await runTransaction(async (tx) => {
        // Nothing may have arrived: a PO with a receipt already owns a bill and
        // batches, and undoing that is a return-to-vendor, not a cancel.
        const received = await tx.query<{ total: number }>(
          `SELECT COALESCE(SUM(quantity_received), 0) AS total
             FROM purchase_order_items WHERE purchase_order_id = $1`,
          [order.id]
        );
        if (Number(received.rows[0]?.total ?? 0) > 0) {
          throw new Error("Barang sudah diterima sebagian. Batalkan lewat retur ke vendor.");
        }
        const res = await tx.query(
          `UPDATE purchase_orders
              SET status = 'cancelled', cancelled_by = $2, cancelled_at = $3,
                  cancel_reason = $4, updated_at = $3
            WHERE id = $1 AND status IN ('draft', 'submitted', 'approved')`,
          [order.id, user?.id ?? null, nowIso(), reason]
        );
        if (res.rowCount === 0) throw new Error("Purchase order sudah berubah, muat ulang halaman");
        await logAuditTx(tx, {
          action: "cancel_po",
          entity: "purchase_orders",
          entityId: order.id,
          details: { poNumber: order.po_number, reason },
          userId: user?.id,
        });
      });
      toast.success(`${order.po_number} dibatalkan`);
      await refresh(order.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal membatalkan purchase order");
    } finally {
      setBusy(false);
    }
  };

  const deleteOrder = async (order: PurchaseOrderRow) => {
    if (!window.confirm(`Hapus draf ${order.po_number}? Tindakan ini tidak bisa dibatalkan.`)) {
      return;
    }
    setBusy(true);
    try {
      await runTransaction(async (tx) => {
        const res = await tx.query(`DELETE FROM purchase_orders WHERE id = $1 AND status = 'draft'`, [
          order.id,
        ]);
        if (res.rowCount === 0) throw new Error("Hanya draf yang bisa dihapus");
        await tx.query(`DELETE FROM purchase_order_items WHERE purchase_order_id = $1`, [order.id]);
        await logAuditTx(tx, {
          action: "delete",
          entity: "purchase_orders",
          entityId: order.id,
          details: { poNumber: order.po_number },
          userId: user?.id,
        });
      });
      toast.success("Draf purchase order dihapus");
      setDetailOpen(false);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menghapus purchase order");
    } finally {
      setBusy(false);
    }
  };

  // ---- editor ---------------------------------------------------------------

  const openCreate = () => {
    setEditingId(null);
    setEditorDraft(null);
    setEditorOpen(true);
  };

  const openEdit = async (order: PurchaseOrderRow) => {
    try {
      const data = await fetchDetail(order.id);
      setEditingId(order.id);
      setEditorDraft({
        supplierId: data.supplier_id ?? "",
        supplierName: data.supplier_name ?? "",
        paymentTermsDays: data.payment_terms_days,
        destinationWarehouseId: data.warehouse_id ?? "",
        expectedDate: data.expected_date ?? "",
        notes: data.notes ?? "",
        items: data.lines.map((line) => ({
          productId: line.product_id,
          productName: line.product_name,
          sku: line.sku,
          variantId: line.variant_id ?? null,
          variantName: line.variant_name || undefined,
          quantity: line.quantity,
          unitName: line.unit_name ?? "Pcs",
          conversionFactor: Number(line.conversion_factor) || 1,
          unitCost: Number(line.unit_cost),
          subtotal: Number(line.subtotal),
        })),
        subtotalAmount: Number(data.subtotal_amount),
        discountType: data.discount_type ?? "none", discountValue: Number(data.discount_value ?? 0), discountAmount: Number(data.discount_amount ?? 0),
        ppnRate: normalizePpnRate(data.ppn_rate),
        ppnAmount: Number(data.ppn_amount),
        totalAmount: Number(data.total_amount),
      });
      setEditorOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memuat detail purchase order");
    }
  };

  const duplicateOrder = async (order: PurchaseOrderRow) => {
    try {
      const data = await fetchDetail(order.id);
      setEditingId(null);
      const currentPpnRate = vendorPpnRate(
        vendors.find((vendor) => vendor.id === data.supplier_id)?.ppn_enabled
      );
      const duplicateAmounts = procurementAmounts(
        data.lines.map((line) => ({ quantity: line.quantity, unitCost: Number(line.unit_cost) })),
        currentPpnRate, { type: data.discount_type ?? "none", value: Number(data.discount_value ?? 0) }
      );
      setEditorDraft({
        supplierId: data.supplier_id ?? "",
        supplierName: data.supplier_name ?? "",
        paymentTermsDays: data.payment_terms_days,
        destinationWarehouseId: data.warehouse_id ?? "",
        expectedDate: "",
        notes: data.notes ?? "",
        items: data.lines.map((line) => ({
          productId: line.product_id,
          productName: line.product_name,
          sku: line.sku,
          variantId: line.variant_id ?? null,
          variantName: line.variant_name || undefined,
          quantity: line.quantity,
          unitName: line.unit_name ?? "Pcs",
          conversionFactor: Number(line.conversion_factor) || 1,
          unitCost: Number(line.unit_cost),
          subtotal: Math.round(line.quantity * Number(line.unit_cost)),
        })),
        subtotalAmount: duplicateAmounts.subtotal,
        discountType: duplicateAmounts.discountType, discountValue: duplicateAmounts.discountValue, discountAmount: duplicateAmounts.discountAmount,
        ppnRate: duplicateAmounts.ppnRate,
        ppnAmount: duplicateAmounts.ppnAmount,
        totalAmount: duplicateAmounts.total,
      });
      setEditorOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menduplikat purchase order");
    }
  };

  // ---- receipt --------------------------------------------------------------

  const openReceipt = async (order: PurchaseOrderRow) => {
    try {
      // Read before the transaction opens: the policy decides whether an expiry
      // date is mandatory, and it must not cost a query inside the write.
      const [res, issueMethod, previous] = await Promise.all([
        query<ReceiptLineRow>(RECEIPT_LINES_SQL, [order.id]),
        getStockIssueMethod(),
        query<{ subtotal: number; discount: number; ppn: number }>(
          `SELECT COALESCE(SUM(subtotal_amount), 0) AS subtotal, COALESCE(SUM(discount_amount), 0) AS discount,
                  COALESCE(SUM(ppn_amount), 0) AS ppn FROM goods_receipts WHERE purchase_order_id = $1`, [order.id]),
      ]);
      setReceiptTarget({
        id: order.id,
        poNumber: order.po_number,
        vendorName: order.supplier_name ?? "Tanpa vendor",
        warehouseName: warehouseName(order.warehouse_id),
        requireExpiry: issueMethod === "fefo",
        ppnRate: normalizePpnRate(order.ppn_rate),
        amountContext: { poSubtotal: Number(order.subtotal_amount), poDiscountAmount: Number(order.discount_amount ?? 0),
          previousSubtotal: Number(previous.rows[0].subtotal), previousDiscount: Number(previous.rows[0].discount), previousPpn: Number(previous.rows[0].ppn) },
        lines: res.rows.map((row) => ({
          purchaseOrderItemId: row.purchase_order_item_id,
          productId: row.product_id,
          productName: row.product_name,
          sku: row.sku,
          ordered: Number(row.ordered),
          alreadyReceived: Number(row.already_received),
          previousValue: Number(row.previous_value),
          previousSubtotal: Number(row.previous_subtotal),
          unitName: row.unit_name,
          conversionFactor: Number(row.conversion_factor) || 1,
          unitCost: Number(row.unit_cost),
        })),
      });
      setReceiptOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memuat baris purchase order");
    }
  };

  const handleReceive = async (payload: GoodsReceiptPayload) => {
    if (!receiptTarget) return;
    const result = await runTransaction((tx) =>
      receivePurchaseOrder(tx, {
        purchaseOrderId: receiptTarget.id,
        lines: payload.lines,
        receivedOn: isoToday(),
        supplierDocument: payload.supplierDocument || null,
        notes: payload.notes || null,
        requireExpiry: receiptTarget.requireExpiry,
        userId: user?.id ?? null,
      })
    );
    toast.success(
      `Penerimaan ${result.grnNumber} tersimpan: ${result.linesReceived} baris, ${formatCurrency(
        result.totalAmount
      )}`
    );
    await refresh(receiptTarget.id);
  };

  // ---- shared action dispatch ----------------------------------------------

  const runAction = async (action: PurchaseOrderAction, order: PurchaseOrderRow) => {
    switch (action) {
      case "edit":
        await openEdit(order);
        break;
      case "submit":
        await submitOrder(order);
        break;
      case "approve":
        await approveOrder(order);
        break;
      case "reject":
      case "cancel":
        setReasonText("");
        setReasonDialog({ order, action });
        break;
      case "receive":
        await openReceipt(order);
        break;
      case "delete":
        await deleteOrder(order);
        break;
      case "duplicate":
        await duplicateOrder(order);
        break;
      case "view":
        await openDetail(order);
        break;
      default:
        break;
    }
  };

  const openDetailById = async (orderId: string) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      setDetail(await fetchDetail(orderId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memuat purchase order");
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const openDetail = async (order: PurchaseOrderRow) => openDetailById(order.id);

  const handlePrint = async (order: PurchaseOrderRow) => {
    if (busy || printPendingRef.current) return;
    printPendingRef.current = true;
    setPrintingId(order.id);
    try {
      // Read the current header and lines so another user's changes appear in the printout.
      const latest = await fetchDetail(order.id);
      printPurchaseOrder(purchaseOrderPrintInput(latest, warehouseName(latest.warehouse_id)), {
        onError: (error) => toast.error(error.message),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal membuka dokumen cetak");
    } finally {
      printPendingRef.current = false;
      setPrintingId(null);
    }
  };

  useEffect(() => {
    if (focusId) void openDetailById(focusId);
    // Only the requested id matters; re-running on every render would fight
    // the sheet's own open/close state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  const closeDetail = (open: boolean) => {
    setDetailOpen(open);
    if (open || !focusId) return;
    const next = new URLSearchParams(searchParams);
    next.delete("po");
    setSearchParams(next, { replace: true });
  };

  const confirmReason = async () => {
    if (!reasonDialog) return;
    const reason = reasonText.trim();
    if (!reason) {
      toast.error("Alasan wajib diisi");
      return;
    }
    const { order, action } = reasonDialog;
    setReasonDialog(null);
    if (action === "reject") await rejectOrder(order, reason);
    else await cancelOrder(order, reason);
  };

  const actionsFor = (order: PurchaseOrderRow) =>
    actionsForPurchaseOrder(order.status, can).filter((action) => action !== "view");

  /**
   * Exports what the filters currently show, not the whole table: the file has
   * to match the screen or the numbers cannot be reconciled afterwards.
   */
  const handleExport = () => {
    if (filtered.length === 0) {
      toast.error("Tidak ada purchase order untuk diexport");
      return;
    }

    const rows = filtered.map((order) => ({
      "No. PO": order.po_number,
      Vendor: order.supplier_name ?? "-",
      Tujuan: warehouseName(order.warehouse_id),
      Tanggal: order.created_at.slice(0, 10),
      Diharapkan: order.expected_date ?? "-",
      Status: PO_STATUS_LABEL[order.status],
      Subtotal: Number(order.subtotal_amount),
      "Jenis Diskon": order.discount_type,
      "Nilai Diskon": Number(order.discount_value),
      "Diskon (Rp)": Number(order.discount_amount),
      "DPP": Number(order.subtotal_amount) - Number(order.discount_amount),
      "PPN (%)": Number(order.ppn_rate),
      "Nilai PPN": Number(order.ppn_amount),
      "Total Pembayaran": Number(order.total_amount),
      Diterima: effectiveReceivedAmount(order),
      "Diajukan Oleh": order.submitted_by_name ?? "-",
      "Disetujui Oleh": order.approved_by_name ?? "-",
    }));

    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet["!cols"] = [
      { wch: 22 },
      { wch: 24 },
      { wch: 22 },
      { wch: 12 },
      { wch: 12 },
      { wch: 20 },
      { wch: 16 },
      { wch: 16 },
      { wch: 14 },
      { wch: 16 },
      { wch: 16 },
      { wch: 10 },
      { wch: 16 },
      { wch: 18 },
      { wch: 16 },
      { wch: 20 },
      { wch: 20 },
    ];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Purchase Order");
    XLSX.writeFile(book, `Purchase_Order_${new Date().toISOString().split("T")[0]}.xlsx`);
    toast.success("Berhasil export purchase order");
  };

  // ---- render ---------------------------------------------------------------

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-lg border p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <ClipboardList className="w-4 h-4" /> PO terbuka
          </div>
          <p className="text-2xl font-bold mt-1">{kpi.open}</p>
        </div>
        <div className="rounded-lg border p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <Clock className="w-4 h-4" /> Menunggu persetujuan
          </div>
          <p className="text-2xl font-bold mt-1">{kpi.waiting}</p>
        </div>
        <div className="rounded-lg border p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <AlertTriangle className="w-4 h-4" /> Terlambat
          </div>
          <p className="text-2xl font-bold mt-1 text-warning">{kpi.overdue}</p>
        </div>
        <div className="rounded-lg border p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <Wallet className="w-4 h-4" /> Nilai bulan ini
          </div>
          <p className="text-lg font-bold mt-1">{formatCurrency(kpi.monthValue)}</p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Cari nomor PO atau vendor..."
            className="pl-9"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full lg:w-[190px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua status</SelectItem>
            <SelectItem value="open">Perlu tindakan</SelectItem>
            {PURCHASE_ORDER_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {PO_STATUS_LABEL[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={vendorFilter} onValueChange={setVendorFilter}>
          <SelectTrigger className="w-full lg:w-[190px]">
            <SelectValue placeholder="Vendor" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua vendor</SelectItem>
            {vendors.map((vendor) => (
              <SelectItem key={vendor.id} value={vendor.id}>
                {vendor.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          className="w-full lg:w-[150px]"
          value={fromDate}
          onChange={(event) => setFromDate(event.target.value)}
        />
        <Input
          type="date"
          className="w-full lg:w-[150px]"
          value={toDate}
          onChange={(event) => setToDate(event.target.value)}
        />
        <PermissionGate permission="export_reports">
          <Button variant="outline" size="icon" onClick={handleExport} title="Export ke Excel">
            <Download className="w-4 h-4" />
          </Button>
        </PermissionGate>
        <Button variant="outline" size="icon" onClick={() => loadOrders()} title="Muat ulang">
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
        </Button>
        {can("create_po") && (
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4 mr-2" />
            Buat PO
          </Button>
        )}
      </div>

      <div className="border rounded-lg overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>No. PO</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>Tanggal</TableHead>
              <TableHead>Diharapkan</TableHead>
              <TableHead>Tujuan</TableHead>
              <TableHead className="text-right">Nilai PO</TableHead>
              <TableHead className="text-right">Diterima</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && orders.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="w-4 h-4 mr-2 inline animate-spin" />
                  Memuat purchase order...
                </TableCell>
              </TableRow>
            )}
            {!loading && pageRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  Tidak ada purchase order pada filter ini
                </TableCell>
              </TableRow>
            )}
            {pageRows.map((order) => {
              const actions = actionsFor(order);
              return (
                <TableRow key={order.id}>
                  <TableCell>
                    <button
                      type="button"
                      className="font-medium text-primary hover:underline"
                      onClick={() => openDetail(order)}
                    >
                      {order.po_number}
                    </button>
                  </TableCell>
                  <TableCell>{order.supplier_name ?? "-"}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {order.created_at.slice(0, 10)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{order.expected_date ?? "-"}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {warehouseName(order.warehouse_id)}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {formatCurrency(Number(order.total_amount))}
                    {Number(order.discount_amount) > 0 && <p className="text-xs text-muted-foreground">Diskon {formatCurrency(Number(order.discount_amount))}</p>}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap text-muted-foreground">
                    {formatCurrency(effectiveReceivedAmount(order))}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium whitespace-nowrap",
                        PO_STATUS_TONE[order.status]
                      )}
                    >
                      {PO_STATUS_LABEL[order.status]}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        className="h-7 w-7"
                        title="Cetak / Simpan PDF"
                        aria-label={`Cetak ${order.po_number}`}
                        disabled={busy || printingId !== null}
                        onClick={() => void handlePrint(order)}
                      >
                        {printingId === order.id
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <Printer className="h-4 w-4" />}
                      </Button>
                      {actions.map((action) => (
                        <Button
                          key={action}
                          size="sm"
                          variant={
                            action === "delete" || action === "reject" || action === "cancel"
                              ? "outline"
                              : "secondary"
                          }
                          className={cn(
                            "h-7 px-2 text-xs",
                            (action === "delete" || action === "reject" || action === "cancel") &&
                              "text-destructive"
                          )}
                          disabled={busy}
                          onClick={() => runAction(action, order)}
                        >
                          {PO_ACTION_LABEL[action]}
                        </Button>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <PaginationBar
          page={page}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          onPageChange={setPage}
          label="purchase order"
        />
      </div>

      <PurchaseOrderModal
        open={editorOpen}
        onOpenChange={setEditorOpen}
        products={products}
        warehouses={visibleWarehouses}
        vendors={vendors}
        defaultWarehouseId={defaultWarehouseId}
        initialDraft={editorDraft}
        onSubmit={(draft, options) => persistDraft(draft, options, editingId)}
      />

      <GoodsReceiptModal
        open={receiptOpen}
        onOpenChange={setReceiptOpen}
        poNumber={receiptTarget?.poNumber ?? ""}
        vendorName={receiptTarget?.vendorName ?? ""}
        warehouseName={receiptTarget?.warehouseName ?? ""}
        lines={receiptTarget?.lines ?? []}
        requireExpiry={receiptTarget?.requireExpiry ?? false}
        ppnRate={receiptTarget?.ppnRate ?? 0}
        amountContext={receiptTarget?.amountContext}
        onSubmit={handleReceive}
      />

      <PurchaseOrderDetail
        open={detailOpen}
        onOpenChange={closeDetail}
        order={detail}
        loading={detailLoading}
        warehouseName={warehouseName}
        actions={detail ? actionsForPurchaseOrder(detail.status, can) : []}
        onAction={(action) => {
          if (detail) void runAction(action, detail);
        }}
      />

      <Dialog open={reasonDialog !== null} onOpenChange={(open) => !open && setReasonDialog(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>
              {reasonDialog?.action === "reject" ? "Tolak purchase order" : "Batalkan purchase order"}
            </DialogTitle>
            <DialogDescription>
              {reasonDialog?.order.po_number} — alasan ini tersimpan di riwayat PO.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>Alasan *</Label>
            <Textarea
              autoFocus
              value={reasonText}
              placeholder={
                reasonDialog?.action === "reject"
                  ? "Contoh: harga di atas penawaran vendor lain"
                  : "Contoh: kebutuhan batal, stok masih cukup"
              }
              onChange={(event) => setReasonText(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReasonDialog(null)}>
              Batal
            </Button>
            <Button variant="destructive" onClick={confirmReason} disabled={busy}>
              {reasonDialog?.action === "reject" ? "Tolak" : "Batalkan PO"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
