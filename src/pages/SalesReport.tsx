import { useState } from "react";
import { PermissionGate } from "@/components/auth/PermissionGate";
import { BackOfficeLayout } from "@/components/layout/BackOfficeLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { useQuery } from "@tanstack/react-query";
import { query } from "@/lib/db";
import { Download, Loader2, ArrowLeft } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { id } from "date-fns/locale";
import { paymentLabel } from "@/lib/print/receipt-doc";

function formatIdr(value: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR" }).format(value);
}

export default function SalesReport() {
  const navigate = useNavigate();
  const [dateRange, setDateRange] = useState<{ from: string; to: string }>({
    from: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
    to: new Date().toISOString().split('T')[0],
  });
  const [selectedBranch, setSelectedBranch] = useState("all");

  const { data: branches = [] } = useQuery({
    queryKey: ["branches"],
    queryFn: async () => {
      const res = await query("SELECT id, name FROM branches ORDER BY name ASC");
      return res.rows;
    },
  });

  const { data: salesData = [], isLoading } = useQuery({
    queryKey: ["salesReport", dateRange, selectedBranch],
    queryFn: async () => {
      if (!dateRange?.from || !dateRange?.to) return [];
      
      let queryStr = `
        SELECT 
          t.id,
          t.invoice_number,
          t.created_at,
          t.total_amount,
          t.payment_method,
          t.fee_amount,
          t.source,
          t.status,
          b.name as branch_name,
          u.name as cashier_name
        FROM transactions t
        LEFT JOIN branches b ON t.branch_id = b.id
        LEFT JOIN users u ON t.cashier_id = u.id
        WHERE t.created_at >= $1 AND t.created_at <= $2
      `;
      
      // Add time to dates to cover full days
      const fromDate = new Date(dateRange.from);
      fromDate.setHours(0, 0, 0, 0);
      
      const toDate = new Date(dateRange.to);
      toDate.setHours(23, 59, 59, 999);

      const params: any[] = [fromDate.toISOString(), toDate.toISOString()];
      
      if (selectedBranch !== "all") {
        queryStr += ` AND t.branch_id = $3`;
        params.push(selectedBranch);
      }
      
      queryStr += ` ORDER BY t.created_at DESC`;
      
      const res = await query(queryStr, params);
      return res.rows.map((row: any) => ({
        ...row,
        total_amount: Number(row.total_amount),
        fee_amount: Number(row.fee_amount) || 0,
        source: row.source ?? "pos",
      }));
    },
    enabled: !!dateRange?.from && !!dateRange?.to,
  });

  const handleExport = () => {
    if (salesData.length === 0) {
      toast.error("Tidak ada data untuk diexport");
      return;
    }

    const exportData = salesData.map((item: any) => ({
      "No. Invoice": item.invoice_number,
      "Tanggal": format(new Date(item.created_at), "dd MMM yyyy HH:mm", { locale: id }),
      "Outlet": item.branch_name || "-",
      "Kasir": item.cashier_name || "-",
      "Metode Pembayaran": paymentLabel(item.payment_method),
      "Kanal": item.source === "online" ? "Online" : "Kasir",
      "Status": item.status,
      "Total": item.total_amount,
      "Biaya Merchant": Number(item.fee_amount) || 0,
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Laporan Penjualan");

    // Auto-width
    const wscols = [
      { wch: 20 }, // Invoice
      { wch: 20 }, // Tanggal
      { wch: 20 }, // Cabang
      { wch: 20 }, // Kasir
      { wch: 15 }, // Payment
      { wch: 12 }, // Kanal
      { wch: 15 }, // Status
      { wch: 15 }, // Total
      { wch: 15 }, // Biaya Merchant
    ];
    ws["!cols"] = wscols;

    XLSX.writeFile(wb, `Laporan_Penjualan_${format(new Date(), "yyyy-MM-dd")}.xlsx`);
    toast.success("Berhasil export laporan penjualan");
  };

  // The table lists every bon including voids, but revenue only adds up the
  // completed ones: a voided bon keeps its `total_amount` as the record of the
  // cancelled sale, so summing it here would double-count money already back.
  const completedSales = salesData.filter((item) => item.status === "completed");
  const totalSales = completedSales.reduce((acc, curr) => acc + curr.total_amount, 0);
  // Net revenue is what the store keeps after the merchant fee it absorbs. The
  // fee never changes what the customer paid, only what actually lands with us.
  const totalFee = completedSales.reduce((acc, curr) => acc + (Number(curr.fee_amount) || 0), 0);
  const netSales = totalSales - totalFee;

  return (
    <BackOfficeLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/backoffice/reports")}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Laporan Penjualan</h1>
            <p className="text-muted-foreground">Detail transaksi penjualan</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 items-end sm:items-center justify-between">
          <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
            <div className="w-full sm:w-[250px]">
               <div className="flex items-center gap-2">
                 <Input 
                   type="date" 
                   value={dateRange.from} 
                   onChange={(e) => setDateRange(prev => ({ ...prev, from: e.target.value }))}
                   className="w-[140px]"
                 />
                 <span className="text-muted-foreground">-</span>
                 <Input 
                   type="date" 
                   value={dateRange.to} 
                   onChange={(e) => setDateRange(prev => ({ ...prev, to: e.target.value }))}
                   className="w-[140px]"
                 />
               </div>
            </div>
            <Select value={selectedBranch} onValueChange={setSelectedBranch}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <SelectValue placeholder="Pilih Outlet" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Outlet</SelectItem>
                {branches.map((b: any) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <PermissionGate permission="export_reports">
            <Button onClick={handleExport} className="gap-2">
              <Download className="w-4 h-4" /> Export Excel
            </Button>
          </PermissionGate>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Total Penjualan</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">
                        {formatIdr(totalSales)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                        {salesData.length} Transaksi
                    </p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Biaya Merchant</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold text-warning">
                        {formatIdr(totalFee)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                        Biaya transfer &amp; QRIS yang ditanggung toko
                    </p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Pendapatan Bersih</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold text-success">
                        {formatIdr(netSales)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                        Total penjualan dikurangi biaya merchant
                    </p>
                </CardContent>
            </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Riwayat Transaksi</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No. Invoice</TableHead>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Outlet</TableHead>
                  <TableHead>Kasir</TableHead>
                  <TableHead>Metode</TableHead>
                  <TableHead>Kanal</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Biaya</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="h-24 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" /> Loading...
                      </div>
                    </TableCell>
                  </TableRow>
                ) : salesData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                      Tidak ada data transaksi pada periode ini
                    </TableCell>
                  </TableRow>
                ) : (
                  salesData.map((item: any) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.invoice_number}</TableCell>
                      <TableCell>
                        {format(new Date(item.created_at), "dd MMM yyyy HH:mm", { locale: id })}
                      </TableCell>
                      <TableCell>{item.branch_name || "-"}</TableCell>
                      <TableCell>{item.cashier_name || "-"}</TableCell>
                      <TableCell>{paymentLabel(item.payment_method)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {item.source === "online" ? "Online" : "Kasir"}
                      </TableCell>
                      <TableCell>
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            item.status === 'completed' ? 'bg-green-100 text-green-800' : 
                            item.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'
                        }`}>
                            {item.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {(Number(item.fee_amount) || 0) > 0 ? formatIdr(Number(item.fee_amount)) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR" }).format(item.total_amount)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </BackOfficeLayout>
  );
}
