import { MainLayout } from "@/components/layout/MainLayout";
import { StatCard } from "@/components/dashboard/StatCard";
import { SalesChart } from "@/components/dashboard/SalesChart";
import { BranchPerformance } from "@/components/dashboard/BranchPerformance";
import { RecentTransactions } from "@/components/dashboard/RecentTransactions";
import { LowStockAlert } from "@/components/dashboard/LowStockAlert";
import {
  DollarSign,
  ShoppingCart,
  Package,
  Users,
  TrendingUp,
  Building2,
} from "lucide-react";

export default function Dashboard() {
  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold">Dashboard</h1>
            <p className="text-muted-foreground mt-1">
              Selamat datang kembali! Berikut ringkasan bisnis Anda hari ini.
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Update terakhir:</span>
            <span className="font-medium text-foreground">
              {new Date().toLocaleString("id-ID", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Total Penjualan Hari Ini"
            value="Rp 45.8 Jt"
            change={12.5}
            icon={<DollarSign className="w-6 h-6" />}
            variant="primary"
          />
          <StatCard
            title="Transaksi Hari Ini"
            value="328"
            change={8.2}
            icon={<ShoppingCart className="w-6 h-6" />}
            variant="info"
          />
          <StatCard
            title="Produk Terjual"
            value="1,542"
            change={-2.4}
            icon={<Package className="w-6 h-6" />}
            variant="success"
          />
          <StatCard
            title="Karyawan Aktif"
            value="64"
            change={0}
            icon={<Users className="w-6 h-6" />}
            variant="warning"
          />
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <SalesChart />
          </div>
          <div>
            <BranchPerformance />
          </div>
        </div>

        {/* Bottom Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <RecentTransactions />
          <LowStockAlert />
        </div>
      </div>
    </MainLayout>
  );
}
