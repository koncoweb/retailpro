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
} from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/use-auth";
import { UserRole } from "@/types";
import { useSidebar } from "@/contexts/SidebarContext";

interface NavItem {
  title: string;
  icon: React.ElementType;
  path?: string;
  children?: { title: string; path: string; icon: React.ElementType; allowedRoles?: UserRole[] }[];
  allowedRoles?: UserRole[];
}

const navItems: NavItem[] = [
  { title: "Dashboard", icon: LayoutDashboard, path: "/backoffice" },
  {
    title: "Cabang",
    icon: Building2,
    children: [
      { 
        title: "Dashboard", 
        path: "/backoffice/branches/dashboard", 
        icon: LayoutDashboard,
        allowedRoles: ['platform_owner', 'tenant_owner', 'tenant_admin', 'store_manager', 'admin']
      },
      { 
        title: "Daftar Cabang", 
        path: "/backoffice/branches", 
        icon: Store,
        allowedRoles: ['platform_owner', 'tenant_owner', 'tenant_admin', 'admin']
      },
      { 
        title: "Transfer Stok", 
        path: "/backoffice/branches/transfer", 
        icon: ArrowLeftRight,
        allowedRoles: ['platform_owner', 'tenant_owner', 'tenant_admin', 'store_manager', 'admin']
      },
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
      { title: "Produk", path: "/backoffice/inventory/products", icon: Package },
      { title: "Stok Masuk", path: "/backoffice/inventory/stock-in", icon: Warehouse },
      { title: "Stok Opname", path: "/backoffice/inventory/opname", icon: Calculator },
      { title: "Purchase Order", path: "/backoffice/inventory/po", icon: FileText },
    ],
  },
  {
    title: "Keuangan",
    icon: CreditCard,
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
    children: [
      { title: "Data Karyawan", path: "/backoffice/hr/employees", icon: Users },
      { title: "Absensi", path: "/backoffice/hr/attendance", icon: UserCheck },
      { title: "Jadwal Shift", path: "/backoffice/hr/schedule", icon: Calendar },
      { title: "Payroll", path: "/backoffice/hr/payroll", icon: DollarSign },
    ],
  },
  { title: "Laporan", icon: BarChart3, path: "/backoffice/reports" },
  { title: "Pengaturan", icon: Settings, path: "/backoffice/settings" },
];

export function Sidebar() {
  const { collapsed, setCollapsed, mobileOpen, setMobileOpen } = useSidebar();
  const [expandedItems, setExpandedItems] = useState<string[]>(["POS & Kasir"]);
  const location = useLocation();
  const { role } = useAuth();

  const filteredNavItems = navItems.filter(item => {
    if (item.allowedRoles && (!role || !item.allowedRoles.includes(role))) {
      return false;
    }
    return true;
  }).map(item => {
    if (item.children) {
      return {
        ...item,
        children: item.children.filter(child => 
          !child.allowedRoles || (role && child.allowedRoles.includes(role))
        )
      };
    }
    return item;
  });

  const toggleExpand = (title: string) => {
    setExpandedItems((prev) =>
      prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title]
    );
  };

  const isActive = (path?: string, children?: NavItem["children"]) => {
    if (path) return location.pathname === path;
    return children?.some((child) => location.pathname === child.path);
  };

  return (
    <>
      {/* Mobile Sidebar via Sheet */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="p-0 w-64 border-r-0 bg-sidebar text-sidebar-foreground">
          <div className="h-full">
             {/* Force expanded state for mobile sidebar regardless of desktop collapsed state */}
             {(() => {
                const wasCollapsed = collapsed;
                // Temporarily uncollapse for rendering content in sheet if needed, 
                // but SidebarContent uses 'collapsed' from scope.
                // We should pass a prop or override it.
                // Since SidebarContent is defined inside the component, it captures 'collapsed'.
                // Ideally, SidebarContent should accept 'collapsed' as prop.
                // Let's refactor SidebarContent to be independent or render it with collapsed=false for mobile.
                
                // Hack: We can just render a modified version or use a prop.
                // Re-defining SidebarContent to take props is better.
                return <SidebarContentWrapper collapsed={false} />
             })()}
          </div>
        </SheetContent>
      </Sheet>

      {/* Desktop Sidebar */}
      <aside
        className={cn(
          "hidden lg:flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300",
          collapsed ? "w-16" : "w-64"
        )}
      >
        <SidebarContentWrapper collapsed={collapsed} />
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

  // Helper component to handle the collapsed state prop
  function SidebarContentWrapper({ collapsed }: { collapsed: boolean }) {
     // We need to pass the same logic but with overridden collapsed state.
     // Since the original SidebarContent used the hook's state directly, 
     // we can just inline the JSX or copy the function and use the prop.
     // To avoid code duplication, I will rewrite SidebarContent to accept props.
     
     return (
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
            {filteredNavItems.map((item) => (
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
                  <p className="text-sm font-medium text-sidebar-foreground capitalize">{role?.replace('_', ' ') || 'Guest'}</p>
                  <p className="text-xs text-sidebar-foreground/60">RetailPro User</p>
                </div>
              )}
            </div>
          </div>
        </div>
     );
  }
}
