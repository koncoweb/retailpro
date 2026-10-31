import { ReactNode, useEffect, useState } from "react";
import { NavLink, useLocation, Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Building2,
  Package,
  Users,
  CreditCard,
  BarChart3,
  Settings,
  ChevronDown,
  ChevronRight,
  Store,
  ArrowLeftRight,
  FileText,
  Calculator,
  UserCheck,
  Calendar,
  DollarSign,
  Shield,
  Menu,
  X,
  LogOut,
  Moon,
  Sun,
  Warehouse,
  Contact,
  Truck,
  ClipboardList,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/use-theme";
import { useAuth } from "@/hooks/use-auth";
import { useSignOut } from "@/hooks/use-sign-out";
import { ROLES } from "@/config/roles";
import { query } from "@/lib/db";
import type { UserRole } from "@/types";

interface BackOfficeLayoutProps {
  children: ReactNode;
}

interface NavChild {
  title: string;
  path: string;
  icon: React.ElementType;
  /** Absent means every role that reaches the back office sees it. */
  allowedRoles?: UserRole[];
  /** Which counter, if any, to render next to the label. */
  badge?: "pendingOrders";
}

interface NavItem {
  title: string;
  icon: React.ElementType;
  path?: string;
  allowedRoles?: UserRole[];
  children?: NavChild[];
}

const MANAGER_ROLES: UserRole[] = [
  "platform_owner",
  "tenant_owner",
  "tenant_admin",
  "store_manager",
  "admin",
];

/**
 * Stock documents only — the manager roles plus gudang staff.
 *
 * Warehouse staff approve and ship branch orders, count stock and move goods
 * between locations. They must not see the rest of the back office (finance,
 * HR, customers, settings), which is why visibility is declared per entry
 * here instead of relying on the route guard alone: a visible link that ends
 * in a redirect reads like a broken app.
 */
const STOCK_ROLES: UserRole[] = [...MANAGER_ROLES, "warehouse"];

const navItems: NavItem[] = [
  // The dashboard is manager-only (`BACK_OFFICE` in `App.tsx`); showing it to
  // gudang staff would give them a link that redirects straight back out.
  { title: "Dashboard", icon: LayoutDashboard, path: "/backoffice", allowedRoles: MANAGER_ROLES },
  {
    title: "Cabang",
    icon: Building2,
    children: [
      { title: "Daftar Cabang", path: "/backoffice/branches", icon: Store, allowedRoles: MANAGER_ROLES },
      { title: "Gudang", path: "/backoffice/warehouses", icon: Warehouse, allowedRoles: STOCK_ROLES },
      {
        title: "Pesanan Cabang",
        path: "/backoffice/branches/orders",
        icon: ClipboardList,
        allowedRoles: STOCK_ROLES,
        badge: "pendingOrders",
      },
      { title: "Transfer Stok", path: "/backoffice/branches/transfer", icon: ArrowLeftRight, allowedRoles: STOCK_ROLES },
    ],
  },
  {
    title: "Inventory",
    icon: Package,
    children: [
      { title: "Produk", path: "/backoffice/inventory/products", icon: Package, allowedRoles: STOCK_ROLES },
      { title: "Stok Masuk", path: "/backoffice/inventory/stock-in", icon: Warehouse, allowedRoles: MANAGER_ROLES },
      { title: "Stok Opname", path: "/backoffice/inventory/opname", icon: Calculator, allowedRoles: STOCK_ROLES },
      { title: "Purchase Order", path: "/backoffice/inventory/po", icon: FileText, allowedRoles: MANAGER_ROLES },
    ],
  },
  {
    title: "Vendor",
    icon: Truck,
    allowedRoles: MANAGER_ROLES,
    children: [
      { title: "Data Vendor", path: "/backoffice/vendors", icon: Truck },
      { title: "Hutang Vendor", path: "/backoffice/finance/ap-ar", icon: DollarSign },
    ],
  },
  {
    title: "CRM",
    icon: Contact,
    allowedRoles: MANAGER_ROLES,
    children: [
      { title: "Pelanggan", path: "/backoffice/crm/customers", icon: Users },
    ],
  },
  {
    title: "Keuangan",
    icon: CreditCard,
    allowedRoles: MANAGER_ROLES,
    children: [
      { title: "Jurnal", path: "/backoffice/finance/journal", icon: FileText },
      { title: "Hutang/Piutang", path: "/backoffice/finance/ap-ar", icon: DollarSign },
      { title: "Cash Flow", path: "/backoffice/finance/cashflow", icon: BarChart3 },
      { title: "Pengeluaran", path: "/backoffice/finance/expenses", icon: CreditCard },
    ],
  },
  {
    title: "Karyawan",
    icon: Users,
    allowedRoles: MANAGER_ROLES,
    children: [
      { title: "Data Karyawan", path: "/backoffice/hr/employees", icon: Users },
      { title: "Absensi", path: "/backoffice/hr/attendance", icon: UserCheck },
      { title: "Jadwal Shift", path: "/backoffice/hr/schedule", icon: Calendar },
      { title: "Payroll", path: "/backoffice/hr/payroll", icon: DollarSign },
    ],
  },
  { title: "Laporan", icon: BarChart3, path: "/backoffice/reports", allowedRoles: MANAGER_ROLES },
  { title: "Pengaturan", icon: Settings, path: "/backoffice/settings", allowedRoles: MANAGER_ROLES },
];

// Detail pages (/backoffice/vendors/:id) still belong to their list menu entry.
const matchesRoute = (pathname: string, path: string) =>
  pathname === path || pathname.startsWith(`${path}/`);

export function BackOfficeLayout({ children }: BackOfficeLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [expandedItems, setExpandedItems] = useState<string[]>(["Inventory", "CRM"]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pendingOrders, setPendingOrders] = useState(0);
  const location = useLocation();
  const { theme, setTheme } = useTheme();
  const { user } = useAuth();
  const signOut = useSignOut();

  // The sidebar is the only place the signed-in person sees their own name.
  const roleLabel = ROLES.find((role) => role.value === user?.role)?.label ?? "Staff";

  const role = user?.role;
  /** An entry with no `allowedRoles` is open to whoever reached this layout. */
  const canSee = (item: { allowedRoles?: UserRole[] }) =>
    !item.allowedRoles || (role ? item.allowedRoles.includes(role) : false);

  // A group with nothing visible inside it is hidden rather than rendered empty.
  const visibleNav = navItems
    .filter(canSee)
    .map((item) =>
      item.children ? { ...item, children: item.children.filter(canSee) } : item
    )
    .filter((item) => !item.children || item.children.length > 0);

  /**
   * How many orders are waiting on this person.
   *
   * The shop counts what it still has to do (finish drafts, confirm arrivals);
   * the gudang counts what it owes the shops (approve, then ship). One query,
   * refreshed on navigation, and a failure is silent: a badge must never stop
   * the sidebar from rendering.
   */
  const branchId = user?.assigned_branch_id ?? null;

  useEffect(() => {
    if (!role || !STOCK_ROLES.includes(role)) return;
    let cancelled = false;

    const load = async () => {
      try {
        const res =
          role === "store_manager"
            ? await query<{ pending: number }>(
                `SELECT COUNT(*) AS pending
                   FROM stock_requests
                  WHERE status IN ('in_transit', 'draft') AND branch_id = $1`,
                [branchId ?? ""]
              )
            : await query<{ pending: number }>(
                `SELECT COUNT(*) AS pending
                   FROM stock_requests
                  WHERE status IN ('submitted', 'approved')`
              );
        if (!cancelled) setPendingOrders(Number(res.rows[0]?.pending ?? 0));
      } catch {
        if (!cancelled) setPendingOrders(0);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [role, branchId, location.pathname]);

  // Opening a page from the mode selector must not leave its menu group
  // collapsed, otherwise the active entry looks like it does not exist.
  useEffect(() => {
    const owner = visibleNav.find((item) =>
      item.children?.some((child) => matchesRoute(location.pathname, child.path))
    );
    if (!owner) return;
    setExpandedItems((prev) => (prev.includes(owner.title) ? prev : [...prev, owner.title]));
    // `visibleNav` is rebuilt every render; the pathname is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const toggleExpand = (title: string) => {
    setExpandedItems((prev) =>
      prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title]
    );
  };

  const isActive = (path?: string, children?: NavItem["children"]) => {
    if (path) return location.pathname === path;
    return children?.some((child) => matchesRoute(location.pathname, child.path));
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-sidebar-border">
        <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center">
          <Store className="w-6 h-6 text-primary-foreground" />
        </div>
        {!collapsed && (
          <div className="animate-fade-in">
            <h1 className="text-lg font-bold text-sidebar-foreground">RetailPro</h1>
            <p className="text-xs text-sidebar-foreground/60">Back Office</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {visibleNav.map((item) => (
          <div key={item.title}>
            {item.path ? (
              <NavLink
                to={item.path}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200",
                    isActive
                      ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  )
                }
                onClick={() => setMobileOpen(false)}
              >
                <item.icon className="w-5 h-5 flex-shrink-0" />
                {!collapsed && <span className="font-medium">{item.title}</span>}
              </NavLink>
            ) : (
              <>
                <button
                  onClick={() => toggleExpand(item.title)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200",
                    isActive(undefined, item.children)
                      ? "bg-sidebar-accent text-sidebar-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  )}
                >
                  <item.icon className="w-5 h-5 flex-shrink-0" />
                  {!collapsed && (
                    <>
                      <span className="flex-1 text-left font-medium">{item.title}</span>
                      {expandedItems.includes(item.title) ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </>
                  )}
                </button>
                {!collapsed && expandedItems.includes(item.title) && (
                  <div className="ml-4 mt-1 space-y-1 animate-fade-in">
                    {item.children?.map((child) => (
                      <NavLink
                        key={child.path}
                        to={child.path}
                        className={({ isActive }) =>
                          cn(
                            "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-200",
                            isActive
                              ? "bg-sidebar-primary text-sidebar-primary-foreground"
                              : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                          )
                        }
                        onClick={() => setMobileOpen(false)}
                      >
                        <child.icon className="w-4 h-4" />
                        <span className="flex-1">{child.title}</span>
                        {child.badge === "pendingOrders" && pendingOrders > 0 && (
                          <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-semibold leading-none text-destructive-foreground">
                            {pendingOrders > 99 ? "99+" : pendingOrders}
                          </span>
                        )}
                      </NavLink>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </nav>

      {/* User Section */}
      <div className="p-4 border-t border-sidebar-border space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-sidebar-primary/20 flex items-center justify-center">
            <Shield className="w-5 h-5 text-sidebar-primary" />
          </div>
          {!collapsed && (
            <div className="animate-fade-in">
              <p className="text-sm font-medium text-sidebar-foreground">
                {user?.name ?? "Memuat…"}
              </p>
              <p className="text-xs text-sidebar-foreground/60">{roleLabel}</p>
            </div>
          )}
        </div>
        {!collapsed && (
          <div className="space-y-2">
            <Link to="/mode-select">
              <Button variant="outline" size="sm" className="w-full gap-2">
                <ArrowLeftRight className="w-4 h-4" />
                Ganti Mode
              </Button>
            </Link>
            {/* Ganti Mode only picks another screen for the same person; this
                is the way out of the session itself. */}
            <Button
              variant="ghost"
              size="sm"
              className="w-full gap-2 text-muted-foreground hover:text-destructive"
              onClick={() => void signOut()}
            >
              <LogOut className="w-4 h-4" />
              Keluar
            </Button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-background">
      {/* Mobile Toggle */}
      <Button
        variant="ghost"
        size="icon"
        className="fixed top-4 left-4 z-50 lg:hidden"
        onClick={() => setMobileOpen(!mobileOpen)}
      >
        {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </Button>

      {/* Mobile Overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-64 bg-sidebar transform transition-transform duration-300 lg:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <SidebarContent />
      </aside>

      {/* Desktop Sidebar */}
      <aside
        className={cn(
          "hidden lg:flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300 relative",
          collapsed ? "w-16" : "w-64"
        )}
      >
        <SidebarContent />
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "Rentangkan sidebar" : "Ciutkan sidebar"}
          className="absolute -right-3 top-20 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md hover:scale-110 transition-transform"
        >
          <ChevronRight
            className={cn("w-4 h-4 transition-transform", collapsed ? "" : "rotate-180")}
          />
        </button>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-h-screen overflow-hidden">
        {/* Header */}
        <header className="h-14 bg-card border-b flex items-center justify-between px-4 lg:px-6">
          <div className="lg:hidden w-10" /> {/* Spacer for mobile menu button */}
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </Button>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 lg:p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
