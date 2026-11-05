import { useState, useEffect, useMemo } from "react";
import { BackOfficeLayout } from "@/components/layout/BackOfficeLayout";
import { SalesChart } from "@/components/dashboard/SalesChart";
import { BranchPerformance } from "@/components/dashboard/BranchPerformance";
import { RecentTransactions } from "@/components/dashboard/RecentTransactions";
import { LowStockAlert } from "@/components/dashboard/LowStockAlert";
import { SalesDetailModal } from "@/components/dashboard/SalesDetailModal";
import { TransactionDetailModal } from "@/components/dashboard/TransactionDetailModal";
import { ProductSalesModal } from "@/components/dashboard/ProductSalesModal";
import { EmployeeDetailModal } from "@/components/dashboard/EmployeeDetailModal";
import { DollarSign, ShoppingCart, Package, Users, TrendingUp, TrendingDown, ClipboardList, Truck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { batchQuery } from "@/lib/db";
import { getPeriodRange, type ReportPeriod } from "@/lib/date-range";
import { useAuth } from "@/hooks/use-auth";
import { useBranchScope } from "@/hooks/use-permissions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const variantStyles = { primary: "bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20", success: "bg-gradient-to-br from-success/10 to-success/5 border-success/20", warning: "bg-gradient-to-br from-warning/10 to-warning/5 border-warning/20", info: "bg-gradient-to-br from-info/10 to-info/5 border-info/20" };
const iconStyles = { primary: "bg-primary/20 text-primary", success: "bg-success/20 text-success", warning: "bg-warning/20 text-warning", info: "bg-info/20 text-info" };

/** `all` is not a branch id — it means "aggregate every branch". */
const ALL_BRANCHES = "all";

const PERIOD_OPTIONS: { value: ReportPeriod; label: string; adjective: string }[] = [
  { value: "today", label: "Hari Ini", adjective: "Hari Ini" },
  { value: "thisweek", label: "Minggu Ini", adjective: "Minggu Ini" },
  { value: "thismonth", label: "Bulan Ini", adjective: "Bulan Ini" },
  { value: "thisyear", label: "Tahun Ini", adjective: "Tahun Ini" },
];

interface ClickableStatCardProps { title: string; value: string; change?: number; icon: React.ReactNode; variant: keyof typeof variantStyles; onClick: () => void; }

function ClickableStatCard({ title, value, change, icon, variant, onClick }: ClickableStatCardProps) {
  return (
    <button onClick={onClick} className={cn("rounded-xl border p-4 md:p-5 transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5 animate-fade-in text-left w-full cursor-pointer", variantStyles[variant])}>
      <div className="flex items-start justify-between">
        <div className="space-y-1 md:space-y-2">
          <p className="text-xs md:text-sm font-medium text-muted-foreground">{title}</p>
          <p className="text-xl md:text-2xl lg:text-3xl font-bold tracking-tight">{value}</p>
          {change !== undefined && <div className={cn("flex items-center gap-1 text-xs md:text-sm font-medium", change >= 0 ? "text-success" : "text-destructive")}>{change >= 0 ? <TrendingUp className="w-3 h-3 md:w-4 md:h-4" /> : <TrendingDown className="w-3 h-3 md:w-4 md:h-4" />}<span>{Math.abs(change)}% dari bulan lalu</span></div>}
        </div>
        <div className={cn("p-2 md:p-3 rounded-xl", iconStyles[variant])}>{icon}</div>
      </div>
    </button>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { branchIds, restricted } = useBranchScope();
  const navigate = useNavigate();
  const [salesModalOpen, setSalesModalOpen] = useState(false);
  const [transactionModalOpen, setTransactionModalOpen] = useState(false);
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [employeeModalOpen, setEmployeeModalOpen] = useState(false);

  const [period, setPeriod] = useState<ReportPeriod>("today");
  const [branchFilter, setBranchFilter] = useState<string>(ALL_BRANCHES);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [branchResolved, setBranchResolved] = useState(false);

  const [stats, setStats] = useState({
    todaySales: 0,
    todayTx: 0,
    productsSold: 0,
    activeEmployees: 0
  });

  /** Documents waiting for a decision — the queue an owner must not have to hunt for. */
  const [pending, setPending] = useState({
    poApproval: 0,
    requestApproval: 0,
    requestToShip: 0,
  });

  /**
   * Seed the branch filter from the signed-in user once the session resolves.
   * A cashier or manager is scoped to their own branch; an owner (no branch on
   * the session) starts on "Semua Cabang", which is the aggregate view.
   *
   * An owner-configured scope (`role_scopes` / a custom role) overrides that:
   * the picklist then only offers the branches inside it, and a role scoped to
   * exactly one branch cannot ask for the company view at all. Out-of-scope
   * numbers are not shown dimmed — they are not shown, and `scopeSentence`
   * says why.
   */
  useEffect(() => {
    if (!restricted || !branchIds || branchIds.length === 0) return;
    if (branchFilter === ALL_BRANCHES || !branchIds.includes(branchFilter)) {
      setBranchFilter(branchIds[0]);
      setBranchResolved(true);
    }
  }, [restricted, branchIds, branchFilter]);

  useEffect(() => {
    if (branchResolved || restricted) return;
    if (user?.branchId) {
      setBranchFilter(user.branchId);
      setBranchResolved(true);
    } else if (user) {
      setBranchFilter(ALL_BRANCHES);
      setBranchResolved(true);
    }
  }, [user, branchResolved, restricted]);

  /** Picklist options, already narrowed to what this role is allowed to see. */
  const visibleBranches = useMemo(
    () => (branchIds ? branches.filter((b) => branchIds.includes(b.id)) : branches),
    [branches, branchIds]
  );

  const scopeSentence = useMemo(() => {
    if (!restricted || !branchIds) return null;
    const names = branchIds
      .map((id) => branches.find((b) => b.id === id)?.name ?? id)
      .join(", ");
    return `Anda hanya melihat cabang: ${names}`;
  }, [restricted, branchIds, branches]);

  useEffect(() => {
    const fetchBranches = async () => {
      try {
        const [branchRes] = await batchQuery([
          { sql: "SELECT id, name FROM branches ORDER BY name" },
        ]);
        setBranches(branchRes.rows as unknown as { id: string; name: string }[]);
      } catch (e) {
        console.error("Dashboard branch fetch error", e);
      }
    };
    fetchBranches();
  }, []);

  useEffect(() => {
     /**
      * One batch, one round-trip. The headline counters are independent, so
      * paying four sequential network trips for them dominated first paint.
      *
      * Both filters are bound parameters: the period becomes a half-open
      * `>= start AND < end` range (so the query stays index-servable and does
      * not silently widen when the clock crosses midnight) and the branch adds
      * `branch_id = ?` instead of relying on the removed RLS policy.
      */
     const fetchData = async () => {
        const [start, end] = getPeriodRange(period);
        const scoped = branchFilter !== ALL_BRANCHES;
        const txArgs = scoped ? [start, end, branchFilter] : [start, end];
        const txWhere = scoped
          ? "WHERE created_at >= $1 AND created_at < $2 AND branch_id = $3"
          : "WHERE created_at >= $1 AND created_at < $2";
        // Same predicate, aliased for the join below.
        const itemWhere = scoped
          ? "WHERE t.created_at >= $1 AND t.created_at < $2 AND t.branch_id = $3"
          : "WHERE t.created_at >= $1 AND t.created_at < $2";

        try {
          const [salesRes, txRes, prodRes, empRes] = await batchQuery([
             {
               sql: `SELECT COALESCE(SUM(total_amount), 0) as val FROM transactions ${txWhere}`,
               params: txArgs,
             },
             {
               sql: `SELECT COUNT(*) as val FROM transactions ${txWhere}`,
               params: txArgs,
             },
             {
               sql: `SELECT COALESCE(SUM(ti.quantity), 0) as val
                       FROM transaction_items ti
                       JOIN transactions t ON ti.transaction_id = t.id
                      ${itemWhere}`,
               params: txArgs,
             },
             {
               // Headcount is a point-in-time fact, so the period does not
               // apply — only the branch scope does.
               sql: scoped
                 ? `SELECT COUNT(*) as val FROM users WHERE is_active = 1 AND assigned_branch_id = $1`
                 : `SELECT COUNT(*) as val FROM users WHERE is_active = 1`,
               params: scoped ? [branchFilter] : [],
             },
          ]);

          setStats({
             todaySales: parseFloat(String(salesRes.rows[0].val)),
             todayTx: parseInt(String(txRes.rows[0].val)),
             productsSold: parseInt(String(prodRes.rows[0].val)),
             activeEmployees: parseInt(String(empRes.rows[0].val))
          });
        } catch (e) {
           console.error("Dashboard fetch error", e);
        }
     };
     fetchData();
  }, [period, branchFilter]);

  /**
   * The pending queue is counted separately from the sales batch: these two
   * tables are independent of the reporting period, and a tenant missing one
   * of them must still render its headline figures.
   *
   * A scoped role gets the same branch predicate as the headline figures: a
   * badge counting another branch's queue would send them to click through to
   * a list they cannot open.
   */
  useEffect(() => {
    let cancelled = false;
    const inScope = branchIds ?? [];
    if (restricted && inScope.length === 0) {
      setPending({ poApproval: 0, requestApproval: 0, requestToShip: 0 });
      return;
    }
    const placeholders = inScope.map((_, index) => `$${index + 1}`).join(", ");
    const clause = restricted ? ` AND branch_id IN (${placeholders})` : "";
    const params = restricted ? inScope : [];
    batchQuery([
      {
        sql: `SELECT COUNT(*) AS val FROM purchase_orders WHERE status = 'submitted'${clause}`,
        params,
      },
      {
        sql: `SELECT COUNT(*) AS val FROM stock_requests WHERE status = 'submitted'${clause}`,
        params,
      },
      {
        sql: `SELECT COUNT(*) AS val FROM stock_requests WHERE status = 'approved'${clause}`,
        params,
      },
    ])
      .then(([poRes, requestRes, shipRes]) => {
        if (cancelled) return;
        setPending({
          poApproval: parseInt(String(poRes.rows[0].val)),
          requestApproval: parseInt(String(requestRes.rows[0].val)),
          requestToShip: parseInt(String(shipRes.rows[0].val)),
        });
      })
      .catch((e) => console.error("Dashboard pending fetch error", e));
    return () => {
      cancelled = true;
    };
  }, [restricted, branchIds]);

  const formatCurrency = (val: number) => {
     if (val >= 1000000000) return `Rp ${(val/1000000000).toFixed(1)} M`;
     if (val >= 1000000) return `Rp ${(val/1000000).toFixed(1)} Jt`;
     return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(val);
  };

  const periodAdjective = PERIOD_OPTIONS.find((p) => p.value === period)?.adjective ?? "Hari Ini";

  return (
    <BackOfficeLayout>
      <div className="space-y-4 md:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl md:text-2xl lg:text-3xl font-bold">Dashboard</h1>
            <p className="text-muted-foreground text-sm md:text-base mt-1">Selamat datang kembali! Berikut ringkasan bisnis Anda.</p>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <Select value={period} onValueChange={(v) => setPeriod(v as ReportPeriod)}>
              <SelectTrigger className="w-full sm:w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={branchFilter} onValueChange={setBranchFilter}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* A scoped role never gets the aggregate it is not allowed to see. */}
                {!restricted && (
                  <SelectItem value={ALL_BRANCHES}>Semua Cabang</SelectItem>
                )}
                {visibleBranches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs md:text-sm text-muted-foreground justify-end"><span>Update terakhir:</span><span className="font-medium text-foreground">{new Date().toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}</span></div>

        {scopeSentence && (
          <p className="text-xs md:text-sm text-muted-foreground justify-end">
            {scopeSentence}
          </p>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <ClickableStatCard title={`Total Penjualan ${periodAdjective}`} value={formatCurrency(stats.todaySales)} icon={<DollarSign className="w-5 h-5 md:w-6 md:h-6" />} variant="primary" onClick={() => setSalesModalOpen(true)} />
          <ClickableStatCard title={`Transaksi ${periodAdjective}`} value={stats.todayTx.toString()} icon={<ShoppingCart className="w-5 h-5 md:w-6 md:h-6" />} variant="info" onClick={() => setTransactionModalOpen(true)} />
          <ClickableStatCard title={`Produk Terjual ${periodAdjective}`} value={stats.productsSold.toLocaleString('id-ID')} icon={<Package className="w-5 h-5 md:w-6 md:h-6" />} variant="success" onClick={() => setProductModalOpen(true)} />
          <ClickableStatCard title="Karyawan Aktif" value={stats.activeEmployees.toString()} icon={<Users className="w-5 h-5 md:w-6 md:h-6" />} variant="warning" onClick={() => setEmployeeModalOpen(true)} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
          {[
            { label: "PO menunggu persetujuan", value: pending.poApproval, to: "/backoffice/inventory/po", icon: ClipboardList },
            { label: "Permintaan cabang menunggu", value: pending.requestApproval, to: "/backoffice/branches/orders", icon: ClipboardList },
            { label: "Siap dikirim ke cabang", value: pending.requestToShip, to: "/backoffice/branches/orders", icon: Truck },
          ].map((item) => (
            <button
              key={item.label}
              onClick={() => navigate(item.to)}
              className="rounded-xl border bg-card p-4 text-left transition-colors hover:bg-accent cursor-pointer"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs md:text-sm text-muted-foreground">{item.label}</p>
                  <p className="text-2xl font-bold mt-1">{item.value}</p>
                </div>
                <item.icon className={cn("w-5 h-5", item.value > 0 ? "text-warning" : "text-muted-foreground")} />
              </div>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6"><div className="lg:col-span-2"><SalesChart /></div><div><BranchPerformance /></div></div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6"><RecentTransactions /><LowStockAlert /></div>
      </div>

      <SalesDetailModal open={salesModalOpen} onOpenChange={setSalesModalOpen} />
      <TransactionDetailModal open={transactionModalOpen} onOpenChange={setTransactionModalOpen} />
      <ProductSalesModal open={productModalOpen} onOpenChange={setProductModalOpen} />
      <EmployeeDetailModal open={employeeModalOpen} onOpenChange={setEmployeeModalOpen} />
    </BackOfficeLayout>
  );
}
