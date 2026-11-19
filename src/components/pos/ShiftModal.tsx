import { useRef, useState } from "react";
import type { ShiftCashReport } from "@/lib/shift-cash";
import { expectedShiftCash } from "@/lib/shift-cash";
import { ShiftExpenseSummary } from "./ShiftExpenseSummary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Clock, DollarSign, Banknote, Check, Receipt } from "lucide-react";
import { toast } from "sonner";

export interface ShiftActionData {
  pettyCash?: number;
  openTime?: Date;
  closeTime?: Date;
  actualCash?: number;
  notes?: string;
}

/** What the closing window renders, all read from the shift's persisted rows. */
export type ShiftReport = ShiftCashReport;

interface ShiftModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "open" | "close";
  report?: ShiftReport;
  onShiftAction: (data: ShiftActionData) => Promise<boolean>;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(value);
}

export function ShiftModal({
  open,
  onOpenChange,
  mode,
  report,
  onShiftAction,
}: ShiftModalProps) {
  const [pettyCash, setPettyCash] = useState("");
  const [actualCash, setActualCash] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const posting = useRef(false);

  const submit = async (data: ShiftActionData) => {
    if (posting.current) return;
    posting.current = true;
    setSaving(true);
    try {
      if (await onShiftAction(data)) {
        onOpenChange(false);
        setPettyCash("");
        setActualCash("");
        setNotes("");
      }
    } finally {
      posting.current = false;
      setSaving(false);
    }
  };

  const handleOpenShift = () => {
    // Blank and 0 are a legitimate choice — many mornings the drawer starts
    // empty — so the guard rejects only what is actually not a number or
    // negative. The old `<= 0` rule made "tanpa uang tunai" un-openable.
    const raw = pettyCash.trim();
    const amount = raw === "" ? 0 : parseFloat(raw);
    if (isNaN(amount)) {
      toast.error("Petty cash harus berupa angka. Kosongkan jika tidak ada uang tunai awal.");
      return;
    }
    if (amount < 0) {
      toast.error("Petty cash tidak boleh negatif.");
      return;
    }
    // Keep the form open on failure; the caller reports the persisted result.
    void submit({ pettyCash: amount, openTime: new Date() });
  };

  const handleCloseShift = () => {
    const raw = actualCash.trim();
    if (raw !== "" && (isNaN(parseFloat(raw)) || parseFloat(raw) < 0)) {
      toast.error("Uang tunai aktual harus angka dan tidak boleh negatif. Masukkan 0 jika laci kosong.");
      return;
    }
    if (!report) return;
    void submit({ closeTime: new Date(), actualCash: Number(raw) || 0, notes });
  };

  // Non-cash sales never touch the drawer; recorded cash expenses leave it.
  const expectedCash = expectedShiftCash(report?.initialCash ?? 0, report?.cashSales ?? 0, report?.expenseTotal ?? 0);

  if (mode === "open") {
    return (
      <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
        <DialogContent className="max-w-[95vw] sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-primary" />
              Buka Shift Kasir
            </DialogTitle>
            <DialogDescription>
              Masukkan jumlah uang awal (petty cash) untuk memulai shift.
              Kosongkan atau isi 0 jika tidak ada uang tunai awal.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Petty Cash (Uang Awal)</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="number"
                  inputMode="numeric"
                  placeholder="Contoh: 500000 (kosong = 0)"
                  value={pettyCash}
                  onChange={(e) => setPettyCash(e.target.value)}
                  className="pl-10 text-base md:text-lg"
                />
              </div>
              {!pettyCash && (
                <p className="text-xs text-muted-foreground">
                  Tanpa uang tunai awal — shift tetap bisa dibuka.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[0, 200000, 300000, 500000].map((amount) => (
                <Button
                  key={amount}
                  variant="outline"
                  size="sm"
                  onClick={() => setPettyCash(amount.toString())}
                >
                  {amount === 0 ? "Rp0" : formatCurrency(amount)}
                </Button>
              ))}
            </div>

            <div className="p-4 bg-muted/50 rounded-lg">
              <p className="text-sm text-muted-foreground">Waktu Buka Shift</p>
              <p className="text-lg font-semibold">
                {new Date().toLocaleString("id-ID", {
                  dateStyle: "full",
                  timeStyle: "short",
                })}
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" disabled={saving} onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button className="flex-1 gap-2" disabled={saving} onClick={handleOpenShift}>
              <Clock className="w-4 h-4" />
              Buka Shift
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-[95vw] flex-col overflow-hidden p-4 sm:max-w-[520px]">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary" />
            Tutup Shift - Laporan Akhir
          </DialogTitle>
          <DialogDescription>
            Periksa laporan penjualan dan rekonsiliasi kas sebelum menutup shift.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto space-y-4 py-2">
          {/* Shift info */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-xs text-muted-foreground">Waktu Buka</p>
              <p className="font-semibold text-sm">
                {report?.startTime
                  ? new Date(report.startTime).toLocaleString("id-ID", {
                      timeStyle: "short",
                      dateStyle: "short",
                    })
                  : "-"}
              </p>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-xs text-muted-foreground">Jumlah Transaksi</p>
              <p className="font-semibold text-sm">{report?.txCount ?? 0} bon</p>
            </div>
          </div>

          {/* Sales report — one combined total, not split by payment method. */}
          <div className="p-4 rounded-lg border space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Receipt className="w-4 h-4 text-primary" />
              Laporan Penjualan
            </div>
            <div className="flex justify-between text-lg font-bold">
              <span>Total Penjualan</span>
              <span className="text-primary">{formatCurrency(report?.totalSales ?? 0)}</span>
            </div>
            {(report?.feeTotal ?? 0) > 0 && (
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Biaya merchant</span>
                <span>{formatCurrency(report?.feeTotal ?? 0)}</span>
              </div>
            )}
            {(report?.voidCount ?? 0) > 0 && (
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Bon di-void ({report?.voidCount} bon)</span>
                <span>{formatCurrency(report?.voidAmount ?? 0)}</span>
              </div>
            )}
          </div>

          <ShiftExpenseSummary expenses={report?.expenses ?? []} total={report?.expenseTotal ?? 0} />

          {/* Cash reconciliation */}
          <div className="p-4 bg-primary/10 rounded-lg space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Banknote className="w-4 h-4 text-success" />
              Rekonsiliasi Kas
            </div>
            <div className="flex justify-between text-sm">
              <span>Modal Awal</span>
              <span>{formatCurrency(report?.initialCash ?? 0)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Penjualan Tunai</span>
              <span>{formatCurrency(report?.cashSales ?? 0)}</span>
            </div>
            <div className="flex justify-between text-sm text-destructive">
              <span>Pengeluaran kas</span>
              <span>-{formatCurrency(report?.expenseTotal ?? 0)}</span>
            </div>
            <div className="flex justify-between text-sm font-medium pt-1 border-t">
              <span>Saldo Seharusnya</span>
              <span>{formatCurrency(expectedCash)}</span>
            </div>
            <div className="space-y-2">
              <Label>Uang Tunai Fisik di Laci</Label>
              <Input
                type="number"
                inputMode="numeric"
                placeholder="Masukkan jumlah uang aktual (0 jika laci kosong)"
                value={actualCash}
                onChange={(e) => setActualCash(e.target.value)}
              />
            </div>
            {actualCash !== "" && (
              <div
                className={`flex justify-between text-sm font-bold ${
                  parseFloat(actualCash) === expectedCash ? "text-success" : "text-destructive"
                }`}
              >
                <span>Selisih</span>
                <span>{formatCurrency((parseFloat(actualCash) || 0) - expectedCash)}</span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="close-shift-notes">Catatan (Opsional)</Label>
            <Input id="close-shift-notes" value={notes} onChange={(event) => setNotes(event.target.value)}
              placeholder="Alasan selisih atau catatan lainnya..." disabled={saving} />
          </div>
          <p className="text-xs text-muted-foreground">
            Laporan ini otomatis tercetak sebagai Z-report saat shift ditutup.
          </p>
        </div>

        <div className="flex shrink-0 gap-2 border-t pt-3">
          <Button variant="outline" className="flex-1" disabled={saving} onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button className="flex-1 gap-2" disabled={saving || !report} onClick={handleCloseShift}>
            <Check className="w-4 h-4" />
            Tutup Shift
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
