import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart, Clock, Banknote, CreditCard, Wallet, Building2 } from "lucide-react";
import { query } from "@/lib/db";

interface TransactionDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Transaction {
  id: string;
  invoice_number: string;
  branch_name: string;
  created_at: string;
  amount_paid: number;
  payment_method: string;
  status: string;
}

interface BranchStat {
  name: string;
  transactions: number;
  amount: number;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(value);
}

export function TransactionDetailModal({
  open,
  onOpenChange,
}: TransactionDetailModalProps) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [liveTransactions, setLiveTransactions] = useState<Transaction[]>([]);
  const [branchStats, setBranchStats] = useState<BranchStat[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (open) {
      fetchData();
    }
  }, [open]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch recent transactions
      const txRes = await query(`
        SELECT 
          t.id, 
          t.invoice_number,
          b.name as branch_name, 
          t.created_at, 
          t.amount_paid, 
          t.payment_method, 
          t.status
        FROM transactions t
        LEFT JOIN branches b ON t.branch_id = b.id
        ORDER BY t.created_at DESC
        LIMIT 20
      `);
      
      setLiveTransactions(txRes.rows.map((row: any) => ({
        ...row,
        amount_paid: parseFloat(row.amount_paid)
      })));

      // Fetch branch stats
      const statsRes = await query(`
        SELECT 
          b.name, 
          COUNT(t.id) as tx_count, 
          COALESCE(SUM(t.amount_paid), 0) as total_amount
        FROM branches b
        LEFT JOIN transactions t ON b.id = t.branch_id AND t.created_at >= CURRENT_DATE
        GROUP BY b.id, b.name
        ORDER BY total_amount DESC
      `);

      setBranchStats(statsRes.rows.map((row: any) => ({
        name: row.name,
        transactions: parseInt(row.tx_count),
        amount: parseFloat(row.total_amount)
      })));

    } catch (error) {
      console.error("Failed to fetch transaction details:", error);
    } finally {
      setLoading(false);
    }
  };

  const getMethodIcon = (method: string) => {
    switch (method?.toLowerCase()) {
      case "cash":
        return <Banknote className="w-4 h-4 text-success" />;
      case "card":
        return <CreditCard className="w-4 h-4 text-info" />;
      case "ewallet":
      case "qris":
        return <Wallet className="w-4 h-4 text-warning" />;
      default:
        return <Banknote className="w-4 h-4 text-muted-foreground" />;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-info" />
            Transaksi Real-Time
            <Badge variant="outline" className="ml-auto">
              <Clock className="w-3 h-3 mr-1" />
              {currentTime.toLocaleTimeString("id-ID")}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Branch Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {branchStats.map((branch) => (
              <div
                key={branch.name}
                className="p-3 bg-muted/50 rounded-lg text-center"
              >
                <p className="text-sm text-muted-foreground">{branch.name}</p>
                <p className="text-xl font-bold">{branch.transactions}</p>
                <p className="text-xs text-muted-foreground">transaksi</p>
              </div>
            ))}
          </div>

          {/* Live Transactions */}
          <div>
            <h4 className="font-semibold mb-3 flex items-center gap-2">
              <span className="w-2 h-2 bg-success rounded-full animate-pulse" />
              Transaksi Terbaru
            </h4>
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Cabang</TableHead>
                    <TableHead>Waktu</TableHead>
                    <TableHead>Metode</TableHead>
                    <TableHead className="text-right">Jumlah</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && liveTransactions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-4">Loading...</TableCell>
                    </TableRow>
                  ) : liveTransactions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-4">Belum ada transaksi hari ini</TableCell>
                    </TableRow>
                  ) : (
                    liveTransactions.map((trx) => (
                      <TableRow key={trx.id} className="animate-fade-in">
                        <TableCell className="font-mono text-sm">{trx.invoice_number}</TableCell>
                        <TableCell className="flex items-center gap-2">
                          <Building2 className="w-4 h-4 text-muted-foreground" />
                          {trx.branch_name}
                        </TableCell>
                        <TableCell>
                          {new Date(trx.created_at).toLocaleTimeString("id-ID", {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getMethodIcon(trx.payment_method)}
                            <span className="capitalize text-xs">{trx.payment_method}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(trx.amount_paid)}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant={trx.status === "completed" ? "default" : "secondary"}
                            className={
                              trx.status === "completed"
                                ? "bg-success/20 text-success"
                                : "bg-warning/20 text-warning"
                            }
                          >
                            {trx.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
