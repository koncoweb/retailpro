/**
 * Back-office view of every online order that landed in this tenant's database.
 *
 * Reads come from `query()` against the tenant's own `storefront_orders` table
 * (the same path the dashboard and transaction pages use). Writes — confirming
 * payment, advancing the status, cancelling — go through the authenticated
 * server endpoints so the multi-query transaction (stock deduction, bon
 * creation, audit row) stays trustworthy.
 */
import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  Package,
  Truck,
  X,
  XCircle,
  Eye,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { toast } from "@/hooks/use-toast";
import { query } from "@/lib/db";
import { BackOfficeLayout } from "@/components/layout/BackOfficeLayout";

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

interface StorefrontOrder {
  id: string;
  parent_id: string;
  invoice_number: string;
  shop_name: string | null;
  customer_name: string;
  customer_phone: string;
  customer_address: string | null;
  fulfillment: string;
  slot: string | null;
  notes: string | null;
  payment_channel: string | null;
  payment_bank_id: string | null;
  items: string;
  subtotal: number;
  shipping: number;
  total: number;
  status: string;
  cancel_reason: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  transaction_id: string | null;
  created_at: string;
}

interface SnapshotItem {
  product_id: string;
  variant_id: string | null;
  unit_name: string;
  conversion_factor: number;
  qty: number;
  unit_price: number;
}

const STATUS_OPTIONS = [
  { value: "all", label: "Semua Status" },
  { value: "pending_payment", label: "Menunggu Pembayaran" },
  { value: "confirmed", label: "Dikonfirmasi" },
  { value: "packing", label: "Dikemas" },
  { value: "shipped", label: "Dikirim" },
  { value: "done", label: "Selesai" },
  { value: "cancelled", label: "Dibatalkan" },
];

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending_payment: { label: "Menunggu Bayar", variant: "outline" },
  confirmed: { label: "Dikonfirmasi", variant: "default" },
  packing: { label: "Dikemas", variant: "secondary" },
  shipped: { label: "Dikirim", variant: "secondary" },
  done: { label: "Selesai", variant: "default" },
  cancelled: { label: "Dibatalkan", variant: "destructive" },
  void: { label: "Dibatalkan", variant: "destructive" },
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(value);
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export default function StorefrontOrders() {
  const [orders, setOrders] = useState<StorefrontOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedOrder, setSelectedOrder] = useState<StorefrontOrder | null>(null);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const statusClause = statusFilter === "all" ? "" : ` AND status = $1`;
      const params = statusFilter === "all" ? [] : [statusFilter];
      const res = await query<StorefrontOrder>(
        `SELECT * FROM storefront_orders WHERE 1=1${statusClause} ORDER BY created_at DESC LIMIT 100`,
        params
      );
      setOrders(res.rows as StorefrontOrder[]);
    } catch (error) {
      console.error("Failed to fetch storefront orders:", error);
      toast({ title: "Gagal memuat pesanan", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  async function handleConfirm(orderId: string) {
    setActionLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/tenant/orders/confirm`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      toast({ title: "Pembayaran dikonfirmasi" });
      fetchOrders();
      if (selectedOrder?.id === orderId) {
        setSelectedOrder(null);
      }
    } catch (error) {
      toast({
        title: "Gagal konfirmasi",
        description: error instanceof Error ? error.message : "Coba lagi",
        variant: "destructive",
      });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleTransition(orderId: string, target: string) {
    setActionLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/tenant/orders/status`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, status: target, reason: null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      toast({ title: `Status diubah ke ${target}` });
      fetchOrders();
    } catch (error) {
      toast({
        title: "Gagal mengubah status",
        description: error instanceof Error ? error.message : "Coba lagi",
        variant: "destructive",
      });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCancel() {
    if (!selectedOrder) return;
    if (cancelReason.trim().length < 3) {
      toast({ title: "Alasan pembatalan wajib diisi (min 3 karakter)", variant: "destructive" });
      return;
    }
    setActionLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/tenant/orders/status`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: selectedOrder.id, status: "cancel", reason: cancelReason.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
      toast({ title: "Pesanan dibatalkan" });
      setCancelDialogOpen(false);
      setCancelReason("");
      setSelectedOrder(null);
      fetchOrders();
    } catch (error) {
      toast({
        title: "Gagal membatalkan",
        description: error instanceof Error ? error.message : "Coba lagi",
        variant: "destructive",
      });
    } finally {
      setActionLoading(false);
    }
  }

  function parseItems(raw: string): SnapshotItem[] {
    try {
      return JSON.parse(raw) as SnapshotItem[];
    } catch {
      return [];
    }
  }

  return (
    <BackOfficeLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold">Pesanan Toko Online</h1>
            <p className="text-muted-foreground mt-1">
              Kelola pesanan dari toko online: konfirmasi pembayaran, kirim, atau batalkan.
            </p>
          </div>
          <div className="flex gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Filter status" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={fetchOrders} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* Table */}
        <div className="bg-card rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Pemesan</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tanggal</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && orders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto" />
                  </TableCell>
                </TableRow>
              ) : orders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                    Tidak ada pesanan online.
                  </TableCell>
                </TableRow>
              ) : (
                orders.map((order) => {
                  const badge = STATUS_BADGE[order.status] ?? { label: order.status, variant: "outline" as const };
                  return (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">{order.invoice_number}</TableCell>
                      <TableCell>
                        <p className="text-sm">{order.customer_name}</p>
                        <p className="text-xs text-muted-foreground">{order.customer_phone}</p>
                      </TableCell>
                      <TableCell className="text-sm">
                        {order.payment_channel === "transfer"
                          ? `Transfer${order.payment_bank_id ? ` (${order.payment_bank_id})` : ""}`
                          : order.payment_channel === "qris"
                          ? "QRIS"
                          : order.payment_channel === "cash"
                          ? "Tunai"
                          : order.payment_channel ?? "—"}
                      </TableCell>
                      <TableCell className="tabular-nums">{formatCurrency(order.total)}</TableCell>
                      <TableCell>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(order.created_at).toLocaleDateString("id-ID")}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => setSelectedOrder(order)}>
                            <Eye className="w-4 h-4" />
                          </Button>
                          {order.status === "pending_payment" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleConfirm(order.id)}
                              disabled={actionLoading}
                              title="Konfirmasi Pembayaran"
                            >
                              <CheckCircle2 className="w-4 h-4 text-green-600" />
                            </Button>
                          )}
                          {order.status === "confirmed" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleTransition(order.id, "packing")}
                              disabled={actionLoading}
                              title="Kemas"
                            >
                              <Package className="w-4 h-4 text-blue-600" />
                            </Button>
                          )}
                          {order.status === "packing" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleTransition(order.id, "shipped")}
                              disabled={actionLoading}
                              title="Kirim"
                            >
                              <Truck className="w-4 h-4 text-orange-600" />
                            </Button>
                          )}
                          {order.status === "shipped" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleTransition(order.id, "done")}
                              disabled={actionLoading}
                              title="Selesai"
                            >
                              <CheckCircle2 className="w-4 h-4 text-green-600" />
                            </Button>
                          )}
                          {(order.status === "pending_payment" || order.status === "confirmed") && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setSelectedOrder(order);
                                setCancelDialogOpen(true);
                              }}
                              title="Batalkan"
                            >
                              <XCircle className="w-4 h-4 text-red-600" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Detail Dialog */}
      <Dialog open={!!selectedOrder && !cancelDialogOpen} onOpenChange={(open) => !open && setSelectedOrder(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {selectedOrder && (
            <>
              <DialogHeader>
                <DialogTitle>Detail Pesanan {selectedOrder.invoice_number}</DialogTitle>
                <DialogDescription>
                  {selectedOrder.customer_name} · {selectedOrder.customer_phone}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <Label>Status</Label>
                    <p>
                      <Badge variant={STATUS_BADGE[selectedOrder.status]?.variant ?? "outline"}>
                        {STATUS_BADGE[selectedOrder.status]?.label ?? selectedOrder.status}
                      </Badge>
                    </p>
                  </div>
                  <div>
                    <Label>Pembayaran</Label>
                    <p>
                      {selectedOrder.payment_channel === "transfer"
                        ? `Transfer${selectedOrder.payment_bank_id ? ` (${selectedOrder.payment_bank_id})` : ""}`
                        : selectedOrder.payment_channel === "qris"
                        ? "QRIS"
                        : selectedOrder.payment_channel === "cash"
                        ? "Tunai"
                        : selectedOrder.payment_channel ?? "—"}
                    </p>
                  </div>
                  <div>
                    <Label>Pengiriman</Label>
                    <p>{selectedOrder.fulfillment === "delivery" ? "Diantar" : "Ambil sendiri"}</p>
                  </div>
                  <div>
                    <Label>Slot</Label>
                    <p>{selectedOrder.slot ?? "—"}</p>
                  </div>
                  <div className="col-span-2">
                    <Label>Alamat</Label>
                    <p>{selectedOrder.customer_address ?? "—"}</p>
                  </div>
                  {selectedOrder.notes && (
                    <div className="col-span-2">
                      <Label>Catatan</Label>
                      <p>{selectedOrder.notes}</p>
                    </div>
                  )}
                </div>

                <div>
                  <Label>Item Pesanan</Label>
                  <Table className="mt-2">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Produk</TableHead>
                        <TableHead>Satuan</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Harga</TableHead>
                        <TableHead className="text-right">Subtotal</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parseItems(selectedOrder.items).map((item, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="text-sm">{item.product_id}</TableCell>
                          <TableCell className="text-sm">{item.unit_name}</TableCell>
                          <TableCell className="text-right tabular-nums">{item.qty}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatCurrency(item.unit_price)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(item.qty * item.unit_price)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex justify-between text-sm border-t pt-2">
                  <span>Subtotal</span>
                  <span className="tabular-nums">{formatCurrency(selectedOrder.subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Ongkir</span>
                  <span className="tabular-nums">{formatCurrency(selectedOrder.shipping)}</span>
                </div>
                <div className="flex justify-between font-medium border-t pt-2">
                  <span>Total</span>
                  <span className="tabular-nums">{formatCurrency(selectedOrder.total)}</span>
                </div>

                {selectedOrder.cancel_reason && (
                  <div className="bg-destructive/10 rounded-md p-3 text-sm text-destructive">
                    <Label>Alasan Pembatalan</Label>
                    <p>{selectedOrder.cancel_reason}</p>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setSelectedOrder(null)}>
                  Tutup
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Cancel Dialog */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Batalkan Pesanan</DialogTitle>
            <DialogDescription>
              Pembatalan pesanan yang sudah dikonfirmasi akan mengembalikan stok dan memvoid transaksi.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="cancel-reason">Alasan Pembatalan (wajib)</Label>
              <Input
                id="cancel-reason"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Minimal 3 karakter"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelDialogOpen(false)}>
              Batal
            </Button>
            <Button variant="destructive" onClick={handleCancel} disabled={actionLoading}>
              {actionLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Konfirmasi Batalkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BackOfficeLayout>
  );
}
