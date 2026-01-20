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

const transactions = [
  {
    id: "TRX-001",
    date: "2024-01-15 14:30",
    customer: "Walk-in Customer",
    items: 5,
    subtotal: 125000,
    discount: 12500,
    total: 112500,
    payment: "cash",
    cashier: "Andi Wijaya",
    branch: "Jakarta",
    status: "completed",
  },
  {
    id: "TRX-002",
    date: "2024-01-15 14:15",
    customer: "Member - Budi S.",
    items: 3,
    subtotal: 85000,
    discount: 8500,
    total: 76500,
    payment: "card",
    cashier: "Maya Sari",
    branch: "Surabaya",
    status: "completed",
  },
  {
    id: "TRX-003",
    date: "2024-01-15 13:45",
    customer: "Walk-in Customer",
    items: 8,
    subtotal: 245000,
    discount: 0,
    total: 245000,
    payment: "e-wallet",
    cashier: "Andi Wijaya",
    branch: "Jakarta",
    status: "completed",
  },
  {
    id: "TRX-004",
    date: "2024-01-15 13:20",
    customer: "Member - Dewi L.",
    items: 2,
    subtotal: 48000,
    discount: 4800,
    total: 43200,
    payment: "cash",
    cashier: "Andi Wijaya",
    branch: "Jakarta",
    status: "completed",
  },
  {
    id: "TRX-005",
    date: "2024-01-15 12:55",
    customer: "Walk-in Customer",
    items: 6,
    subtotal: 178000,
    discount: 0,
    total: 178000,
    payment: "card",
    cashier: "Maya Sari",
    branch: "Surabaya",
    status: "refunded",
  },
  {
    id: "TRX-006",
    date: "2024-01-15 12:30",
    customer: "Walk-in Customer",
    items: 4,
    subtotal: 92000,
    discount: 0,
    total: 92000,
    payment: "e-wallet",
    cashier: "Andi Wijaya",
    branch: "Jakarta",
    status: "completed",
  },
];

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
};

export default function POSTransactions() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPayment, setSelectedPayment] = useState("all");
  const [selectedBranch, setSelectedBranch] = useState("all");

  const filteredTransactions = transactions.filter((trx) => {
    const matchesSearch =
      trx.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      trx.customer.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesPayment = selectedPayment === "all" || trx.payment === selectedPayment;
    const matchesBranch = selectedBranch === "all" || trx.branch === selectedBranch;
    return matchesSearch && matchesPayment && matchesBranch;
  });

  const totalSales = filteredTransactions.reduce((sum, trx) => sum + trx.total, 0);
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
                    transactions.filter((t) => t.payment === "card").reduce((s, t) => s + t.total, 0)
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
                <p className="text-sm text-muted-foreground">Via E-Wallet</p>
                <p className="text-xl font-bold">
                  {formatCurrency(
                    transactions.filter((t) => t.payment === "e-wallet").reduce((s, t) => s + t.total, 0)
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
              <SelectItem value="e-wallet">E-Wallet</SelectItem>
            </SelectContent>
          </Select>
          <Select value={selectedBranch} onValueChange={setSelectedBranch}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Cabang" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua</SelectItem>
              <SelectItem value="Jakarta">Jakarta</SelectItem>
              <SelectItem value="Surabaya">Surabaya</SelectItem>
              <SelectItem value="Bandung">Bandung</SelectItem>
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
                const PaymentIcon = paymentIcons[trx.payment] || Receipt;
                return (
                  <TableRow key={trx.id} className="group">
                    <TableCell>
                      <span className="font-mono font-medium text-primary">{trx.id}</span>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{trx.date.split(" ")[0]}</p>
                        <p className="text-sm text-muted-foreground">{trx.date.split(" ")[1]}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{trx.customer}</p>
                        <p className="text-sm text-muted-foreground">
                          {trx.cashier} • {trx.branch}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary">{trx.items}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <PaymentIcon className="w-4 h-4 text-muted-foreground" />
                        <span className="capitalize">{trx.payment}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div>
                        <p className="font-bold">{formatCurrency(trx.total)}</p>
                        {trx.discount > 0 && (
                          <p className="text-sm text-success">-{formatCurrency(trx.discount)}</p>
                        )}
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
                        {trx.status === "completed" ? "Selesai" : "Refund"}
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
