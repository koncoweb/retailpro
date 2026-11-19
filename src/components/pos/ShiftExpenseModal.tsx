import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { usePermissions } from '@/hooks/use-permissions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { readShiftCashReport, recordShiftExpense, type ShiftCashReport } from '@/lib/shift-cash';
import { formatCurrency } from '@/lib/utils';
import { ShiftExpenseSummary } from './ShiftExpenseSummary';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shiftId: string;
  branchId: string;
}

export function ShiftExpenseModal({ open, onOpenChange, shiftId, branchId }: Props) {
  const { user } = useAuth();
  const { can } = usePermissions();
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [report, setReport] = useState<ShiftCashReport | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const posting = useRef(false);
  const requestId = useRef<string | null>(null);
  const loadVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    setReport(null);
    setError('');
    try {
      const nextReport = await readShiftCashReport(shiftId);
      if (version === loadVersion.current) setReport(nextReport);
    } catch (cause) {
      if (version === loadVersion.current) {
        setReport(null);
        setError(cause instanceof Error ? cause.message : 'Gagal memuat kas shift.');
      }
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [shiftId]);

  useEffect(() => {
    if (open) void load();
    return () => { loadVersion.current += 1; };
  }, [open, load]);

  const save = async () => {
    if (posting.current || loading || !report) return;
    posting.current = true;
    setSaving(true);
    try {
      requestId.current ??= crypto.randomUUID();
      await recordShiftExpense({
        id: requestId.current, shiftId, branchId, userId: user?.id ?? '',
        amount: Number(amount), description,
      }, can);
      // Reset only after the expense and its audit entry have committed.
      requestId.current = null;
      setAmount('');
      setDescription('');
      toast.success('Pengeluaran berhasil disimpan dan mengurangi kas shift.');
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Gagal menyimpan pengeluaran.');
    } finally {
      posting.current = false;
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-[95vw] flex-col overflow-hidden p-4 sm:max-w-[520px]">
        <DialogHeader className="shrink-0">
          <DialogTitle>Pengeluaran non transaksi</DialogTitle>
          <DialogDescription>Catat uang yang dikeluarkan dari kas laci, misalnya sumbangan. Nominal dan keterangan wajib diisi.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto space-y-4">
          {loading && <p role="status" className="text-sm">Memuat kas shift...</p>}
          {error && <div role="alert" className="text-sm text-destructive space-y-2"><p>{error}</p><Button variant="outline" onClick={() => void load()}>Coba lagi</Button></div>}
          {report && <p className="rounded-lg bg-muted p-3 text-sm">Saldo kas laci: <strong>{formatCurrency(report.expectedCash)}</strong></p>}
          <div className="space-y-2">
            <Label htmlFor="pos-expense-amount">Nominal (Rp)</Label>
            <Input id="pos-expense-amount" type="number" inputMode="numeric" min="1" step="1" placeholder="Contoh: 10000" value={amount} disabled={saving}
              onChange={(event) => { setAmount(event.target.value); requestId.current = null; }} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pos-expense-description">Keterangan</Label>
            <Textarea id="pos-expense-description" maxLength={500} placeholder="Contoh: Sumbangan kegiatan lingkungan" value={description} disabled={saving}
              onChange={(event) => { setDescription(event.target.value); requestId.current = null; }} />
          </div>
          {report && <ShiftExpenseSummary expenses={report.expenses} total={report.expenseTotal} />}
        </div>
        <div className="flex shrink-0 gap-2 border-t pt-3">
          <Button variant="outline" className="flex-1" disabled={saving} onClick={() => onOpenChange(false)}>Selesai</Button>
          <Button className="flex-1" disabled={saving || loading || !report || !amount || !description.trim() || !can('record_pos_expense')}
            onClick={() => void save()}>{saving ? 'Menyimpan...' : 'Simpan Pengeluaran'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
