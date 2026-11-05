import { Link } from "react-router-dom";
import { ShoppingCart, Briefcase, Store, Truck, Moon, Sun, KeyRound, Loader2, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/use-theme";
import { usePermissions } from "@/hooks/use-permissions";
import { useSignOut } from "@/hooks/use-sign-out";

export default function ModeSelect() {
  const { theme, setTheme } = useTheme();
  const { can, loading, roleLabel, grants, role } = usePermissions();
  const signOut = useSignOut();

  /**
   * A card that opens a screen its guard refuses is a trap: the click lands back
   * here with no explanation. Visibility is therefore decided by the same
   * permission keys `App.tsx` guards the routes with — asked of the resolved
   * matrix, so an owner's custom role gets real cards instead of a blank grid.
   */
  const canUsePos = can("access_pos");
  const canSeeAnalytics = can("view_analytics");
  const canUseBackOffice = canSeeAnalytics || can("view_inventory");
  const canUseVendors = can("view_finance");
  // Self-service check-in is deliberately role-free: every signed-in employee
  // lands here, so it is always renderable (the /absen route gates on auth only).
  const canUseAttendance = true;

  /**
   * Somebody scoped to the stock screens has no dashboard to land on, so their
   * entry is the order queue they work from. Same rule the sidebar follows.
   */
  const backOfficePath = canSeeAnalytics ? "/backoffice" : "/backoffice/branches/orders";
  const backOfficePoints = canSeeAnalytics
    ? ["Dashboard & Analytics", "Inventory & Cabang", "Keuangan & HR", "Laporan & Pengaturan"]
    : ["Pesanan Cabang", "Transfer Stok", "Stok Opname"];

  // A role key that resolves to no grant is a custom role that was deleted while
  // somebody was still using it. Saying so beats a blank grid.
  const unknownRole = !loading && !!role && !grants[role];
  // The dead-end panel only makes sense when there is genuinely nothing to open.
  // Check-in is always available, so the one real dead end is a broken role.
  const nothingRenderable = unknownRole;

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
        <div className="w-full max-w-5xl">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold mb-2">Selamat Datang</h1>
            {roleLabel && (
              <p className="text-muted-foreground mb-1">Masuk sebagai {roleLabel}.</p>
            )}
            <p className="text-muted-foreground">Pilih mode yang ingin Anda gunakan</p>
          </div>

          {loading && (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Memuat hak akses…</span>
            </div>
          )}

          {nothingRenderable && (
            <div className="mx-auto max-w-md rounded-2xl border bg-card p-6 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
                <KeyRound className="h-7 w-7 text-muted-foreground" />
              </div>
              <h2 className="mb-2 text-lg font-bold">Belum ada layar untuk Anda</h2>
              <p className="text-sm text-muted-foreground">
                {unknownRole
                  ? "Role Anda tidak lagi dikenali. "
                  : "Belum ada hak akses yang aktif untuk role Anda. "}
                Hubungi owner untuk pengaturan akses.
              </p>
              <Button variant="outline" className="mt-6 w-full" size="lg" onClick={() => void signOut()}>
                Keluar
              </Button>
            </div>
          )}

          <div className="grid md:grid-cols-3 gap-6">
            {/* Attendance Mode — always shown; every employee clocks in here. */}
            {canUseAttendance && (
              <Link to="/absen" className="block group">
              <div className="p-6 rounded-2xl border-2 border-transparent bg-card hover:border-primary transition-all duration-300 hover:shadow-xl hover:shadow-primary/10">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-success to-primary flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <UserCheck className="w-8 h-8 text-primary-foreground" />
                </div>
                <h2 className="text-xl font-bold mb-2">Absensi / Presensi</h2>
                <p className="text-muted-foreground text-sm mb-4">
                  Catat kehadiran Anda dengan verifikasi lokasi dan pengenalan wajah.
                </p>
                <ul className="text-sm space-y-2 text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-success" />
                    Check In / Check Out
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-success" />
                    Verifikasi Wajah & Lokasi
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-success" />
                    Riwayat Absensi Saya
                  </li>
                </ul>
                <Button className="w-full mt-6" size="lg">
                  Mulai Absen
                </Button>
              </div>
            </Link>
            )}

            {/* POS Mode */}
            {canUsePos && (
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
            )}

            {/* Back Office Mode */}
            {canUseBackOffice && (
              <Link to={backOfficePath} className="block group">
              <div className="p-6 rounded-2xl border-2 border-transparent bg-card hover:border-primary transition-all duration-300 hover:shadow-xl hover:shadow-primary/10">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-info to-success flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <Briefcase className="w-8 h-8 text-primary-foreground" />
                </div>
                <h2 className="text-xl font-bold mb-2">Back Office</h2>
                <p className="text-muted-foreground text-sm mb-4">
                  {canSeeAnalytics
                    ? "Mode untuk manajemen, laporan, inventory, keuangan, dan pengaturan sistem."
                    : "Mode untuk mengelola stok: pesanan cabang, transfer, dan opname."}
                </p>
                <ul className="text-sm space-y-2 text-muted-foreground">
                  {backOfficePoints.map((point) => (
                    <li key={point} className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-info" />
                      {point}
                    </li>
                  ))}
                </ul>
                <Button variant="secondary" className="w-full mt-6" size="lg">
                  Masuk Back Office
                </Button>
              </div>
            </Link>
            )}

            {/* Vendor Mode */}
            {canUseVendors && (
              <Link to="/backoffice/vendors" className="block group">
              <div className="p-6 rounded-2xl border-2 border-transparent bg-card hover:border-primary transition-all duration-300 hover:shadow-xl hover:shadow-primary/10">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-warning to-success flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <Truck className="w-8 h-8 text-primary-foreground" />
                </div>
                <h2 className="text-xl font-bold mb-2">Vendor & Supplier</h2>
                <p className="text-muted-foreground text-sm mb-4">
                  Mode untuk mengelola data vendor, katalog produk, sampai hutang pembelian.
                </p>
                <ul className="text-sm space-y-2 text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-warning" />
                    Data Vendor & Kontak
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-warning" />
                    Katalog Produk Vendor
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-warning" />
                    Purchase Order
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-warning" />
                    Hutang & Pembayaran
                  </li>
                </ul>
                <Button variant="outline" className="w-full mt-6" size="lg">
                  Masuk Vendor
                </Button>
              </div>
            </Link>
            )}
          </div>

          <p className="text-center text-xs text-muted-foreground mt-8">
            RetailPro ERP v1.0 - Multi-Branch Retail Management System
          </p>
        </div>
      </div>
    </div>
  );
}
