import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, ClipboardList, Clock, Truck, XCircle } from "lucide-react";
import {
  STOCK_REQUEST_PRIORITY_LABEL,
  STOCK_REQUEST_STATUS_LABEL,
  canPerform,
  summarizeOrder,
  type StockRequestStatus,
} from "@/lib/branch-orders";
import type { UserRole } from "@/types";

export interface OrderDetailLine {
  id: string;
  product_id: string;
  product_name: string;
  sku: string;
  unit_name: string | null;
  conversion_factor: number;
  quantity_requested: number;
  quantity_approved: number;
  quantity_dispatched: number;
  quantity_received: number;
}

export interface OrderDetail {
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
  items: OrderDetailLine[];
}

interface BranchOrderDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: OrderDetail | null;
  /** Current user's role; decides which buttons render. */
  role: UserRole | null | undefined;
  onApprove: (approved: Record<string, number>) => void;
  onReject: (reason: string) => void;
  onDispatch: () => void;
  onReceive: (received: Record<string, number>) => void;
  onCancel: () => void;
  busy?: boolean;
}

const STATUS_BADGE: Record<StockRequestStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-warning/20 text-warning",
  approved: "bg-info/20 text-info",
  rejected: "bg-destructive/20 text-destructive",
  in_transit: "bg-primary/20 text-primary",
  received: "bg-success/20 text-success",
  cancelled: "bg-muted text-muted-foreground",
};

function formatWhen(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function BranchOrderDetailModal({
  open,
  onOpenChange,
  order,
  role,
  onApprove,
  onReject,
  onDispatch,
  onReceive,
  onCancel,
  busy,
}: BranchOrderDetailModalProps) {
  const [approved, setApproved] = useState<Record<string, number>>({});
  const [received, setReceived] = useState<Record<string, number>>({});
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);

  /** Every opening starts from what the document says, not from a stale edit. */
  useEffect(() => {
    if (!open || !order) return;
    setApproved(
      Object.fromEntries(
        order.items.map((item) => [
          item.id,
          Number(item.quantity_approved || item.quantity_requested),
        ])
      )
    );
    setReceived(
      Object.fromEntries(
        order.items.map((item) => [item.id, Number(item.quantity_dispatched || 0)])
      )
    );
    setRejectReason("");
    setShowReject(false);
  }, [open, order]);

  if (!order) return null;

  const summary = summarizeOrder(order.items);
  const canApprove = canPerform(role, order.status, "approve");
  const canReject = canPerform(role, order.status, "reject");
  const canDispatch = canPerform(role, order.status, "dispatch");
  const canReceive = canPerform(role, order.status, "receive");
  const canCancel = canPerform(role, order.status, "cancel");

  const timeline = [
    { label: "Dibuat", who: order.requested_by_name, when: order.created_at },
    { label: "Disetujui", who: order.approved_by_name, when: order.approved_at },
    { label: "Dikirim", who: order.dispatched_by_name, when: order.dispatched_at },
    { label: "Diterima", who: order.received_by_name, when: order.received_at },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <ClipboardList className="w-5 h-5" />
            {order.request_number}
            <Badge className={STATUS_BADGE[order.status]}>
              {STOCK_REQUEST_STATUS_LABEL[order.status]}
            </Badge>
            {order.priority === "urgent" && <Badge variant="destructive">Mendesak</Badge>}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            {order.branch_name ?? "Cabang"} <ArrowRight className="w-3 h-3" />
            {order.warehouse_name ?? "Gudang pusat"}
            {order.needed_date && (
              <span className="text-muted-foreground">
                · dibutuhkan {new Date(order.needed_date).toLocaleDateString("id-ID")}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Timeline */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {timeline.map((step) => (
              <div
                key={step.label}
                className={`rounded-lg border p-3 ${step.when ? "bg-card" : "bg-muted/40 opacity-70"}`}
              >
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {step.label}
                </p>
                <p className="text-sm font-medium mt-1">{formatWhen(step.when)}</p>
                <p className="text-xs text-muted-foreground">{step.who ?? "—"}</p>
              </div>
            ))}
          </div>

          {order.notes && (
            <div className="rounded-lg border p-3 text-sm">
              <span className="text-muted-foreground">Catatan cabang: </span>
              {order.notes}
            </div>
          )}

          {order.rejection_reason && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <span className="font-medium text-destructive">Alasan ditolak: </span>
              {order.rejection_reason}
            </div>
          )}

          {order.transfer_number && (
            <div className="rounded-lg border p-3 text-sm flex items-center gap-2">
              <Truck className="w-4 h-4 text-muted-foreground" />
              Transfer stok:{" "}
              <Link
                to="/backoffice/branches/transfer"
                className="font-mono font-medium underline underline-offset-2"
              >
                {order.transfer_number}
              </Link>
            </div>
          )}

          {/* Lines */}
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produk</TableHead>
                  <TableHead className="text-center">Diminta</TableHead>
                  <TableHead className="text-center">Disetujui</TableHead>
                  <TableHead className="text-center">Dikirim</TableHead>
                  <TableHead className="text-center">Diterima</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <p className="font-medium">{item.product_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.sku}
                        {item.unit_name ? ` · ${item.unit_name}` : ""}
                      </p>
                    </TableCell>
                    <TableCell className="text-center">{item.quantity_requested}</TableCell>
                    <TableCell className="text-center">
                      {canApprove ? (
                        <Input
                          type="number"
                          min={0}
                          max={item.quantity_requested}
                          className="w-20 mx-auto text-center"
                          value={approved[item.id] ?? 0}
                          onChange={(event) =>
                            setApproved((prev) => ({
                              ...prev,
                              [item.id]: Number(event.target.value),
                            }))
                          }
                        />
                      ) : (
                        item.quantity_approved
                      )}
                    </TableCell>
                    <TableCell className="text-center">{item.quantity_dispatched}</TableCell>
                    <TableCell className="text-center">
                      {canReceive ? (
                        <Input
                          type="number"
                          min={0}
                          max={item.quantity_dispatched}
                          className="w-20 mx-auto text-center"
                          value={received[item.id] ?? 0}
                          onChange={(event) =>
                            setReceived((prev) => ({
                              ...prev,
                              [item.id]: Number(event.target.value),
                            }))
                          }
                        />
                      ) : (
                        item.quantity_received
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/50">
                  <TableCell className="font-semibold">Total (unit dasar)</TableCell>
                  <TableCell className="text-center font-semibold">{summary.requested}</TableCell>
                  <TableCell className="text-center font-semibold">{summary.approved}</TableCell>
                  <TableCell className="text-center font-semibold">{summary.dispatched}</TableCell>
                  <TableCell className="text-center font-semibold">{summary.received}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          {showReject && (
            <div className="space-y-2">
              <Label>Alasan penolakan *</Label>
              <Textarea
                placeholder="Mis. stok gudang habis sampai kiriman vendor datang"
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Tutup
          </Button>
          {canCancel && (
            <Button variant="outline" className="gap-1 text-destructive" disabled={busy} onClick={onCancel}>
              <XCircle className="w-4 h-4" />
              Batalkan
            </Button>
          )}
          {canReject && !showReject && (
            <Button variant="outline" className="gap-1" disabled={busy} onClick={() => setShowReject(true)}>
              <XCircle className="w-4 h-4" />
              Tolak
            </Button>
          )}
          {canReject && showReject && (
            <Button
              variant="destructive"
              className="gap-1"
              disabled={busy || rejectReason.trim().length === 0}
              onClick={() => onReject(rejectReason.trim())}
            >
              Kirim Penolakan
            </Button>
          )}
          {canApprove && (
            <Button className="gap-1" disabled={busy} onClick={() => onApprove(approved)}>
              <CheckCircle2 className="w-4 h-4" />
              Setujui
            </Button>
          )}
          {canDispatch && (
            <Button className="gap-1" disabled={busy} onClick={onDispatch}>
              <Clock className="w-4 h-4" />
              Siapkan &amp; Kirim
            </Button>
          )}
          {canReceive && (
            <Button className="gap-1" disabled={busy} onClick={() => onReceive(received)}>
              <CheckCircle2 className="w-4 h-4" />
              Terima Barang
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
