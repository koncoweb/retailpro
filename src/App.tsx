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
import AttendanceCheckIn from "./pages/AttendanceCheckIn";
import Dashboard from "./pages/Dashboard";
import Branches from "./pages/Branches";
import Warehouses from "./pages/Warehouses";
import Inventory from "./pages/Inventory";
import Employees from "./pages/Employees";
import EmployeeReports from "./pages/EmployeeReports";
import FaceEnrollment from "./pages/FaceEnrollment";
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
import ProcurementReport from "./pages/ProcurementReport";

const queryClient = new QueryClient();

/**
 * Every authenticated route is gated twice:
 *   RequireTenant  -> is their company database reachable?
 *   RoleBasedRoute -> does the matrix hand them the key for this screen?
 * Nothing below mounts until both hold, so no page can issue a query without a
 * tenant client.
 *
 * The order matters. `RoleBasedRoute` reads the tenant's settings document, so
 * it has to run inside `RequireTenant`; and because a deep link cannot be
 * judged before that read answers, the guard waits instead of bouncing.
 * `RequireTenant` lets an anonymous visitor through so the guard can still send
 * them to the login form.
 *
 * Keys live in the permission catalog (`src/config/roles.ts`) and are the same
 * ones the sidebar and the mode chooser use, so no link can bounce. Changing
 * who reaches what is a Settings edit, not a code change.
 */
function guarded(element: React.ReactNode, permission: string) {
  return (
    <RequireTenant>
      <RoleBasedRoute permission={permission}>{element}</RoleBasedRoute>
    </RequireTenant>
  );
}

/**
 * A screen that two families legitimately share.
 *
 * `/pos/transactions` is the till's own ledger (a cashier must reach it) and at
 * the same time the history a warehouse person checks when a stock movement
 * looks wrong. Asking for `anyOf` keeps both, where one key would silently take
 * the page away from whoever the second family is. `access_pos` is listed
 * because the cashier default revoked `view_dashboard`: reading the book of
 * one's own sales is transaction work, not back-office access.
 */
function guardedAny(element: React.ReactNode, permissions: string[]) {
  return (
    <RequireTenant>
      <RoleBasedRoute anyOf={permissions}>{element}</RoleBasedRoute>
    </RequireTenant>
  );
}

/**
 * A screen every signed-in employee reaches, whatever their role — the self
 * check-in. Passing no permission key keeps `RoleBasedRoute`'s fail-closed
 * behaviour (an unauthenticated or roleless session still bounces to /login)
 * while skipping the matrix lookup, so a cashier with no back-office grant can
 * still clock in. `RequireTenant` guarantees their database is reachable first.
 */
function guardedAuthed(element: React.ReactNode) {
  return (
    <RequireTenant>
      <RoleBasedRoute>{element}</RoleBasedRoute>
    </RequireTenant>
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
              <Route path="/pos" element={guarded(<POS />, "access_pos")} />
              <Route
                path="/pos/transactions"
                element={guardedAny(<POSTransactions />, ["access_pos", "view_dashboard", "view_inventory"])}
              />
              <Route path="/pos/shifts" element={guarded(<POSShifts />, "access_pos")} />

              {/* Self-service attendance: any signed-in user, no role gate. */}
              <Route path="/absen" element={guardedAuthed(<AttendanceCheckIn />)} />

              {/* Back Office Routes */}
              <Route path="/backoffice" element={guarded(<Dashboard />, "view_analytics")} />
              <Route path="/backoffice/crm/suppliers" element={guarded(<Vendors />, "view_finance")} />
              <Route path="/backoffice/vendors" element={guarded(<Vendors />, "view_finance")} />
              <Route path="/backoffice/vendors/:id" element={guarded(<VendorDetail />, "view_finance")} />
              <Route path="/backoffice/crm/customers" element={guarded(<Customers />, "view_finance")} />

              {/* Branch Management Routes */}
              <Route path="/backoffice/branches" element={guarded(<Branches />, "manage_branches")} />
              <Route path="/backoffice/warehouses" element={guarded(<Warehouses />, "view_inventory")} />
              <Route
                path="/backoffice/branches/dashboard"
                element={guarded(<BranchDashboard />, "manage_branches")}
              />
              <Route
                path="/backoffice/branches/transfer"
                element={guarded(<BranchTransfers />, "view_inventory")}
              />
              <Route
                path="/backoffice/branches/orders"
                element={guarded(<BranchOrders />, "view_inventory")}
              />

              <Route path="/backoffice/inventory/products" element={guarded(<Inventory />, "view_inventory")} />
              <Route path="/backoffice/inventory/stock-in" element={guarded(<Inventory />, "add_stock")} />
              <Route path="/backoffice/inventory/opname" element={guarded(<Inventory />, "view_inventory")} />
              <Route path="/backoffice/inventory/po" element={guarded(<Inventory />, "view_inventory")} />
              <Route path="/backoffice/finance/journal" element={guarded(<Journal />, "view_finance")} />
              <Route path="/backoffice/finance/ap-ar" element={guarded(<ApAr />, "view_finance")} />
              <Route path="/backoffice/finance/cashflow" element={guarded(<Cashflow />, "view_finance")} />
              <Route path="/backoffice/finance/expenses" element={guarded(<Expenses />, "view_finance")} />
              <Route path="/backoffice/hr/employees" element={guarded(<Employees />, "view_employees")} />
              <Route path="/backoffice/hr/attendance" element={guarded(<EmployeeReports />, "view_employees")} />
              <Route path="/backoffice/hr/face" element={guarded(<FaceEnrollment />, "manage_attendance")} />
              <Route path="/backoffice/hr/schedule" element={guarded(<Employees />, "view_employees")} />
              <Route path="/backoffice/hr/payroll" element={guarded(<EmployeeReports />, "view_employees")} />
              <Route path="/backoffice/reports" element={guarded(<Reports />, "view_reports")} />
              <Route path="/backoffice/reports/sales" element={guarded(<SalesReport />, "view_reports")} />
              <Route
                path="/backoffice/reports/inventory"
                element={guarded(<InventoryReport />, "view_reports")}
              />
              <Route path="/backoffice/reports/finance" element={guarded(<FinanceReports />, "view_reports")} />
              <Route
                path="/backoffice/reports/procurement"
                element={guarded(<ProcurementReport />, "view_reports")}
              />
              <Route path="/backoffice/settings" element={guarded(<Settings />, "view_settings")} />

              <Route path="*" element={<NotFound />} />
            </Routes>
          </TenantProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
