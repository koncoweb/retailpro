import { useState, useEffect } from "react";
import { POSLayout } from "@/components/layout/POSLayout";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, DollarSign, Calendar, AlertCircle, CheckCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { query, runTransaction } from "@/lib/db";
import { useAuth } from "@/hooks/use-auth";
import { Shift, Transaction } from "@/types";
import { formatCurrency } from "@/lib/utils";

export default function POSShifts() {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [activeShift, setActiveShift] = useState<Shift | null>(null);
  const [shiftHistory, setShiftHistory] = useState<Shift[]>([]);
  
  // Open Shift State
  const [initialCash, setInitialCash] = useState("");
  
  // Close Shift State
  const [finalCash, setFinalCash] = useState("");
  const [notes, setNotes] = useState("");
  const [transactionsSummary, setTransactionsSummary] = useState({
    cash: 0,
    card: 0,
    ewallet: 0,
    qris: 0,
    total: 0,
  });

  useEffect(() => {
    if (user) {
      fetchShiftData();
    }
  }, [user]);

  const fetchShiftData = async () => {
    setIsLoading(true);
    try {
      // 1. Get Active Shift. Both ids come from the session — with
      // database-per-tenant there is no `tenant_id` column to read.
      const userId = user?.id;
      const branchId = user?.assigned_branch_id;

      if (!userId || !branchId) return;

      const activeRes = await query(
        `SELECT * FROM shifts WHERE user_id = $1 AND branch_id = $2 AND status = 'open' LIMIT 1`,
        [userId, branchId]
      );

      if (activeRes.rows.length > 0) {
        const shift = activeRes.rows[0];
        setActiveShift(shift);
        calculateSummary(shift.id, shift.initial_cash);
      } else {
        setActiveShift(null);
      }

      // 2. Get Shift History
      const historyRes = await query(
        `SELECT * FROM shifts WHERE user_id = $1 AND branch_id = $2 ORDER BY created_at DESC LIMIT 10`,
        [userId, branchId]
      );
      setShiftHistory(historyRes.rows);

    } catch (error) {
      console.error("Error fetching shift data:", error);
      toast.error("Gagal memuat data shift");
    } finally {
      setIsLoading(false);
    }
  };

  const calculateSummary = async (shiftId: string, startCash: string | number) => {
    try {
      // Shift takings are everything posted against this shift — the POS stamps
      // `shift_id` on each transaction, so no time-range guessing is needed.
      const res = await query(
        `SELECT payment_method, total_amount FROM transactions 
         WHERE shift_id = $1`,
        [shiftId]
      );

      const summary = { cash: 0, card: 0, ewallet: 0, qris: 0, total: 0 };
      
      res.rows.forEach((t: { payment_method: string; total_amount: string | number }) => {
        const amount = Number(t.total_amount);
        summary.total += amount;
        switch (t.payment_method) {
          case 'cash': summary.cash += amount; break;
          case 'card': summary.card += amount; break;
          case 'ewallet': summary.ewallet += amount; break;
          case 'qris': summary.qris += amount; break;
          default: break;
        }
      });

      setTransactionsSummary(summary);
    } catch (err) {
      console.error("Error calculating summary:", err);
    }
  };

  const handleOpenShift = async () => {
    const amount = parseFloat(initialCash);
    if (isNaN(amount) || amount < 0) {
      toast.error("Masukkan jumlah modal awal yang valid");
      return;
    }

    try {
      const userId = user?.id;
      const branchId = user?.assigned_branch_id;

      if (!userId || !branchId) {
        toast.error("Sesi tidak lengkap: cabang belum ditetapkan");
        return;
      }

      // Close any shift left open by this user in this branch before opening a
      // new one, so `shifts` never ends up with two open drawers.
      await runTransaction(async (tx) => {
        await tx.query(
          `UPDATE shifts
             SET status = 'closed', end_time = strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE user_id = $1 AND branch_id = $2 AND status = 'open'`,
          [userId, branchId]
        );
        await tx.query(
          `INSERT INTO shifts (branch_id, user_id, start_time, initial_cash, status)
           VALUES ($1, $2, strftime('%Y-%m-%dT%H:%M:%fZ','now'), $3, 'open')`,
          [branchId, userId, amount]
        );
      });

      toast.success("Shift berhasil dibuka");
      setInitialCash("");
      fetchShiftData();
    } catch (error) {
      console.error("Error opening shift:", error);
      toast.error("Gagal membuka shift");
    }
  };

  const handleCloseShift = async () => {
    if (!activeShift) return;
    
    const actual = parseFloat(finalCash);
    if (isNaN(actual) || actual < 0) {
      toast.error("Masukkan jumlah uang fisik yang valid");
      return;
    }

    const expected = Number(activeShift.initial_cash) + transactionsSummary.cash;
    const diff = actual - expected;

    try {
      await query(
        `UPDATE shifts 
         SET end_time = strftime('%Y-%m-%dT%H:%M:%fZ','now'), 
             final_cash = $1, 
             expected_cash = $2, 
             difference = $3, 
             notes = $4,
             status = 'closed'
         WHERE id = $5`,
        [actual, expected, diff, notes, activeShift.id]
      );

      toast.success("Shift berhasil ditutup");
      setFinalCash("");
      setNotes("");
      fetchShiftData();
    } catch (error) {
      console.error("Error closing shift:", error);
      toast.error("Gagal menutup shift");
    }
  };

  if (isLoading) {
    return (
      <POSLayout>
        <div className="flex items-center justify-center h-full">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </POSLayout>
    );
  }

  return (
    <POSLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Clock className="w-6 h-6" />
            Manajemen Shift
          </h1>
          {activeShift ? (
            <Badge variant="default" className="bg-green-500 hover:bg-green-600">Shift Aktif</Badge>
          ) : (
            <Badge variant="secondary">Shift Ditutup</Badge>
          )}
        </div>

        {/* Active Shift / Open Shift Action */}
        <div className="grid gap-6">
          {!activeShift ? (
            <Card className="border-primary/20 shadow-lg">
              <CardHeader>
                <CardTitle>Buka Shift Baru</CardTitle>
                <CardDescription>Masukkan modal awal (Petty Cash) untuk memulai operasional kasir.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Modal Awal (Petty Cash)</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      type="number"
                      placeholder="Contoh: 200000"
                      value={initialCash}
                      onChange={(e) => setInitialCash(e.target.value)}
                      className="pl-10 text-lg"
                    />
                  </div>
                  <div className="flex gap-2 mt-2">
                    {[100000, 200000, 500000].map(amt => (
                      <Button key={amt} variant="outline" size="sm" onClick={() => setInitialCash(amt.toString())}>
                        {formatCurrency(amt)}
                      </Button>
                    ))}
                  </div>
                </div>
              </CardContent>
              <CardFooter>
                <Button className="w-full" size="lg" onClick={handleOpenShift}>Buka Shift Sekarang</Button>
              </CardFooter>
            </Card>
          ) : (
            <Card className="border-destructive/20 shadow-lg">
              <CardHeader>
                <CardTitle className="text-destructive flex items-center gap-2">
                  <AlertCircle className="w-5 h-5" />
                  Tutup Shift
                </CardTitle>
                <CardDescription>Lakukan rekonsiliasi uang tunai sebelum menutup shift.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 bg-muted/50 rounded-lg space-y-1">
                    <p className="text-sm text-muted-foreground">Waktu Mulai</p>
                    <p className="font-semibold text-lg">
                      {new Date(activeShift.start_time).toLocaleString('id-ID')}
                    </p>
                  </div>
                  <div className="p-4 bg-muted/50 rounded-lg space-y-1">
                    <p className="text-sm text-muted-foreground">Modal Awal</p>
                    <p className="font-semibold text-lg">{formatCurrency(Number(activeShift.initial_cash))}</p>
                  </div>
                </div>

                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Metode Pembayaran</TableHead>
                        <TableHead className="text-right">Total Transaksi</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell>Tunai (Cash)</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(transactionsSummary.cash)}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Non-Tunai (Kartu/QRIS)</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(transactionsSummary.total - transactionsSummary.cash)}</TableCell>
                      </TableRow>
                      <TableRow className="bg-muted/50 font-bold">
                        <TableCell>Total Penjualan</TableCell>
                        <TableCell className="text-right">{formatCurrency(transactionsSummary.total)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>

                <div className="space-y-4 pt-4 border-t">
                  <div className="space-y-2">
                    <Label>Uang Tunai Fisik (Di Laci)</Label>
                    <div className="relative">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        type="number"
                        placeholder="Masukkan total uang tunai yang ada..."
                        value={finalCash}
                        onChange={(e) => setFinalCash(e.target.value)}
                        className="pl-10 text-lg"
                      />
                    </div>
                    {finalCash && (
                      <div className="flex justify-between items-center text-sm p-2 bg-muted rounded">
                        <span>Selisih (Aktual - Harapan):</span>
                        <span className={cn(
                          "font-bold",
                          Number(finalCash) - (Number(activeShift.initial_cash) + transactionsSummary.cash) === 0 ? "text-success" : "text-destructive"
                        )}>
                          {formatCurrency(Number(finalCash) - (Number(activeShift.initial_cash) + transactionsSummary.cash))}
                        </span>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      *Harapan = Modal Awal ({formatCurrency(Number(activeShift.initial_cash))}) + Penjualan Tunai ({formatCurrency(transactionsSummary.cash)}) = {formatCurrency(Number(activeShift.initial_cash) + transactionsSummary.cash)}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>Catatan (Opsional)</Label>
                    <Input 
                      placeholder="Alasan selisih atau catatan lainnya..." 
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </div>
                </div>
              </CardContent>
              <CardFooter>
                <Button variant="destructive" className="w-full" onClick={handleCloseShift}>
                  Konfirmasi Tutup Shift
                </Button>
              </CardFooter>
            </Card>
          )}
        </div>

        {/* History */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Riwayat Shift Terakhir</h2>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Waktu Mulai</TableHead>
                  <TableHead>Waktu Selesai</TableHead>
                  <TableHead className="text-right">Modal Awal</TableHead>
                  <TableHead className="text-right">Total Akhir</TableHead>
                  <TableHead className="text-right">Selisih</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shiftHistory.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      Belum ada riwayat shift.
                    </TableCell>
                  </TableRow>
                ) : (
                  shiftHistory.map((shift) => (
                    <TableRow key={shift.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-muted-foreground" />
                          {new Date(shift.start_time).toLocaleString('id-ID')}
                        </div>
                      </TableCell>
                      <TableCell>
                        {shift.end_time ? new Date(shift.end_time).toLocaleString('id-ID') : '-'}
                      </TableCell>
                      <TableCell className="text-right">{formatCurrency(Number(shift.initial_cash))}</TableCell>
                      <TableCell className="text-right">{shift.final_cash ? formatCurrency(Number(shift.final_cash)) : '-'}</TableCell>
                      <TableCell className={`text-right ${Number(shift.difference) !== 0 ? 'text-destructive font-medium' : 'text-success'}`}>
                        {shift.difference ? formatCurrency(Number(shift.difference)) : '-'}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant={shift.status === 'open' ? 'default' : 'secondary'}>
                          {shift.status === 'open' ? 'Aktif' : 'Selesai'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </div>
      </div>
    </POSLayout>
  );
}

// Helper for class merging if not imported
function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(' ');
}
