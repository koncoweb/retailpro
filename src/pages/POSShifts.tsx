import { useState, useEffect } from "react";
import { POSLayout } from "@/components/layout/POSLayout";
import { Button } from "@/components/ui/button";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, DollarSign, Calendar, AlertCircle, CheckCircle, Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { query, runTransaction } from "@/lib/db";
import { useAuth } from "@/hooks/use-auth";
import { usePosBranch } from "@/hooks/use-pos-branch";
import {
  autoAttendanceWarning,
  autoCheckInForShift,
  autoCheckOutForShift,
} from "@/lib/shift-attendance";
import { Shift } from "@/types";
import { cn, formatCurrency } from "@/lib/utils";

export default function POSShifts() {
  const { user } = useAuth();
  // One branch answer shared with the till and the header: a shift opened
  // here is the very shift the till finds, even for a cashier whose
  // `assigned_branch_id` is null but whose session resolved a branch.
  const {
    branchId,
    setBranchId,
    branches,
    branchName,
    canSwitch,
    loading: branchLoading,
  } = usePosBranch();
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
    if (!user || branchLoading) return;
    if (!branchId) {
      // No in-scope branch at all: stop the spinner and let the empty state
      // below explain it. This used to dead-end on "Sesi tidak lengkap"
      // whenever `assigned_branch_id` was null, even though the session had
      // perfectly good branches to open a shift under.
      setIsLoading(false);
      return;
    }
    fetchShiftData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, branchLoading, branchId]);

  const fetchShiftData = async () => {
    setIsLoading(true);
    try {
      // Both ids come from the session + the shared hook — with
      // database-per-tenant there is no `tenant_id` column to read.
      const userId = user?.id;

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

      // Shift history for this branch, newest first
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
    // Blank means "no cash in the drawer this morning", which is a normal
    // shift, not a validation error — the hint under the field says so.
    const raw = initialCash.trim();
    const amount = raw === "" ? 0 : parseFloat(raw);
    if (isNaN(amount) || amount < 0) {
      toast.error("Masukkan jumlah modal awal yang valid (0 boleh, tanpa uang tunai awal)");
      return;
    }

    const userId = user?.id;

    if (!userId || !branchId) {
      toast.error("Belum ada cabang yang bisa diakses akun ini. Hubungi owner.");
      return;
    }

    try {
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

      // Attendance half of the deal: opening a drawer *is* showing up, so it
      // books the day's check-in unless one already exists. Best-effort —
      // the shift itself already succeeded and stays open either way.
      const checkIn = await autoCheckInForShift(userId, branchId);
      const shiftNote =
        amount === 0
          ? "Shift berhasil dibuka tanpa uang tunai awal."
          : "Shift berhasil dibuka.";
      const warning = autoAttendanceWarning(checkIn);
      if (warning) toast.warning(`${shiftNote} ${warning}`);
      else if (checkIn.changed)
        toast.success(`${shiftNote} Absensi tercatat otomatis.`);
      // Already booked (they checked in at /absen first): say what happened
      // instead of claiming a second entry.
      else toast.success(`${shiftNote} Absensi hari ini sudah tercatat.`);
      setInitialCash("");
      fetchShiftData();
    } catch (error) {
      console.error("Error opening shift:", error);
      toast.error("Gagal membuka shift: " + (error instanceof Error ? error.message : "Coba lagi"));
    }
  };

  const handleCloseShift = async () => {
    if (!activeShift) return;
    const userId = user?.id;
    
    const actual = parseFloat(finalCash);
    if (isNaN(actual) || actual < 0) {
      toast.error("Masukkan jumlah uang fisik yang valid (0 boleh, laci kosong)");
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

      // Closing the drawer stamps the day's check-out — but only on rows
      // that still lack one, so an /absen check-out is never overwritten.
      if (userId) {
        const checkOut = await autoCheckOutForShift(userId);
        const warning = autoAttendanceWarning(checkOut);
        if (warning) toast.warning(`Shift berhasil ditutup. ${warning}`);
        else if (checkOut.changed)
          toast.success("Shift berhasil ditutup. Absensi check-out tercatat otomatis.");
        // Nothing to stamp: this account never got an auto check-in (or the
        // day's row already had a check-out). Don't invent a claim.
        else toast.success("Shift berhasil ditutup");
      } else {
        toast.success("Shift berhasil ditutup");
      }
      setFinalCash("");
      setNotes("");
      fetchShiftData();
    } catch (error) {
      console.error("Error closing shift:", error);
      toast.error("Gagal menutup shift: " + (error instanceof Error ? error.message : "Coba lagi"));
    }
  };

  if (isLoading || branchLoading) {
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
        <div className="flex flex-wrap items-center justify-between gap-3">
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

        {!branchId ? (
          // Not "sesi tidak lengkap" anymore: the real explanation, with the
          // one action that can fix it (retry), instead of a dead end.
          <Card className="border-warning/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <AlertCircle className="w-5 h-5 text-warning" />
                Cabang belum tersedia
              </CardTitle>
              <CardDescription>
                Shift butuh sebuah cabang untuk dibuka. Akun ini belum punya
                cabang yang bisa diakses — minta owner menetapkan cabang atau
                scope role Anda, lalu muat ulang halaman ini.
              </CardDescription>
            </CardHeader>
            <CardFooter>
              <Button variant="outline" onClick={() => window.location.reload()}>
                Muat Ulang
              </Button>
            </CardFooter>
          </Card>
        ) : (
          <>
        {/* Where the drawer lives: same picker the till uses, same memory. */}
        <div className="flex items-center gap-2 flex-wrap">
          {canSwitch ? (
            <Select value={branchId ?? ""} onValueChange={setBranchId}>
              <SelectTrigger className="w-auto min-w-[180px] h-9 gap-2 text-sm">
                <MapPin className="w-4 h-4" />
                <SelectValue placeholder="Pilih cabang" />
              </SelectTrigger>
              <SelectContent>
                {branches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full">
              <MapPin className="w-4 h-4" />
              <span>{branchName ?? "Cabang"}</span>
            </div>
          )}
        </div>

        {/* Active Shift / Open Shift Action */}
        <div className="grid gap-6">
          {!activeShift ? (
            <Card className="border-primary/20 shadow-lg">
              <CardHeader>
                <CardTitle>Buka Shift Baru</CardTitle>
                <CardDescription>
                  Masukkan modal awal (Petty Cash) untuk memulai operasional
                  kasir. Boleh 0 jika tidak ada uang tunai awal. Buka shift
                  sekaligus mencatat absensi masuk Anda hari ini.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Modal Awal (Petty Cash)</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      type="number"
                      inputMode="numeric"
                      placeholder="Contoh: 200000 (0 = tanpa uang tunai)"
                      value={initialCash}
                      onChange={(e) => setInitialCash(e.target.value)}
                      className="pl-10 text-base md:text-lg"
                    />
                  </div>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {[0, 100000, 200000, 500000].map(amt => (
                      <Button key={amt} variant="outline" size="sm" onClick={() => setInitialCash(amt.toString())}>
                        {amt === 0 ? "Rp0 (tanpa tunai)" : formatCurrency(amt)}
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
                        inputMode="numeric"
                        placeholder="Masukkan total uang tunai yang ada..."
                        value={finalCash}
                        onChange={(e) => setFinalCash(e.target.value)}
                        className="pl-10 text-base md:text-lg"
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

        {/* History: a table from md up, compact cards below it — the same
            two-view pattern the attendance reports settled on, because a
            six-column shift table is unreadable on a phone propped by the
            cash drawer. */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Riwayat Shift Terakhir</h2>
          <Card className="hidden md:block">
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
          <div className="md:hidden space-y-3">
            {shiftHistory.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  Belum ada riwayat shift.
                </CardContent>
              </Card>
            ) : (
              shiftHistory.map((shift) => (
                <Card key={shift.id}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Calendar className="w-4 h-4 text-muted-foreground" />
                        {new Date(shift.start_time).toLocaleString('id-ID')}
                      </div>
                      <Badge variant={shift.status === 'open' ? 'default' : 'secondary'}>
                        {shift.status === 'open' ? 'Aktif' : 'Selesai'}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Selesai: {shift.end_time ? new Date(shift.end_time).toLocaleString('id-ID') : '-'}
                    </p>
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">Modal Awal</p>
                        <p className="font-medium">{formatCurrency(Number(shift.initial_cash))}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Total Akhir</p>
                        <p className="font-medium">{shift.final_cash ? formatCurrency(Number(shift.final_cash)) : '-'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Selisih</p>
                        <p className={cn("font-medium", Number(shift.difference) !== 0 ? 'text-destructive' : 'text-success')}>
                          {shift.difference ? formatCurrency(Number(shift.difference)) : '-'}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>
          </>
        )}
      </div>
    </POSLayout>
  );
}
