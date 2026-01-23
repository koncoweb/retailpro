import { useState } from "react";
import { POSLayout } from "@/components/layout/POSLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  Download,
  Eye,
  Receipt,
  Calendar,
  CreditCard,
  Banknote,
  Wallet,
  Printer,
} from "lucide-react";
import { mockTransactions, mockBranches } from "@/data/mockData";
import { Transaction } from "@/types";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(value);
}

const paymentIcons: Record<string, React.ElementType> = {
  cash: Banknote,
  card: CreditCard,
  "e-wallet": Wallet,
  qris: Wallet,
};

const getBranchName = (branchId: string) => {
  const branch = mockBranches.find((b) => b.id === branchId);
  return branch ? branch.name : branchId;
};

export default function POSTransactions() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPayment, setSelectedPayment] = useState("all");
  const [selectedBranch, setSelectedBranch] = useState("all");

  const filteredTransactions = mockTransactions.filter((trx) => {
    const branchName = getBranchName(trx.branch_id);
    const matchesSearch =
      trx.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      trx.invoice_number.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesPayment = selectedPayment === "all" || trx.payment_method === selectedPayment;
    const matchesBranch = selectedBranch === "all" || trx.branch_id === selectedBranch;
    return matchesSearch && matchesPayment && matchesBranch;
  });

  const totalSales = filteredTransactions.reduce((sum, trx) => sum + trx.total_amount, 0);
  const totalTransactions = filteredTransactions.length;

  return (
    <POSLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold">Riwayat Transaksi</h1>
            <p className="text-muted-foreground mt-1">
              Daftar semua transaksi penjualan
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2">
              <Calendar className="w-4 h-4" />
              Hari Ini
            </Button>
            <Button variant="outline" className="gap-2">
              <Download className="w-4 h-4" />
              Export
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-card rounded-xl border p-4 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-primary/10">
                <Receipt className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Transaksi</p>
                <p className="text-2xl font-bold">{totalTransactions}</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border p-4 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-success/10">
                <Banknote className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Penjualan</p>
                <p className="text-xl font-bold text-success">{formatCurrency(totalSales)}</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border p-4 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-info/10">
                <CreditCard className="w-5 h-5 text-info" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Via Kartu</p>
                <p className="text-xl font-bold">
                  {formatCurrency(
                    mockTransactions.filter((t) => t.payment_method === "card").reduce((s, t) => s + t.total_amount, 0)
                  )}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border p-4 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-warning/10">
                <Wallet className="w-5 h-5 text-warning" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Via E-Wallet/QRIS</p>
                <p className="text-xl font-bold">
                  {formatCurrency(
                    mockTransactions.filter((t) => t.payment_method === "ewallet" || t.payment_method === "qris").reduce((s, t) => s + t.total_amount, 0)
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Search & Filter */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Cari transaksi..."
              className="pl-10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Select value={selectedPayment} onValueChange={setSelectedPayment}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Pembayaran" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua</SelectItem>
              <SelectItem value="cash">Tunai</SelectItem>
              <SelectItem value="card">Kartu</SelectItem>
              <SelectItem value="ewallet">E-Wallet</SelectItem>
              <SelectItem value="qris">QRIS</SelectItem>
            </SelectContent>
          </Select>
          <Select value={selectedBranch} onValueChange={setSelectedBranch}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Cabang" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua</SelectItem>
              {mockBranches.map((branch) => (
                <SelectItem key={branch.id} value={branch.id}>
                  {branch.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Transactions Table */}
        <div className="bg-card rounded-xl border overflow-hidden animate-fade-in">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID Transaksi</TableHead>
                <TableHead>Tanggal</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-center">Items</TableHead>
                <TableHead>Pembayaran</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTransactions.map((trx) => {
                const PaymentIcon = paymentIcons[trx.payment_method] || Receipt;
                const totalItems = trx.items.reduce((sum, item) => sum + item.quantity, 0);
                const branchName = getBranchName(trx.branch_id);
                const date = new Date(trx.created_at);
                
                return (
                  <TableRow key={trx.id} className="group">
                    <TableCell>
                      <span className="font-mono font-medium text-primary">{trx.id}</span>
                      <p className="text-xs text-muted-foreground">{trx.invoice_number}</p>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{date.toLocaleDateString('id-ID')}</p>
                        <p className="text-sm text-muted-foreground">{date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{trx.customer_id || "Walk-in Customer"}</p>
                        <p className="text-sm text-muted-foreground">
                          {trx.cashier_id} • {branchName}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary">{totalItems}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <PaymentIcon className="w-4 h-4 text-muted-foreground" />
                        <span className="capitalize">{trx.payment_method}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div>
                        <p className="font-bold">{formatCurrency(trx.total_amount)}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant={trx.status === "completed" ? "default" : "destructive"}
                        className={
                          trx.status === "completed"
                            ? "bg-success/20 text-success hover:bg-success/30"
                            : ""
                        }
                      >
                        {trx.status === "completed" ? "Selesai" : "Void"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon">
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon">
                          <Printer className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </POSLayout>
  );
}
