import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "@/hooks/use-theme";
import Login from "./pages/auth/Login";
import RegisterTenant from "./pages/auth/RegisterTenant";
import ModeSelect from "./pages/ModeSelect";
import POS from "./pages/POS";
import POSTransactions from "./pages/POSTransactions";
import POSShifts from "./pages/POSShifts";
import Dashboard from "./pages/Dashboard";
import Branches from "./pages/Branches";
import Warehouses from "./pages/Warehouses";
import Inventory from "./pages/Inventory";
import Employees from "./pages/Employees";
import EmployeeReports from "./pages/EmployeeReports";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";

import BranchDashboard from "./pages/branches/Dashboard";
import BranchOrders from "./pages/BranchOrders";
import BranchTransfers from "./pages/BranchTransfers";
import { RoleBasedRoute } from "./components/auth/RoleBasedRoute";
import { TenantProvider, RequireTenant } from "./contexts/TenantContext";
import Expenses from "./pages/finance/Expenses";
import Journal from "./pages/finance/Journal";
import ApAr from "./pages/finance/ApAr";
import Cashflow from "./pages/finance/Cashflow";
import Vendors from "./pages/vendors/Vendors";
import VendorDetail from "./pages/vendors/VendorDetail";
import Customers from "./pages/crm/Customers";
import SalesReport from "./pages/SalesReport";
import InventoryReport from "./pages/InventoryReport";
import FinanceReports from "./pages/FinanceReports";
import type { UserRole } from "./types";
import {
  ALL_ROLE_VALUES,
  MANAGER_ROLES,
  FRONT_OFFICE_ROLES,
  BACK_OFFICE_ROLES,
  STOCK_DOC_ROLES,
  PROCUREMENT_ROLES,
  HR_ROLES,
} from "./config/roles";

const queryClient = new QueryClient();

/**
 * Every authenticated route is gated twice:
 *   RoleBasedRoute -> is this person allowed on this screen?
 *   RequireTenant  -> is their company database reachable?
 * Nothing below mounts until both hold, so no page can issue a query without a
 * tenant client.
 *
 * The lists live in `config/roles.ts` so a screen that links to a guarded page
 * (the mode chooser, the sidebar) can use the same one.
 */
const ALL_ROLES = ALL_ROLE_VALUES;
const MANAGERS = MANAGER_ROLES;
const FRONT_OFFICE = FRONT_OFFICE_ROLES;
const BACK_OFFICE = BACK_OFFICE_ROLES;
const STOCK_DOCS = STOCK_DOC_ROLES;
const PROCUREMENT = PROCUREMENT_ROLES;
const HR_ONLY = HR_ROLES;

function guarded(element: React.ReactNode, allowedRoles: UserRole[]) {
  return (
    <RoleBasedRoute allowedRoles={allowedRoles}>
      <RequireTenant>{element}</RequireTenant>
    </RoleBasedRoute>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider defaultTheme="dark" storageKey="erp-theme">
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <TenantProvider>
            <Routes>
              {/* Auth Routes */}
              <Route path="/" element={<Navigate to="/login" replace />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register-tenant" element={<RegisterTenant />} />
              <Route path="/mode-select" element={<ModeSelect />} />

              {/* POS Routes */}
              <Route path="/pos" element={guarded(<POS />, FRONT_OFFICE)} />
              <Route path="/pos/transactions" element={guarded(<POSTransactions />, ALL_ROLES)} />
              <Route path="/pos/shifts" element={guarded(<POSShifts />, FRONT_OFFICE)} />

              {/* Back Office Routes */}
              <Route path="/backoffice" element={guarded(<Dashboard />, BACK_OFFICE)} />
              <Route path="/backoffice/crm/suppliers" element={guarded(<Vendors />, BACK_OFFICE)} />
              <Route path="/backoffice/vendors" element={guarded(<Vendors />, BACK_OFFICE)} />
              <Route path="/backoffice/vendors/:id" element={guarded(<VendorDetail />, BACK_OFFICE)} />
              <Route path="/backoffice/crm/customers" element={guarded(<Customers />, BACK_OFFICE)} />

              {/* Branch Management Routes */}
              <Route path="/backoffice/branches" element={guarded(<Branches />, MANAGERS)} />
              <Route path="/backoffice/warehouses" element={guarded(<Warehouses />, STOCK_DOCS)} />
              <Route
                path="/backoffice/branches/dashboard"
                element={guarded(<BranchDashboard />, MANAGERS)}
              />
              <Route
                path="/backoffice/branches/transfer"
                element={guarded(<BranchTransfers />, STOCK_DOCS)}
              />
              <Route
                path="/backoffice/branches/orders"
                element={guarded(<BranchOrders />, STOCK_DOCS)}
              />

              <Route path="/backoffice/inventory/products" element={guarded(<Inventory />, STOCK_DOCS)} />
              <Route path="/backoffice/inventory/stock-in" element={guarded(<Inventory />, BACK_OFFICE)} />
              <Route path="/backoffice/inventory/opname" element={guarded(<Inventory />, STOCK_DOCS)} />
              <Route path="/backoffice/inventory/po" element={guarded(<Inventory />, PROCUREMENT)} />
              <Route path="/backoffice/finance/journal" element={guarded(<Journal />, BACK_OFFICE)} />
              <Route path="/backoffice/finance/ap-ar" element={guarded(<ApAr />, BACK_OFFICE)} />
              <Route path="/backoffice/finance/cashflow" element={guarded(<Cashflow />, BACK_OFFICE)} />
              <Route path="/backoffice/finance/expenses" element={guarded(<Expenses />, BACK_OFFICE)} />
              <Route path="/backoffice/hr/employees" element={guarded(<Employees />, HR_ONLY)} />
              <Route path="/backoffice/hr/attendance" element={guarded(<EmployeeReports />, HR_ONLY)} />
              <Route path="/backoffice/hr/schedule" element={guarded(<Employees />, HR_ONLY)} />
              <Route path="/backoffice/hr/payroll" element={guarded(<EmployeeReports />, HR_ONLY)} />
              <Route path="/backoffice/reports" element={guarded(<Reports />, BACK_OFFICE)} />
              <Route path="/backoffice/reports/sales" element={guarded(<SalesReport />, BACK_OFFICE)} />
              <Route
                path="/backoffice/reports/inventory"
                element={guarded(<InventoryReport />, BACK_OFFICE)}
              />
              <Route path="/backoffice/reports/finance" element={guarded(<FinanceReports />, BACK_OFFICE)} />
              <Route path="/backoffice/settings" element={guarded(<Settings />, HR_ONLY)} />

              <Route path="*" element={<NotFound />} />
            </Routes>
          </TenantProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
