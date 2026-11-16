/**
 * Void confirmation dialog.
 *
 * Retail practice: cancelling a paid bon is a cash-refund event, so it is never
 * a one-click icon. The cashier must type why (the audit trail an owner reads
 * later), see exactly what comes back — money to the customer, units to the
 * shelf — and confirm. The same dialog serves both shapes (one line or the whole
 * bon) because the two decisions feel identical at the counter.
 *
 * It only asks; `src/lib/void.ts` decides. Permission and open-shift gating
 * live there, so a stale button in this dialog cannot void anything.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { voidTransactionBon, voidTransactionItems, type VoidActor } from "@/lib/void";
import { printSaleReceipt } from "@/lib/print/receipt-printer";
import { viaLabel, type PrintContext } from "@/lib/print/print-service";
import type { Transaction, TransactionItem } from "@/types";

/** Which shape of void this dialog is confirming. */
export type VoidMode = "items" | "bon";

interface VoidDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: Transaction | null;
  mode: VoidMode;
  /** Lines to void in `items` mode; ignored for a bon void. */
  items: TransactionItem[];
  /** Resolved from the signed-in person; `canVoid` is re-checked server-side lib. */
  actor: VoidActor | null;
  printCtx: PrintContext | null;
  /** Called after a successful void so the list reloads. */
  onVoided: () => void;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(value);
}

export function VoidDialog({
  open,
  onOpenChange,
  transaction,
  mode,
  items,
  actor,
  printCtx,
  onVoided,
}: VoidDialogProps) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  /*
   * Radix keeps the dialog mounted through its close animation, while the parent
   * clears its pending request the moment the void lands. Rendering the live
   * props during that fade would flash an empty bon form ("Nilai bon dibatalkan
   * Rp 0"), so what is on screen stays the request the person actually confirmed.
   * The actions below still read the live props: a frozen view cannot be
   * submitted, because `canSubmit` requires a real transaction.
   */
  const lastRequest = useRef<{ transaction: Transaction; mode: VoidMode; items: TransactionItem[] } | null>(
    transaction ? { transaction, mode, items } : null
  );
  if (transaction) lastRequest.current = { transaction, mode, items };
  const view = lastRequest.current;

  // A reason that survived a cancelled dialog would be reused on the wrong bon.
  useEffect(() => {
    if (!open) setReason("");
  }, [open]);

  const voidedSubtotal = useMemo(() => {
    if (!view) return 0;
    return view.mode === "bon"
      ? view.transaction.total_amount ?? 0
      : view.items.reduce((sum, i) => sum + Number(i.subtotal ?? 0), 0);
  }, [view]);
  const lineCount = !view
    ? 0
    : view.mode === "bon"
      ? view.transaction.items?.length ?? 0
      : view.items.length;
  const trimmed = reason.trim();
  const canSubmit = trimmed.length >= 3 && !busy && !!transaction && !!actor;

  const handleConfirm = async () => {
    if (!transaction || !actor) return;
    if (trimmed.length < 3) {
      toast.error("Alasan void wajib diisi (minimal 3 karakter).");
      return;
    }
    setBusy(true);
    try {
      const result =
        mode === "bon"
          ? await voidTransactionBon(transaction.id, trimmed, actor)
          : await voidTransactionItems(
              transaction.id,
              items.map((item) => item.id),
              trimmed,
              actor
            );
      toast.success(
        mode === "bon"
          ? `Transaksi ${transaction.invoice_number} dibatalkan. ${result.voided} item dikembalikan ke stok.`
          : `${result.voided} item di-void (${formatCurrency(result.voidedAmount)}). Stok dikembalikan.`
      );
      onOpenChange(false);
      onVoided();
      // The customer leaves with a note that shows the struck-through lines;
      // the till only prints it when auto-print is on, same as a normal sale.
      if (printCtx?.receipt.autoPrint) {
        const printed = await printSaleReceipt(transaction.id, printCtx);
        if (printed.ok) toast.success(`Nota void tercetak via ${viaLabel(printed.via)}.`);
        else toast.error(printed.error ?? "Gagal mencetak nota void.");
      }
    } catch (error) {
      console.error("Void failed:", error);
      toast.error(error instanceof Error ? error.message : "Gagal mem-void transaksi.");
    } finally {
      setBusy(false);
    }
  };

  // Nothing has been asked yet (first render): there is no dialog to show.
  if (!view) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="w-[95vw] max-w-[95vw] sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-destructive" />
            {view.mode === "bon" ? "Void Seluruh Transaksi" : "Void Item"}
          </DialogTitle>
          <DialogDescription>
            {view.mode === "bon"
              ? `Bon ${view.transaction.invoice_number} akan ditandai batal. Semua item aktif dikembalikan ke stok dan nota tidak dihitung sebagai penjualan.`
              : `${lineCount} item dari bon ${view.transaction.invoice_number} akan dicoret dan dikembalikan ke stok.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1">
            {view.mode === "items" &&
              view.items.map((item) => (
                <div key={item.id} className="flex justify-between gap-2">
                  <span className="truncate line-through text-muted-foreground">
                    {item.product_name} × {item.quantity}
                  </span>
                  <span className="shrink-0 line-through text-muted-foreground">
                    {formatCurrency(Number(item.subtotal ?? 0))}
                  </span>
                </div>
              ))}
            <div className="flex justify-between gap-2 font-bold border-t pt-1 mt-1">
              <span>{view.mode === "bon" ? "Nilai bon dibatalkan" : "Pengurang total"}</span>
              <span>{formatCurrency(voidedSubtotal)}</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="void-reason">Alasan void (wajib)</Label>
            <Textarea
              id="void-reason"
              placeholder="mis. salah input, customer batal, barang rusak"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={busy}
            />
            <p className="text-xs text-muted-foreground">
              Tercatat di jejak audit dan dicetak pada nota. Minimal 3 karakter.
            </p>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)} disabled={busy}>
              Batal
            </Button>
            <Button
              variant="destructive"
              className="flex-1 gap-2"
              onClick={handleConfirm}
              disabled={!canSubmit}
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
              {view.mode === "bon" ? "Void Bon" : `Void ${lineCount} Item`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
