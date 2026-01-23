import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import * as XLSX from "xlsx";

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
  onImport: (products: Product[]) => void;
}

interface ImportRow {
  "SKU"?: string;
  sku?: string;
  "Nama Produk"?: string;
  name?: string;
  "Kategori"?: string;
  category?: string;
  "Harga Jual"?: string | number;
  price?: string | number;
  "Harga Modal"?: string | number;
  cost?: string | number;
  "Stok"?: string | number;
  stock?: string | number;
  "Stok Minimum"?: string | number;
  minStock?: string | number;
  "Supplier"?: string;
  supplier?: string;
}

export function ProductImportExport({ products, onImport }: ProductImportExportProps) {
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importData, setImportData] = useState<Product[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const exportData = products.map((p) => ({
      SKU: p.sku,
      "Nama Produk": p.name,
      Kategori: p.category,
      "Harga Jual": p.price,
      "Harga Modal": p.cost,
      Stok: p.stock,
      "Stok Minimum": p.minStock,
      Supplier: p.supplier,
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Produk");

    // Set column widths
    ws["!cols"] = [
      { wch: 12 }, // SKU
      { wch: 30 }, // Nama Produk
      { wch: 15 }, // Kategori
      { wch: 12 }, // Harga Jual
      { wch: 12 }, // Harga Modal
      { wch: 8 },  // Stok
      { wch: 12 }, // Stok Minimum
      { wch: 20 }, // Supplier
    ];

    XLSX.writeFile(wb, `produk_${new Date().toISOString().split("T")[0]}.xlsx`);
    toast.success("File Excel berhasil diexport");
  };

  const handleExportTemplate = () => {
    const templateData = [
      {
        SKU: "PRD-001",
        "Nama Produk": "Contoh Produk",
        Kategori: "Makanan",
        "Harga Jual": 10000,
        "Harga Modal": 8000,
        Stok: 100,
        "Stok Minimum": 20,
        Supplier: "PT Supplier",
      },
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");

    ws["!cols"] = [
      { wch: 12 },
      { wch: 30 },
      { wch: 15 },
      { wch: 12 },
      { wch: 12 },
      { wch: 8 },
      { wch: 12 },
      { wch: 20 },
    ];

    XLSX.writeFile(wb, "template_produk.xlsx");
    toast.success("Template berhasil didownload");
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportError(null);
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: "binary" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        const parsedProducts: Product[] = jsonData.map((row: unknown) => {
          const r = row as ImportRow;
          return {
            sku: r["SKU"] || r["sku"] || "",
            name: r["Nama Produk"] || r["name"] || "",
            category: r["Kategori"] || r["category"] || "",
            price: parseFloat(String(r["Harga Jual"] || r["price"] || 0)),
            cost: parseFloat(String(r["Harga Modal"] || r["cost"] || 0)),
            stock: parseInt(String(r["Stok"] || r["stock"] || 0)),
            minStock: parseInt(String(r["Stok Minimum"] || r["minStock"] || 0)),
            supplier: r["Supplier"] || r["supplier"] || "",
          };
        });

        // Validate data
        const invalidRows = parsedProducts.filter(
          (p) => !p.sku || !p.name || p.price <= 0
        );

        if (invalidRows.length > 0) {
          setImportError(`${invalidRows.length} baris tidak valid (SKU, nama, atau harga kosong)`);
        }

        setImportData(parsedProducts.filter((p) => p.sku && p.name && p.price > 0));
        setIsImportOpen(true);
      } catch (error) {
        setImportError("Gagal membaca file. Pastikan format file benar.");
        toast.error("Gagal membaca file");
      }
    };

    reader.readAsBinaryString(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleConfirmImport = () => {
    onImport(importData);
    setIsImportOpen(false);
    setImportData([]);
    toast.success(`${importData.length} produk berhasil diimport`);
  };

  return (
    <>
      <div className="flex gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFileUpload}
          className="hidden"
        />
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="w-4 h-4" />
          Import
        </Button>
        <Button variant="outline" className="gap-2" onClick={handleExport}>
          <Download className="w-4 h-4" />
          Export
        </Button>
        <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={handleExportTemplate}>
          <FileSpreadsheet className="w-4 h-4" />
          Template
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
              {importData.length} produk siap untuk diimport
            </DialogDescription>
          </DialogHeader>

          {importError && (
            <div className="flex items-center gap-2 p-3 bg-destructive/10 rounded-lg text-destructive text-sm">
              <AlertCircle className="w-4 h-4" />
              {importError}
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
                {importData.slice(0, 20).map((product, index) => (
                  <TableRow key={index}>
                    <TableCell className="font-mono text-sm">{product.sku}</TableCell>
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
            {importData.length > 20 && (
              <div className="p-3 text-center text-sm text-muted-foreground border-t">
                ... dan {importData.length - 20} produk lainnya
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-4">
            <Button variant="outline" className="flex-1" onClick={() => setIsImportOpen(false)}>
              <X className="w-4 h-4 mr-2" />
              Batal
            </Button>
            <Button className="flex-1 gap-2" onClick={handleConfirmImport} disabled={importData.length === 0}>
              <Check className="w-4 h-4" />
              Import {importData.length} Produk
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
