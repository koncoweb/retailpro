import { useCallback, useEffect, useMemo, useState } from "react";
import { PermissionGate } from "@/components/auth/PermissionGate";
import { Link } from "react-router-dom";
import { BackOfficeLayout } from "@/components/layout/BackOfficeLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { ArrowLeft, Download, FileSpreadsheet, Loader2 } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { batchQuery, query } from "@/lib/db";
import { formatCurrency } from "@/lib/formatters";
import { getPeriodRange, type ReportPeriod } from "@/lib/date-range";
import { PO_STATUS_LABEL, normalizePurchaseOrderStatus } from "@/lib/procurement";
import { STOCK_REQUEST_STATUS_LABEL, type StockRequestStatus } from "@/lib/branch-orders";

const PERIOD_OPTIONS: { value: ReportPeriod; label: string }[] = [
  { value: "today", label: "Hari Ini" },
  { value: "thisweek", label: "Minggu Ini" },
  { value: "thismonth", label: "Bulan Ini" },
  { value: "thisyear", label: "Tahun Ini" },
];

interface StatusRow {
  status: string;
  total: number;
  value: number;
}

interface BranchRow {
  branch: string;
  total: number;
  waiting: number;
  to_ship: number;
  shipping: number;
  done: number;
  rejected: number;
}

interface Totals {
  poCount: number;
  poValue: number;
  poOpen: number;
  leadDays: number | null;
  requestCount: number;
  cycleDays: number | null;
}

const EMPTY_TOTALS: Totals = {
  poCount: 0,
  poValue: 0,
  poOpen: 0,
  leadDays: null,
  requestCount: 0,
  cycleDays: null,
};

function days(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 10) / 10 : null;
}

export default function ProcurementReport() {
  const [period, setPeriod] = useState<ReportPeriod>("thismonth");
  const [branchFilter, setBranchFilter] = useState("all");
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [totals, setTotals] = useState<Totals>(EMPTY_TOTALS);
  const [poByStatus, setPoByStatus] = useState<StatusRow[]>([]);
  const [requestsByBranch, setRequestsByBranch] = useState<BranchRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    query<{ id: string; name: string }>("SELECT id, name FROM branches ORDER BY name")
      .then((res) => setBranches(res.rows))
      .catch((error) => console.error("Failed to load branches:", error));
  }, []);

  /**
   * One branch predicate, spelled once: the aggregate view must include every
   * branch, so the condition is appended only when a branch is selected.
   */
  const scope = useMemo(() => {
    const scoped = branchFilter !== "all";
    return {
      clause: (alias: string) =>
        scoped
          ? ` AND ${alias}.created_at >= $1 AND ${alias}.created_at < $2 AND ${alias}.branch_id = $3`
          : ` AND ${alias}.created_at >= $1 AND ${alias}.created_at < $2`,
      args: (start: string, end: string) =>
        scoped ? [start, end, branchFilter] : [start, end],
    };
  }, [branchFilter]);

  const load = useCallback(async () => {
    setIsLoading(true);
    const [start, end] = getPeriodRange(period);
    const args = scope.args(start, end);
    try {
      const [totalsRes, statusRes, branchRes] = await batchQuery<Record<string, unknown>>([
        {
          // Lead time is measured from approval to the first delivery: that is
          // the part of the wait procurement actually controls.
          sql: `SELECT
                  (SELECT COUNT(*) FROM purchase_orders po WHERE 1=1 ${scope.clause("po")}) AS po_count,
                  (SELECT COALESCE(SUM(po.total_amount), 0) FROM purchase_orders po
                    WHERE 1=1 ${scope.clause("po")}
                      AND po.status NOT IN ('rejected', 'cancelled')) AS po_value,
                  (SELECT COUNT(*) FROM purchase_orders po
                    WHERE 1=1 ${scope.clause("po")}
                      AND po.status IN ('submitted', 'approved', 'partially_received')) AS po_open,
                  (SELECT AVG(julianday(po.received_at) - julianday(po.approved_at))
                     FROM purchase_orders po
                    WHERE 1=1 ${scope.clause("po")}
                      AND po.approved_at IS NOT NULL AND po.received_at IS NOT NULL) AS lead_days,
                  (SELECT COUNT(*) FROM stock_requests r WHERE 1=1 ${scope.clause("r")}) AS request_count,
                  (SELECT AVG(julianday(r.received_at) - julianday(r.created_at))
                     FROM stock_requests r
                    WHERE 1=1 ${scope.clause("r")}
                      AND r.received_at IS NOT NULL) AS cycle_days`,
          params: args,
        },
        {
          sql: `SELECT po.status, COUNT(*) AS total, COALESCE(SUM(po.total_amount), 0) AS value
                  FROM purchase_orders po
                 WHERE 1=1 ${scope.clause("po")}
                 GROUP BY po.status
                 ORDER BY total DESC`,
          params: args,
        },
        {
          sql: `SELECT COALESCE(b.name, '-') AS branch,
                       COUNT(*) AS total,
                       SUM(CASE WHEN r.status = 'submitted' THEN 1 ELSE 0 END) AS waiting,
                       SUM(CASE WHEN r.status = 'approved' THEN 1 ELSE 0 END) AS to_ship,
                       SUM(CASE WHEN r.status = 'in_transit' THEN 1 ELSE 0 END) AS shipping,
                       SUM(CASE WHEN r.status = 'received' THEN 1 ELSE 0 END) AS done,
                       SUM(CASE WHEN r.status = 'rejected' THEN 1 ELSE 0 END) AS rejected
                  FROM stock_requests r
                  LEFT JOIN branches b ON b.id = r.branch_id
                 WHERE 1=1 ${scope.clause("r")}
                 GROUP BY b.name
                 ORDER BY total DESC`,
          params: args,
        },
      ]);

      const row = totalsRes.rows[0] ?? {};
      setTotals({
        poCount: Number(row.po_count ?? 0),
        poValue: Number(row.po_value ?? 0),
        poOpen: Number(row.po_open ?? 0),
        leadDays: days(row.lead_days),
        requestCount: Number(row.request_count ?? 0),
        cycleDays: days(row.cycle_days),
      });
      setPoByStatus(
        statusRes.rows.map((item) => ({
          status: normalizePurchaseOrderStatus(String(item.status)),
          total: Number(item.total),
          value: Number(item.value),
        }))
      );
      setRequestsByBranch(
        branchRes.rows.map((item) => ({
          branch: String(item.branch),
          total: Number(item.total),
          waiting: Number(item.waiting),
          to_ship: Number(item.to_ship),
          shipping: Number(item.shipping),
          done: Number(item.done),
          rejected: Number(item.rejected),
        }))
      );
    } catch (error) {
      console.error("Failed to load procurement report:", error);
      toast.error("Gagal memuat laporan pengadaan");
    } finally {
      setIsLoading(false);
    }
  }, [period, scope]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * The file carries the rows behind the figures, not just the figures: an
   * owner reconciling a month needs to see which documents make up the total.
   */
  const handleExport = async () => {
    setIsExporting(true);
    const [start, end] = getPeriodRange(period);
    const args = scope.args(start, end);
    try {
      const [poRes, requestRes] = await batchQuery<Record<string, unknown>>([
        {
          sql: `SELECT po.po_number, po.supplier_name, po.status, po.total_amount,
                       po.created_at, po.approved_at, po.received_at
                  FROM purchase_orders po
                 WHERE 1=1 ${scope.clause("po")}
                 ORDER BY po.created_at DESC`,
          params: args,
        },
        {
          sql: `SELECT r.request_number, COALESCE(b.name, '-') AS branch, r.status,
                       r.source, r.created_at, r.received_at
                  FROM stock_requests r
                  LEFT JOIN branches b ON b.id = r.branch_id
                 WHERE 1=1 ${scope.clause("r")}
                 ORDER BY r.created_at DESC`,
          params: args,
        },
      ]);

      const book = XLSX.utils.book_new();

      const poSheet = XLSX.utils.json_to_sheet(
        poRes.rows.map((item) => ({
          "No. PO": item.po_number,
          Vendor: item.supplier_name ?? "-",
          Status: PO_STATUS_LABEL[normalizePurchaseOrderStatus(String(item.status))],
          "Nilai PO": Number(item.total_amount),
          Dibuat: item.created_at,
          Disetujui: item.approved_at ?? "-",
          Diterima: item.received_at ?? "-",
        }))
      );
      poSheet["!cols"] = [
        { wch: 22 },
        { wch: 24 },
        { wch: 20 },
        { wch: 16 },
        { wch: 22 },
        { wch: 22 },
        { wch: 22 },
      ];
      XLSX.utils.book_append_sheet(book, poSheet, "Purchase Order");

      const requestSheet = XLSX.utils.json_to_sheet(
        requestRes.rows.map((item) => ({
          "No. Pesanan": item.request_number,
          Cabang: item.branch,
          Status: STOCK_REQUEST_STATUS_LABEL[String(item.status) as StockRequestStatus] ?? item.status,
          Sumber: item.source,
          Dibuat: item.created_at,
          Diterima: item.received_at ?? "-",
        }))
      );
      requestSheet["!cols"] = [
        { wch: 26 },
        { wch: 20 },
        { wch: 22 },
        { wch: 14 },
        { wch: 22 },
        { wch: 22 },
      ];
      XLSX.utils.book_append_sheet(book, requestSheet, "Pesanan Cabang");

      XLSX.writeFile(book, `Laporan_Pengadaan_${new Date().toISOString().split("T")[0]}.xlsx`);
      toast.success("Berhasil export laporan pengadaan");
    } catch (error) {
      console.error("Failed to export procurement report:", error);
      toast.error("Gagal export laporan pengadaan");
    } finally {
      setIsExporting(false);
    }
  };

  const cards = [
    { label: "Nilai PO", value: formatCurrency(totals.poValue), hint: "dokumen pada periode ini" },
    { label: "PO dibuat", value: String(totals.poCount), hint: `${totals.poOpen} masih berjalan` },
    {
      label: "Rata-rata lead time",
      value: totals.leadDays === null ? "-" : `${totals.leadDays} hari`,
      hint: "disetujui sampai diterima",
    },
    {
      label: "Permintaan cabang",
      value: String(totals.requestCount),
      hint:
        totals.cycleDays === null
          ? "belum ada yang selesai"
          : `rata-rata ${totals.cycleDays} hari sampai diterima`,
    },
  ];

  return (
    <BackOfficeLayout>
      <div className="space-y-4 md:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3">
            <Button asChild variant="ghost" size="icon" className="mt-1">
              <Link to="/backoffice/reports" aria-label="Kembali ke daftar laporan">
                <ArrowLeft className="w-4 h-4" />
              </Link>
            </Button>
            <div>
              <h1 className="text-xl md:text-2xl lg:text-3xl font-bold">Laporan Pengadaan</h1>
              <p className="text-muted-foreground text-sm md:text-base mt-1">
                Purchase order ke vendor dan permintaan cabang ke gudang pusat.
              </p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Select value={period} onValueChange={(value) => setPeriod(value as ReportPeriod)}>
              <SelectTrigger className="w-full sm:w-[170px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={branchFilter} onValueChange={setBranchFilter}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Cabang</SelectItem>
                {branches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <PermissionGate permission="export_reports">
              <Button variant="outline" className="gap-2" onClick={handleExport} disabled={isExporting}>
                {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Export
              </Button>
            </PermissionGate>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
              {cards.map((card) => (
                <Card key={card.label}>
                  <CardHeader className="pb-2">
                    <CardDescription>{card.label}</CardDescription>
                    <CardTitle className="text-2xl">{card.value}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">{card.hint}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FileSpreadsheet className="w-4 h-4" />
                    Purchase order per status
                  </CardTitle>
                  <CardDescription>Dokumen yang dibuat pada periode ini</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Jumlah</TableHead>
                        <TableHead className="text-right">Nilai</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {poByStatus.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center py-6 text-muted-foreground">
                            Belum ada purchase order pada periode ini
                          </TableCell>
                        </TableRow>
                      )}
                      {poByStatus.map((row) => (
                        <TableRow key={row.status}>
                          <TableCell>{PO_STATUS_LABEL[row.status as keyof typeof PO_STATUS_LABEL]}</TableCell>
                          <TableCell className="text-right">{row.total}</TableCell>
                          <TableCell className="text-right">{formatCurrency(row.value)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FileSpreadsheet className="w-4 h-4" />
                    Permintaan cabang per cabang
                  </CardTitle>
                  <CardDescription>Alur terima dari gudang pusat pada periode ini</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Cabang</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                          <TableHead className="text-right">Menunggu</TableHead>
                          <TableHead className="text-right">Dikirim</TableHead>
                          <TableHead className="text-right">Diterima</TableHead>
                          <TableHead className="text-right">Ditolak</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {requestsByBranch.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center py-6 text-muted-foreground">
                              Belum ada permintaan pada periode ini
                            </TableCell>
                          </TableRow>
                        )}
                        {requestsByBranch.map((row) => (
                          <TableRow key={row.branch}>
                            <TableCell>{row.branch}</TableCell>
                            <TableCell className="text-right">{row.total}</TableCell>
                            <TableCell className="text-right">{row.waiting + row.to_ship}</TableCell>
                            <TableCell className="text-right">{row.shipping}</TableCell>
                            <TableCell className="text-right">{row.done}</TableCell>
                            <TableCell className="text-right">{row.rejected}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </BackOfficeLayout>
  );
}
