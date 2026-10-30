import { useEffect, useMemo, useState } from "react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { AlertTriangle, Loader2, PackageCheck } from "lucide-react";
import { isoToday, validateReceipt, type ReceiptLineInput } from "@/lib/procurement";

/** One order line as the delivery desk sees it. */
export interface ReceiptLineSource {
  purchaseOrderItemId: string;
  productId: string;
  productName: string;
  sku: string;
  /** Ordered quantity, in `unitName`. */
  ordered: number;
  alreadyReceived: number;
  unitName: string;
  conversionFactor: number;
  /** Agreed price; the line starts here but the operator may correct it. */
  unitCost: number;
}

export interface GoodsReceiptPayload {
  lines: {
    purchaseOrderItemId: string;
    quantity: number;
    unitCost: number;
    batchNumber: string | null;
    expiryDate: string | null;
  }[];
  supplierDocument: string;
  notes: string;
}

interface GoodsReceiptModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  poNumber: string;
  vendorName: string;
  /** Destination location, already resolved to its label. */
  warehouseName: string;
  lines: ReceiptLineSource[];
  /** True when the tenant picks stock FEFO, which makes the expiry mandatory. */
  requireExpiry: boolean;
  onSubmit: (payload: GoodsReceiptPayload) => Promise<void>;
}

interface LineDraft {
  quantity: string;
  unitCost: string;
  batchNumber: string;
  expiryDate: string;
}

function parseNumber(value: string): number {
  return Number(value.replace(",", "."));
}

function remainingOf(line: ReceiptLineSource): number {
  return Math.max(0, line.ordered - line.alreadyReceived);
}

export function GoodsReceiptModal({
  open,
  onOpenChange,
  poNumber,
  vendorName,
  warehouseName,
  lines,
  requireExpiry,
  onSubmit,
}: GoodsReceiptModalProps) {
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({});
  const [supplierDocument, setSupplierDocument] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Every open starts from "everything that is still owed arrived", which is
  // what happens most of the time; the operator lowers the numbers otherwise.
  useEffect(() => {
    if (!open) return;
    const next: Record<string, LineDraft> = {};
    for (const line of lines) {
      next[line.purchaseOrderItemId] = {
        quantity: String(Number(remainingOf(line).toFixed(3))),
        unitCost: String(Number(line.unitCost)),
        batchNumber: "",
        expiryDate: "",
      };
    }
    setDrafts(next);
    setSupplierDocument("");
    setNotes("");
    setSaving(false);
  }, [open, lines]);

  const receivedOn = isoToday();

  const totals = useMemo(() => {
    const value = lines.reduce((sum, line) => {
      const draft = drafts[line.purchaseOrderItemId];
      const qty = draft ? parseNumber(draft.quantity) : 0;
      const cost = draft ? parseNumber(draft.unitCost) : 0;
      if (!Number.isFinite(qty) || !Number.isFinite(cost) || qty <= 0) return sum;
      return sum + Math.round(qty * cost);
    }, 0);
    return { value };
  }, [drafts, lines]);

  const update = (id: string, patch: Partial<LineDraft>) => {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  };

  const buildLines = (): ReceiptLineInput[] =>
    lines.map((line) => {
      const draft = drafts[line.purchaseOrderItemId];
      return {
        purchaseOrderItemId: line.purchaseOrderItemId,
        quantity: draft ? parseNumber(draft.quantity) : 0,
        ordered: line.ordered,
        alreadyReceived: line.alreadyReceived,
        unitCost: draft ? parseNumber(draft.unitCost) : line.unitCost,
        unitName: line.unitName,
        expiryDate: draft?.expiryDate || null,
      };
    });

  const handleSubmit = async () => {
    if (saving) return;

    const receiptLines = buildLines();
    const invalid = validateReceipt(receiptLines, { receivedOn, requireExpiry });
    if (invalid) {
      toast.error(invalid);
      return;
    }

    const payload: GoodsReceiptPayload = {
      lines: receiptLines.map((line) => {
        const draft = drafts[line.purchaseOrderItemId];
        return {
          purchaseOrderItemId: line.purchaseOrderItemId,
          quantity: line.quantity,
          unitCost: line.unitCost,
          batchNumber: draft?.batchNumber.trim() || null,
          expiryDate: draft?.expiryDate || null,
        };
      }),
      supplierDocument: supplierDocument.trim(),
      notes: notes.trim(),
    };

    setSaving(true);
    try {
      await onSubmit(payload);
      onOpenChange(false);
    } catch (error) {
      // The receipt is one transaction: a failure leaves nothing behind, so the
      // form stays exactly as the operator left it.
      toast.error(error instanceof Error ? error.message : "Gagal menyimpan penerimaan barang");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[1000px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageCheck className="w-5 h-5" />
            Terima Barang — {poNumber}
          </DialogTitle>
          <DialogDescription>
            {vendorName} · tujuan {warehouseName} · tanggal terima {receivedOn}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {requireExpiry && (
            <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-warning mt-0.5" />
              <p className="text-sm">
                Metode stok <strong>FEFO</strong> aktif: tanggal kedaluwarsa wajib diisi untuk
                setiap baris yang diterima.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>No. Dokumen Vendor</Label>
              <Input
                className="mt-1"
                placeholder="Nomor surat jalan / faktur vendor"
                value={supplierDocument}
                onChange={(event) => setSupplierDocument(event.target.value)}
              />
            </div>
            <div>
              <Label>Tanggal Terima</Label>
              <Input className="mt-1" value={receivedOn} readOnly disabled />
            </div>
          </div>

          <div className="border rounded-lg overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produk</TableHead>
                  <TableHead className="text-right">Dipesan</TableHead>
                  <TableHead className="text-right">Sudah Diterima</TableHead>
                  <TableHead className="text-right">Sisa</TableHead>
                  <TableHead className="text-right">Terima Sekarang</TableHead>
                  <TableHead className="text-right">Harga Satuan</TableHead>
                  <TableHead>No. Batch</TableHead>
                  <TableHead>Kedaluwarsa</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => {
                  const draft = drafts[line.purchaseOrderItemId];
                  const remaining = remainingOf(line);
                  if (!draft) return null;
                  return (
                    <TableRow key={line.purchaseOrderItemId}>
                      <TableCell>
                        <p className="font-medium">{line.productName}</p>
                        <p className="text-xs text-muted-foreground">{line.sku}</p>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {Number(line.ordered.toFixed(3))} {line.unitName}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap text-muted-foreground">
                        {Number(line.alreadyReceived.toFixed(3))} {line.unitName}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Badge variant={remaining > 0 ? "secondary" : "outline"}>
                          {Number(remaining.toFixed(3))} {line.unitName}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          step="0.001"
                          min="0"
                          className="w-24 ml-auto text-right"
                          value={draft.quantity}
                          onChange={(event) =>
                            update(line.purchaseOrderItemId, { quantity: event.target.value })
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min="0"
                          className="w-28 ml-auto text-right"
                          value={draft.unitCost}
                          onChange={(event) =>
                            update(line.purchaseOrderItemId, { unitCost: event.target.value })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="w-32"
                          placeholder="otomatis"
                          value={draft.batchNumber}
                          onChange={(event) =>
                            update(line.purchaseOrderItemId, { batchNumber: event.target.value })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="date"
                          className="w-36"
                          value={draft.expiryDate}
                          onChange={(event) =>
                            update(line.purchaseOrderItemId, { expiryDate: event.target.value })
                          }
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="bg-muted/50">
                  <TableCell colSpan={7} className="text-right font-semibold">
                    Nilai penerimaan:
                  </TableCell>
                  <TableCell className="text-right font-bold">
                    Rp {totals.value.toLocaleString("id-ID")}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <div>
            <Label>Catatan</Label>
            <Textarea
              className="mt-1"
              placeholder="Kondisi barang, kekurangan, atau catatan lain..."
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Penerimaan ini menambah stok di gudang tujuan, mengubah sisa pesanan, dan mencatat
            satu tagihan ke vendor dalam satu transaksi.
          </p>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button className="flex-1" onClick={handleSubmit} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Simpan Penerimaan
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
