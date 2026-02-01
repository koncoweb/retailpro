import { useState } from "react";
import { BackOfficeLayout } from "@/components/layout/BackOfficeLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { query } from "@/lib/db";
import { Download, TrendingUp, TrendingDown, DollarSign, FileText, ArrowRight, ArrowLeft } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

export default function FinanceReports() {
  const navigate = useNavigate();

  const { data: summary = { income: 0, expense: 0, profit: 0 }, isLoading } = useQuery({
    queryKey: ["financeSummary"],
    queryFn: async () => {
      // Get total income (sales)
      const incomeRes = await query(`
        SELECT COALESCE(SUM(total_amount), 0) as total
        FROM transactions
        WHERE status = 'completed'
      `);
      
      // Get total expenses
      const expenseRes = await query(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM expenses
      `);

      const income = Number(incomeRes.rows[0].total);
      const expense = Number(expenseRes.rows[0].total);

      return {
        income,
        expense,
        profit: income - expense
      };
    },
  });

  const handleExport = () => {
    const data = [
      ["Ringkasan Keuangan"],
      [""],
      ["Total Pendapatan", summary.income],
      ["Total Pengeluaran", summary.expense],
      ["Laba Bersih", summary.profit],
      [""],
      ["Dicetak pada", new Date().toLocaleString()]
    ];

    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Ringkasan");
    
    ws['!cols'] = [{wch: 20}, {wch: 20}];

    XLSX.writeFile(wb, `Ringkasan_Keuangan_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success("Berhasil export ringkasan keuangan");
  };

  const menuItems = [
    {
      title: "Jurnal Umum",
      description: "Catatan detail debit dan kredit transaksi",
      icon: FileText,
      path: "/backoffice/finance/journal",
      color: "text-blue-500",
      bgColor: "bg-blue-100 dark:bg-blue-900/20"
    },
    {
      title: "Arus Kas (Cashflow)",
      description: "Analisis pemasukan dan pengeluaran per periode",
      icon: TrendingUp,
      path: "/backoffice/finance/cashflow",
      color: "text-emerald-500",
      bgColor: "bg-emerald-100 dark:bg-emerald-900/20"
    },
    {
      title: "Pengeluaran",
      description: "Daftar beban operasional dan biaya lainnya",
      icon: TrendingDown,
      path: "/backoffice/finance/expenses",
      color: "text-rose-500",
      bgColor: "bg-rose-100 dark:bg-rose-900/20"
    },
    {
      title: "Hutang & Piutang",
      description: "Monitoring tagihan dan kewajiban pembayaran",
      icon: DollarSign,
      path: "/backoffice/finance/ap-ar",
      color: "text-amber-500",
      bgColor: "bg-amber-100 dark:bg-amber-900/20"
    }
  ];

  return (
    <BackOfficeLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/backoffice/reports")}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Laporan Keuangan</h1>
            <p className="text-muted-foreground">Pusat data dan pelaporan keuangan</p>
          </div>
        </div>

        <div className="flex justify-end">
             <Button onClick={handleExport} className="gap-2">
                <Download className="w-4 h-4" /> Export Ringkasan
            </Button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Pendapatan</CardTitle>
              <TrendingUp className="h-4 w-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-600">
                {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR" }).format(summary.income)}
              </div>
              <p className="text-xs text-muted-foreground">Total akumulasi pendapatan</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Pengeluaran</CardTitle>
              <TrendingDown className="h-4 w-4 text-rose-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-rose-600">
                {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR" }).format(summary.expense)}
              </div>
              <p className="text-xs text-muted-foreground">Total akumulasi beban</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Laba Bersih</CardTitle>
              <DollarSign className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${summary.profit >= 0 ? 'text-blue-600' : 'text-rose-600'}`}>
                {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR" }).format(summary.profit)}
              </div>
              <p className="text-xs text-muted-foreground">Pendapatan - Pengeluaran</p>
            </CardContent>
          </Card>
        </div>

        {/* Navigation Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {menuItems.map((item) => (
            <Card 
                key={item.title} 
                className="cursor-pointer hover:shadow-md transition-all group"
                onClick={() => navigate(item.path)}
            >
              <CardHeader className="flex flex-row items-center gap-4">
                <div className={`p-3 rounded-xl ${item.bgColor}`}>
                  <item.icon className={`w-6 h-6 ${item.color}`} />
                </div>
                <div className="flex-1">
                  <CardTitle className="text-lg group-hover:text-primary transition-colors">
                    {item.title}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    {item.description}
                  </CardDescription>
                </div>
                <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:translate-x-1 transition-transform" />
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>
    </BackOfficeLayout>
  );
}
