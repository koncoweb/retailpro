import { useRef, useState } from "react";
import { PermissionGate } from "@/components/auth/PermissionGate";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { AlertCircle, Check, Download, Package, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { query, runTransaction, type Transaction } from "@/lib/db";
import { logAuditTx } from "@/lib/audit";
import { usePermissions } from "@/hooks/use-permissions";
import { WAREHOUSES_SQL, activeWarehouses, resolveBranchWarehouse, type WarehouseOption } from "@/lib/warehouse";
import { generateNextSku, skuPrefixForCategory } from "@/lib/inventory-utils";
import { VENDOR_CATEGORIES } from "@/lib/vendor";
import {
  VENDOR_PRODUCT_COLUMNS,
  VENDOR_PRODUCT_TEMPLATE_ROWS,
  dateStamp,
  downloadCsv,
  downloadXlsx,
  keepValid,
  normalizeRows,
  readRows,
  type BulkRow,
} from "@/lib/bulk-io";
import {
  groupVendorProductRows,
  planVendorProductImport,
  type ImportPlan,
  type VendorPlan,
} from "@/lib/vendor-import";
import {
  insertImportedProduct,
  type ImportedPack,
} from "@/lib/product-write";
import {
  markPreferredVendor,
  resolveOrCreateVendor,
  upsertVendorCatalogLink,
  upsertVendorPrice,
} from "@/lib/vendor-catalog";

/**
 * Bulk "vendor + product" sheet: master, catalogue and buy prices in one file.
 *
 * The vendor screen used to have an import that understood vendor columns only,
 * while the product import turned a typed vendor name into a `suppliers` row
 * without a code and without a price list. Neither could express "this vendor
 * sells these packs at these prices", which is the sheet a purchasing person
 * actually receives. This dialog reads that sheet, shows exactly what it will
 * change, and writes it through the same helpers the forms use, so the two can
 * no longer disagree about what a catalogue row means.
 *
 * One transaction per vendor block: a cloud round-trip per line would make a few
 * hundred rows crawl, and one bad line must not undo the vendors that were fine.
 *
 * Design notes: `docs/spec-vendor-produk-terintegrasi.md`.
 */

/** Flat preview line: one sheet (vendor, product, pack) with its verdict. */
interface PreviewLine {
  vendorName: string;
  vendorState: "baru" | "sudah ada";
  productName: string;
  sku: string;
  productState: "produk baru" | "tautkan produk" | "vendor saja";
  unitName: string;
  buyPrice: number;
  action: string;
  tone: "new" | "update" | "keep" | "skip";
}

/** What the writer needs besides the plan itself. */
interface ApplyOptions {
  warehouseId: string | null;
  userId: string | null;
  priceMode: "overwrite" | "gap-only";
  mayCreateProducts: boolean;
}

/** Sheet cell → the canonical vendor category the master stores. */
function mapVendorCategory(value: string | null | undefined): string {
  const token = String(value ?? "").trim().toLowerCase();
  return (
    VENDOR_CATEGORIES.find((c) => c.value === token || c.label.toLowerCase() === token)?.value ??
    "supplier"
  );
}

/** Buy prices per pack, the way the product writer wants them. */
function packsOf(plan: ImportPlan["vendors"][number]["products"][number]): ImportedPack[] {
  return plan.packs.map((pack) => ({
    unitName: pack.unitName,
    conversionFactor: pack.conversionFactor,
    cost: pack.buyPrice,
    price: pack.sellPrice,
  }));
}

/**
 * Continue the app's own SKU sequence for a sheet row that left `SKU` empty.
 *
 * Read inside the transaction, so two lines of the same category in one file
 * cannot both claim the next number.
 */
async function mintSku(seed: { category: string | null }, tx: Transaction): Promise<string> {
  const category = (seed.category || "Umum").trim() || "Umum";
  const today = new Date();
  const prefix = skuPrefixForCategory(category, today);
  const res = await tx.query<{ sku: string }>(
    `SELECT sku FROM products WHERE sku LIKE $1 ORDER BY sku DESC LIMIT 1`,
    [`${prefix}%`]
  );
  return generateNextSku(category, today, res.rows[0]?.sku ?? null);
}

function toneClass(tone: PreviewLine["tone"]): string {
  if (tone === "new") return "bg-success/10 text-success";
  if (tone === "update") return "bg-warning/10 text-warning";
  if (tone === "skip") return "bg-destructive/10 text-destructive";
  return "bg-muted text-muted-foreground";
}

export function VendorProductImport({
  userId,
  branchId,
  onImported,
}: {
  userId?: string | null;
  /** The operator's branch, so opening stock lands in a warehouse that exists. */
  branchId?: string | null;
  /** Refresh the vendor list after a successful run. */
  onImported: () => void;
}) {
  const { can } = usePermissions();
  const mayCreateProducts = can("manage_variants");
  const mayOverwritePrices = can("manage_vendor_prices");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [lines, setLines] = useState<PreviewLine[]>([]);
  const [ignoredRows, setIgnoredRows] = useState(0);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState(false);

  /** Build the preview lines the dialog shows, straight from the plan. */
  const describe = (next: ImportPlan): PreviewLine[] => {
    const rows: PreviewLine[] = [];
    for (const vendor of next.vendors) {
      if (vendor.products.length === 0) {
        rows.push({
          vendorName: vendor.vendor.name,
          vendorState: vendor.isNew ? "baru" : "sudah ada",
          productName: "—",
          sku: "",
          productState: "vendor saja",
          unitName: "",
          buyPrice: 0,
          action: vendor.isNew ? "vendor dibuat" : "vendor dilewati",
          tone: vendor.isNew ? "new" : "keep",
        });
        continue;
      }
      for (const product of vendor.products) {
        if (product.packs.length === 0) {
          rows.push({
            vendorName: vendor.vendor.name,
            vendorState: vendor.isNew ? "baru" : "sudah ada",
            productName: product.seed.name,
            sku: product.seed.sku ?? "",
            productState: product.action === "create" ? "produk baru" : "tautkan produk",
            unitName: "",
            buyPrice: 0,
            action: "catalogue saja (tanpa harga)",
            tone: "keep",
          });
          continue;
        }
        for (const pack of product.packs) {
          const label =
            pack.action === "overwrite"
              ? "harga diperbarui"
              : pack.action === "fill"
                ? "harga diisi"
                : product.action === "create"
                  ? "ikut produk baru"
                  : "dilewati";
          rows.push({
            vendorName: vendor.vendor.name,
            vendorState: vendor.isNew ? "baru" : "sudah ada",
            productName: product.seed.name,
            sku: product.seed.sku ?? "",
            productState: product.action === "create" ? "produk baru" : "tautkan produk",
            unitName: `${pack.unitName}${pack.conversionFactor > 1 ? ` ×${pack.conversionFactor}` : ""}`,
            buyPrice: pack.buyPrice,
            action:
              pack.conversionFactor === 1 && product.action === "create"
                ? `produk + ${label}`
                : label,
            tone:
              pack.action === "overwrite"
                ? "update"
                : pack.action === "skip"
                  ? "skip"
                  : product.action === "create"
                    ? "new"
                    : "keep",
          });
        }
        for (const name of product.skippedPacks) {
          rows.push({
            vendorName: vendor.vendor.name,
            vendorState: vendor.isNew ? "baru" : "sudah ada",
            productName: product.seed.name,
            sku: product.seed.sku ?? "",
            productState: "tautkan produk",
            unitName: name,
            buyPrice: 0,
            action: "pecahan tidak ada di produk",
            tone: "skip",
          });
        }
      }
    }
    return rows;
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;

    try {
      const raw = await readRows(file);
      const normalized = normalizeRows(raw, VENDOR_PRODUCT_COLUMNS);
      // A line has to name a vendor; without it nothing can be found or created.
      const { valid, invalid } = keepValid(normalized, ["vendorName"]);

      const groups = groupVendorProductRows(valid);

      // Read the whole existing key space once, so the preview can promise
      // numbers instead of hoping the write matches.
      const [vendorRes, productRes, variantRes, unitRes, linkRes, priceRes, warehouseRes] =
        await Promise.all([
          query<{ id: string; name: string; code: string | null }>(
            `SELECT id, name, code FROM suppliers`
          ),
          query<{ id: string; sku: string | null; name: string }>(
            `SELECT id, sku, name FROM products`
          ),
          query<{ id: string; product_id: string }>(`SELECT id, product_id FROM product_variants`),
          query<{ variant_id: string; name: string; conversion_factor: number }>(
            `SELECT variant_id, name, conversion_factor FROM product_units`
          ),
          query<{ vendor_id: string; product_id: string; is_preferred: number }>(
            `SELECT vendor_id, product_id, is_preferred FROM vendor_products`
          ),
          query<{ vendor_id: string; variant_id: string; unit_name: string }>(
            `SELECT vendor_id, variant_id, unit_name FROM vendor_price_list`
          ),
          query<WarehouseOption>(WAREHOUSES_SQL),
        ]);

      const packsByProduct = new Map<string, Array<{ variantId: string; unitName: string; conversionFactor: number }>>();
      const variantToProduct = new Map(variantRes.rows.map((row) => [row.id, row.product_id]));
      for (const unit of unitRes.rows) {
        const productId = variantToProduct.get(unit.variant_id);
        if (!productId) continue;
        const list = packsByProduct.get(productId) ?? [];
        list.push({
          variantId: unit.variant_id,
          unitName: unit.name,
          conversionFactor: Number(unit.conversion_factor ?? 1),
        });
        packsByProduct.set(productId, list);
      }

      const next = planVendorProductImport(
        groups,
        {
          vendors: vendorRes.rows,
          products: productRes.rows.map((row) => ({
            ...row,
            packs: packsByProduct.get(row.id) ?? [],
          })),
          links: linkRes.rows.map((row) => ({
            vendorId: row.vendor_id,
            productId: row.product_id,
            isPreferred: Number(row.is_preferred ?? 0) === 1,
          })),
          prices: priceRes.rows.map((row) => ({
            vendorId: row.vendor_id,
            variantId: row.variant_id,
            unitName: row.unit_name,
          })),
        },
        { priceMode: mayOverwritePrices ? "overwrite" : "gap-only" }
      );

      const active = activeWarehouses(warehouseRes.rows);
      const fallback =
        (await resolveBranchWarehouse(branchId ?? null)) ?? active[0]?.id ?? "";

      setPlan(next);
      setLines(describe(next));
      setIgnoredRows(invalid.length);
      setWarehouses(active);
      setWarehouseId(fallback);
      setOpen(true);

      if (next.summary.newProducts > 0 && !mayCreateProducts) {
        toast.error("Baris produk dilewati: tidak berwenang mengelola template produk.");
      }
    } catch (error) {
      console.error("Vendor + product import failed:", error);
      toast.error("Gagal membaca file. Pastikan format CSV/Excel benar.");
    }
  };

  /**
   * Apply one vendor block inside one transaction.
   *
   * The plan already decided what each line means, so this loop only executes:
   * the vendor row, then either a brand-new product (through the same writer the
   * product import uses) or the catalogue/price rows of a product that exists.
   */
  const applyVendorBlock = async (vendor: VendorPlan, options: ApplyOptions): Promise<void> => {
    await runTransaction(async (tx) => {
      const vendorId = await resolveOrCreateVendor(tx, {
        name: vendor.vendor.name,
        code: vendor.vendor.code,
        category: mapVendorCategory(vendor.vendor.category),
        contactPerson: vendor.vendor.contactPerson,
        phone: vendor.vendor.phone,
        email: vendor.vendor.email,
        paymentTermsDays: vendor.vendor.paymentTermsDays,
      });
      if (!vendorId) return;

      let created = 0;
      let linked = 0;
      let prices = 0;

      for (const product of vendor.products) {
        const base =
          product.packs.find((pack) => pack.conversionFactor === 1) ?? product.packs[0] ?? null;
        const minOrder = product.seed.packs.find((pack) => pack.minOrderQty)?.minOrderQty ?? null;

        if (product.action === "create") {
          if (!options.mayCreateProducts) continue;
          const sku = product.seed.sku || (await mintSku(product.seed, tx));
          await insertImportedProduct(
            tx,
            {
              sku,
              name: product.seed.name,
              category: product.seed.category || "Umum",
              price: base?.sellPrice ?? 0,
              cost: base?.buyPrice ?? 0,
              stock: product.seed.stock,
              minStock: product.seed.minStock,
              unitName: base?.unitName,
              packs: packsOf(product).filter((pack) => pack.conversionFactor !== 1),
              minOrderQty: minOrder,
              vendorSku:
                product.seed.packs.find((pack) => pack.vendorSku)?.vendorSku ?? null,
            },
            {
              warehouseId: options.warehouseId,
              vendorId,
              userId: options.userId,
              isPreferredVendor: true,
              priceMode: options.priceMode,
              priceSource: "import",
            }
          );
          created += 1;
          prices += product.packs.filter((pack) => pack.buyPrice > 0).length;
          continue;
        }

        // An existing product is never renamed and never duplicated: the sheet
        // only says "this vendor offers it, at this price".
        const productId = product.productId;
        if (!productId) continue;
        const cost = base?.buyPrice ?? 0;
        await upsertVendorCatalogLink(tx, {
          vendorId,
          productId,
          vendorSku: product.seed.packs.find((pack) => pack.vendorSku)?.vendorSku ?? null,
          lastCost: cost,
          minOrderQty: minOrder,
          isPreferred: false,
        });

        if (product.claimPreference) {
          await markPreferredVendor(tx, { vendorId, productId });
          // A product without a main vendor adopts the one the sheet names.
          await tx.query(
            `UPDATE products SET supplier_id = $1 WHERE id = $2 AND supplier_id IS NULL`,
            [vendorId, productId]
          );
        }

        for (const pack of product.packs) {
          if (pack.action === "skip" || !pack.variantId || pack.buyPrice <= 0) continue;
          await upsertVendorPrice(tx, {
            vendorId,
            variantId: pack.variantId,
            unitName: pack.unitName,
            conversionFactor: pack.conversionFactor,
            buyPrice: pack.buyPrice,
            minQty: minOrder,
            userId: options.userId,
            mode: pack.action === "overwrite" ? "overwrite" : "gap-only",
            source: "import",
          });
          prices += 1;
        }
        linked += 1;
      }

      await logAuditTx(tx, {
        action: "update",
        entity: "suppliers",
        entityId: vendorId,
        details: {
          via: "import vendor + produk",
          vendor: vendor.vendor.name,
          createdProducts: created,
          linkedProducts: linked,
          priceRows: prices,
        },
        userId: options.userId ?? undefined,
      });
    });
  };

  const handleConfirm = async () => {
    if (!plan) return;
    setApplying(true);
    let blocks = 0;
    let failed = 0;
    try {
      for (const vendor of plan.vendors) {
        try {
          await applyVendorBlock(vendor, {
            warehouseId: warehouseId || null,
            userId: userId ?? null,
            priceMode: mayOverwritePrices ? "overwrite" : "gap-only",
            mayCreateProducts,
          });
          blocks += 1;
        } catch (error) {
          // One vendor's block failing must not roll back the others.
          failed += 1;
          console.error(`Import block failed for ${vendor.vendor.name}:`, error);
        }
      }

      const summary = plan.summary;
      const parts = [
        `${blocks} vendor diproses`,
        `${summary.newProducts} produk baru`,
        `${summary.linkedProducts} produk ditautkan`,
        `${summary.priceOverwrites + summary.priceFills} harga beli`,
      ];
      if (summary.skippedPacks > 0) parts.push(`${summary.skippedPacks} pecahan dilewati`);
      if (ignoredRows > 0) parts.push(`${ignoredRows} baris tanpa nama vendor dibuang`);
      if (failed > 0) parts.push(`${failed} blok vendor gagal`);

      (failed > 0 ? toast.error : toast.success)(parts.join(" · "));
      setOpen(false);
      setPlan(null);
      setLines([]);
      onImported();
    } finally {
      setApplying(false);
    }
  };

  /**
   * The catalogue as one flat sheet, in the exact shape this dialog reads, so an
   * export can be edited in Excel and imported back without re-typing columns.
   */
  const handleExportCatalogue = async (format: "xlsx" | "csv") => {
    try {
      const res = await query<{
        vendor_code: string | null;
        vendor_name: string;
        vendor_category: string | null;
        contact_person: string | null;
        phone: string | null;
        email: string | null;
        payment_terms_days: number | null;
        sku: string | null;
        product_name: string | null;
        product_category: string | null;
        sell_price: number | null;
        stock: number | null;
        min_stock_level: number | null;
        unit_name: string | null;
        conversion_factor: number | null;
        buy_price: number | null;
        min_order_qty: number | null;
        vendor_sku: string | null;
      }>(
        /*
         * One line per (vendor, product, variant, pack): the shape the dialog
         * reads back. `vendor_price_list` is preferred, then the pack's own buy
         * price, then the catalogue's last cost — the same precedence the PO
         * screen uses, so an export shows what ordering would actually quote.
         */
        `SELECT
           v.code AS vendor_code, v.name AS vendor_name, v.category AS vendor_category,
           v.contact_person, v.phone, v.email, v.payment_terms_days,
           p.sku, p.name AS product_name, p.category AS product_category,
           p.min_stock_level, vp.vendor_sku, vp.min_order_qty,
           COALESCE(u.name, 'Pcs') AS unit_name,
           COALESCE(u.conversion_factor, 1) AS conversion_factor,
           COALESCE(u.price, pv.price, 0) AS sell_price,
           COALESCE(vpl.buy_price, u.cost, vp.last_cost, p.cost_price) AS buy_price,
           (SELECT COALESCE(SUM(b.quantity_current), 0) FROM product_batches b
             WHERE b.product_id = p.id) AS stock
         FROM suppliers v
         LEFT JOIN vendor_products vp ON vp.vendor_id = v.id
         LEFT JOIN products p ON p.id = vp.product_id
         LEFT JOIN product_variants pv ON pv.product_id = p.id
         LEFT JOIN product_units u ON u.variant_id = pv.id
         LEFT JOIN vendor_price_list vpl
           ON vpl.vendor_id = v.id AND vpl.variant_id = pv.id AND vpl.unit_name = u.name
         ORDER BY v.name ASC, p.name ASC, conversion_factor ASC`
      );

      const rows: BulkRow[] = res.rows.map((row) => ({
        vendorCode: row.vendor_code ?? "",
        vendorName: row.vendor_name ?? "",
        vendorCategory: row.vendor_category ?? "",
        contactPerson: row.contact_person ?? "",
        phone: row.phone ?? "",
        email: row.email ?? "",
        terms: String(row.payment_terms_days ?? ""),
        sku: row.sku ?? "",
        productName: row.product_name ?? "",
        productCategory: row.product_category ?? "",
        price: String(row.sell_price ?? ""),
        stock: String(row.stock ?? ""),
        minStock: String(row.min_stock_level ?? ""),
        unit: row.unit_name ?? "",
        factor: String(row.conversion_factor ?? 1),
        buyPrice: String(row.buy_price ?? ""),
        minOrder: String(row.min_order_qty ?? ""),
        vendorSku: row.vendor_sku ?? "",
      }));

      if (rows.length === 0) {
        toast.error("Belum ada katalog vendor untuk diekspor");
        return;
      }
      const name = `katalog_vendor_produk_${dateStamp()}.${format}`;
      if (format === "csv") downloadCsv(name, rows, VENDOR_PRODUCT_COLUMNS);
      else downloadXlsx(name, rows, VENDOR_PRODUCT_COLUMNS, "Katalog");
      toast.success(`${rows.length} baris katalog diekspor`);
    } catch (error) {
      console.error("Catalogue export failed:", error);
      toast.error("Gagal mengekspor katalog");
    }
  };

  const handleTemplate = (format: "xlsx" | "csv") => {
    const name = `template_vendor_produk.${format}`;
    if (format === "csv") downloadCsv(name, VENDOR_PRODUCT_TEMPLATE_ROWS, VENDOR_PRODUCT_COLUMNS);
    else downloadXlsx(name, VENDOR_PRODUCT_TEMPLATE_ROWS, VENDOR_PRODUCT_COLUMNS, "Template");
    toast.success("Template berhasil didownload");
  };

  const summary = plan?.summary ?? null;
  const willCreateProducts = (summary?.newProducts ?? 0) > 0 && !mayCreateProducts;

  return (
    <>
      <input
        ref={fileInputRef}
        id="vendor-product-import-file"
        type="file"
        accept=".csv,.xlsx,.xls"
        onChange={handleFile}
        className="hidden"
      />
      {/* The combined flow needs both keys: a vendor catalogue and its products. */}
      <PermissionGate permission="manage_vendor_prices">
        <PermissionGate permission="manage_variants">
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="w-4 h-4" />
            Import Vendor + Produk
          </Button>
        </PermissionGate>
      </PermissionGate>
      <PermissionGate permission="export_reports">
        <Button variant="outline" className="gap-2" onClick={() => handleExportCatalogue("xlsx")}>
          <Download className="w-4 h-4" />
          Ekspor Katalog
        </Button>
      </PermissionGate>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1 text-muted-foreground"
        onClick={() => handleTemplate("csv")}
      >
        <Package className="w-4 h-4" />
        Template Vendor + Produk (CSV)
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1 text-muted-foreground"
        onClick={() => handleTemplate("xlsx")}
      >
        <Package className="w-4 h-4" />
        Template Vendor + Produk (Excel)
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-5 h-5 text-primary" />
              Preview Import Vendor + Produk
            </DialogTitle>
            <DialogDescription>
              {summary &&
                `${summary.newVendors} vendor baru · ${summary.existingVendors} vendor sudah ada · ${summary.newProducts} produk baru · ${summary.linkedProducts} produk ditautkan · ${summary.priceOverwrites + summary.priceFills} harga beli (${summary.priceOverwrites} diperbarui)`}
              {summary && summary.vendorOnlyRows > 0 && ` · ${summary.vendorOnlyRows} baris vendor saja`}
              {ignoredRows > 0 && ` · ${ignoredRows} baris dibuang`}
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between gap-3 p-3 bg-muted/50 rounded-lg text-sm">
            <p className="text-muted-foreground">
              Master bersifat menambah — vendor dan produk yang sudah ada tidak
              diganti namanya. Harga beli mengikuti sheet.
            </p>
            {warehouses.length > 0 && (
              <div className="flex items-center gap-2 shrink-0">
                <Label className="text-xs whitespace-nowrap">Stok awal ke</Label>
                <Select value={warehouseId} onValueChange={setWarehouseId}>
                  <SelectTrigger className="h-8 w-[190px]">
                    <SelectValue placeholder="Gudang" />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses.map((warehouse) => (
                      <SelectItem key={warehouse.id} value={warehouse.id}>
                        {warehouse.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {willCreateProducts && (
            <div className="flex items-center gap-2 p-3 bg-destructive/10 rounded-lg text-destructive text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              Baris produk baru tidak akan dibuat: import gabungan ini butuh izin
              template produk. Vendor dan harganya tetap bisa masuk.
            </div>
          )}

          <div className="flex-1 overflow-auto border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Produk</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Satuan</TableHead>
                  <TableHead className="text-right">Harga Beli</TableHead>
                  <TableHead>Rencana</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.slice(0, 40).map((line, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <p className="text-sm font-medium">{line.vendorName}</p>
                      <p className="text-xs text-muted-foreground">{line.vendorState}</p>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm">{line.productName}</p>
                      <p className="text-xs text-muted-foreground">{line.productState}</p>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {line.sku || <span className="text-muted-foreground">(otomatis)</span>}
                    </TableCell>
                    <TableCell className="text-sm">{line.unitName || "-"}</TableCell>
                    <TableCell className="text-right text-sm">
                      {line.buyPrice ? `Rp ${line.buyPrice.toLocaleString("id-ID")}` : "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={toneClass(line.tone)}>
                        {line.action}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {lines.length > 40 && (
              <div className="p-3 text-center text-sm text-muted-foreground border-t">
                ... dan {lines.length - 40} baris lainnya
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => setOpen(false)}>
              <X className="w-4 h-4 mr-2" />
              Batal
            </Button>
            <Button
              className="flex-1 gap-2"
              onClick={handleConfirm}
              disabled={applying || !plan || plan.vendors.length === 0}
            >
              {applying ? (
                <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              Import {plan?.vendors.length ?? 0} Vendor
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
