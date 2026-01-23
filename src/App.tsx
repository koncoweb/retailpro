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
import Dashboard from "./pages/Dashboard";
import Branches from "./pages/Branches";
import Inventory from "./pages/Inventory";
import Employees from "./pages/Employees";
import EmployeeReports from "./pages/EmployeeReports";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider defaultTheme="dark" storageKey="erp-theme">
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            {/* Auth Routes */}
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register-tenant" element={<RegisterTenant />} />
            <Route path="/mode-select" element={<ModeSelect />} />

            {/* POS Routes */}
            <Route path="/pos" element={<POS />} />
            <Route path="/pos/transactions" element={<POSTransactions />} />
            <Route path="/pos/shifts" element={<POS />} />

            {/* Back Office Routes */}
            <Route path="/backoffice" element={<Dashboard />} />
            <Route path="/backoffice/branches" element={<Branches />} />
            <Route path="/backoffice/branches/transfer" element={<Branches />} />
            <Route path="/backoffice/inventory/products" element={<Inventory />} />
            <Route path="/backoffice/inventory/stock-in" element={<Inventory />} />
            <Route path="/backoffice/inventory/opname" element={<Inventory />} />
            <Route path="/backoffice/inventory/po" element={<Inventory />} />
            <Route path="/backoffice/finance/journal" element={<Reports />} />
            <Route path="/backoffice/finance/ap-ar" element={<Reports />} />
            <Route path="/backoffice/finance/cashflow" element={<Reports />} />
            <Route path="/backoffice/finance/expenses" element={<Reports />} />
            <Route path="/backoffice/hr/employees" element={<Employees />} />
            <Route path="/backoffice/hr/attendance" element={<EmployeeReports />} />
            <Route path="/backoffice/hr/schedule" element={<Employees />} />
            <Route path="/backoffice/hr/payroll" element={<EmployeeReports />} />
            <Route path="/backoffice/reports" element={<Reports />} />
            <Route path="/backoffice/settings" element={<Settings />} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
