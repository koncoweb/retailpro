import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { query } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { useAuth } from "@/hooks/use-auth";
import {
  PAYMENT_TERM_OPTIONS,
  VENDOR_CATEGORIES,
  VENDOR_STATUSES,
  nextVendorCode,
} from "@/lib/vendor";

/** Row shape of `suppliers` as the vendor screens read it. */
export interface VendorRecord {
  id: string;
  name: string;
  code: string | null;
  legal_name: string | null;
  category: string | null;
  status: string | null;
  tax_id: string | null;
  website: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  payment_terms_days: number | null;
  lead_time_days: number | null;
  credit_limit: number | null;
  currency: string | null;
  rating: number | null;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_name: string | null;
  notes: string | null;
  settings: Record<string, unknown> | null;
  created_at: string;
  updated_at: string | null;
}

interface VendorFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing vendor to edit; omit to create. */
  vendor?: VendorRecord | null;
  onSaved: (vendorId: string) => void;
}

interface FormState {
  name: string;
  code: string;
  legal_name: string;
  category: string;
  status: string;
  tax_id: string;
  website: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  province: string;
  postal_code: string;
  payment_terms_days: string;
  lead_time_days: string;
  credit_limit: string;
  currency: string;
  rating: string;
  bank_name: string;
  bank_account_number: string;
  bank_account_name: string;
  notes: string;
  auto_send_low_stock_alert: boolean;
}

const EMPTY_FORM: FormState = {
  name: "",
  code: "",
  legal_name: "",
  category: "supplier",
  status: "active",
  tax_id: "",
  website: "",
  contact_person: "",
  phone: "",
  email: "",
  address: "",
  city: "",
  province: "",
  postal_code: "",
  payment_terms_days: "30",
  lead_time_days: "0",
  credit_limit: "0",
  currency: "IDR",
  rating: "0",
  bank_name: "",
  bank_account_number: "",
  bank_account_name: "",
  notes: "",
  auto_send_low_stock_alert: false,
};

function toForm(vendor: VendorRecord): FormState {
  return {
    name: vendor.name ?? "",
    code: vendor.code ?? "",
    legal_name: vendor.legal_name ?? "",
    category: vendor.category ?? "supplier",
    status: vendor.status ?? "active",
    tax_id: vendor.tax_id ?? "",
    website: vendor.website ?? "",
    contact_person: vendor.contact_person ?? "",
    phone: vendor.phone ?? "",
    email: vendor.email ?? "",
    address: vendor.address ?? "",
    city: vendor.city ?? "",
    province: vendor.province ?? "",
    postal_code: vendor.postal_code ?? "",
    payment_terms_days: String(vendor.payment_terms_days ?? 30),
    lead_time_days: String(vendor.lead_time_days ?? 0),
    credit_limit: String(vendor.credit_limit ?? 0),
    currency: vendor.currency ?? "IDR",
    rating: String(vendor.rating ?? 0),
    bank_name: vendor.bank_name ?? "",
    bank_account_number: vendor.bank_account_number ?? "",
    bank_account_name: vendor.bank_account_name ?? "",
    notes: vendor.notes ?? "",
    auto_send_low_stock_alert: Boolean(
      (vendor.settings as { auto_send_low_stock_alert?: boolean } | null)?.auto_send_low_stock_alert
    ),
  };
}

const toNumber = (value: string, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const emptyToNull = (value: string) => (value.trim() === "" ? null : value.trim());

/**
 * Create/edit a vendor.
 *
 * The vendor row is the single master record used by products, purchase orders
 * and accounts payable, so every procurement detail lives here instead of being
 * spread across free-text fields on the product form.
 */
export function VendorFormModal({ open, onOpenChange, vendor, onSaved }: VendorFormModalProps) {
  const { user } = useAuth();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const isEditing = Boolean(vendor?.id);

  useEffect(() => {
    if (!open) return;
    setForm(vendor ? toForm(vendor) : EMPTY_FORM);
  }, [open, vendor]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!form.name.trim()) {
      toast.error("Nama vendor wajib diisi");
      return;
    }
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      toast.error("Format email tidak valid");
      return;
    }

    setIsSaving(true);
    try {
      // Code is optional for imported vendors, but the screens sort and search by
      // it, so a new vendor gets the next sequence automatically.
      let code = form.code.trim().toUpperCase();
      if (!code) {
        const latest = await query<{ code: string | null }>(
          `SELECT code FROM suppliers WHERE code LIKE 'VND-%' ORDER BY code DESC LIMIT 1`
        );
        code = nextVendorCode(latest.rows[0]?.code);
      }

      const settings = JSON.stringify({
        ...(vendor?.settings ?? {}),
        auto_send_low_stock_alert: form.auto_send_low_stock_alert,
      });

      const params = [
        code,
        form.name.trim(),
        emptyToNull(form.legal_name),
        form.category,
        form.status,
        emptyToNull(form.tax_id),
        emptyToNull(form.website),
        emptyToNull(form.contact_person),
        emptyToNull(form.phone),
        emptyToNull(form.email),
        emptyToNull(form.address),
        emptyToNull(form.city),
        emptyToNull(form.province),
        emptyToNull(form.postal_code),
        toNumber(form.payment_terms_days, 0),
        toNumber(form.lead_time_days, 0),
        toNumber(form.credit_limit, 0),
        form.currency.trim().toUpperCase() || "IDR",
        toNumber(form.rating, 0),
        emptyToNull(form.bank_name),
        emptyToNull(form.bank_account_number),
        emptyToNull(form.bank_account_name),
        emptyToNull(form.notes),
        settings,
      ];

      let vendorId = vendor?.id ?? "";

      if (isEditing) {
        await query(
          `UPDATE suppliers SET
             code = $1, name = $2, legal_name = $3, category = $4, status = $5,
             tax_id = $6, website = $7,
             contact_person = $8, phone = $9, email = $10,
             address = $11, city = $12, province = $13, postal_code = $14,
             payment_terms_days = $15, lead_time_days = $16, credit_limit = $17,
             currency = $18, rating = $19,
             bank_name = $20, bank_account_number = $21, bank_account_name = $22,
             notes = $23, settings = $24,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE id = $25`,
          [...params, vendor?.id]
        );
        toast.success("Vendor berhasil diperbarui");
      } else {
        const inserted = await query<{ id: string }>(
          `INSERT INTO suppliers
             (code, name, legal_name, category, status, tax_id, website,
              contact_person, phone, email, address, city, province, postal_code,
              payment_terms_days, lead_time_days, credit_limit, currency, rating,
              bank_name, bank_account_number, bank_account_name, notes, settings)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                   $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
           RETURNING id`,
          params
        );
        vendorId = inserted.rows[0].id;
        toast.success("Vendor berhasil ditambahkan");
      }

      await logAudit({
        action: isEditing ? "update" : "create",
        entity: "suppliers",
        entityId: vendorId,
        details: { name: form.name.trim(), code, category: form.category, status: form.status },
        userId: user?.id,
      });

      onOpenChange(false);
      onSaved(vendorId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Failed to save vendor:", error);
      if (message.includes("idx_suppliers_code") || message.includes("UNIQUE constraint failed: suppliers.code")) {
        toast.error("Kode vendor sudah dipakai vendor lain");
      } else if (message.includes("idx_suppliers_name") || message.includes("UNIQUE constraint failed: suppliers.name")) {
        toast.error("Nama vendor sudah terdaftar");
      } else {
        toast.error("Gagal menyimpan vendor");
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[760px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Vendor" : "Tambah Vendor Baru"}</DialogTitle>
          <DialogDescription>
            Data vendor dipakai oleh produk, purchase order, dan hutang usaha.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 py-2">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Identitas Vendor</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="vendor-code">Kode Vendor</Label>
                <Input
                  id="vendor-code"
                  value={form.code}
                  onChange={(e) => set("code", e.target.value)}
                  placeholder="Otomatis (VND-0001)"
                />
              </div>
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="vendor-name">
                  Nama Vendor <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="vendor-name"
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="PT Sumber Makmur"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="vendor-legal">Nama Badan Usaha</Label>
                <Input
                  id="vendor-legal"
                  value={form.legal_name}
                  onChange={(e) => set("legal_name", e.target.value)}
                  placeholder="PT Sumber Makmur Sejahtera"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="vendor-tax">NPWP</Label>
                <Input
                  id="vendor-tax"
                  value={form.tax_id}
                  onChange={(e) => set("tax_id", e.target.value)}
                  placeholder="01.234.567.8-901.000"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="grid gap-2">
                <Label>Kategori</Label>
                <Select value={form.category} onValueChange={(value) => set("category", value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VENDOR_CATEGORIES.map((category) => (
                      <SelectItem key={category.value} value={category.value}>
                        {category.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(value) => set("status", value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VENDOR_STATUSES.map((status) => (
                      <SelectItem key={status.value} value={status.value}>
                        {status.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="vendor-website">Website</Label>
                <Input
                  id="vendor-website"
                  value={form.website}
                  onChange={(e) => set("website", e.target.value)}
                  placeholder="https://vendor.co.id"
                />
              </div>
            </div>
          </section>

          <section className="space-y-3 border-t pt-4">
            <h3 className="text-sm font-semibold text-muted-foreground">Kontak</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="vendor-contact">Contact Person</Label>
                <Input
                  id="vendor-contact"
                  value={form.contact_person}
                  onChange={(e) => set("contact_person", e.target.value)}
                  placeholder="Bpk. Budi"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="vendor-phone">Telepon</Label>
                <Input
                  id="vendor-phone"
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  placeholder="0812..."
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="vendor-email">Email</Label>
                <Input
                  id="vendor-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="sales@vendor.co.id"
                />
              </div>
            </div>
          </section>

          <section className="space-y-3 border-t pt-4">
            <h3 className="text-sm font-semibold text-muted-foreground">Alamat</h3>
            <div className="grid gap-2">
              <Label htmlFor="vendor-address">Alamat</Label>
              <Textarea
                id="vendor-address"
                value={form.address}
                onChange={(e) => set("address", e.target.value)}
                placeholder="Jl. Raya No. 123..."
                rows={2}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="vendor-city">Kota</Label>
                <Input id="vendor-city" value={form.city} onChange={(e) => set("city", e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="vendor-province">Provinsi</Label>
                <Input
                  id="vendor-province"
                  value={form.province}
                  onChange={(e) => set("province", e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="vendor-postal">Kode Pos</Label>
                <Input
                  id="vendor-postal"
                  value={form.postal_code}
                  onChange={(e) => set("postal_code", e.target.value)}
                />
              </div>
            </div>
          </section>

          <section className="space-y-3 border-t pt-4">
            <h3 className="text-sm font-semibold text-muted-foreground">Termin & Pengiriman</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="vendor-terms">Termin (hari)</Label>
                <Input
                  id="vendor-terms"
                  type="number"
                  min={0}
                  list="vendor-term-options"
                  value={form.payment_terms_days}
                  onChange={(e) => set("payment_terms_days", e.target.value)}
                />
                <datalist id="vendor-term-options">
                  {PAYMENT_TERM_OPTIONS.map((days) => (
                    <option key={days} value={days} />
                  ))}
                </datalist>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="vendor-lead">Lead Time (hari)</Label>
                <Input
                  id="vendor-lead"
                  type="number"
                  min={0}
                  value={form.lead_time_days}
                  onChange={(e) => set("lead_time_days", e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="vendor-credit">Limit Kredit</Label>
                <Input
                  id="vendor-credit"
                  type="number"
                  min={0}
                  value={form.credit_limit}
                  onChange={(e) => set("credit_limit", e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label>Rating</Label>
                <Select value={form.rating} onValueChange={(value) => set("rating", value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Belum dinilai</SelectItem>
                    {[1, 2, 3, 4, 5].map((stars) => (
                      <SelectItem key={stars} value={String(stars)}>
                        {"★".repeat(stars)} ({stars})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="vendor-currency">Mata Uang</Label>
                <Input
                  id="vendor-currency"
                  value={form.currency}
                  onChange={(e) => set("currency", e.target.value.toUpperCase())}
                  maxLength={3}
                />
              </div>
            </div>
          </section>

          <section className="space-y-3 border-t pt-4">
            <h3 className="text-sm font-semibold text-muted-foreground">Rekening Bank</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="vendor-bank">Bank</Label>
                <Input
                  id="vendor-bank"
                  value={form.bank_name}
                  onChange={(e) => set("bank_name", e.target.value)}
                  placeholder="BCA"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="vendor-bank-number">No. Rekening</Label>
                <Input
                  id="vendor-bank-number"
                  value={form.bank_account_number}
                  onChange={(e) => set("bank_account_number", e.target.value)}
                  placeholder="1234567890"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="vendor-bank-holder">Atas Nama</Label>
                <Input
                  id="vendor-bank-holder"
                  value={form.bank_account_name}
                  onChange={(e) => set("bank_account_name", e.target.value)}
                />
              </div>
            </div>
          </section>

          <section className="space-y-3 border-t pt-4">
            <div className="grid gap-2">
              <Label htmlFor="vendor-notes">Catatan</Label>
              <Textarea
                id="vendor-notes"
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
                placeholder="Syarat pembayaran khusus, jadwal pengiriman, dsb."
                rows={2}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
              <div className="space-y-0.5">
                <Label htmlFor="vendor-low-stock">Low Stock Alert</Label>
                <p className="text-[0.8rem] text-muted-foreground">
                  Kirim email otomatis saat stok produk dari vendor ini menipis.
                </p>
              </div>
              <Switch
                id="vendor-low-stock"
                checked={form.auto_send_low_stock_alert}
                onCheckedChange={(checked) => set("auto_send_low_stock_alert", checked)}
              />
            </div>
          </section>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? "Simpan Perubahan" : "Tambah Vendor"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
