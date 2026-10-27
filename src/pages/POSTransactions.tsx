import { useState, useEffect } from "react";
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
  Loader2,
} from "lucide-react";
import { Transaction, Branch } from "@/types";
import { PaginationBar } from "@/components/ui/pagination-bar";
import { batchQuery, parseJson } from "@/lib/db";
import * as XLSX from 'xlsx';
import { toast } from "sonner";

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

const PAGE_SIZE = 50;

export default function POSTransactions() {
  const [searchQuery, setSearchQuery] = useState("");
  // Debounced copy of the search box: one query per pause, not per keystroke.
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPayment, setSelectedPayment] = useState("all");
  const [selectedBranch, setSelectedBranch] = useState("all");
  const [page, setPage] = useState(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [totals, setTotals] = useState({ count: 0, sales: 0, card: 0, wallet: 0 });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(searchQuery);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        // Filters run in SQL, not on the already-fetched rows: the list is
        // paginated, so client-side filtering would only ever search the
        // current page and the headline totals would be wrong.
        const where: string[] = [];
        const args: unknown[] = [];

        if (selectedBranch !== "all") {
          args.push(selectedBranch);
          where.push(`t.branch_id = $${args.length}`);
        }
        if (selectedPayment !== "all") {
          args.push(selectedPayment);
          where.push(`t.payment_method = $${args.length}`);
        }
        const term = searchTerm.trim();
        if (term) {
          args.push(`%${term}%`, `%${term}%`);
          where.push(`(t.invoice_number LIKE $${args.length - 1} OR t.id LIKE $${args.length})`);
        }
        const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

        const limitIdx = args.length + 1;
        const offsetIdx = args.length + 2;

        // JSON1 bundles the items with the transaction, and the aggregate row
        // covers every matching transaction, not just this page. One batch =
        // one round trip for list, totals and branches.
        const [trxRes, totalsRes, branchesRes] = await batchQuery([
          {
            sql: `
              SELECT 
                t.id, t.branch_id, t.cashier_id, t.customer_id, 
                t.invoice_number, t.total_amount, t.amount_paid, t.payment_method, t.status, t.created_at,
                u.name as cashier_name,
                COALESCE(
                  json_group_array(
                    json_object(
                      'id', ti.id,
                      'product_id', ti.product_id,
                      'product_name', p.name,
                      'quantity', ti.quantity,
                      'unit_price', ti.unit_price,
                      'subtotal', ti.subtotal,
                      'unit_name', ti.unit_name
                    )
                  ) FILTER (WHERE ti.id IS NOT NULL),
                  '[]'
                ) as items
              FROM transactions t
              LEFT JOIN transaction_items ti ON t.id = ti.transaction_id
              LEFT JOIN products p ON ti.product_id = p.id
              LEFT JOIN users u ON t.cashier_id = u.id
              ${whereSql}
              GROUP BY t.id, u.name
              ORDER BY t.created_at DESC
              LIMIT $${limitIdx} OFFSET $${offsetIdx}
            `,
            params: [...args, PAGE_SIZE, page * PAGE_SIZE],
          },
          {
            sql: `
              SELECT 
                COUNT(*) as total,
                COALESCE(SUM(t.total_amount), 0) as sales,
                COALESCE(SUM(CASE WHEN t.payment_method = 'card' THEN t.total_amount ELSE 0 END), 0) as card_sales,
                COALESCE(SUM(CASE WHEN t.payment_method IN ('ewallet','e-wallet','qris') THEN t.total_amount ELSE 0 END), 0) as wallet_sales
              FROM transactions t
              ${whereSql}
            `,
            params: args,
          },
          { sql: 'SELECT * FROM branches ORDER BY name' },
        ]);

        // Map to Transaction type
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mappedTrx: Transaction[] = (trxRes.rows as any[]).map((row) => ({
            ...row,
            created_at: new Date(row.created_at).toISOString(),
            // JSON columns arrive as TEXT — parse them before use.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            items: parseJson<any[]>(row.items, [])
        }));

        const aggregate = totalsRes.rows[0] as {
          total: number; sales: number; card_sales: number; wallet_sales: number;
        };

        setTransactions(mappedTrx);
        setBranches(branchesRes.rows as unknown as Branch[]);
        setTotals({
          count: Number(aggregate?.total ?? 0),
          sales: Number(aggregate?.sales ?? 0),
          card: Number(aggregate?.card_sales ?? 0),
          wallet: Number(aggregate?.wallet_sales ?? 0),
        });
      } catch (error) {
        console.error("Failed to fetch data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [page, searchTerm, selectedPayment, selectedBranch]);

  const getBranchName = (branchId: string) => {
    const branch = branches.find((b) => b.id === branchId);
    return branch ? branch.name : branchId;
  };

  const totalSales = totals.sales;
  const totalTransactions = totals.count;

  const handleExport = () => {
    if (transactions.length === 0) {
      toast.error("Tidak ada data untuk diexport");
      return;
    }

    const exportData = transactions.map(trx => ({
      "ID Transaksi": trx.id,
      "Invoice": trx.invoice_number,
      "Tanggal": new Date(trx.created_at).toLocaleDateString('id-ID'),
      "Waktu": new Date(trx.created_at).toLocaleTimeString('id-ID'),
      "Kasir": (trx as any).cashier_name || "Unknown",
      "Customer": trx.customer_id || "Walk-in",
      "Cabang": getBranchName(trx.branch_id),
      "Pembayaran": trx.payment_method,
      "Total Items": trx.items.reduce((sum, item) => sum + item.quantity, 0),
      "Total Amount": trx.total_amount,
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Transaksi");

    // Auto-width
    ws['!cols'] = [
      { wch: 20 }, // ID
      { wch: 15 }, // Invoice
      { wch: 12 }, // Tanggal
      { wch: 10 }, // Waktu
      { wch: 20 }, // Customer
      { wch: 15 }, // Cabang
      { wch: 12 }, // Pembayaran
      { wch: 10 }, // Items
      { wch: 15 }, // Total
      { wch: 10 }, // Status
    ];

    XLSX.writeFile(wb, `Transaksi_POS_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success("Berhasil export data transaksi");
  };

  if (isLoading) {
    return (
        <POSLayout>
            <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        </POSLayout>
    );
  }

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
            <Button variant="outline" className="gap-2" onClick={handleExport}>
              <Download className="w-4 h-4" />
              Export Excel
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
                  {formatCurrency(totals.card)}
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
                  {formatCurrency(totals.wallet)}
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
          <Select value={selectedPayment} onValueChange={(v) => { setSelectedPayment(v); setPage(0); }}>
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
          <Select value={selectedBranch} onValueChange={(v) => { setSelectedBranch(v); setPage(0); }}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Cabang" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua</SelectItem>
              {branches.map((branch) => (
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
              {transactions.length === 0 ? (
                <TableRow>
                    <TableCell colSpan={8} className="text-center h-24 text-muted-foreground">
                        Tidak ada transaksi ditemukan
                    </TableCell>
                </TableRow>
              ) : (
                transactions.map((trx) => {
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
                            {(trx as any).cashier_name || trx.cashier_id} • {branchName}
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
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination: the list is server-paged so a long history never loads
            all at once. */}
        <PaginationBar
          page={page}
          pageSize={PAGE_SIZE}
          total={totals.count}
          onPageChange={setPage}
          label="transaksi"
        />
      </div>
    </POSLayout>
  );
}