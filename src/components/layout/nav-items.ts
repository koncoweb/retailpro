/**
 * The back office menu, as data.
 *
 * It lives apart from `BackOfficeLayout.tsx` for two reasons. The Role screen's
 * "Pratinjau" has to render from this exact list — a preview built on a copy of
 * the menu is a preview that can lie — and a module that exports both a
 * component and a constant breaks React Fast Refresh in the layout.
 *
 * `permission` is the key `src/App.tsx` guards the route with, and the reason it
 * is a key rather than a role list: an owner who revokes `view_reports` in
 * Settings should lose the link as well as the screen.
 */
import type { ElementType } from "react";
import {
  ArrowLeftRight,
  BarChart3,
  Building2,
  Calculator,
  Calendar,
  ClipboardList,
  Contact,
  CreditCard,
  DollarSign,
  FileText,
  LayoutDashboard,
  Package,
  Settings,
  Store,
  Truck,
  UserCheck,
  Users,
  Warehouse,
} from "lucide-react";

export interface NavChild {
  title: string;
  path: string;
  icon: ElementType;
  /** The permission that opens the route; absent means the section is enough. */
  permission?: string;
  /** Which counter, if any, to render next to the label. */
  badge?: "pendingOrders";
}

export interface NavItem {
  title: string;
  icon: ElementType;
  path?: string;
  /** Applies to the whole group, and to a single-item entry's own path. */
  permission?: string;
  children?: NavChild[];
}

export const navItems: NavItem[] = [
  { title: "Dashboard", icon: LayoutDashboard, path: "/backoffice", permission: "view_analytics" },
  {
    title: "Cabang",
    icon: Building2,
    children: [
      { title: "Daftar Cabang", path: "/backoffice/branches", icon: Store, permission: "manage_branches" },
      { title: "Gudang", path: "/backoffice/warehouses", icon: Warehouse, permission: "view_inventory" },
      {
        title: "Pesanan Cabang",
        path: "/backoffice/branches/orders",
        icon: ClipboardList,
        permission: "view_inventory",
        badge: "pendingOrders",
      },
      { title: "Transfer Stok", path: "/backoffice/branches/transfer", icon: ArrowLeftRight, permission: "view_inventory" },
    ],
  },
  {
    title: "Inventory",
    icon: Package,
    children: [
      { title: "Produk", path: "/backoffice/inventory/products", icon: Package, permission: "view_inventory" },
      { title: "Stok Masuk", path: "/backoffice/inventory/stock-in", icon: Warehouse, permission: "add_stock" },
      { title: "Stok Opname", path: "/backoffice/inventory/opname", icon: Calculator, permission: "view_inventory" },
      {
        title: "Purchase Order",
        path: "/backoffice/inventory/po",
        icon: FileText,
        permission: "view_inventory",
      },
    ],
  },
  {
    title: "Vendor",
    icon: Truck,
    permission: "view_finance",
    children: [
      { title: "Data Vendor", path: "/backoffice/vendors", icon: Truck },
      { title: "Hutang Vendor", path: "/backoffice/finance/ap-ar", icon: DollarSign },
    ],
  },
  {
    title: "CRM",
    icon: Contact,
    permission: "view_finance",
    children: [
      { title: "Pelanggan", path: "/backoffice/crm/customers", icon: Users },
    ],
  },
  {
    title: "Keuangan",
    icon: CreditCard,
    permission: "view_finance",
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
    permission: "view_employees",
    children: [
      { title: "Data Karyawan", path: "/backoffice/hr/employees", icon: Users },
      { title: "Absensi", path: "/backoffice/hr/attendance", icon: UserCheck },
      { title: "Jadwal Shift", path: "/backoffice/hr/schedule", icon: Calendar },
      { title: "Payroll", path: "/backoffice/hr/payroll", icon: DollarSign },
    ],
  },
  { title: "Laporan", icon: BarChart3, path: "/backoffice/reports", permission: "view_reports" },
  { title: "Pengaturan", icon: Settings, path: "/backoffice/settings", permission: "view_settings" },
];
