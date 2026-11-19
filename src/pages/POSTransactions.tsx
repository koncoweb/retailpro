import { useState, useEffect } from "react";
import { PermissionGate } from "@/components/auth/PermissionGate";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { POSLayout } from "@/components/layout/POSLayout";
import { VoidDialog, type VoidMode } from "@/components/pos/VoidDialog";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Search,
  Download,
  Eye,
  Receipt,
  Calendar,
  CreditCard,
  Banknote,
  Wallet,
  Landmark,
  QrCode,
  Printer,
  Loader2,
  Ban,
} from "lucide-react";
import { Transaction, TransactionItem, Branch } from "@/types";
import { PaginationBar } from "@/components/ui/pagination-bar";
import { batchQuery, parseJson } from "@/lib/db";
import { cn } from "@/lib/utils";
import * as XLSX from 'xlsx';
import { toast } from "sonner";
import {
  loadPrintContext,
  viaLabel,
  type PrintContext,
} from "@/lib/print/print-service";
import { printSaleReceipt } from "@/lib/print/receipt-printer";
import { OWNER_TIER_ROLES, type VoidActor } from "@/lib/void";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(value);
}

const paymentIcons: Record<string, React.ElementType> = {
  cash: Banknote,
  transfer: Landmark,
  card: CreditCard,
  debit: CreditCard,
  credit: CreditCard,
  "e-wallet": Wallet,
  ewallet: Wallet,
  qris: QrCode,
};

/** Indonesian labels for `transactions.payment_method`, including legacy values. */
const paymentLabels: Record<string, string> = {
  cash: "Tunai",
  transfer: "Transfer Bank",
  card: "Kartu",
  debit: "Kartu Debit",
  credit: "Kartu Kredit",
  ewallet: "E-Wallet",
  "e-wallet": "E-Wallet",
  qris: "QRIS",
};

function paymentLabel(method: string) {
  return paymentLabels[method] ?? method;
}

const PAGE_SIZE = 50;

export default function POSTransactions() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const [searchQuery, setSearchQuery] = useState("");
  // Debounced copy of the search box: one query per pause, not per keystroke.
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPayment, setSelectedPayment] = useState("all");
  const [selectedBranch, setSelectedBranch] = useState("all");
  // Voids stay in the list — a cancelled bon is still a transaction — so the
  // status filter is a view choice, not a way to hide the trail.
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [page, setPage] = useState(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [totals, setTotals] = useState({ count: 0, sales: 0, card: 0, wallet: 0, voids: 0 });
  const [isLoading, setIsLoading] = useState(true);
  // The receipt view the Eye button never opened. One dialog serves both
  // desktop (button) and mobile (tapping the whole card), sized to the
  // viewport on phones so a long item list scrolls instead of overflowing.
  const [detailTx, setDetailTx] = useState<Transaction | null>(null);
  // Print context + which row is mid-print so the button can show a spinner and
  // a double-tap cannot queue two struks for one invoice.
  const [printCtx, setPrintCtx] = useState<PrintContext | null>(null);
  const [printingId, setPrintingId] = useState<string | null>(null);
  // Bumped after a void so the list re-reads the new totals/void marks.
  const [reloadKey, setReloadKey] = useState(0);
  // The void being confirmed: which bon, which shape, and which lines.
  const [voidRequest, setVoidRequest] = useState<{
    tx: Transaction;
    mode: VoidMode;
    items: TransactionItem[];
  } | null>(null);

  /**
   * Who is voiding. `voidGuard()` in `src/lib/void.ts` re-checks everything
   * here — this mirror only decides what the buttons look like, so a cashier
   * without the permission never sees a control that would fail on click.
   */
  const canVoid = can("void_transaction");
  const isOwnerTier = !!user && OWNER_TIER_ROLES.includes(user.role);
  const voidActor: VoidActor | null = user
    ? { id: user.id, role: user.role, canVoid }
    : null;
  const canVoidTx = (trx: Transaction) =>
    canVoid &&
    trx.status === "completed" &&
    // Open-shift rule: a closed shift's Z-report is owner/admin territory.
    (trx.shift_status === "open" || isOwnerTier);
  /** True when the bon is voidable except for the shift being closed. */
  const blockedByClosedShift = (trx: Transaction) =>
    canVoid && trx.status === "completed" && trx.shift_status !== "open" && !isOwnerTier;

  useEffect(() => {
    let cancelled = false;
    loadPrintContext()
      .then((ctx) => {
        if (!cancelled) setPrintCtx(ctx);
      })
      .catch((error) => console.error("Failed to load print settings:", error));
    return () => {
      cancelled = true;
    };
  }, []);

  const handleReprint = async (trx: Transaction) => {
    if (!printCtx) {
      toast.error("Pengaturan printer belum termuat. Muat ulang halaman lalu coba lagi.");
      return;
    }
    setPrintingId(trx.id);
    try {
      // Re-query by id (not from the list row) so variant labels and the
      // member name match the receipt that printed at the till.
      const result = await printSaleReceipt(trx.id, printCtx);
      if (result.ok) toast.success(`Struk ${trx.invoice_number} tercetak via ${viaLabel(result.via)}.`);
      else toast.error(result.error ?? "Gagal mencetak struk.");
    } catch (error) {
      console.error("Reprint failed:", error);
      toast.error(error instanceof Error ? error.message : "Gagal mencetak struk.");
    } finally {
      setPrintingId(null);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(searchQuery);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  /** Asks for the reason before anything is written — see `VoidDialog`. */
  const openVoid = (trx: Transaction, mode: VoidMode, items: TransactionItem[]) => {
    if (!voidActor) {
      toast.error("Sesi Anda belum termuat. Muat ulang halaman lalu coba lagi.");
      return;
    }
    setVoidRequest({ tx: trx, mode, items });
  };

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
        if (selectedStatus !== "all") {
          args.push(selectedStatus);
          where.push(`t.status = $${args.length}`);
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
                t.fee_amount, t.fee_label, t.source,
                t.void_reason, t.voided_by, t.voided_at,
                u.name as cashier_name,
                c.name as customer_name,
                u2.name as voided_by_name,
                sh.status as shift_status,
                COALESCE(
                  json_group_array(
                    json_object(
                      'id', ti.id,
                      'product_id', ti.product_id,
                      'product_name', p.name,
                      'quantity', ti.quantity,
                      'unit_price', ti.unit_price,
                      'subtotal', ti.subtotal,
                      'unit_name', ti.unit_name,
                      'voided', ti.voided,
                      'void_reason', ti.void_reason
                    )
                  ) FILTER (WHERE ti.id IS NOT NULL),
                  '[]'
                ) as items
              FROM transactions t
              LEFT JOIN transaction_items ti ON t.id = ti.transaction_id
              LEFT JOIN products p ON ti.product_id = p.id
              LEFT JOIN users u ON t.cashier_id = u.id
              LEFT JOIN users u2 ON t.voided_by = u2.id
              LEFT JOIN customers c ON t.customer_id = c.id
              LEFT JOIN shifts sh ON t.shift_id = sh.id
              ${whereSql}
              GROUP BY t.id, u.name, c.name, u2.name, sh.status
              ORDER BY t.created_at DESC
              LIMIT $${limitIdx} OFFSET $${offsetIdx}
            `,
            params: [...args, PAGE_SIZE, page * PAGE_SIZE],
          },
          {
            sql: `
              SELECT 
                COUNT(*) as total,
                COALESCE(SUM(CASE WHEN t.status = 'completed' THEN t.total_amount ELSE 0 END), 0) as sales,
                COALESCE(SUM(CASE WHEN t.status = 'completed' AND t.payment_method = 'card' THEN t.total_amount ELSE 0 END), 0) as card_sales,
                COALESCE(SUM(CASE WHEN t.status = 'completed' AND t.payment_method IN ('ewallet','e-wallet','qris') THEN t.total_amount ELSE 0 END), 0) as wallet_sales,
                COALESCE(SUM(CASE WHEN t.status = 'void' THEN 1 ELSE 0 END), 0) as void_count
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
          total: number; sales: number; card_sales: number; wallet_sales: number; void_count: number;
        };

        setTransactions(mappedTrx);
        setBranches(branchesRes.rows as unknown as Branch[]);
        setTotals({
          count: Number(aggregate?.total ?? 0),
          sales: Number(aggregate?.sales ?? 0),
          card: Number(aggregate?.card_sales ?? 0),
          wallet: Number(aggregate?.wallet_sales ?? 0),
          voids: Number(aggregate?.void_count ?? 0),
        });
      } catch (error) {
        console.error("Failed to fetch data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [page, searchTerm, selectedPayment, selectedBranch, selectedStatus, reloadKey]);

  const getBranchName = (branchId: string) => {
    const branch = branches.find((b) => b.id === branchId);
    return branch ? branch.name : branchId;
  };

  const totalSales = totals.sales;
  const totalTransactions = totals.count;
  // The "Biaya" column is a merchant cost most tills never incur (cash), so it
  // only earns screen space when the current page actually has a fee to show.
  const hasFee = transactions.some((trx) => Number(trx.fee_amount) > 0);

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
      "Kasir": trx.cashier_name || "Unknown",
      "Customer": trx.customer_name || "Walk-in",
      "Outlet": getBranchName(trx.branch_id),
      "Pembayaran": trx.payment_method,
      "Total Items": trx.items.reduce((sum, item) => sum + item.quantity, 0),
      "Total Amount": trx.total_amount,
      "Biaya Merchant": Number(trx.fee_amount ?? 0),
      "Kanal": trx.source ?? "pos",
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
            <PermissionGate permission="export_reports">
              <Button variant="outline" className="gap-2" onClick={handleExport}>
                <Download className="w-4 h-4" />
                Export Excel
              </Button>
            </PermissionGate>
          </div>
        </div>

        {/* Stats: "Rp 113.063.000" carries a non-breaking space, so a card
            cannot shrink below ~220px. Two columns inside a 390px phone were
            therefore pushed sideways; phones get one card per row. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
                {/* The money cards only add up completed bons, so say what was
                    taken out rather than letting a void silently shrink a day. */}
                {totals.voids > 0 && (
                  <p className="text-xs text-muted-foreground">{totals.voids} bon di-void (tidak dihitung)</p>
                )}
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

        {/* Search & Filter: stacked full-width on phones, inline from sm. */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1 sm:max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Cari transaksi..."
              className="pl-10 text-base"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Select value={selectedPayment} onValueChange={(v) => { setSelectedPayment(v); setPage(0); }}>
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue placeholder="Pembayaran" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua</SelectItem>
              <SelectItem value="cash">Tunai</SelectItem>
              <SelectItem value="transfer">Transfer Bank</SelectItem>
              <SelectItem value="card">Kartu</SelectItem>
              <SelectItem value="ewallet">E-Wallet</SelectItem>
              <SelectItem value="qris">QRIS</SelectItem>
            </SelectContent>
          </Select>
          <Select value={selectedStatus} onValueChange={(v) => { setSelectedStatus(v); setPage(0); }}>
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Status</SelectItem>
              <SelectItem value="completed">Selesai</SelectItem>
              <SelectItem value="void">Void</SelectItem>
            </SelectContent>
          </Select>
          <Select value={selectedBranch} onValueChange={(v) => { setSelectedBranch(v); setPage(0); }}>
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue placeholder="Outlet" />
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

        {/* Transactions: the eight-column table from md up; on phones each
            transaction is a compact card that opens the same detail dialog,
            because an eight-column grid over 360px is not a table, it is
            homework. Between md and lg the eight columns still want ~896px, so
            the wrapper scrolls sideways rather than clipping the status column
            off-screen. */}
        <div className="hidden md:block bg-card rounded-xl border overflow-x-auto animate-fade-in">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID Transaksi</TableHead>
                <TableHead>Tanggal</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-center">Items</TableHead>
                <TableHead>Pembayaran</TableHead>
                {hasFee && <TableHead className="text-right">Biaya</TableHead>}
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.length === 0 ? (
                <TableRow>
                    <TableCell colSpan={hasFee ? 9 : 8} className="text-center h-24 text-muted-foreground">
                        Tidak ada transaksi ditemukan
                    </TableCell>
                </TableRow>
              ) : (
                transactions.map((trx) => {
                    const PaymentIcon = paymentIcons[trx.payment_method] || Receipt;
                    // Voids never delete a line, so "items" counts what was sold;
                    // the struck count is shown next to it, not hidden inside it.
                    const voidedItems = trx.items.filter((item) => Number(item.voided ?? 0) === 1).length;
                    const totalItems = trx.items
                      .filter((item) => Number(item.voided ?? 0) !== 1)
                      .reduce((sum, item) => sum + item.quantity, 0);
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
                            <p className="font-medium">{trx.customer_name || "Walk-in Customer"}</p>
                            <p className="text-sm text-muted-foreground">
                            {trx.cashier_name || trx.cashier_id} • {branchName}
                            </p>
                        </div>
                        </TableCell>
                        <TableCell className="text-center">
                        <Badge variant="secondary">{totalItems}</Badge>
                        {voidedItems > 0 && (
                          <p className="text-[10px] text-muted-foreground">{voidedItems} dicoret</p>
                        )}
                        </TableCell>
                        <TableCell>
                        <div className="flex items-center gap-2">
                            <PaymentIcon className="w-4 h-4 text-muted-foreground" />
                            <span>{paymentLabel(trx.payment_method)}</span>
                            {trx.source === "online" && (
                              <Badge variant="secondary" className="text-[10px]">Online</Badge>
                            )}
                        </div>
                        </TableCell>
                        {hasFee && (
                          <TableCell className="text-right text-sm text-muted-foreground">
                            {Number(trx.fee_amount) > 0 ? formatCurrency(Number(trx.fee_amount)) : "—"}
                          </TableCell>
                        )}
                        <TableCell className="text-right">
                        <div>
                            <p className={cn("font-bold", trx.status === "void" && "line-through text-muted-foreground")}>{formatCurrency(trx.total_amount)}</p>
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
                            <Button variant="ghost" size="icon" onClick={() => setDetailTx(trx)}>
                            <Eye className="w-4 h-4" />
                            </Button>
                            <Button
                            variant="ghost"
                            size="icon"
                            title="Cetak ulang struk"
                            aria-label="Cetak ulang struk"
                            disabled={printingId === trx.id}
                            onClick={() => handleReprint(trx)}
                            >
                            {printingId === trx.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <Printer className="w-4 h-4" />
                            )}
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

        {/* <md: the same rows as cards; tap opens the receipt detail. */}
        <div className="md:hidden space-y-3">
          {transactions.length === 0 ? (
            <div className="bg-card rounded-xl border p-8 text-center text-muted-foreground">
              Tidak ada transaksi ditemukan
            </div>
          ) : (
            transactions.map((trx) => {
              const PaymentIcon = paymentIcons[trx.payment_method] || Receipt;
              const voidedItems = trx.items.filter((item) => Number(item.voided ?? 0) === 1).length;
              const totalItems = trx.items
                .filter((item) => Number(item.voided ?? 0) !== 1)
                .reduce((sum, item) => sum + item.quantity, 0);
              const date = new Date(trx.created_at);
              return (
                <button
                  key={trx.id}
                  onClick={() => setDetailTx(trx)}
                  className="w-full text-left bg-card rounded-xl border p-3 active:bg-muted/50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-primary truncate">{trx.invoice_number || trx.id}</span>
                    <Badge
                      variant={trx.status === "completed" ? "default" : "destructive"}
                      className={
                        trx.status === "completed"
                          ? "bg-success/20 text-success hover:bg-success/30 shrink-0"
                          : "shrink-0"
                      }
                    >
                      {trx.status === "completed" ? "Selesai" : "Void"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="text-xs text-muted-foreground">
                      {date.toLocaleDateString('id-ID')} {date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                      {' · '}
                      <span className="inline-flex items-center gap-1">
                        <PaymentIcon className="w-3.5 h-3.5" />{paymentLabel(trx.payment_method)}
                      </span>
                      {' · '}{totalItems} item{voidedItems > 0 ? ` (${voidedItems} void)` : ""}
                    </div>
                    <p className="font-bold text-sm ml-2">{formatCurrency(trx.total_amount)}</p>
                  </div>
                </button>
              );
            })
          )}
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

      {/* Receipt detail: full-bleed on phones (`w-[95vw]`), bounded from sm. */}
      <Dialog open={!!detailTx} onOpenChange={(open) => { if (!open) setDetailTx(null); }}>
        <DialogContent className="w-[95vw] max-w-[95vw] sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="w-5 h-5" />
              Detail Transaksi
            </DialogTitle>
          </DialogHeader>
          {detailTx && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Invoice</p>
                  <p className="font-medium break-all">{detailTx.invoice_number || detailTx.id}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Tanggal</p>
                  <p>{new Date(detailTx.created_at).toLocaleString('id-ID')}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Kasir</p>
                  <p>{detailTx.cashier_name || detailTx.cashier_id}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Outlet</p>
                  <p>{getBranchName(detailTx.branch_id)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Pembayaran</p>
                  <p>{paymentLabel(detailTx.payment_method)}{detailTx.source === "online" ? " · Online" : ""}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <p>{detailTx.status === "completed" ? "Selesai" : "Void"}</p>
                </div>
              </div>
              {/* Bon-level void trail: the cancelled amount stays on the record,
                  so the note says who cancelled it and why. */}
              {detailTx.status === "void" && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm space-y-1">
                  <p className="font-medium text-destructive">Transaksi dibatalkan</p>
                  <p className="text-xs text-muted-foreground">Alasan: {detailTx.void_reason || "-"}</p>
                  <p className="text-xs text-muted-foreground">
                    Oleh {detailTx.voided_by_name || detailTx.voided_by || "-"}
                    {detailTx.voided_at ? ` • ${new Date(detailTx.voided_at).toLocaleString("id-ID")}` : ""}
                  </p>
                </div>
              )}
              <div className="border rounded-lg divide-y">
                {detailTx.items.map((item) => {
                  const isVoided = Number(item.voided ?? 0) === 1;
                  return (
                    <div key={item.id} className="flex items-center justify-between gap-2 p-2 text-sm">
                      <div className="min-w-0">
                        <p className={cn("truncate", isVoided && "line-through text-muted-foreground")}>
                          {item.product_name}
                          {isVoided && (
                            <Badge variant="destructive" className="ml-2 text-[10px]">VOID</Badge>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.quantity}{item.unit_name ? ` ${item.unit_name}` : ""} × {formatCurrency(item.unit_price)}
                        </p>
                        {isVoided && item.void_reason && (
                          <p className="text-xs text-muted-foreground">Alasan: {item.void_reason}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <p className={cn("font-medium", isVoided && "line-through text-muted-foreground")}>
                          {formatCurrency(item.subtotal)}
                        </p>
                        {/* One click per line, but nothing is written until the
                            reason is confirmed in the dialog. */}
                        {!isVoided && canVoidTx(detailTx) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 text-destructive hover:text-destructive"
                            onClick={() => openVoid(detailTx, "items", [item])}
                          >
                            <Ban className="w-3.5 h-3.5" />
                            Void
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between text-lg font-bold border-t pt-3">
                <span>Total</span>
                <span
                  className={cn(
                    "text-primary",
                    detailTx.status === "void" && "line-through text-muted-foreground"
                  )}
                >
                  {formatCurrency(detailTx.total_amount)}
                </span>
              </div>
              {Number(detailTx.fee_amount) > 0 && (
                <div className="flex justify-between text-sm text-muted-foreground -mt-2">
                  <span>Biaya merchant{detailTx.fee_label ? ` (${detailTx.fee_label})` : ""}</span>
                  <span>{formatCurrency(Number(detailTx.fee_amount))}</span>
                </div>
              )}
              <Button className="w-full gap-2" disabled={printingId === detailTx.id} onClick={() => handleReprint(detailTx)}>
                {printingId === detailTx.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Printer className="w-4 h-4" />
                )}
                Cetak Struk
              </Button>
              {canVoidTx(detailTx) && (
                <Button
                  variant="destructive"
                  className="w-full gap-2"
                  onClick={() => openVoid(detailTx, "bon", [])}
                >
                  <Ban className="w-4 h-4" />
                  Void Bon
                </Button>
              )}
              {blockedByClosedShift(detailTx) && (
                <p className="text-xs text-muted-foreground text-center">
                  Shift transaksi ini sudah ditutup; hanya owner/admin yang dapat mem-void.
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <VoidDialog
        open={!!voidRequest}
        onOpenChange={(next) => { if (!next) setVoidRequest(null); }}
        transaction={voidRequest?.tx ?? null}
        mode={voidRequest?.mode ?? "bon"}
        items={voidRequest?.items ?? []}
        actor={voidActor}
        printCtx={printCtx}
        onVoided={() => {
          // The totals, the struck lines and the void badge all come from the
          // same re-read, so nothing here is patched client-side.
          setDetailTx(null);
          setReloadKey((key) => key + 1);
        }}
      />
    </POSLayout>
  );
}