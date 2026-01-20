import { Link } from "react-router-dom";
import { ShoppingCart, Briefcase, Store, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/use-theme";

export default function ModeSelect() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="h-14 bg-card border-b flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center">
            <Store className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="font-bold text-lg">RetailPro ERP</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </Button>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-3xl">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold mb-2">Selamat Datang</h1>
            <p className="text-muted-foreground">Pilih mode yang ingin Anda gunakan</p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* POS Mode */}
            <Link to="/pos" className="block group">
              <div className="p-6 rounded-2xl border-2 border-transparent bg-card hover:border-primary transition-all duration-300 hover:shadow-xl hover:shadow-primary/10">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-info flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <ShoppingCart className="w-8 h-8 text-primary-foreground" />
                </div>
                <h2 className="text-xl font-bold mb-2">POS & Kasir</h2>
                <p className="text-muted-foreground text-sm mb-4">
                  Mode untuk kasir melakukan transaksi penjualan, pembayaran, dan pengelolaan shift.
                </p>
                <ul className="text-sm space-y-2 text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                    Point of Sale
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                    Riwayat Transaksi
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                    Shift & Closing
                  </li>
                </ul>
                <Button className="w-full mt-6" size="lg">
                  Masuk POS
                </Button>
              </div>
            </Link>

            {/* Back Office Mode */}
            <Link to="/backoffice" className="block group">
              <div className="p-6 rounded-2xl border-2 border-transparent bg-card hover:border-primary transition-all duration-300 hover:shadow-xl hover:shadow-primary/10">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-info to-success flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <Briefcase className="w-8 h-8 text-primary-foreground" />
                </div>
                <h2 className="text-xl font-bold mb-2">Back Office</h2>
                <p className="text-muted-foreground text-sm mb-4">
                  Mode untuk manajemen, laporan, inventory, keuangan, dan pengaturan sistem.
                </p>
                <ul className="text-sm space-y-2 text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-info" />
                    Dashboard & Analytics
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-info" />
                    Inventory & Cabang
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-info" />
                    Keuangan & HR
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-info" />
                    Laporan & Pengaturan
                  </li>
                </ul>
                <Button variant="secondary" className="w-full mt-6" size="lg">
                  Masuk Back Office
                </Button>
              </div>
            </Link>
          </div>

          <p className="text-center text-xs text-muted-foreground mt-8">
            RetailPro ERP v1.0 - Multi-Branch Retail Management System
          </p>
        </div>
      </div>
    </div>
  );
}
