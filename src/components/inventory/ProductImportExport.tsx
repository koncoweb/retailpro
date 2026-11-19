import { useRef, useState } from "react";
import { PermissionGate } from "@/components/auth/PermissionGate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Package,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { query } from "@/lib/db";
import { usePermissions } from "@/hooks/use-permissions";
import {
  WAREHOUSES_SQL,
  activeWarehouses,
  resolveBranchWarehouse,
  type WarehouseOption,
} from "@/lib/warehouse";
import {
  PRODUCT_COLUMNS,
  PRODUCT_TEMPLATE_ROWS,
  dateStamp,
  downloadCsv,
  downloadXlsx,
  normalizeRows,
  readRows,
  toCsv,
  type BulkRow,
  type ColumnDef,
} from "@/lib/bulk-io";
import {
  groupProductRows,
  planProductImport,
  type ImportedProductSeed,
  type ProductImportPlan,
  type ProductImportUniverse,
} from "@/lib/product-import";
import { normalizeVendorName } from "@/lib/vendor-catalog";
import {
  formatAttributeCell,
  parseVariantAttributes,
  variantKey,
  variantLabel,
  type VariantAttributeGroup,
  type VariantAttributes,
} from "@/lib/variants";

/**
 * The rich product sheet: one line per (variant x pack).
 *
 * This dialog used to read eight flat columns and hand the page a list of
 * name/price rows, which meant a product with six flavours was six products and
 * a carton was unspeakable. It now reads the flat sheet the writer can actually
 * store — attribute axes in a cell, one line per pack — plans it against what the
 * database already holds, and shows the plan before a single row is written.
 *
 * Reading and planning live here; the writing is the page's (`onImport`), because
 * a page owns its transactions. Export emits exactly the columns import reads, so
 * a file can be exported, edited in Excel and imported back.
 *
 * Design notes: `docs/spec-impor-varian-kaya.md`.
 */

/** The slice of an inventory row the rich export needs. Structurally satisfied. */
export interface ExportableProduct {
  sku: string;
  name: string;
  category: string;
  minStock: number;
  supplier: string;
  variantGroups?: VariantAttributeGroup[];
  variants?: Array<{
    sku: string;
    attributes: VariantAttributes;
    barcode?: string | null;
    warehouses?: Record<string, number>;
    units: Array<{
      name: string;
      conversion_factor: number;
      cost: number;
      price: number;
      barcode?: string | null;
    }>;
  }>;
}

/** What the page needs to execute the plan the operator just confirmed. */
export interface ProductImportContext {
  /** Opening stock lands here; null when the tenant has no gudang row. */
  warehouseId: string | null;
  /** `manage_vendor_prices` + the explicit toggle. */
  priceMode: "overwrite" | "gap-only";
}

interface ProductImportExportProps {
  products: ExportableProduct[];
  /**
   * Executes a confirmed plan. The rows are already resolved — product ids,
   * variant ids, per-pack prices — so the page only writes what the preview
   * promised and cannot disagree with the operator.
   */
  onImport: (plan: ProductImportPlan, context: ProductImportContext) => Promise<void> | void;
}

/** Flat preview line: one (product, variant, pack) with its verdict and reason. */
interface PreviewLine {
  productName: string;
  sku: string;
  productState: string;
  variantLabel: string;
  variantSku: string;
  attributes: string;
  unitName: string;
  sellPrice: number;
  buyPrice: number;
  action: string;
  reason: string;
  tone: "new" | "update" | "keep" | "skip";
}

const EXPORT_COLUMNS: ColumnDef[] = PRODUCT_COLUMNS;

function toneClass(tone: PreviewLine["tone"]): string {
  if (tone === "new") return "bg-success/10 text-success";
  if (tone === "update") return "bg-warning/10 text-warning";
  if (tone === "skip") return "bg-destructive/10 text-destructive";
  return "bg-muted text-muted-foreground";
}

/** `Rasa=Susu;Ukuran=250ml`, in the order the product's axes were authored. */
const attributeCell = formatAttributeCell;

/** One export line per (variant x pack), so the file reads like the product. */
function productToRows(product: ExportableProduct): BulkRow[] {
  const groups = product.variantGroups ?? [];
  const variants =
    product.variants && product.variants.length > 0
      ? product.variants
      : [
          {
            sku: product.sku,
            attributes: {} as VariantAttributes,
            barcode: null,
            warehouses: {} as Record<string, number>,
            units: [{ name: "Pcs", conversion_factor: 1, cost: 0, price: 0, barcode: null }],
          },
        ];

  const rows: BulkRow[] = [];
  variants.forEach((variant, variantIndex) => {
    const stock = Object.values(variant.warehouses ?? {}).reduce(
      (sum, qty) => sum + Number(qty ?? 0),
      0
    );
    const attrs = attributeCell(variant.attributes ?? {}, groups);
    // Codes are only exported when they say something the attributes do not:
    // a hand-typed variant code must survive the round trip.
    const code =
      variant.sku && variant.sku !== product.sku && attrs === "" ? variant.sku : "";
    const units =
      variant.units && variant.units.length > 0
        ? variant.units
        : [{ name: "Pcs", conversion_factor: 1, cost: 0, price: 0, barcode: null }];

    units.forEach((unit, unitIndex) => {
      const leadLine = variantIndex === 0 && unitIndex === 0;
      rows.push({
        sku: product.sku,
        name: leadLine ? product.name : "",
        category: leadLine ? product.category : "",
        // A pack carries its OWN prices; `Stok` is base units, so it belongs to
        // the factor-1 line only, or a re-import would multiply the stock.
        price: String(unit.price ?? ""),
        cost: String(unit.cost ?? ""),
        stock: Number(unit.conversion_factor ?? 1) === 1 ? String(stock || "") : "",
        minStock: leadLine ? String(product.minStock ?? "") : "",
        supplier: leadLine ? product.supplier : "",
        variantSku: code,
        variantAttrs: attrs,
        barcode: unit.barcode || variant.barcode || "",
        unit: unit.name,
        factor: String(unit.conversion_factor ?? 1),
        vendorCode: "",
        minOrder: "",
        vendorSku: "",
      });
    });
  });
  return rows;
}

/** Build the preview lines straight from the plan, never from the sheet. */
function describe(plan: ProductImportPlan): PreviewLine[] {
  const rows: PreviewLine[] = [];
  for (const product of plan.products) {
    const groups = product.seed.variantGroups;

    if (product.variants.length === 0) {
      rows.push({
        productName: product.seed.name,
        sku: product.seed.sku ?? "",
        productState: `produk baru · ${product.reason}`,
        variantLabel: "Default",
        variantSku: "",
        attributes: "",
        unitName: "",
        sellPrice: 0,
        buyPrice: 0,
        action: "dilewati",
        reason: "baris tidak membawa varian",
        tone: "skip",
      });
      continue;
    }

    for (const variant of product.variants) {
      const state =
        product.action === "create"
          ? `produk baru · ${product.reason}`
          : product.action === "nochange"
            ? `sudah ada · ${product.reason}`
            : `produk sudah ada · ${product.reason}`;

      const packs =
        variant.packs.length > 0
          ? variant.packs
          : [
              {
                unitName: variant.seed.packs[0]?.unitName ?? "Pcs",
                conversionFactor: 1,
                buyPrice: variant.seed.packs[0]?.buyPrice ?? 0,
                sellPrice: variant.seed.packs[0]?.sellPrice ?? 0,
                variantId: null,
                action: "skip" as const,
                isNewPack: false,
              },
            ];

      for (const pack of packs) {
        const action =
          variant.action === "conflict"
            ? "dilewati"
            : product.action === "nochange"
              ? "tidak ada yang baru"
              : pack.action === "overwrite"
                ? "harga diperbarui"
                : pack.action === "fill"
                  ? "harga diisi"
                  : variant.action === "create"
                    ? pack.isNewPack
                      ? "varian baru"
                      : "varian baru (tanpa harga)"
                    : pack.isNewPack
                      ? "pecahan baru"
                      : "dilewati";
        rows.push({
          productName: product.seed.name || "(hanya kode)",
          sku: product.seed.sku ?? "",
          productState: state,
          variantLabel: variantLabel(variant.seed.attributes, groups) || "Default",
          variantSku: variant.sku,
          attributes: attributeCell(variant.seed.attributes, groups),
          unitName: `${pack.unitName}${pack.conversionFactor > 1 ? ` ×${pack.conversionFactor}` : ""}`,
          sellPrice: pack.sellPrice,
          buyPrice: pack.buyPrice,
          action,
          reason:
            variant.action === "conflict"
              ? variant.reason
              : pack.action === "skip" && pack.buyPrice > 0
                ? product.vendorId || product.newVendor
                  ? "sudah ada harga beli untuk vendor ini"
                  : "harga beli butuh Kode Vendor atau Supplier"
                : variant.reason,
          tone:
            variant.action === "conflict"
              ? "skip"
              : pack.action === "overwrite"
                ? "update"
                : variant.action === "create"
                  ? "new"
                  : pack.action === "skip"
                    ? "skip"
                    : "keep",
        });
      }
    }

    for (const note of product.seed.notes) {
      rows.push({
        productName: product.seed.name,
        sku: product.seed.sku ?? "",
        productState: "catatan file",
        variantLabel: "",
        variantSku: "",
        attributes: "",
        unitName: "",
        sellPrice: 0,
        buyPrice: 0,
        action: "perhatikan",
        reason: note,
        tone: "skip",
      });
    }
  }
  return rows;
}

/** One summary chip; hidden when the number is zero. */
function Chip({ value, label, tone }: { value: number; label: string; tone?: string }) {
  if (value <= 0) return null;
  return (
    <Badge variant="secondary" className={tone ?? "bg-muted text-muted-foreground"}>
      {value} {label}
    </Badge>
  );
}

export function ProductImportExport({ products, onImport }: ProductImportExportProps) {
  const { can } = usePermissions();
  const mayOverwritePrices = can("manage_vendor_prices");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [showFormat, setShowFormat] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [ignoredRows, setIgnoredRows] = useState(0);
  const [plan, setPlan] = useState<ProductImportPlan | null>(null);
  const [lines, setLines] = useState<PreviewLine[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [warehouseId, setWarehouseId] = useState("");

  /** Kept so the "Timpa harga beli" toggle can re-plan without reading again. */
  const [seeds, setSeeds] = useState<ImportedProductSeed[]>([]);
  const [universe, setUniverse] = useState<ProductImportUniverse | null>(null);

  const build = (nextSeeds: ImportedProductSeed[], nextUniverse: ProductImportUniverse, mayReplace: boolean) => {
    const next = planProductImport(nextSeeds, nextUniverse, {
      priceMode: mayReplace && mayOverwritePrices ? "overwrite" : "gap-only",
    });
    setPlan(next);
    setLines(describe(next));
    return next;
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;

    try {
      const normalized = normalizeRows(await readRows(file), PRODUCT_COLUMNS);
      // A line only has to say WHICH product it is about: the model's name may
      // sit on the first line of the group alone, and a pack line legitimately
      // carries no name at all.
      const withIdentity = normalized.filter(
        (row) => normalizeVendorName(row.sku) || normalizeVendorName(row.name)
      );
      setIgnoredRows(normalized.length - withIdentity.length);

      const nextSeeds = groupProductRows(withIdentity);
      if (nextSeeds.length === 0) {
        toast.error(
          "Tidak ada produk yang terbaca. Pastikan kolom SKU atau Nama Produk terisi."
        );
        return;
      }

      // Read the whole existing key space once, so the preview can promise
      // numbers instead of hoping the write matches.
      const [productRes, variantRes, unitRes, vendorRes, linkRes, priceRes, warehouseRes] =
        await Promise.all([
          query<{ id: string; sku: string | null; name: string }>(
            `SELECT id, sku, name FROM products`
          ),
          query<{ id: string; product_id: string; sku: string | null; attributes: string | null }>(
            `SELECT id, product_id, sku, attributes FROM product_variants`
          ),
          query<{ variant_id: string | null; name: string; conversion_factor: number }>(
            `SELECT variant_id, name, conversion_factor FROM product_units`
          ),
          query<{ id: string; name: string; code: string | null }>(
            `SELECT id, name, code FROM suppliers`
          ),
          query<{ vendor_id: string; product_id: string; is_preferred: number }>(
            `SELECT vendor_id, product_id, is_preferred FROM vendor_products`
          ),
          query<{ vendor_id: string; variant_id: string; unit_name: string }>(
            `SELECT vendor_id, variant_id, unit_name FROM vendor_price_list`
          ),
          query<WarehouseOption>(WAREHOUSES_SQL),
        ]);

      const variantsByProduct = new Map<string, ProductImportUniverse["products"][number]["variants"]>();
      for (const row of variantRes.rows) {
        const list = variantsByProduct.get(row.product_id) ?? [];
        list.push({
          id: row.id,
          sku: row.sku,
          // The stored attributes are the variant's real identity: a code typed
          // over on the product screen must not turn a flavour into a new row.
          attributeKey: variantKey(parseVariantAttributes(row.attributes)),
        });
        variantsByProduct.set(row.product_id, list);
      }
      const packsByProduct = new Map<string, ProductImportUniverse["products"][number]["packs"]>();
      const variantToProduct = new Map(
        variantRes.rows.map((row) => [row.id, row.product_id] as const)
      );
      for (const unit of unitRes.rows) {
        const productId = unit.variant_id ? variantToProduct.get(unit.variant_id) : undefined;
        if (!productId) continue;
        const list = packsByProduct.get(productId) ?? [];
        list.push({
          variantId: unit.variant_id as string,
          unitName: unit.name,
          conversionFactor: Number(unit.conversion_factor ?? 1),
        });
        packsByProduct.set(productId, list);
      }

      const nextUniverse: ProductImportUniverse = {
        products: productRes.rows.map((row) => ({
          id: row.id,
          sku: row.sku,
          name: row.name,
          variants: variantsByProduct.get(row.id) ?? [],
          packs: packsByProduct.get(row.id) ?? [],
        })),
        vendors: vendorRes.rows,
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
      };

      const active = activeWarehouses(warehouseRes.rows);
      const fallback = (await resolveBranchWarehouse(null)) ?? active[0]?.id ?? "";

      setSeeds(nextSeeds);
      setUniverse(nextUniverse);
      setOverwrite(false);
      setWarehouses(active);
      setWarehouseId(fallback);
      build(nextSeeds, nextUniverse, false);
      setOpen(true);
    } catch (error) {
      console.error("Import failed:", error);
      toast.error("Gagal membaca file. Pastikan format CSV/Excel benar.");
    }
  };

  const handleConfirmImport = async () => {
    if (!plan) return;
    setApplying(true);
    try {
      await onImport(plan, {
        warehouseId: warehouseId || null,
        priceMode: overwrite && mayOverwritePrices ? "overwrite" : "gap-only",
      });
      setOpen(false);
      setPlan(null);
      setLines([]);
      setSeeds([]);
      setUniverse(null);
    } finally {
      setApplying(false);
    }
  };

  const handleExport = (format: "xlsx" | "csv") => {
    const rows = products.flatMap(productToRows);
    if (rows.length === 0) {
      toast.error("Belum ada produk untuk diekspor");
      return;
    }
    const name = `produk_${dateStamp()}.${format}`;
    if (format === "csv") downloadCsv(name, rows, EXPORT_COLUMNS);
    else downloadXlsx(name, rows, EXPORT_COLUMNS, "Produk");
    toast.success(`Export ${format.toUpperCase()} berhasil (${rows.length} baris)`);
  };

  const handleExportTemplate = (format: "xlsx" | "csv") => {
    const name = `template_produk.${format}`;
    if (format === "csv") downloadCsv(name, PRODUCT_TEMPLATE_ROWS, EXPORT_COLUMNS);
    else downloadXlsx(name, PRODUCT_TEMPLATE_ROWS, EXPORT_COLUMNS, "Template");
    toast.success("Template berhasil didownload");
  };

  const summary = plan?.summary ?? null;
  const writeCount =
    (summary?.newProducts ?? 0) + (summary?.extendedProducts ?? 0);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <input
          ref={fileInputRef}
          id="product-import-file"
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={handleFileUpload}
          className="hidden"
        />
        <PermissionGate permission="manage_variants">
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
        {/*
         * The blank template is deliberately *not* gated: it carries sample rows
         * only, and staff allowed to import must see the column format.
         */}
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 text-muted-foreground"
          onClick={() => handleExportTemplate("csv")}
        >
          <FileSpreadsheet className="w-4 h-4" />
          Template CSV
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 text-muted-foreground"
          onClick={() => handleExportTemplate("xlsx")}
        >
          <FileSpreadsheet className="w-4 h-4" />
          Template Excel
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-5 h-5 text-primary" />
              Preview Import Produk
            </DialogTitle>
            <DialogDescription>
              {summary &&
                `${plan?.products.length ?? 0} produk dalam file · ${writeCount} akan ditulis · ${summary.unchangedProducts} tidak ada yang baru`}
              {ignoredRows > 0 && ` · ${ignoredRows} baris dibuang`}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-2">
            <Chip value={summary?.newProducts ?? 0} label="produk baru" tone="bg-success/10 text-success" />
            <Chip value={summary?.newVariants ?? 0} label="varian baru" tone="bg-success/10 text-success" />
            <Chip value={summary?.newPacks ?? 0} label="pecahan baru" tone="bg-success/10 text-success" />
            <Chip value={summary?.priceFills ?? 0} label="harga diisi" />
            <Chip
              value={summary?.priceOverwrites ?? 0}
              label="harga ditimpa"
              tone="bg-warning/10 text-warning"
            />
            <Chip
              value={(summary?.unchangedProducts ?? 0) + (summary?.conflicts ?? 0)}
              label="dilewati"
              tone="bg-destructive/10 text-destructive"
            />
            <Chip value={summary?.autoSkuProducts ?? 0} label="SKU otomatis" />
            <Chip
              value={summary?.noteLines ?? 0}
              label="catatan file"
              tone="bg-warning/10 text-warning"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-muted/50 rounded-lg text-sm">
            <p className="text-muted-foreground">
              Import bersifat menambah — produk dan varian yang sudah ada tidak
              diganti namanya, tidak dihapus, dan harganya tidak dinolkan.
            </p>
            <div className="flex items-center gap-3 shrink-0">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={overwrite}
                  disabled={!mayOverwritePrices}
                  onChange={(event) => {
                    const next = event.target.checked;
                    setOverwrite(next);
                    if (seeds.length > 0 && universe) build(seeds, universe, next);
                  }}
                />
                <span
                  title={
                    mayOverwritePrices
                      ? undefined
                      : "Butuh izin kelola harga beli vendor untuk menimpa harga"
                  }
                >
                  Timpa harga beli
                </span>
              </label>
              {warehouses.length > 0 && (
                <div className="flex items-center gap-2">
                  <Label className="text-xs whitespace-nowrap">Stok awal ke</Label>
                  <Select value={warehouseId} onValueChange={setWarehouseId}>
                    <SelectTrigger className="h-8 w-[170px]">
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
          </div>

          {summary && summary.conflicts > 0 && (
            <div className="flex items-center gap-2 p-3 bg-destructive/10 rounded-lg text-destructive text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              Ada Kode Varian yang sudah dipakai produk lain. Baris itu tidak
              ditulis — perbaiki kodenya di file, atau hapus barisnya.
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowFormat((value) => !value)}
            className="flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground"
          >
            {showFormat ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
            Format kolom &amp; contoh baris
          </button>
          {showFormat && (
            <div className="text-xs text-muted-foreground space-y-2 p-3 border rounded-lg">
              <p>
                Satu baris = satu varian × satu kemasan. Produk dengan dua sumbu
                dan dua kemasan ditulis empat baris dengan <b>SKU</b> yang sama.
              </p>
              <ul className="list-disc pl-4 space-y-1">
                <li>
                  <b>Atribut Varian</b>: <code>Rasa=Susu;Ukuran=250ml</code> — pemisah{" "}
                  <code>;</code>, <code>|</code>, atau baris baru; pembatas nama dan nilai{" "}
                  <code>=</code> atau <code>:</code>. Kosong atau <code>Default</code> = produk
                  tanpa varian.
                </li>
                <li>
                  <b>Kode Varian</b> opsional. Dikosongkan = aplikasi menurunkan kodenya dari
                  atribut (<code>KOP-001-SUSU-250ML</code>). Kode yang sudah dipakai produk lain
                  ditandai, tidak ditimpa.
                </li>
                <li>
                  <b>Satuan</b> dan <b>Faktor</b>: <code>Pcs</code>/1 adalah kemasan dasar dan
                  memegang harga jual/modal varian itu; <code>Karton</code>/24 punya harganya
                  sendiri, tidak dihitung dari yang lain.
                </li>
                <li>
                  <b>Stok</b> dihitung dalam satuan dasar, jadi hanya ditulis pada baris Faktor 1.
                </li>
                <li>
                  <b>Kode Vendor</b> lebih diutamakan daripada <b>Supplier</b> (nama) saat
                  mencocokkan vendor.
                </li>
              </ul>
              <p>Baris contoh yang bisa langsung dipakai:</p>
              <pre className="overflow-auto p-2 bg-muted rounded text-[11px] leading-relaxed">
                {toCsv(PRODUCT_TEMPLATE_ROWS, PRODUCT_COLUMNS)}
              </pre>
            </div>
          )}

          <div className="flex-1 min-h-[200px] max-h-[50vh] overflow-auto border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produk</TableHead>
                  <TableHead>Varian</TableHead>
                  <TableHead>Satuan</TableHead>
                  <TableHead className="text-right">Harga Jual</TableHead>
                  <TableHead className="text-right">Harga Beli</TableHead>
                  <TableHead>Rencana</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.slice(0, 40).map((line, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <p className="text-sm font-medium">{line.productName}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {line.sku || "(SKU otomatis)"}
                      </p>
                      <p className="text-xs text-muted-foreground">{line.productState}</p>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm">{line.variantLabel || "-"}</p>
                      {line.attributes && (
                        <p className="text-xs text-muted-foreground">{line.attributes}</p>
                      )}
                      {line.variantSku && (
                        <p className="font-mono text-xs text-muted-foreground">
                          {line.variantSku}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{line.unitName || "-"}</TableCell>
                    <TableCell className="text-right text-sm">
                      {line.sellPrice ? `Rp ${line.sellPrice.toLocaleString("id-ID")}` : "-"}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {line.buyPrice ? `Rp ${line.buyPrice.toLocaleString("id-ID")}` : "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={toneClass(line.tone)}>
                        {line.action}
                      </Badge>
                      {line.reason && (
                        <p className="text-xs text-muted-foreground mt-1 max-w-[220px]">
                          {line.reason}
                        </p>
                      )}
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
              onClick={handleConfirmImport}
              disabled={applying || writeCount === 0}
            >
              {applying ? (
                <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              Import {writeCount} Produk
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
