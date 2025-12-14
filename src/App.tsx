import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import POS from "./pages/POS";
import POSTransactions from "./pages/POSTransactions";
import Branches from "./pages/Branches";
import Inventory from "./pages/Inventory";
import Employees from "./pages/Employees";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <div className="dark">
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/pos" element={<POS />} />
            <Route path="/pos/transactions" element={<POSTransactions />} />
            <Route path="/pos/shifts" element={<POS />} />
            <Route path="/branches" element={<Branches />} />
            <Route path="/branches/transfer" element={<Branches />} />
            <Route path="/inventory/products" element={<Inventory />} />
            <Route path="/inventory/stock-in" element={<Inventory />} />
            <Route path="/inventory/opname" element={<Inventory />} />
            <Route path="/inventory/po" element={<Inventory />} />
            <Route path="/finance/journal" element={<Reports />} />
            <Route path="/finance/ap-ar" element={<Reports />} />
            <Route path="/finance/cashflow" element={<Reports />} />
            <Route path="/finance/expenses" element={<Reports />} />
            <Route path="/hr/employees" element={<Employees />} />
            <Route path="/hr/attendance" element={<Employees />} />
            <Route path="/hr/schedule" element={<Employees />} />
            <Route path="/hr/payroll" element={<Employees />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/settings" element={<Settings />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </div>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
