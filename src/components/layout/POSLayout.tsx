import { ReactNode } from "react";
// Layout component for Point of Sale pages
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ShoppingCart, FileText, Clock, LogOut, Store, Moon, Sun, MapPin, ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/use-theme";
import { useSignOut } from "@/hooks/use-sign-out";
import { usePosBranch } from "@/hooks/use-pos-branch";

interface POSLayoutProps {
  children: ReactNode;
}

const posNavItems = [
  { title: "Point of Sale", path: "/pos", icon: ShoppingCart },
  { title: "Transaksi", path: "/pos/transactions", icon: FileText },
  { title: "Shift", path: "/pos/shifts", icon: Clock },
];

export function POSLayout({ children }: POSLayoutProps) {
  const location = useLocation();
  const { theme, setTheme } = useTheme();
  const signOut = useSignOut();
  // The header names the same branch the till and the shift desk are using.
  // It used to run its own `assigned_branch_id` query, which could disagree
  // with both — the label then lied about where a shift was being opened.
  const { branchName, loading: branchLoading } = usePosBranch();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* POS Header */}
      {/* The inline tabs need room the tablet classes never had: at `md` (768px)
         brand + branch + three tabs + the action buttons measured 855px, which
         pushed the whole header past the viewport and gave every POS screen a
         horizontal scrollbar. Tabs therefore start at `lg`, and the compact bar
         below covers everything under it. */}
      <header className="h-14 bg-card border-b flex items-center justify-between gap-2 px-4">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex shrink-0 items-center gap-2">
            <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center">
              <Store className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-lg">RetailPro</span>
            <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full">POS</span>
          </div>
          
          <div className="hidden lg:flex min-w-0 items-center gap-2 text-sm text-muted-foreground border-l pl-4 ml-2">
            <MapPin className="w-4 h-4 shrink-0" />
            <span className="truncate">{branchLoading ? "Memuat…" : branchName ?? "RetailPro"}</span>
          </div>

          <nav className="hidden lg:flex shrink-0 items-center gap-1 ml-4">
            {posNavItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                  location.pathname === item.path
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <item.icon className="w-4 h-4" />
                {item.title}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </Button>
          <Link to="/mode-select">
            <Button variant="outline" size="sm" className="gap-2">
              <ArrowLeftRight className="w-4 h-4" />
              <span className="hidden sm:inline">Ganti Mode</span>
            </Button>
          </Link>
          {/* Leaving the till is not the same as leaving the account. */}
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-muted-foreground hover:text-destructive"
            onClick={() => void signOut()}
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Keluar</span>
          </Button>
        </div>
      </header>

      {/* Navigation */}
      <div className="lg:hidden flex items-center justify-center gap-2 p-2 border-b bg-card">
        {posNavItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={cn(
              "flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              location.pathname === item.path
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            <item.icon className="w-3 h-3" />
            {item.title}
          </Link>
        ))}
      </div>

      {/* Main Content */}
      <main className="flex-1 p-4 overflow-auto">
        {children}
      </main>
    </div>
  );
}
