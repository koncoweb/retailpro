import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BackOfficeLayout } from "@/components/layout/BackOfficeLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  Building2,
  CreditCard,
  Edit,
  Link2,
  Loader2,
  Mail,
  MapPin,
  Package,
  Phone,
  Plus,
  Star,
  Trash2,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { batchQuery, query, runTransaction } from "@/lib/db";
import { logAudit, logAuditTx } from "@/lib/audit";
import { formatCurrency } from "@/lib/formatters";
import {
  VENDOR_PAYMENT_METHODS,
  dueDateFromTerms,
  isOverdue,
  isoDate,
  outstandingAmount,
  vendorCategoryLabel,
  vendorInitials,
  vendorStatusBadgeClass,
  vendorStatusLabel,
} from "@/lib/vendor";
import { VendorFormModal, type VendorRecord } from "@/components/vendors/VendorFormModal";

interface VendorSummary {
  po_count: number;
  po_total: number;
  outstanding: number;
  paid_total: number;
  product_count: number;
  overdue_count: number;
}

interface LinkedProduct {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  stock: number;
  cost_price: number;
  link_id: string | null;
  vendor_sku: string | null;
  last_cost: number | null;
  lead_time_days: number | null;
  min_order_qty: number | null;
  is_preferred: number | null;
}

interface PurchaseOrderRow {
  id: string;
  po_number: string;
  status: string;
  total_amount: number;
  expected_date: string | null;
  received_at: string | null;
  created_at: string;
  items_count: number;
}

interface ExpenseRow {
  id: string;
  description: string;
  category: string;
  amount: number;
  amount_paid: number;
  date: string;
  due_date: string | null;
  status: string;
}

interface VendorPaymentRow {
  id: string;
  amount: number;
  payment_date: string;
  method: string;
  reference_number: string | null;
  notes: string | null;
  expense_description: string | null;
}

interface ProductOption {
  id: string;
  sku: string;
  name: string;
  cost_price: number;
}

const VENDOR_SQL = `SELECT * FROM suppliers WHERE id = $1`;

const VENDOR_SUMMARY_SQL = `
  SELECT
    (SELECT COUNT(*) FROM purchase_orders WHERE supplier_id = $1) AS po_count,
    (SELECT COALESCE(SUM(total_amount), 0) FROM purchase_orders
      WHERE supplier_id = $1 AND status = 'received') AS po_total,
    (SELECT COALESCE(SUM(amount - amount_paid), 0) FROM expenses
      WHERE supplier_id = $1 AND amount > amount_paid) AS outstanding,
    (SELECT COALESCE(SUM(amount_paid), 0) FROM expenses WHERE supplier_id = $1) AS paid_total,
    (SELECT COUNT(*) FROM products WHERE supplier_id = $1) AS product_count,
    (SELECT COUNT(*) FROM expenses
      WHERE supplier_id = $1 AND amount > amount_paid
        AND due_date IS NOT NULL AND due_date < date('now')) AS overdue_count
`;

/**
 * `products.supplier_id` is the product's main vendor, `vendor_products` is the
 * vendor-specific catalogue. Both are read so a product that was assigned before
 * this module existed still appears on the vendor it belongs to.
 */
const VENDOR_PRODUCTS_SQL = `
  SELECT
    p.id, p.sku, p.name, p.category, p.cost_price,
    COALESCE(SUM(b.quantity_current), 0) AS stock,
    vp.id AS link_id, vp.vendor_sku, vp.last_cost, vp.lead_time_days,
    vp.min_order_qty, vp.is_preferred
  FROM products p
  LEFT JOIN vendor_products vp ON vp.product_id = p.id AND vp.vendor_id = $1
  LEFT JOIN product_batches b ON b.product_id = p.id
  WHERE p.supplier_id = $1 OR vp.vendor_id = $1
  GROUP BY p.id
  ORDER BY p.name ASC
`;

const VENDOR_ORDERS_SQL = `
  SELECT
    po.id, po.po_number, po.status, po.total_amount, po.expected_date,
    po.received_at, po.created_at,
    (SELECT COUNT(*) FROM purchase_order_items poi WHERE poi.purchase_order_id = po.id) AS items_count
  FROM purchase_orders po
  WHERE po.supplier_id = $1
  ORDER BY po.created_at DESC
  LIMIT 50
`;

const VENDOR_BILLS_SQL = `
  SELECT id, description, category, amount, amount_paid, date, due_date, status
  FROM expenses
  WHERE supplier_id = $1
  ORDER BY date DESC
  LIMIT 100
`;

const VENDOR_PAYMENTS_SQL = `
  SELECT vp.id, vp.amount, vp.payment_date, vp.method, vp.reference_number, vp.notes,
         e.description AS expense_description
  FROM vendor_payments vp
  LEFT JOIN expenses e ON e.id = vp.expense_id
  WHERE vp.vendor_id = $1
  ORDER BY vp.payment_date DESC, vp.created_at DESC
  LIMIT 100
`;

const UNLINKED_PRODUCTS_SQL = `
  SELECT p.id, p.sku, p.name, p.cost_price
  FROM products p
  WHERE p.id NOT IN (SELECT product_id FROM vendor_products WHERE vendor_id = $1)
  ORDER BY p.name ASC
`;

export default function VendorDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [vendor, setVendor] = useState<VendorRecord | null>(null);
  const [summary, setSummary] = useState<VendorSummary | null>(null);
  const [products, setProducts] = useState<LinkedProduct[]>([]);
  const [orders, setOrders] = useState<PurchaseOrderRow[]>([]);
  const [bills, setBills] = useState<ExpenseRow[]>([]);
  const [payments, setPayments] = useState<VendorPaymentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [editOpen, setEditOpen] = useState(false);

  const [linkOpen, setLinkOpen] = useState(false);
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [linkForm, setLinkForm] = useState({
    productId: "",
    vendorSku: "",
    lastCost: "",
    leadTime: "0",
    minOrderQty: "1",
  });
  const [isSavingLink, setIsSavingLink] = useState(false);

  const [paymentTarget, setPaymentTarget] = useState<ExpenseRow | null>(null);
  const [paymentForm, setPaymentForm] = useState({
    amount: "",
    date: isoDate(),
    method: "transfer",
    reference: "",
    notes: "",
  });
  const [isSavingPayment, setIsSavingPayment] = useState(false);

  const [debtOpen, setDebtOpen] = useState(false);
  const [debtForm, setDebtForm] = useState({
    description: "",
    amount: "",
    dueDate: dueDateFromTerms(30),
  });
  const [isSavingDebt, setIsSavingDebt] = useState(false);

  const loadVendor = async () => {
    if (!id) return;
    try {
      setIsLoading(true);
      const [vendorRes, summaryRes, productsRes, ordersRes, billsRes, paymentsRes] =
        await batchQuery([
          { sql: VENDOR_SQL, params: [id] },
          { sql: VENDOR_SUMMARY_SQL, params: [id] },
          { sql: VENDOR_PRODUCTS_SQL, params: [id] },
          { sql: VENDOR_ORDERS_SQL, params: [id] },
          { sql: VENDOR_BILLS_SQL, params: [id] },
          { sql: VENDOR_PAYMENTS_SQL, params: [id] },
        ]);

      if (vendorRes.rows.length === 0) {
        setNotFound(true);
        return;
      }

      setVendor(vendorRes.rows[0] as unknown as VendorRecord);

      const rawSummary = summaryRes.rows[0] as unknown as VendorSummary | undefined;
      setSummary({
        po_count: Number(rawSummary?.po_count ?? 0),
        po_total: Number(rawSummary?.po_total ?? 0),
        outstanding: Number(rawSummary?.outstanding ?? 0),
        paid_total: Number(rawSummary?.paid_total ?? 0),
        product_count: Number(rawSummary?.product_count ?? 0),
        overdue_count: Number(rawSummary?.overdue_count ?? 0),
      });

      setProducts(
        (productsRes.rows as unknown as LinkedProduct[]).map((row) => ({
          ...row,
          stock: Number(row.stock ?? 0),
          cost_price: Number(row.cost_price ?? 0),
          last_cost: row.last_cost === null ? null : Number(row.last_cost),
          min_order_qty: row.min_order_qty === null ? null : Number(row.min_order_qty),
        }))
      );
      setOrders(
        (ordersRes.rows as unknown as PurchaseOrderRow[]).map((row) => ({
          ...row,
          total_amount: Number(row.total_amount ?? 0),
          items_count: Number(row.items_count ?? 0),
        }))
      );
      setBills(
        (billsRes.rows as unknown as ExpenseRow[]).map((row) => ({
          ...row,
          amount: Number(row.amount ?? 0),
          amount_paid: Number(row.amount_paid ?? 0),
        }))
      );
      setPayments(
        (paymentsRes.rows as unknown as VendorPaymentRow[]).map((row) => ({
          ...row,
          amount: Number(row.amount ?? 0),
        }))
      );
      setNotFound(false);
    } catch (error) {
      console.error("Failed to load vendor:", error);
      toast.error("Gagal memuat detail vendor");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadVendor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const openLinkDialog = async () => {
    if (!id) return;
    try {
      const res = await query<ProductOption>(UNLINKED_PRODUCTS_SQL, [id]);
      setProductOptions(
        res.rows.map((row) => ({ ...row, cost_price: Number(row.cost_price ?? 0) }))
      );
      setLinkForm({
        productId: "",
        vendorSku: "",
        lastCost: "",
        leadTime: String(vendor?.lead_time_days ?? 0),
        minOrderQty: "1",
      });
      setLinkOpen(true);
    } catch (error) {
      console.error("Failed to load products:", error);
      toast.error("Gagal memuat daftar produk");
    }
  };

  const handleLinkProduct = async () => {
    if (!id || !linkForm.productId) {
      toast.error("Pilih produk terlebih dahulu");
      return;
    }
    setIsSavingLink(true);
    try {
      const selected = productOptions.find((product) => product.id === linkForm.productId);
      const lastCost = linkForm.lastCost ? Number(linkForm.lastCost) : selected?.cost_price ?? 0;

      await runTransaction(async (tx) => {
        await tx.query(
          `INSERT INTO vendor_products
             (vendor_id, product_id, vendor_sku, last_cost, lead_time_days, min_order_qty)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (vendor_id, product_id) DO UPDATE SET
             vendor_sku = excluded.vendor_sku,
             last_cost = excluded.last_cost,
             lead_time_days = excluded.lead_time_days,
             min_order_qty = excluded.min_order_qty`,
          [
            id,
            linkForm.productId,
            linkForm.vendorSku.trim() || null,
            lastCost,
            Number(linkForm.leadTime) || 0,
            Number(linkForm.minOrderQty) || 1,
          ]
        );

        // A product with no main vendor adopts this one, so the product list and
        // the procurement filter agree from now on.
        await tx.query(
          `UPDATE products SET supplier_id = $1 WHERE id = $2 AND supplier_id IS NULL`,
          [id, linkForm.productId]
        );

        await logAuditTx(tx, {
          action: "update",
          entity: "vendor_products",
          entityId: linkForm.productId,
          details: { vendorId: id, productId: linkForm.productId, vendorSku: linkForm.vendorSku },
          userId: user?.id,
        });
      });

      toast.success("Produk berhasil dihubungkan ke vendor");
      setLinkOpen(false);
      loadVendor();
    } catch (error) {
      console.error("Failed to link product:", error);
      toast.error("Gagal menghubungkan produk");
    } finally {
      setIsSavingLink(false);
    }
  };

  const handleUnlinkProduct = async (product: LinkedProduct) => {
    if (!id) return;
    if (!confirm(`Lepas ${product.name} dari vendor ini?`)) return;

    try {
      await runTransaction(async (tx) => {
        if (product.link_id) {
          await tx.query(`DELETE FROM vendor_products WHERE id = $1`, [product.link_id]);
        }
        await tx.query(
          `UPDATE products SET supplier_id = NULL WHERE id = $1 AND supplier_id = $2`,
          [product.id, id]
        );
      });
      toast.success("Produk dilepas dari vendor");
      loadVendor();
    } catch (error) {
      console.error("Failed to unlink product:", error);
      toast.error("Gagal melepas produk");
    }
  };

  const handleTogglePreferred = async (product: LinkedProduct) => {
    if (!product.link_id) {
      toast.info("Simpan produk sebagai katalog vendor terlebih dahulu");
      return;
    }
    try {
      await query(
        `UPDATE vendor_products SET is_preferred = CASE WHEN is_preferred = 1 THEN 0 ELSE 1 END
          WHERE id = $1`,
        [product.link_id]
      );
      loadVendor();
    } catch (error) {
      console.error("Failed to toggle preferred vendor product:", error);
      toast.error("Gagal mengubah preferensi produk");
    }
  };

  const openPayment = (bill: ExpenseRow) => {
    setPaymentTarget(bill);
    setPaymentForm({
      amount: String(outstandingAmount(bill.amount, bill.amount_paid)),
      date: isoDate(),
      method: "transfer",
      reference: "",
      notes: "",
    });
  };

  /**
   * One write transaction: the bill balance, the payment ledger row and the
   * audit trail must move together, otherwise AP and the vendor statement
   * disagree after a partial failure.
   */
  const handleSavePayment = async () => {
    if (!paymentTarget || !id) return;
    const amount = Number(paymentForm.amount);
    const remaining = outstandingAmount(paymentTarget.amount, paymentTarget.amount_paid);

    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Jumlah pembayaran tidak valid");
      return;
    }
    if (amount > remaining) {
      toast.error("Pembayaran melebihi sisa tagihan");
      return;
    }

    setIsSavingPayment(true);
    try {
      await runTransaction(async (tx) => {
        const updated = await tx.query(
          `UPDATE expenses
              SET amount_paid = amount_paid + $1,
                  status = CASE WHEN amount_paid + $1 >= amount THEN 'paid' ELSE 'unpaid' END
            WHERE id = $2 AND amount_paid + $1 <= amount`,
          [amount, paymentTarget.id]
        );
        if (updated.rowCount === 0) {
          throw new Error("Tagihan sudah berubah, muat ulang halaman");
        }

        await tx.query(
          `INSERT INTO vendor_payments
             (vendor_id, expense_id, amount, payment_date, method, reference_number, notes, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            id,
            paymentTarget.id,
            amount,
            paymentForm.date || isoDate(),
            paymentForm.method,
            paymentForm.reference.trim() || null,
            paymentForm.notes.trim() || null,
            user?.id ?? null,
          ]
        );

        await logAuditTx(tx, {
          action: "create_payment",
          entity: "vendor_payments",
          entityId: paymentTarget.id,
          details: {
            vendorId: id,
            expenseId: paymentTarget.id,
            amount,
            method: paymentForm.method,
            reference: paymentForm.reference || null,
          },
          userId: user?.id,
        });
      });

      toast.success("Pembayaran vendor berhasil dicatat");
      setPaymentTarget(null);
      loadVendor();
    } catch (error) {
      console.error("Failed to save vendor payment:", error);
      toast.error(error instanceof Error ? error.message : "Gagal mencatat pembayaran");
    } finally {
      setIsSavingPayment(false);
    }
  };

  const handleCreateDebt = async () => {
    if (!id) return;
    if (!debtForm.description.trim() || !debtForm.amount) {
      toast.error("Keterangan dan jumlah wajib diisi");
      return;
    }
    const amount = Number(debtForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Jumlah tagihan tidak valid");
      return;
    }

    setIsSavingDebt(true);
    try {
      await runTransaction(async (tx) => {
        const inserted = await tx.query<{ id: string }>(
          `INSERT INTO expenses
             (branch_id, category, amount, date, due_date, description, status, amount_paid, supplier_id)
           VALUES ($1, 'Pembelian Stok', $2, date('now'), $3, $4, 'unpaid', 0, $5)
           RETURNING id`,
          [
            user?.assigned_branch_id ?? null,
            amount,
            debtForm.dueDate || null,
            debtForm.description.trim(),
            id,
          ]
        );

        await logAuditTx(tx, {
          action: "create_expense",
          entity: "expenses",
          entityId: inserted.rows[0]?.id,
          details: { kind: "vendor_payable", vendorId: id, amount, due_date: debtForm.dueDate },
          userId: user?.id,
        });
      });

      toast.success("Tagihan vendor berhasil dicatat");
      setDebtOpen(false);
      setDebtForm({ description: "", amount: "", dueDate: dueDateFromTerms(30) });
      loadVendor();
    } catch (error) {
      console.error("Failed to create vendor bill:", error);
      toast.error("Gagal mencatat tagihan vendor");
    } finally {
      setIsSavingDebt(false);
    }
  };

  const openBills = useMemo(() => bills.filter((bill) => bill.amount > bill.amount_paid), [bills]);

  if (isLoading) {
    return (
      <BackOfficeLayout>
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Memuat vendor...
        </div>
      </BackOfficeLayout>
    );
  }

  if (notFound || !vendor) {
    return (
      <BackOfficeLayout>
        <div className="flex flex-col items-center justify-center gap-4 py-24">
          <Building2 className="h-12 w-12 text-muted-foreground" />
          <div className="text-center">
            <h2 className="text-xl font-semibold">Vendor tidak ditemukan</h2>
            <p className="text-muted-foreground">Data vendor mungkin sudah dihapus.</p>
          </div>
          <Button variant="outline" onClick={() => navigate("/backoffice/vendors")}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Kembali ke daftar vendor
          </Button>
        </div>
      </BackOfficeLayout>
    );
  }

  return (
    <BackOfficeLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex items-start gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/backoffice/vendors")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-start gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-lg font-bold text-primary">
                {vendorInitials(vendor.name) || "VD"}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold tracking-tight">{vendor.name}</h1>
                  <Badge className={vendorStatusBadgeClass(vendor.status)}>
                    {vendorStatusLabel(vendor.status)}
                  </Badge>
                  <Badge variant="secondary">{vendorCategoryLabel(vendor.category)}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {vendor.code || "Tanpa kode"}
                  {vendor.legal_name ? ` · ${vendor.legal_name}` : ""}
                </p>
                {Number(vendor.rating) > 0 && (
                  <p className="mt-1 text-sm text-warning">
                    {"★".repeat(Number(vendor.rating))}
                    <span className="text-muted-foreground">
                      {"☆".repeat(Math.max(0, 5 - Number(vendor.rating)))}
                    </span>
                  </p>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setDebtOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Catat Tagihan
            </Button>
            <Button onClick={() => setEditOpen(true)}>
              <Edit className="mr-2 h-4 w-4" /> Edit Vendor
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-card rounded-xl border p-4">
            <p className="text-sm text-muted-foreground">Total Pembelian</p>
            <p className="text-xl font-bold">{formatCurrency(summary?.po_total ?? 0)}</p>
            <p className="text-xs text-muted-foreground">{summary?.po_count ?? 0} purchase order</p>
          </div>
          <div className="bg-card rounded-xl border p-4">
            <p className="text-sm text-muted-foreground">Hutang Berjalan</p>
            <p className="text-xl font-bold text-destructive">
              {formatCurrency(summary?.outstanding ?? 0)}
            </p>
            <p className="text-xs text-muted-foreground">{summary?.overdue_count ?? 0} jatuh tempo</p>
          </div>
          <div className="bg-card rounded-xl border p-4">
            <p className="text-sm text-muted-foreground">Sudah Dibayar</p>
            <p className="text-xl font-bold text-success">{formatCurrency(summary?.paid_total ?? 0)}</p>
            <p className="text-xs text-muted-foreground">{payments.length} pembayaran tercatat</p>
          </div>
          <div className="bg-card rounded-xl border p-4">
            <p className="text-sm text-muted-foreground">Produk Terhubung</p>
            <p className="text-xl font-bold">{products.length}</p>
            <p className="text-xs text-muted-foreground">
              Limit kredit {formatCurrency(Number(vendor.credit_limit ?? 0))}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="bg-card rounded-xl border p-4 space-y-2">
            <h2 className="font-semibold">Kontak</h2>
            <p className="text-sm">{vendor.contact_person || "-"}</p>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Phone className="h-3.5 w-3.5" /> {vendor.phone || "-"}
            </p>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Mail className="h-3.5 w-3.5" /> {vendor.email || "-"}
            </p>
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <MapPin className="mt-0.5 h-3.5 w-3.5" />
              <span>
                {[vendor.address, vendor.city, vendor.province, vendor.postal_code]
                  .filter(Boolean)
                  .join(", ") || "-"}
              </span>
            </p>
            {vendor.tax_id && <p className="text-sm text-muted-foreground">NPWP: {vendor.tax_id}</p>}
          </div>

          <div className="bg-card rounded-xl border p-4 space-y-2">
            <h2 className="font-semibold">Termin & Pengiriman</h2>
            <p className="text-sm">
              Termin pembayaran: <span className="font-medium">{vendor.payment_terms_days ?? 30} hari</span>
            </p>
            <p className="text-sm">
              Lead time: <span className="font-medium">{vendor.lead_time_days ?? 0} hari</span>
            </p>
            <p className="text-sm">
              Limit kredit:{" "}
              <span className="font-medium">{formatCurrency(Number(vendor.credit_limit ?? 0))}</span>
            </p>
            <p className="text-sm">
              Mata uang: <span className="font-medium">{vendor.currency || "IDR"}</span>
            </p>
            {vendor.website && (
              <p className="truncate text-sm text-muted-foreground">{vendor.website}</p>
            )}
          </div>

          <div className="bg-card rounded-xl border p-4 space-y-2">
            <h2 className="font-semibold">Rekening Bank</h2>
            {vendor.bank_name || vendor.bank_account_number ? (
              <>
                <p className="flex items-center gap-2 text-sm">
                  <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
                  {vendor.bank_name || "-"}
                </p>
                <p className="text-sm font-mono">{vendor.bank_account_number || "-"}</p>
                <p className="text-sm text-muted-foreground">a.n. {vendor.bank_account_name || "-"}</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Belum ada rekening tersimpan.</p>
            )}
            {vendor.notes && (
              <p className="border-t pt-2 text-sm text-muted-foreground">{vendor.notes}</p>
            )}
          </div>
        </div>

        <Tabs defaultValue="products" className="space-y-4">
          <TabsList>
            <TabsTrigger value="products" className="gap-2">
              <Package className="h-4 w-4" /> Produk ({products.length})
            </TabsTrigger>
            <TabsTrigger value="orders" className="gap-2">
              <Building2 className="h-4 w-4" /> Purchase Order ({orders.length})
            </TabsTrigger>
            <TabsTrigger value="bills" className="gap-2">
              <Wallet className="h-4 w-4" /> Hutang & Pembayaran ({openBills.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="products">
            <div className="rounded-xl border bg-card">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <div>
                  <h2 className="font-semibold">Katalog Produk Vendor</h2>
                  <p className="text-sm text-muted-foreground">
                    SKU vendor, harga modal terakhir, lead time, dan minimum order.
                  </p>
                </div>
                <Button size="sm" onClick={openLinkDialog}>
                  <Link2 className="mr-2 h-4 w-4" /> Hubungkan Produk
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produk</TableHead>
                    <TableHead>SKU Vendor</TableHead>
                    <TableHead className="text-right">Harga Modal</TableHead>
                    <TableHead className="text-center">Lead Time</TableHead>
                    <TableHead className="text-center">MOQ</TableHead>
                    <TableHead className="text-center">Stok</TableHead>
                    <TableHead className="text-center">Preferensi</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                        Belum ada produk yang dipasok vendor ini.
                      </TableCell>
                    </TableRow>
                  ) : (
                    products.map((product) => (
                      <TableRow key={product.id}>
                        <TableCell>
                          <p className="font-medium">{product.name}</p>
                          <p className="text-xs text-muted-foreground">{product.sku}</p>
                        </TableCell>
                        <TableCell className="text-sm">{product.vendor_sku || "-"}</TableCell>
                        <TableCell className="text-right text-sm">
                          {formatCurrency(Number(product.last_cost ?? product.cost_price))}
                        </TableCell>
                        <TableCell className="text-center text-sm">
                          {product.lead_time_days ?? vendor.lead_time_days ?? 0} hari
                        </TableCell>
                        <TableCell className="text-center text-sm">
                          {product.min_order_qty ?? 1}
                        </TableCell>
                        <TableCell className="text-center text-sm">
                          {product.stock.toLocaleString("id-ID")}
                        </TableCell>
                        <TableCell className="text-center">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Jadikan vendor utama produk"
                            onClick={() => handleTogglePreferred(product)}
                          >
                            <Star
                              className={
                                product.is_preferred
                                  ? "h-4 w-4 fill-warning text-warning"
                                  : "h-4 w-4 text-muted-foreground"
                              }
                            />
                          </Button>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Lepas dari vendor"
                            className="text-destructive hover:text-destructive"
                            onClick={() => handleUnlinkProduct(product)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="orders">
            <div className="rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>No. PO</TableHead>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-center">Item</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Ekspektasi</TableHead>
                    <TableHead>Diterima</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                        Belum ada purchase order untuk vendor ini.
                      </TableCell>
                    </TableRow>
                  ) : (
                    orders.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell className="font-medium">{order.po_number}</TableCell>
                        <TableCell className="text-sm">
                          {order.created_at ? new Date(order.created_at).toLocaleDateString("id-ID") : "-"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={order.status === "received" ? "default" : "secondary"}>
                            {order.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center text-sm">{order.items_count}</TableCell>
                        <TableCell className="text-right text-sm">
                          {formatCurrency(order.total_amount)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {order.expected_date
                            ? new Date(order.expected_date).toLocaleDateString("id-ID")
                            : "-"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {order.received_at
                            ? new Date(order.received_at).toLocaleDateString("id-ID")
                            : "-"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="bills" className="space-y-4">
            <div className="rounded-xl border bg-card">
              <div className="border-b px-4 py-3">
                <h2 className="font-semibold">Hutang Vendor</h2>
                <p className="text-sm text-muted-foreground">
                  Tagihan muncul dari penerimaan purchase order atau input manual.
                </p>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Keterangan</TableHead>
                    <TableHead>Jatuh Tempo</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Terbayar</TableHead>
                    <TableHead className="text-right">Sisa</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bills.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                        Belum ada tagihan dari vendor ini.
                      </TableCell>
                    </TableRow>
                  ) : (
                    bills.map((bill) => {
                      const remaining = outstandingAmount(bill.amount, bill.amount_paid);
                      const overdue = remaining > 0 && isOverdue(bill.due_date);
                      return (
                        <TableRow key={bill.id}>
                          <TableCell>
                            <p className="font-medium">{bill.description}</p>
                            <p className="text-xs text-muted-foreground">{bill.category}</p>
                          </TableCell>
                          <TableCell className={overdue ? "text-sm font-medium text-destructive" : "text-sm"}>
                            {bill.due_date ? new Date(bill.due_date).toLocaleDateString("id-ID") : "-"}
                            {overdue && <span className="ml-1 text-xs">(jatuh tempo)</span>}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {formatCurrency(bill.amount)}
                          </TableCell>
                          <TableCell className="text-right text-sm text-success">
                            {formatCurrency(bill.amount_paid)}
                          </TableCell>
                          <TableCell className="text-right text-sm font-semibold">
                            {formatCurrency(remaining)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={remaining > 0 ? "secondary" : "default"}>
                              {remaining > 0 ? "Belum lunas" : "Lunas"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              disabled={remaining <= 0}
                              onClick={() => openPayment(bill)}
                            >
                              Bayar
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="rounded-xl border bg-card">
              <div className="border-b px-4 py-3">
                <h2 className="font-semibold">Riwayat Pembayaran</h2>
                <p className="text-sm text-muted-foreground">
                  Setiap pembayaran juga mengurangi saldo hutang di modul Keuangan.
                </p>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Tagihan</TableHead>
                    <TableHead>Metode</TableHead>
                    <TableHead>Referensi</TableHead>
                    <TableHead className="text-right">Jumlah</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                        Belum ada pembayaran tercatat.
                      </TableCell>
                    </TableRow>
                  ) : (
                    payments.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell className="text-sm">
                          {new Date(payment.payment_date).toLocaleDateString("id-ID")}
                        </TableCell>
                        <TableCell className="text-sm">
                          {payment.expense_description || "-"}
                        </TableCell>
                        <TableCell className="text-sm capitalize">{payment.method}</TableCell>
                        <TableCell className="text-sm">{payment.reference_number || "-"}</TableCell>
                        <TableCell className="text-right text-sm font-medium">
                          {formatCurrency(payment.amount)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <VendorFormModal
        open={editOpen}
        onOpenChange={setEditOpen}
        vendor={vendor}
        onSaved={() => loadVendor()}
      />

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Hubungkan Produk ke Vendor</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Produk</Label>
              <Select
                value={linkForm.productId}
                onValueChange={(value) => {
                  const selected = productOptions.find((product) => product.id === value);
                  setLinkForm((prev) => ({
                    ...prev,
                    productId: value,
                    lastCost: selected ? String(selected.cost_price) : prev.lastCost,
                  }));
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pilih produk" />
                </SelectTrigger>
                <SelectContent>
                  {productOptions.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.name} ({product.sku})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {productOptions.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Semua produk sudah terhubung ke vendor ini.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="vendor-sku">SKU di Vendor</Label>
                <Input
                  id="vendor-sku"
                  value={linkForm.vendorSku}
                  onChange={(e) => setLinkForm({ ...linkForm, vendorSku: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="vendor-last-cost">Harga Modal Terakhir</Label>
                <Input
                  id="vendor-last-cost"
                  type="number"
                  min={0}
                  value={linkForm.lastCost}
                  onChange={(e) => setLinkForm({ ...linkForm, lastCost: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="vendor-link-lead">Lead Time (hari)</Label>
                <Input
                  id="vendor-link-lead"
                  type="number"
                  min={0}
                  value={linkForm.leadTime}
                  onChange={(e) => setLinkForm({ ...linkForm, leadTime: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="vendor-moq">Minimum Order</Label>
                <Input
                  id="vendor-moq"
                  type="number"
                  min={1}
                  value={linkForm.minOrderQty}
                  onChange={(e) => setLinkForm({ ...linkForm, minOrderQty: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkOpen(false)}>
              Batal
            </Button>
            <Button onClick={handleLinkProduct} disabled={isSavingLink}>
              {isSavingLink && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(paymentTarget)} onOpenChange={(open) => !open && setPaymentTarget(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Catat Pembayaran Vendor</DialogTitle>
          </DialogHeader>
          {paymentTarget && (
            <div className="grid gap-4 py-2">
              <div className="rounded-lg border bg-muted/40 p-3">
                <p className="text-sm font-medium">{paymentTarget.description}</p>
                <p className="text-sm text-muted-foreground">
                  Sisa tagihan:{" "}
                  <span className="font-semibold text-foreground">
                    {formatCurrency(outstandingAmount(paymentTarget.amount, paymentTarget.amount_paid))}
                  </span>
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="payment-amount">Jumlah Bayar</Label>
                  <Input
                    id="payment-amount"
                    type="number"
                    min={1}
                    value={paymentForm.amount}
                    onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="payment-date">Tanggal</Label>
                  <Input
                    id="payment-date"
                    type="date"
                    value={paymentForm.date}
                    onChange={(e) => setPaymentForm({ ...paymentForm, date: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label>Metode</Label>
                  <Select
                    value={paymentForm.method}
                    onValueChange={(value) => setPaymentForm({ ...paymentForm, method: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VENDOR_PAYMENT_METHODS.map((method) => (
                        <SelectItem key={method.value} value={method.value}>
                          {method.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="payment-reference">No. Referensi</Label>
                  <Input
                    id="payment-reference"
                    value={paymentForm.reference}
                    onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })}
                    placeholder="TRF-001"
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="payment-notes">Catatan</Label>
                <Textarea
                  id="payment-notes"
                  rows={2}
                  value={paymentForm.notes}
                  onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentTarget(null)}>
              Batal
            </Button>
            <Button onClick={handleSavePayment} disabled={isSavingPayment}>
              {isSavingPayment && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Simpan Pembayaran
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={debtOpen} onOpenChange={setDebtOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Catat Tagihan Vendor</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="debt-description">Keterangan</Label>
              <Input
                id="debt-description"
                value={debtForm.description}
                onChange={(e) => setDebtForm({ ...debtForm, description: e.target.value })}
                placeholder="Pembelian stok PO/2026/0016"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="debt-amount">Jumlah (Rp)</Label>
                <Input
                  id="debt-amount"
                  type="number"
                  min={1}
                  value={debtForm.amount}
                  onChange={(e) => setDebtForm({ ...debtForm, amount: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="debt-due">Jatuh Tempo</Label>
                <Input
                  id="debt-due"
                  type="date"
                  value={debtForm.dueDate}
                  onChange={(e) => setDebtForm({ ...debtForm, dueDate: e.target.value })}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Tagihan masuk ke modul Keuangan sebagai hutang usaha dan muncul di daftar Hutang/Piutang.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDebtOpen(false)}>
              Batal
            </Button>
            <Button onClick={handleCreateDebt} disabled={isSavingDebt}>
              {isSavingDebt && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Simpan Tagihan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BackOfficeLayout>
  );
}
