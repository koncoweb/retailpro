import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Building2,
  ShoppingCart,
  Package,
  Warehouse,
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
  Clock,
  DollarSign,
  Shield,
  Menu,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface NavItem {
  title: string;
  icon: React.ElementType;
  path?: string;
  children?: { title: string; path: string; icon: React.ElementType }[];
}

const navItems: NavItem[] = [
  { title: "Dashboard", icon: LayoutDashboard, path: "/" },
  {
    title: "Cabang",
    icon: Building2,
    children: [
      { title: "Daftar Cabang", path: "/branches", icon: Store },
      { title: "Transfer Stok", path: "/branches/transfer", icon: ArrowLeftRight },
    ],
  },
  {
    title: "POS & Kasir",
    icon: ShoppingCart,
    children: [
      { title: "Point of Sale", path: "/pos", icon: ShoppingCart },
      { title: "Transaksi", path: "/pos/transactions", icon: FileText },
      { title: "Shift & Closing", path: "/pos/shifts", icon: Clock },
    ],
  },
  {
    title: "Inventory",
    icon: Package,
    children: [
      { title: "Produk", path: "/inventory/products", icon: Package },
      { title: "Stok Masuk", path: "/inventory/stock-in", icon: Warehouse },
      { title: "Stok Opname", path: "/inventory/opname", icon: Calculator },
      { title: "Purchase Order", path: "/inventory/po", icon: FileText },
    ],
  },
  {
    title: "Keuangan",
    icon: CreditCard,
    children: [
      { title: "Jurnal", path: "/finance/journal", icon: FileText },
      { title: "Hutang/Piutang", path: "/finance/ap-ar", icon: DollarSign },
      { title: "Cash Flow", path: "/finance/cashflow", icon: BarChart3 },
      { title: "Pengeluaran", path: "/finance/expenses", icon: CreditCard },
    ],
  },
  {
    title: "Karyawan",
    icon: Users,
    children: [
      { title: "Data Karyawan", path: "/hr/employees", icon: Users },
      { title: "Absensi", path: "/hr/attendance", icon: UserCheck },
      { title: "Jadwal Shift", path: "/hr/schedule", icon: Calendar },
      { title: "Payroll", path: "/hr/payroll", icon: DollarSign },
    ],
  },
  { title: "Laporan", icon: BarChart3, path: "/reports" },
  { title: "Pengaturan", icon: Settings, path: "/settings" },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [expandedItems, setExpandedItems] = useState<string[]>(["POS & Kasir"]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  const toggleExpand = (title: string) => {
    setExpandedItems((prev) =>
      prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title]
    );
  };

  const isActive = (path?: string, children?: NavItem["children"]) => {
    if (path) return location.pathname === path;
    return children?.some((child) => location.pathname === child.path);
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
            <p className="text-xs text-sidebar-foreground/60">ERP System</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => (
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
                        <span>{child.title}</span>
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
      <div className="p-4 border-t border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-sidebar-primary/20 flex items-center justify-center">
            <Shield className="w-5 h-5 text-sidebar-primary" />
          </div>
          {!collapsed && (
            <div className="animate-fade-in">
              <p className="text-sm font-medium text-sidebar-foreground">Admin</p>
              <p className="text-xs text-sidebar-foreground/60">Super Admin</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
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
          "hidden lg:flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300",
          collapsed ? "w-16" : "w-64"
        )}
      >
        <SidebarContent />
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-20 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md hover:scale-110 transition-transform"
        >
          <ChevronRight
            className={cn("w-4 h-4 transition-transform", collapsed ? "" : "rotate-180")}
          />
        </button>
      </aside>
    </>
  );
}
