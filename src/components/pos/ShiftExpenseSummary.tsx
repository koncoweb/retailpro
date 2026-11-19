import type { ShiftExpense } from '@/lib/shift-cash';
import { formatCurrency } from '@/lib/utils';

export function ShiftExpenseSummary({ expenses, total }: { expenses: ShiftExpense[]; total: number }) {
  return (
    <section aria-label="Pengeluaran shift" className="rounded-lg border p-3 space-y-2">
      <div className="flex flex-wrap justify-between gap-1 text-sm font-semibold">
        <span>Pengeluaran non transaksi ({expenses.length})</span>
        <span className="text-destructive">{formatCurrency(total)}</span>
      </div>
      {expenses.length === 0 ? (
        <p className="text-xs text-muted-foreground">Belum ada pengeluaran pada shift ini.</p>
      ) : (
        <ul className="max-h-40 overflow-y-auto space-y-2 text-sm">
          {expenses.map((expense) => (
            <li key={expense.id} className="flex justify-between gap-3 border-t pt-2">
              <div className="min-w-0">
                <p className="break-words whitespace-pre-wrap">{expense.description}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(expense.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              <span className="shrink-0">{formatCurrency(expense.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">Dibayar dari kas laci; mengurangi saldo seharusnya, bukan total penjualan.</p>
    </section>
  );
}
