import { useState, useEffect } from "react";
import { BackOfficeLayout } from "@/components/layout/BackOfficeLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { query } from "@/lib/db";
import { format } from "date-fns";
import { Loader2, FileSpreadsheet } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";

interface JournalEntry {
  id: string;
  date: string;
  description: string;
  ref: string;
  debit: number;
  credit: number;
  account: string;
  type: 'debit' | 'credit';
}

export default function Journal() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchJournal = async () => {
    setIsLoading(true);
    try {
      // 1. Fetch Sales Transactions (simplified journal: Debit Cash, Credit Sales)
      const salesRes = await query(`
        SELECT id, created_at, invoice_number, total_amount, payment_method, amount_paid
        FROM transactions
        WHERE status = 'completed'
        ORDER BY created_at DESC
        LIMIT 100
      `);

      // 2. Fetch Expenses (simplified journal: Debit Expense, Credit Cash/AP)
      const expenseRes = await query(`
        SELECT id, date, category, amount, description, status, amount_paid
        FROM expenses
        ORDER BY date DESC
        LIMIT 100
      `);

      const journalEntries: JournalEntry[] = [];

      // Process Sales
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      salesRes.rows.forEach((sale: any) => {
        // Debit Cash/Bank/Piutang
        const isPaid = parseFloat(sale.amount_paid) >= parseFloat(sale.total_amount);
        
        journalEntries.push({
          id: `${sale.id}-dr`,
          date: sale.created_at,
          description: `Penjualan ${sale.invoice_number}`,
          ref: sale.invoice_number,
          debit: parseFloat(sale.total_amount),
          credit: 0,
          account: isPaid ? (sale.payment_method === 'cash' ? 'Kas' : 'Bank/QRIS') : 'Piutang Usaha',
          type: 'debit'
        });
        // Credit Sales Revenue
        journalEntries.push({
          id: `${sale.id}-cr`,
          date: sale.created_at,
          description: `Pendapatan Penjualan ${sale.invoice_number}`,
          ref: sale.invoice_number,
          debit: 0,
          credit: parseFloat(sale.total_amount),
          account: 'Pendapatan Penjualan',
          type: 'credit'
        });
      });

      // Process Expenses
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expenseRes.rows.forEach((exp: any) => {
        const isPaid = exp.status === 'paid' || parseFloat(exp.amount_paid) >= parseFloat(exp.amount);
        
        // Debit Expense Category
        journalEntries.push({
          id: `${exp.id}-dr`,
          date: exp.date, 
          description: exp.description || `Biaya ${exp.category}`,
          ref: 'EXP',
          debit: parseFloat(exp.amount),
          credit: 0,
          account: `Biaya ${exp.category}`,
          type: 'debit'
        });
        // Credit Cash or Hutang
        journalEntries.push({
          id: `${exp.id}-cr`,
          date: exp.date,
          description: isPaid ? `Pembayaran Biaya ${exp.category}` : `Hutang Biaya ${exp.category}`,
          ref: 'EXP',
          debit: 0,
          credit: parseFloat(exp.amount),
          account: isPaid ? 'Kas' : 'Hutang Usaha',
          type: 'credit'
        });
      });

      // Sort by date desc
      journalEntries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      setEntries(journalEntries);
    } catch (error) {
      console.error("Failed to fetch journal data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchJournal();
  }, []);

  const handleExport = () => {
    if (entries.length === 0) {
      toast.error("Tidak ada data jurnal untuk diexport");
      return;
    }

    try {
      const exportData = entries.map(entry => ({
        "Tanggal": format(new Date(entry.date), "dd/MM/yyyy"),
        "Keterangan": entry.description,
        "Ref": entry.ref,
        "Akun": entry.account,
        "Debit": entry.debit,
        "Kredit": entry.credit,
        "Tipe": entry.type === 'debit' ? 'Debit' : 'Kredit'
      }));

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Jurnal Umum");

      // Auto-width
      const wscols = [{wch: 12}, {wch: 40}, {wch: 15}, {wch: 25}, {wch: 15}, {wch: 15}, {wch: 10}];
      ws['!cols'] = wscols;

      XLSX.writeFile(wb, `Jurnal_Umum_${format(new Date(), "yyyy-MM-dd")}.xlsx`);
      toast.success("Berhasil export jurnal umum");
    } catch (error) {
      console.error("Export failed:", error);
      toast.error("Gagal export jurnal");
    }
  };

  return (
    <BackOfficeLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold">Jurnal Umum</h1>
            <p className="text-muted-foreground">Catatan transaksi debit dan kredit</p>
          </div>
          <Button onClick={handleExport} variant="outline" className="gap-2">
            <FileSpreadsheet className="h-4 w-4" />
            Export Excel
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Buku Jurnal</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Keterangan</TableHead>
                  <TableHead>Ref</TableHead>
                  <TableHead>Akun</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Kredit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center">
                      <div className="flex justify-center items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading...
                      </div>
                    </TableCell>
                  </TableRow>
                ) : entries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      Tidak ada data jurnal
                    </TableCell>
                  </TableRow>
                ) : (
                  entries.map((entry) => (
                    <TableRow key={entry.id} className={entry.type === 'credit' ? "bg-muted/20" : ""}>
                      <TableCell>{format(new Date(entry.date), "dd/MM/yyyy")}</TableCell>
                      <TableCell>
                        <span className={entry.type === 'credit' ? "pl-8" : ""}>
                          {entry.description}
                        </span>
                      </TableCell>
                      <TableCell>{entry.ref}</TableCell>
                      <TableCell>{entry.account}</TableCell>
                      <TableCell className="text-right">
                        {entry.debit > 0 ? new Intl.NumberFormat("id-ID").format(entry.debit) : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        {entry.credit > 0 ? new Intl.NumberFormat("id-ID").format(entry.credit) : "-"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </BackOfficeLayout>
  );
}
