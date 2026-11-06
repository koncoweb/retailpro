import { useState, useRef } from "react";
import { PermissionGate } from "@/components/auth/PermissionGate";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Upload, Download, FileSpreadsheet, Check, AlertCircle, X } from "lucide-react";
import { toast } from "sonner";
import {
  PRODUCT_COLUMNS,
  PRODUCT_TEMPLATE_ROWS,
  dateStamp,
  downloadCsv,
  downloadXlsx,
  normalizeRows,
  parseIdNumber,
  readRows,
  resolveCollisions,
  type ColumnDef,
} from "@/lib/bulk-io";

interface Product {
  sku: string;
  name: string;
  category: string;
  price: number;
  cost: number;
  stock: number;
  minStock: number;
  supplier: string;
}

interface ProductImportExportProps {
  products: Product[];
  /**
   * Receives the rows safe to add. A row's `sku` may be empty — the Inventory
   * writer then mints the next SKU from the app's own sequence. Rows whose SKU
   * already exists are never passed here (import is additive).
   */
  onImport: (products: Product[]) => void;
}

interface SkippedRow {
  row: Product;
  reason: "existing" | "duplicate_in_file";
}

/** Map a normalised sheet row onto the typed product shape. */
function toProduct(r: Record<string, string>): Product {
  return {
    sku: (r.sku || "").trim(),
    name: (r.name || "").trim(),
    category: (r.category || "").trim(),
    price: parseIdNumber(r.price),
    cost: parseIdNumber(r.cost),
    stock: parseIdNumber(r.stock),
    minStock: parseIdNumber(r.minStock),
    supplier: (r.supplier || "").trim(),
  };
}

/** Rows are exported/template-ised as the canonical string cells. */
function productToRow(p: Product): Record<string, string> {
  return {
    sku: p.sku,
    name: p.name,
    category: p.category,
    price: String(p.price ?? ""),
    cost: String(p.cost ?? ""),
    stock: String(p.stock ?? ""),
    minStock: String(p.minStock ?? ""),
    supplier: p.supplier ?? "",
  };
}

const EXPORT_COLUMNS: ColumnDef[] = PRODUCT_COLUMNS;

export function ProductImportExport({ products, onImport }: ProductImportExportProps) {
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<Product[]>([]);
  const [skipped, setSkipped] = useState<SkippedRow[]>([]);
  const [invalidCount, setInvalidCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = (format: "xlsx" | "csv") => {
    const rows = products.map(productToRow);
    const name = `produk_${dateStamp()}.${format}`;
    if (format === "csv") downloadCsv(name, rows, EXPORT_COLUMNS);
    else downloadXlsx(name, rows, EXPORT_COLUMNS, "Produk");
    toast.success(`Export ${format.toUpperCase()} berhasil`);
  };

  const handleExportTemplate = (format: "xlsx" | "csv") => {
    const name = `template_produk.${format}`;
    if (format === "csv") downloadCsv(name, PRODUCT_TEMPLATE_ROWS, EXPORT_COLUMNS);
    else downloadXlsx(name, PRODUCT_TEMPLATE_ROWS, EXPORT_COLUMNS, "Template");
    toast.success("Template berhasil didownload");
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const raw = await readRows(file);
      const normalized = normalizeRows(raw, PRODUCT_COLUMNS).map(toProduct);

      // A product needs at least a name and a sell price.
      const valid = normalized.filter((p) => p.name && p.price > 0);
      setInvalidCount(normalized.length - valid.length);

      // Additive import: existing SKUs (or repeats inside the file) are skipped,
      // never overwritten. Blank-SKU rows pass through for auto-numbering.
      const existingSkus = new Set(products.map((p) => p.sku.toLowerCase()).filter(Boolean));
      const { fresh, conflicts } = resolveCollisions({
        incoming: valid,
        keysOf: (p) => [p.sku],
        existingKeys: existingSkus,
      });

      setImportRows(fresh);
      setSkipped(conflicts.map((c) => ({ row: c.row, reason: c.reason })));
      setIsImportOpen(true);
    } catch (error) {
      console.error("Import failed:", error);
      toast.error("Gagal membaca file. Pastikan format CSV/Excel benar.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleConfirmImport = () => {
    onImport(importRows);
    setIsImportOpen(false);
    setImportRows([]);
    setSkipped([]);
    setInvalidCount(0);
  };

  const blankSkuCount = importRows.filter((p) => !p.sku).length;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <input
          ref={fileInputRef}
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

      <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-primary" />
              Preview Import Produk
            </DialogTitle>
            <DialogDescription>
              {importRows.length} produk siap ditambah
              {blankSkuCount > 0 && ` (${blankSkuCount} tanpa SKU akan dibuat otomatis)`}
              {skipped.length > 0 && ` · ${skipped.length} dilewati (SKU sudah ada/kembar)`}
              {invalidCount > 0 && ` · ${invalidCount} baris tidak valid dibuang`}
            </DialogDescription>
          </DialogHeader>

          {skipped.length > 0 && (
            <div className="flex items-center gap-2 p-3 bg-destructive/10 rounded-lg text-destructive text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              Import bersifat menambah — baris dengan SKU yang sudah ada tidak
              menimpa data lama, melainkan dilewati.
            </div>
          )}

          <div className="flex-1 overflow-auto border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Nama Produk</TableHead>
                  <TableHead>Kategori</TableHead>
                  <TableHead className="text-right">Harga Jual</TableHead>
                  <TableHead className="text-right">Harga Modal</TableHead>
                  <TableHead className="text-right">Stok</TableHead>
                  <TableHead>Supplier</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {importRows.slice(0, 20).map((product, index) => (
                  <TableRow key={index}>
                    <TableCell className="font-mono text-sm">
                      {product.sku || <span className="text-muted-foreground">(otomatis)</span>}
                    </TableCell>
                    <TableCell>{product.name}</TableCell>
                    <TableCell>{product.category}</TableCell>
                    <TableCell className="text-right">Rp {product.price.toLocaleString()}</TableCell>
                    <TableCell className="text-right">Rp {product.cost.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{product.stock}</TableCell>
                    <TableCell>{product.supplier}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {importRows.length > 20 && (
              <div className="p-3 text-center text-sm text-muted-foreground border-t">
                ... dan {importRows.length - 20} produk lainnya
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-4">
            <Button variant="outline" className="flex-1" onClick={() => setIsImportOpen(false)}>
              <X className="w-4 h-4 mr-2" />
              Batal
            </Button>
            <Button className="flex-1 gap-2" onClick={handleConfirmImport} disabled={importRows.length === 0}>
              <Check className="w-4 h-4" />
              Import {importRows.length} Produk
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
