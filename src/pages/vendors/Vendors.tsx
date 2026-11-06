import { useEffect, useRef, useState } from "react";
import { PermissionGate } from "@/components/auth/PermissionGate";
import { useNavigate } from "react-router-dom";
import { BackOfficeLayout } from "@/components/layout/BackOfficeLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Search,
  Plus,
  Edit,
  Trash2,
  Eye,
  Download,
  Loader2,
  Building2,
  Wallet,
  AlertTriangle,
  Package,
  Truck,
  Upload,
  FileSpreadsheet,
} from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { batchQuery, query, runTransaction } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/formatters";
import { PaginationBar } from "@/components/ui/pagination-bar";
import {
  VENDOR_CATEGORIES,
  VENDOR_STATUSES,
  nextVendorCode,
  vendorCategoryLabel,
  vendorStatusBadgeClass,
  vendorStatusLabel,
} from "@/lib/vendor";
import { VendorFormModal, type VendorRecord } from "@/components/vendors/VendorFormModal";
import {
  VENDOR_COLUMNS,
  VENDOR_TEMPLATE_ROWS,
  dateStamp,
  downloadCsv,
  downloadXlsx,
  normalizeRows,
  parseIdNumber,
  readRows,
  resolveCollisions,
} from "@/lib/bulk-io";

const PAGE_SIZE = 25;

/** Vendor list row: master data plus the procurement roll-ups shown inline. */
interface VendorRow {
  id: string;
  name: string;
  code: string | null;
  legal_name: string | null;
  category: string | null;
  status: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  payment_terms_days: number;
  credit_limit: number;
  rating: number;
  outstanding: number;
  overdue_count: number;
  product_count: number;
  po_count: number;
}

interface VendorStats {
  total_vendors: number;
  active_vendors: number;
  outstanding: number;
  overdue_bills: number;
}

/**
 * Map an imported Kategori cell to a canonical category value. Accepts both the
 * stored English value and the Indonesian label shown in the UI/export.
 */
function mapVendorCategory(value: string | null | undefined): string {
  const token = (value ?? "").trim().toLowerCase();
  return VENDOR_CATEGORIES.find((c) => c.value === token || c.label.toLowerCase() === token)?.value ?? "supplier";
}

/** Same forgiving mapping for vendor status. */
function mapVendorStatus(value: string | null | undefined): string {
  const token = (value ?? "").trim().toLowerCase();
  return VENDOR_STATUSES.find((s) => s.value === token || s.label.toLowerCase() === token)?.value ?? "active";
}

const VENDOR_LIST_SQL = `
  SELECT
    v.id, v.name, v.code, v.legal_name, v.category, v.status, v.contact_person,
    v.phone, v.email, v.payment_terms_days, v.credit_limit, v.rating,
    COALESCE((
      SELECT SUM(e.amount - e.amount_paid)
        FROM expenses e
       WHERE e.supplier_id = v.id AND e.amount > e.amount_paid
    ), 0) AS outstanding,
    (
      SELECT COUNT(*)
        FROM expenses e
       WHERE e.supplier_id = v.id AND e.amount > e.amount_paid
         AND e.due_date IS NOT NULL AND e.due_date < date('now')
    ) AS overdue_count,
    (SELECT COUNT(*) FROM products p WHERE p.supplier_id = v.id) AS product_count,
    (SELECT COUNT(*) FROM purchase_orders po WHERE po.supplier_id = v.id) AS po_count
  FROM suppliers v
  WHERE ($1 = '' OR v.name LIKE $2 OR COALESCE(v.code, '') LIKE $2
         OR COALESCE(v.contact_person, '') LIKE $2 OR COALESCE(v.email, '') LIKE $2)
    AND ($3 = 'all' OR v.status = $3)
    AND ($4 = 'all' OR v.category = $4)
  ORDER BY v.name ASC
  LIMIT $5 OFFSET $6
`;

const VENDOR_COUNT_SQL = `
  SELECT COUNT(*) AS total
  FROM suppliers v
  WHERE ($1 = '' OR v.name LIKE $2 OR COALESCE(v.code, '') LIKE $2
         OR COALESCE(v.contact_person, '') LIKE $2 OR COALESCE(v.email, '') LIKE $2)
    AND ($3 = 'all' OR v.status = $3)
    AND ($4 = 'all' OR v.category = $4)
`;

const VENDOR_STATS_SQL = `
  SELECT
    (SELECT COUNT(*) FROM suppliers) AS total_vendors,
    (SELECT COUNT(*) FROM suppliers WHERE status = 'active') AS active_vendors,
    (SELECT COALESCE(SUM(amount - amount_paid), 0) FROM expenses
      WHERE supplier_id IS NOT NULL AND amount > amount_paid) AS outstanding,
    (SELECT COUNT(*) FROM expenses
      WHERE supplier_id IS NOT NULL AND amount > amount_paid
        AND due_date IS NOT NULL AND due_date < date('now')) AS overdue_bills
`;

const VENDOR_USAGE_SQL = `
  SELECT
    (SELECT COUNT(*) FROM products WHERE supplier_id = $1) AS products,
    (SELECT COUNT(*) FROM purchase_orders WHERE supplier_id = $1) AS orders,
    (SELECT COUNT(*) FROM expenses WHERE supplier_id = $1) AS expenses,
    (SELECT COUNT(*) FROM vendor_products WHERE vendor_id = $1) AS links
`;

export default function Vendors() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [stats, setStats] = useState<VendorStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const [formOpen, setFormOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState<VendorRecord | null>(null);
  const [vendorToDelete, setVendorToDelete] = useState<VendorRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchVendors = async () => {
    try {
      setIsLoading(true);
      const term = searchTerm.trim();
      const filterArgs = [term, `%${term}%`, statusFilter, categoryFilter];

      const [listRes, countRes, statsRes] = await batchQuery([
        { sql: VENDOR_LIST_SQL, params: [...filterArgs, PAGE_SIZE, page * PAGE_SIZE] },
        { sql: VENDOR_COUNT_SQL, params: filterArgs },
        { sql: VENDOR_STATS_SQL },
      ]);

      setVendors(
        (listRes.rows as unknown as VendorRow[]).map((row) => ({
          ...row,
          outstanding: Number(row.outstanding ?? 0),
          overdue_count: Number(row.overdue_count ?? 0),
          product_count: Number(row.product_count ?? 0),
          po_count: Number(row.po_count ?? 0),
        }))
      );
      setTotal(Number((countRes.rows[0] as { total: number } | undefined)?.total ?? 0));

      const rawStats = statsRes.rows[0] as unknown as VendorStats | undefined;
      setStats(
        rawStats
          ? {
              total_vendors: Number(rawStats.total_vendors ?? 0),
              active_vendors: Number(rawStats.active_vendors ?? 0),
              outstanding: Number(rawStats.outstanding ?? 0),
              overdue_bills: Number(rawStats.overdue_bills ?? 0),
            }
          : null
      );
    } catch (error) {
      console.error("Failed to fetch vendors:", error);
      toast.error("Gagal mengambil data vendor");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(searchQuery);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    setPage(0);
  }, [statusFilter, categoryFilter]);

  useEffect(() => {
    fetchVendors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, searchTerm, statusFilter, categoryFilter]);

  const openEdit = async (vendorId: string) => {
    try {
      const res = await query<VendorRecord>(`SELECT * FROM suppliers WHERE id = $1`, [vendorId]);
      if (res.rows.length === 0) {
        toast.error("Vendor tidak ditemukan");
        return;
      }
      setEditingVendor(res.rows[0]);
      setFormOpen(true);
    } catch (error) {
      console.error("Failed to load vendor:", error);
      toast.error("Gagal memuat data vendor");
    }
  };

  /**
   * A vendor that products, POs or bills still reference must not disappear:
   * deleting it would leave those rows pointing at nothing. The UI asks for
   * deactivation instead, which keeps history readable.
   */
  const handleDelete = async () => {
    if (!vendorToDelete) return;
    setIsDeleting(true);
    try {
      const usage = await query<{ products: number; orders: number; expenses: number; links: number }>(
        VENDOR_USAGE_SQL,
        [vendorToDelete.id]
      );
      const row = usage.rows[0];
      const used =
        Number(row?.products ?? 0) + Number(row?.orders ?? 0) + Number(row?.expenses ?? 0);

      if (used > 0) {
        toast.error(
          `Vendor masih terhubung dengan ${Number(row.products)} produk, ${Number(row.orders)} PO, dan ${Number(row.expenses)} tagihan. Nonaktifkan saja.`
        );
        return;
      }

      await runTransaction(async (tx) => {
        await tx.query(`DELETE FROM vendor_products WHERE vendor_id = $1`, [vendorToDelete.id]);
        await tx.query(`DELETE FROM vendor_payments WHERE vendor_id = $1`, [vendorToDelete.id]);
        await tx.query(`DELETE FROM suppliers WHERE id = $1`, [vendorToDelete.id]);
      });

      await logAudit({
        action: "delete",
        entity: "suppliers",
        entityId: vendorToDelete.id,
        details: { name: vendorToDelete.name, code: vendorToDelete.code },
        userId: user?.id,
      });

      toast.success("Vendor berhasil dihapus");
      setPage(0);
      fetchVendors();
    } catch (error) {
      console.error("Failed to delete vendor:", error);
      toast.error("Gagal menghapus vendor");
    } finally {
      setIsDeleting(false);
      setVendorToDelete(null);
    }
  };

  const vendorToRow = (v: VendorRow): Record<string, string> => ({
    code: v.code ?? "",
    name: v.name,
    legalName: v.legal_name ?? "",
    category: v.category ?? "supplier",
    contactPerson: v.contact_person ?? "",
    phone: v.phone ?? "",
    email: v.email ?? "",
    terms: String(v.payment_terms_days ?? 0),
    status: v.status ?? "active",
  });

  const handleExport = (format: "xlsx" | "csv") => {
    if (vendors.length === 0) {
      toast.error("Tidak ada data vendor untuk diexport");
      return;
    }
    // CSV is import-shaped (only the columns a re-import understands).
    if (format === "csv") {
      downloadCsv(`Data_Vendor_${dateStamp()}.csv`, vendors.map(vendorToRow), VENDOR_COLUMNS);
      toast.success("Export CSV berhasil");
      return;
    }
    // Excel keeps the full report, including the procurement roll-ups.
    const rows = vendors.map((vendor) => ({
      Kode: vendor.code || "-",
      "Nama Vendor": vendor.name,
      "Badan Usaha": vendor.legal_name || "-",
      Kategori: vendorCategoryLabel(vendor.category),
      Kontak: vendor.contact_person || "-",
      Telepon: vendor.phone || "-",
      Email: vendor.email || "-",
      Termin: `${vendor.payment_terms_days} hari`,
      Produk: vendor.product_count,
      PO: vendor.po_count,
      Hutang: vendor.outstanding,
      Status: vendorStatusLabel(vendor.status),
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet["!cols"] = [
      { wch: 12 }, { wch: 32 }, { wch: 30 }, { wch: 14 }, { wch: 20 }, { wch: 16 },
      { wch: 26 }, { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 16 }, { wch: 12 },
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Vendor");
    XLSX.writeFile(workbook, `Data_Vendor_${dateStamp()}.xlsx`);
    toast.success("Berhasil export data vendor");
  };

  const handleTemplate = (format: "xlsx" | "csv") => {
    const filename = `template_vendor.${format}`;
    if (format === "csv") downloadCsv(filename, VENDOR_TEMPLATE_ROWS, VENDOR_COLUMNS);
    else downloadXlsx(filename, VENDOR_TEMPLATE_ROWS, VENDOR_COLUMNS, "Template");
    toast.success("Template berhasil didownload");
  };

  /**
   * Additive bulk import: a vendor whose code or name already exists (or repeats
   * inside the file) is skipped, never overwritten. A blank code gets the next
   * VND- number, continuing past the database and past the codes in this file.
   */
  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;

    try {
      const raw = await readRows(file);
      const parsed = normalizeRows(raw, VENDOR_COLUMNS).map((r) => ({
        code: (r.code ?? "").trim().toUpperCase(),
        name: (r.name ?? "").trim(),
        legalName: (r.legalName ?? "").trim(),
        category: mapVendorCategory(r.category),
        contactPerson: (r.contactPerson ?? "").trim(),
        phone: (r.phone ?? "").trim(),
        email: (r.email ?? "").trim(),
        terms: parseIdNumber(r.terms),
        status: mapVendorStatus(r.status),
      }));

      // A vendor needs a name; an email, when present, must look like one.
      const valid = parsed.filter(
        (v) => v.name && (!v.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email))
      );
      const invalid = parsed.length - valid.length;

      const ex = await query<{ code: string | null; name: string }>("SELECT code, name FROM suppliers");
      const existingKeys = new Set<string>();
      ex.rows.forEach((row) => {
        if (row.code) existingKeys.add(row.code.toLowerCase());
        existingKeys.add(row.name.toLowerCase());
      });

      const { fresh, conflicts } = resolveCollisions({
        incoming: valid,
        keysOf: (v) => [v.code, v.name],
        existingKeys,
      });

      const usedCodes = new Set(fresh.filter((v) => v.code).map((v) => v.code.toLowerCase()));
      let latest =
        (await query<{ code: string | null }>(
          `SELECT code FROM suppliers WHERE code LIKE 'VND-%' ORDER BY code DESC LIMIT 1`
        )).rows[0]?.code ?? null;

      let added = 0;
      let auto = 0;
      for (const v of fresh) {
        let code = v.code;
        if (!code) {
          do {
            code = nextVendorCode(latest);
            latest = code;
          } while (existingKeys.has(code.toLowerCase()) || usedCodes.has(code.toLowerCase()));
          usedCodes.add(code.toLowerCase());
          auto++;
        }
        await runTransaction(async (tx) => {
          await tx.query(
            `INSERT INTO suppliers
               (code, name, legal_name, category, status, contact_person, phone, email, payment_terms_days)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              code,
              v.name,
              v.legalName || null,
              v.category,
              v.status,
              v.contactPerson || null,
              v.phone || null,
              v.email || null,
              v.terms,
            ]
          );
        });
        added++;
      }

      const parts = [`${added} vendor ditambahkan`];
      if (auto > 0) parts.push(`${auto} kode dibuat otomatis`);
      if (conflicts.length > 0) parts.push(`${conflicts.length} dilewati (kode/nama sudah ada)`);
      if (invalid > 0) parts.push(`${invalid} baris tidak valid dibuang`);
      (added > 0 ? toast.success : toast)(parts.join(" · "));

      await logAudit({
        action: "create",
        entity: "suppliers",
        entityId: "bulk-import",
        details: { added, auto, skipped: conflicts.length, invalid },
        userId: user?.id,
      });
      fetchVendors();
    } catch (error) {
      console.error("Vendor import failed:", error);
      toast.error("Gagal mengimport vendor");
    }
  };

  return (
    <BackOfficeLayout>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">Vendor</h1>
            <p className="text-muted-foreground mt-1">
              Master data pemasok: kontak, termin pembayaran, produk yang dipasok, dan hutang usaha.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleImportFile}
              className="hidden"
            />
            <PermissionGate permission="manage_vendor_prices">
              <Button variant="outline" className="gap-2" onClick={() => fileInputRef.current?.click()}>
                <Upload className="w-4 h-4" />
                Import
              </Button>
            </PermissionGate>
            <PermissionGate permission="export_reports">
              <Button variant="outline" className="gap-2" onClick={() => handleExport("xlsx")}>
                <Download className="w-4 h-4" />
                Export Excel
              </Button>
              <Button variant="outline" className="gap-2" onClick={() => handleExport("csv")}>
                <Download className="w-4 h-4" />
                Export CSV
              </Button>
            </PermissionGate>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-muted-foreground"
              onClick={() => handleTemplate("csv")}
            >
              <FileSpreadsheet className="w-4 h-4" />
              Template CSV
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-muted-foreground"
              onClick={() => handleTemplate("xlsx")}
            >
              <FileSpreadsheet className="w-4 h-4" />
              Template Excel
            </Button>
            <PermissionGate permission="manage_vendor_prices">
              <Button
                className="gap-2"
                onClick={() => {
                  setEditingVendor(null);
                  setFormOpen(true);
                }}
              >
                <Plus className="w-4 h-4" />
                Tambah Vendor
              </Button>
            </PermissionGate>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-card rounded-xl border p-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-primary/10">
                <Truck className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Vendor</p>
                <p className="text-2xl font-bold">{stats?.total_vendors ?? 0}</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border p-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-success/10">
                <Building2 className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Vendor Aktif</p>
                <p className="text-2xl font-bold">{stats?.active_vendors ?? 0}</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border p-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-warning/10">
                <Wallet className="w-5 h-5 text-warning" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Hutang Vendor</p>
                <p className="text-xl font-bold">{formatCurrency(stats?.outstanding ?? 0)}</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border p-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-destructive/10">
                <AlertTriangle className="w-5 h-5 text-destructive" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Tagihan Jatuh Tempo</p>
                <p className="text-2xl font-bold text-destructive">{stats?.overdue_bills ?? 0}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Cari nama, kode, kontak, atau email..."
              className="pl-8"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[170px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Status</SelectItem>
              {VENDOR_STATUSES.map((status) => (
                <SelectItem key={status.value} value={status.value}>
                  {status.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Kategori" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Kategori</SelectItem>
              {VENDOR_CATEGORIES.map((category) => (
                <SelectItem key={category.value} value={category.value}>
                  {category.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor</TableHead>
                <TableHead>Kategori</TableHead>
                <TableHead>Kontak</TableHead>
                <TableHead>Termin</TableHead>
                <TableHead className="text-center">Produk</TableHead>
                <TableHead className="text-right">Hutang</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                    Memuat vendor...
                  </TableCell>
                </TableRow>
              ) : vendors.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                    Tidak ada vendor ditemukan.
                  </TableCell>
                </TableRow>
              ) : (
                vendors.map((vendor) => (
                  <TableRow key={vendor.id}>
                    <TableCell>
                      <button
                        type="button"
                        className="text-left"
                        onClick={() => navigate(`/backoffice/vendors/${vendor.id}`)}
                      >
                        <p className="font-medium hover:underline">{vendor.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {vendor.code || "Tanpa kode"}
                          {vendor.legal_name ? ` · ${vendor.legal_name}` : ""}
                        </p>
                      </button>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{vendorCategoryLabel(vendor.category)}</Badge>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm">{vendor.contact_person || "-"}</p>
                      <p className="text-xs text-muted-foreground">{vendor.phone || vendor.email || "-"}</p>
                    </TableCell>
                    <TableCell className="text-sm">{vendor.payment_terms_days} hari</TableCell>
                    <TableCell className="text-center">
                      <span className="inline-flex items-center gap-1 text-sm">
                        <Package className="h-3 w-3 text-muted-foreground" />
                        {vendor.product_count}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <p className={vendor.outstanding > 0 ? "font-semibold text-destructive" : "text-sm"}>
                        {formatCurrency(vendor.outstanding)}
                      </p>
                      {vendor.overdue_count > 0 && (
                        <p className="text-xs text-destructive">{vendor.overdue_count} jatuh tempo</p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className={vendorStatusBadgeClass(vendor.status)}>
                        {vendorStatusLabel(vendor.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Lihat detail"
                          onClick={() => navigate(`/backoffice/vendors/${vendor.id}`)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <PermissionGate permission="manage_vendor_prices">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Edit"
                            onClick={() => openEdit(vendor.id)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        </PermissionGate>
                        <PermissionGate permission="manage_vendor_prices">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Hapus"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setVendorToDelete(vendor)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </PermissionGate>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <PaginationBar
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onPageChange={setPage}
            label="vendor"
          />
        </div>
      </div>

      <VendorFormModal
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditingVendor(null);
        }}
        vendor={editingVendor}
        onSaved={() => {
          fetchVendors();
        }}
      />

      <AlertDialog open={Boolean(vendorToDelete)} onOpenChange={(open) => !open && setVendorToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus vendor?</AlertDialogTitle>
            <AlertDialogDescription>
              {vendorToDelete?.name} akan dihapus permanen. Vendor yang masih dipakai produk,
              purchase order, atau tagihan tidak dapat dihapus — nonaktifkan statusnya sebagai gantinya.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
              onClick={(event) => {
                event.preventDefault();
                handleDelete();
              }}
            >
              {isDeleting ? "Menghapus..." : "Hapus"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </BackOfficeLayout>
  );
}
