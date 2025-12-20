import { useState } from "react";
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
import { Clock, DollarSign, Banknote, CreditCard, Wallet, Check } from "lucide-react";
import { toast } from "sonner";

interface ShiftModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "open" | "close";
  shiftData?: ShiftData;
  onShiftAction: (data: any) => void;
}

interface ShiftData {
  openTime: Date;
  pettyCash: number;
  transactions: {
    id: string;
    time: Date;
    total: number;
    method: string;
  }[];
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
    const amount = parseFloat(pettyCash) || 0;
    if (amount <= 0) {
      toast.error("Masukkan jumlah petty cash yang valid");
      return;
    }
    toast.success("Shift berhasil dibuka!");
    onShiftAction({ pettyCash: amount, openTime: new Date() });
    onOpenChange(false);
    setPettyCash("");
  };

  const handleCloseShift = () => {
    toast.success("Shift berhasil ditutup!");
    onShiftAction({ closeTime: new Date(), actualCash: parseFloat(actualCash) || 0 });
    onOpenChange(false);
    setActualCash("");
  };

  // Calculate shift summary
  const totalCash = shiftData?.transactions
    .filter((t) => t.method === "cash")
    .reduce((sum, t) => sum + t.total, 0) || 0;
  const totalCard = shiftData?.transactions
    .filter((t) => t.method === "card")
    .reduce((sum, t) => sum + t.total, 0) || 0;
  const totalEWallet = shiftData?.transactions
    .filter((t) => t.method === "ewallet")
    .reduce((sum, t) => sum + t.total, 0) || 0;
  const totalSales = totalCash + totalCard + totalEWallet;
  const expectedCash = (shiftData?.pettyCash || 0) + totalCash;

  if (mode === "open") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-primary" />
              Buka Shift Kasir
            </DialogTitle>
            <DialogDescription>
              Masukkan jumlah uang awal (petty cash) untuk memulai shift
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Petty Cash (Uang Awal)</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="number"
                  placeholder="Contoh: 500000"
                  value={pettyCash}
                  onChange={(e) => setPettyCash(e.target.value)}
                  className="pl-10 text-lg"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[200000, 300000, 500000].map((amount) => (
                <Button
                  key={amount}
                  variant="outline"
                  size="sm"
                  onClick={() => setPettyCash(amount.toString())}
                >
                  {formatCurrency(amount)}
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
      <DialogContent className="sm:max-w-[600px]">
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
                    {formatCurrency(totalCash)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-info" />
                    Kartu (Debit/Kredit)
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(totalCard)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="flex items-center gap-2">
                    <Wallet className="w-4 h-4 text-warning" />
                    E-Wallet
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(totalEWallet)}
                  </TableCell>
                </TableRow>
                <TableRow className="font-bold bg-muted/50">
                  <TableCell>Total Penjualan</TableCell>
                  <TableCell className="text-right text-primary">
                    {formatCurrency(totalSales)}
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
                placeholder="Masukkan jumlah uang aktual"
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
