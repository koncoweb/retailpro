import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, ShoppingCart } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/formatters";
import {
  PO_ACTION_LABEL,
  PO_STATUS_LABEL,
  PO_STATUS_TONE,
  remainingQuantity,
  type PurchaseOrderAction,
  type PurchaseOrderStatus,
} from "@/lib/procurement";

/** One row of `purchase_orders` plus the receipt total the list shows. */
export interface PurchaseOrderRow {
  id: string;
  po_number: string;
  status: PurchaseOrderStatus;
  supplier_id: string | null;
  supplier_name: string | null;
  branch_id: string | null;
  warehouse_id: string | null;
  total_amount: number;
  expected_date: string | null;
  created_at: string;
  received_at: string | null;
  notes: string | null;
  payment_terms_days: number;
  created_by: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  cancel_reason: string | null;
  /** `SUM(goods_receipts.total_amount)` — what has actually arrived. */
  received_amount: number;
  receipt_count: number;
}

export interface PurchaseOrderLine {
  id: string;
  product_id: string;
  product_name: string;
  sku: string;
  quantity: number;
  quantity_received: number;
  unit_name: string | null;
  conversion_factor: number;
  unit_cost: number;
  subtotal: number;
}

export interface PurchaseOrderReceipt {
  id: string;
  grn_number: string;
  received_at: string;
  total_amount: number;
  supplier_document: string | null;
  line_count: number;
}

export interface PurchaseOrderDetailData extends PurchaseOrderRow {
  lines: PurchaseOrderLine[];
  receipts: PurchaseOrderReceipt[];
}

interface PurchaseOrderDetailProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: PurchaseOrderDetailData | null;
  loading: boolean;
  /** Resolves a warehouse id to its label; historical rows may point at a closed location. */
  warehouseName: (id: string | null) => string;
  /** Actions currently permitted for the order, in display order. */
  actions: PurchaseOrderAction[];
  onAction: (action: PurchaseOrderAction) => void;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10);
  return parsed.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

function quantity(value: number): string {
  return Number(Number(value ?? 0).toFixed(3)).toLocaleString("id-ID");
}

/**
 * Read-only view of one purchase order: what was asked for, what has arrived and
 * which deliveries carried it.
 *
 * No writes happen here — every button hands the action back to the panel, which
 * owns the transaction and the audit entry.
 */
export function PurchaseOrderDetail({
  open,
  onOpenChange,
  order,
  loading,
  warehouseName,
  actions,
  onAction,
}: PurchaseOrderDetailProps) {
  const footerActions = actions.filter((action) => action !== "view");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5" />
            {order ? order.po_number : "Purchase Order"}
          </DialogTitle>
          <DialogDescription>
            {order ? `${order.supplier_name ?? "Tanpa vendor"} · ${warehouseName(order.warehouse_id)}` : ""}
          </DialogDescription>
        </DialogHeader>

        {loading || !order ? (
          <div className="py-12 flex items-center justify-center text-muted-foreground">
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            Memuat purchase order...
          </div>
        ) : (
          <div className="space-y-5 py-2">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium",
                  PO_STATUS_TONE[order.status]
                )}
              >
                {PO_STATUS_LABEL[order.status]}
              </span>
              <span className="text-sm text-muted-foreground">
                Dibuat {formatDate(order.created_at)}
                {order.approved_at ? ` · disetujui ${formatDate(order.approved_at)}` : ""}
                {order.received_at ? ` · diterima ${formatDate(order.received_at)}` : ""}
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Nilai PO</p>
                <p className="font-semibold">{formatCurrency(Number(order.total_amount))}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Sudah diterima</p>
                <p className="font-semibold">{formatCurrency(Number(order.received_amount))}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Diharapkan</p>
                <p className="font-semibold">{order.expected_date ?? "-"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Termin</p>
                <p className="font-semibold">{Number(order.payment_terms_days)} hari</p>
              </div>
            </div>

            {order.rejection_reason && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">
                <strong>Alasan penolakan:</strong> {order.rejection_reason}
              </div>
            )}
            {order.cancel_reason && (
              <div className="rounded-md border bg-muted p-3 text-sm">
                <strong>Alasan pembatalan:</strong> {order.cancel_reason}
              </div>
            )}
            {order.notes && (
              <div className="rounded-md border p-3 text-sm">
                <p className="text-muted-foreground mb-1">Catatan</p>
                {order.notes}
              </div>
            )}

            <div className="border rounded-lg overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produk</TableHead>
                    <TableHead className="text-right">Dipesan</TableHead>
                    <TableHead className="text-right">Diterima</TableHead>
                    <TableHead className="text-right">Sisa</TableHead>
                    <TableHead className="text-right">Harga</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.lines.map((line) => {
                    const remaining = remainingQuantity({
                      quantity: line.quantity,
                      quantity_received: line.quantity_received,
                    });
                    return (
                      <TableRow key={line.id}>
                        <TableCell>
                          <p className="font-medium">{line.product_name}</p>
                          <p className="text-xs text-muted-foreground">{line.sku}</p>
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {quantity(line.quantity)} {line.unit_name ?? ""}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {quantity(line.quantity_received)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right whitespace-nowrap",
                            remaining > 0 ? "text-warning" : "text-muted-foreground"
                          )}
                        >
                          {quantity(remaining)}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {formatCurrency(Number(line.unit_cost))}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap font-medium">
                          {formatCurrency(Number(line.subtotal))}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {order.lines.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-6 text-muted-foreground">
                        Belum ada baris produk
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            <div>
              <p className="text-sm font-medium mb-2">Penerimaan barang</p>
              {order.receipts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Belum ada barang yang diterima untuk PO ini.
                </p>
              ) : (
                <div className="border rounded-lg overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>No. Penerimaan</TableHead>
                        <TableHead>Tanggal</TableHead>
                        <TableHead>Dok. Vendor</TableHead>
                        <TableHead className="text-right">Baris</TableHead>
                        <TableHead className="text-right">Nilai</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {order.receipts.map((receipt) => (
                        <TableRow key={receipt.id}>
                          <TableCell className="font-medium">{receipt.grn_number}</TableCell>
                          <TableCell>{formatDate(receipt.received_at)}</TableCell>
                          <TableCell>{receipt.supplier_document ?? "-"}</TableCell>
                          <TableCell className="text-right">{Number(receipt.line_count)}</TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(Number(receipt.total_amount))}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Tutup
          </Button>
          {order &&
            footerActions.map((action) => (
              <Button
                key={action}
                variant={action === "delete" || action === "reject" || action === "cancel" ? "destructive" : "default"}
                onClick={() => onAction(action)}
              >
                {PO_ACTION_LABEL[action]}
              </Button>
            ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
