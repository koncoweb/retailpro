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

interface TransactionDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const liveTransactions = [
  { id: "TRX-001", branch: "Jakarta", time: "14:32", amount: 125000, method: "cash", status: "completed" },
  { id: "TRX-002", branch: "Surabaya", time: "14:30", amount: 89000, method: "ewallet", status: "completed" },
  { id: "TRX-003", branch: "Bandung", time: "14:28", amount: 245000, method: "card", status: "completed" },
  { id: "TRX-004", branch: "Jakarta", time: "14:25", amount: 67000, method: "cash", status: "completed" },
  { id: "TRX-005", branch: "Medan", time: "14:22", amount: 178000, method: "ewallet", status: "pending" },
  { id: "TRX-006", branch: "Surabaya", time: "14:20", amount: 312000, method: "card", status: "completed" },
];

const branchStats = [
  { name: "Jakarta", transactions: 85, amount: 18500000 },
  { name: "Surabaya", transactions: 62, amount: 12300000 },
  { name: "Bandung", transactions: 45, amount: 8900000 },
  { name: "Medan", transactions: 32, amount: 6100000 },
];

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

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const totalTransactions = branchStats.reduce((sum, b) => sum + b.transactions, 0);

  const getMethodIcon = (method: string) => {
    switch (method) {
      case "cash":
        return <Banknote className="w-4 h-4 text-success" />;
      case "card":
        return <CreditCard className="w-4 h-4 text-info" />;
      case "ewallet":
        return <Wallet className="w-4 h-4 text-warning" />;
      default:
        return null;
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
                  {liveTransactions.map((trx) => (
                    <TableRow key={trx.id} className="animate-fade-in">
                      <TableCell className="font-mono text-sm">{trx.id}</TableCell>
                      <TableCell className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-muted-foreground" />
                        {trx.branch}
                      </TableCell>
                      <TableCell>{trx.time}</TableCell>
                      <TableCell>{getMethodIcon(trx.method)}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(trx.amount)}
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
                          {trx.status === "completed" ? "Selesai" : "Proses"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Analytics */}
          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 bg-success/10 rounded-lg text-center">
              <Banknote className="w-6 h-6 mx-auto text-success mb-2" />
              <p className="text-sm text-muted-foreground">Tunai</p>
              <p className="text-xl font-bold">45%</p>
            </div>
            <div className="p-4 bg-info/10 rounded-lg text-center">
              <CreditCard className="w-6 h-6 mx-auto text-info mb-2" />
              <p className="text-sm text-muted-foreground">Kartu</p>
              <p className="text-xl font-bold">30%</p>
            </div>
            <div className="p-4 bg-warning/10 rounded-lg text-center">
              <Wallet className="w-6 h-6 mx-auto text-warning mb-2" />
              <p className="text-sm text-muted-foreground">E-Wallet</p>
              <p className="text-xl font-bold">25%</p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
