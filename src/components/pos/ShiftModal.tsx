import { useState, useMemo } from "react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Clock, DollarSign, Banknote, CreditCard, Wallet, Check, QrCode } from "lucide-react";
import { toast } from "sonner";
import { Transaction } from "@/types";

export interface ShiftActionData {
  pettyCash?: number;
  openTime?: Date;
  closeTime?: Date;
  actualCash?: number;
}

interface ShiftModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "open" | "close";
  shiftData?: ShiftData;
  onShiftAction: (data: ShiftActionData) => void;
}

interface ShiftData {
  openTime: Date;
  pettyCash: number;
  transactions: Transaction[];
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
  shiftData,
  onShiftAction,
}: ShiftModalProps) {
  const [pettyCash, setPettyCash] = useState("");
  const [actualCash, setActualCash] = useState("");

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
    // No premature victory lap: "berhasil" belongs to the caller, after the
    // insert actually lands. This modal only hands the data over and closes.
    onShiftAction({ pettyCash: amount, openTime: new Date() });
    onOpenChange(false);
    setPettyCash("");
  };

  const handleCloseShift = () => {
    const raw = actualCash.trim();
    if (raw !== "" && (isNaN(parseFloat(raw)) || parseFloat(raw) < 0)) {
      toast.error("Uang tunai aktual harus angka dan tidak boleh negatif. Masukkan 0 jika laci kosong.");
      return;
    }
    onShiftAction({ closeTime: new Date(), actualCash: parseFloat(raw) || 0 });
    onOpenChange(false);
    setActualCash("");
  };

  // Calculate shift summary using useMemo for performance
  const summary = useMemo(() => {
    const defaultSummary = { cash: 0, card: 0, ewallet: 0, qris: 0, total: 0 };
    if (!shiftData?.transactions) return defaultSummary;

    return shiftData.transactions.reduce((acc, t) => {
      const amount = t.total_amount;
      acc.total += amount;
      
      switch (t.payment_method) {
        case 'cash': acc.cash += amount; break;
        case 'card': acc.card += amount; break;
        case 'ewallet': acc.ewallet += amount; break;
        case 'qris': acc.qris += amount; break;
      }
      return acc;
    }, { ...defaultSummary });
  }, [shiftData?.transactions]);

  const expectedCash = (shiftData?.pettyCash || 0) + summary.cash;

  if (mode === "open") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
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
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button className="flex-1 gap-2" onClick={handleOpenShift}>
              <Clock className="w-4 h-4" />
              Buka Shift
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary" />
            Tutup Shift - Laporan Penjualan
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Shift Info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-muted/50 rounded-lg">
              <p className="text-sm text-muted-foreground">Waktu Buka</p>
              <p className="font-semibold">
                {shiftData?.openTime.toLocaleString("id-ID", {
                  timeStyle: "short",
                  dateStyle: "short",
                }) || "-"}
              </p>
            </div>
            <div className="p-4 bg-muted/50 rounded-lg">
              <p className="text-sm text-muted-foreground">Petty Cash</p>
              <p className="font-semibold">{formatCurrency(shiftData?.pettyCash || 0)}</p>
            </div>
          </div>

          {/* Sales Summary */}
          <div className="bg-card rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Metode Pembayaran</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="flex items-center gap-2">
                    <Banknote className="w-4 h-4 text-success" />
                    Tunai
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(summary.cash)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-info" />
                    Kartu (Debit/Kredit)
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(summary.card)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="flex items-center gap-2">
                    <Wallet className="w-4 h-4 text-warning" />
                    E-Wallet
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(summary.ewallet)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="flex items-center gap-2">
                    <QrCode className="w-4 h-4 text-purple-500" />
                    QRIS
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(summary.qris)}
                  </TableCell>
                </TableRow>
                <TableRow className="font-bold bg-muted/50">
                  <TableCell>Total Penjualan</TableCell>
                  <TableCell className="text-right text-primary">
                    {formatCurrency(summary.total)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          {/* Cash Verification */}
          <div className="p-4 bg-primary/10 rounded-lg space-y-3">
            <div className="flex justify-between">
              <span>Uang Tunai yang Diharapkan</span>
              <span className="font-bold">{formatCurrency(expectedCash)}</span>
            </div>
            <div className="space-y-2">
              <Label>Uang Tunai Aktual di Laci</Label>
              <Input
                type="number"
                inputMode="numeric"
                placeholder="Masukkan jumlah uang aktual (0 jika laci kosong)"
                value={actualCash}
                onChange={(e) => setActualCash(e.target.value)}
              />
            </div>
            {actualCash && (
              <div
                className={`flex justify-between ${
                  parseFloat(actualCash) === expectedCash
                    ? "text-success"
                    : "text-destructive"
                }`}
              >
                <span>Selisih</span>
                <span className="font-bold">
                  {formatCurrency((parseFloat(actualCash) || 0) - expectedCash)}
                </span>
              </div>
            )}
          </div>

          {/* Transaction Count */}
          <div className="text-center text-muted-foreground">
            Total {shiftData?.transactions.length || 0} transaksi hari ini
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button className="flex-1 gap-2" onClick={handleCloseShift}>
            <Check className="w-4 h-4" />
            Tutup Shift
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
