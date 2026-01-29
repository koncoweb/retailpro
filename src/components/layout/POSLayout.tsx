import { ReactNode, useState, useEffect } from "react";
// Layout component for Point of Sale pages
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ShoppingCart, FileText, Clock, LogOut, Store, Moon, Sun, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/use-theme";
import { useAuth } from "@/hooks/use-auth";
import { query } from "@/lib/db";

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
  const { user } = useAuth();
  const [branchName, setBranchName] = useState<string>("Loading...");

  useEffect(() => {
    const fetchBranch = async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const branchId = (user as any)?.assigned_branch_id;
      
      if (branchId) {
        try {
          const res = await query('SELECT name FROM branches WHERE id = $1', [branchId]);
          if (res.rows.length > 0) {
            setBranchName(res.rows[0].name);
          } else {
             setBranchName("Unknown Branch");
          }
        } catch (err) {
          console.error("Failed to fetch branch:", err);
          setBranchName("Error loading branch");
        }
      } else {
        // Fallback if no assigned branch
        try {
            const res = await query('SELECT name FROM branches LIMIT 1');
            if (res.rows.length > 0) {
                setBranchName(res.rows[0].name);
            } else {
                setBranchName("RetailPro");
            }
        } catch (e) {
            setBranchName("RetailPro");
        }
      }
    };

    fetchBranch();
  }, [user]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* POS Header */}
      <header className="h-14 bg-card border-b flex items-center justify-between px-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center">
              <Store className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-lg">RetailPro</span>
            <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full">POS</span>
          </div>
          
          <div className="hidden md:flex items-center gap-2 text-sm text-muted-foreground border-l pl-4 ml-2">
            <MapPin className="w-4 h-4" />
            <span>{branchName}</span>
          </div>

          <nav className="hidden md:flex items-center gap-1 ml-4">
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

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </Button>
          <Link to="/mode-select">
            <Button variant="outline" size="sm" className="gap-2">
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Keluar POS</span>
            </Button>
          </Link>
        </div>
      </header>

      {/* Mobile Navigation */}
      <div className="md:hidden flex items-center justify-center gap-2 p-2 border-b bg-card">
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
