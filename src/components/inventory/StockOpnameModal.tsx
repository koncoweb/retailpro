import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Package, Search, CheckCircle2, AlertTriangle } from "lucide-react";
import { warehouseLabel, type WarehouseOption } from "@/lib/warehouse";

/** A sellable variant, as an opname needs it: its own stock per warehouse. */
export interface OpnameVariant {
  id: string;
  label: string;
  sku: string;
  warehouses: Record<string, number>;
}

/** `variants` absent or empty means the product is counted as a whole. */
export interface OpnameProduct {
  id: string;
  sku: string;
  name: string;
  stock: number;
  warehouses: Record<string, number>;
  variants?: OpnameVariant[];
}

/** One line of the counting sheet. */
interface OpnameRow {
  key: string;
  productId: string;
  variantId: string | null;
  productName: string;
  variantName: string;
  sku: string;
  systemStock: number;
}

interface StockOpnameModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: OpnameProduct[];
  warehouses: WarehouseOption[];
  onSave: (opname: {
    warehouseId: string;
    items: Array<{
      productId: string;
      /** Which variant was counted; null means "the whole product". */
      variantId: string | null;
      systemStock: number;
      actualStock: number;
      difference: number;
    }>;
  }) => void;
}

export function StockOpnameModal({ open, onOpenChange, products, warehouses, onSave }: StockOpnameModalProps) {
  const [selectedWarehouse, setSelectedWarehouse] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  // Keyed by ROW, not by product: a carton and a piece of the same product are
  // counted separately, so one input per product would overwrite the other.
  const [actualStocks, setActualStocks] = useState<Record<string, string>>({});

  /**
   * One counting row per sellable unit. A product with variants yields one row
   * per variant; a product without them keeps a single product-wide row, which
   * the opname writer still accepts.
   */
  const buildRows = (): OpnameRow[] => {
    if (!selectedWarehouse) return [];
    const rows: OpnameRow[] = [];

    for (const product of products) {
      const variants = product.variants ?? [];
      if (variants.length > 0) {
        for (const variant of variants) {
          rows.push({
            key: `${product.id}|${variant.id}`,
            productId: product.id,
            variantId: variant.id,
            productName: product.name,
            variantName: variant.label,
            sku: variant.sku || product.sku,
            systemStock: variant.warehouses[selectedWarehouse] ?? 0,
          });
        }
        continue;
      }

      rows.push({
        key: `${product.id}|`,
        productId: product.id,
        variantId: null,
        productName: product.name,
        variantName: "",
        sku: product.sku,
        systemStock: product.warehouses[selectedWarehouse] ?? 0,
      });
    }

    const needle = searchQuery.toLowerCase();
    return rows.filter(
      (row) =>
        row.productName.toLowerCase().includes(needle) ||
        row.sku.toLowerCase().includes(needle) ||
        row.variantName.toLowerCase().includes(needle)
    );
  };

  const locationRows = buildRows();

  const handleActualStockChange = (rowKey: string, value: string) => {
    setActualStocks({ ...actualStocks, [rowKey]: value });
  };

  /** What was actually typed, falling back to the system count. */
  const actualFor = (row: OpnameRow) => {
    const raw = actualStocks[row.key];
    return raw !== undefined && raw !== "" ? parseInt(raw) : row.systemStock;
  };

  const handleSubmit = () => {
    if (!selectedWarehouse) {
      toast.error("Pilih gudang terlebih dahulu");
      return;
    }

    const items = locationRows.map((row) => {
      const actualStock = actualFor(row);

      return {
        productId: row.productId,
        variantId: row.variantId,
        systemStock: row.systemStock,
        actualStock,
        difference: actualStock - row.systemStock,
      };
    });

    const hasChanges = items.some(item => item.difference !== 0);
    
    onSave({
      warehouseId: selectedWarehouse,
      items,
    });

    toast.success(hasChanges ? "Stock opname berhasil disimpan" : "Tidak ada perubahan stok");
    onOpenChange(false);
    setSelectedWarehouse("");
    setActualStocks({});
  };

  const getTotalDifference = () => {
    return locationRows.reduce((sum, row) => sum + (actualFor(row) - row.systemStock), 0);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Stock Opname</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Warehouse Selection */}
          <div className="flex gap-4">
            <div className="grid gap-2">
              <Label>Gudang Opname</Label>
              <Select value={selectedWarehouse} onValueChange={setSelectedWarehouse}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih gudang" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((warehouse) => (
                    <SelectItem key={warehouse.id} value={warehouse.id}>
                      {warehouseLabel(warehouse)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedWarehouse && (
              <div className="flex-1">
                <Label>Cari Produk</Label>
                <div className="relative mt-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Cari SKU atau nama..."
                    className="pl-10"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Summary */}
          {selectedWarehouse && (
            <div className="flex gap-4">
              <div className="flex-1 bg-muted/50 rounded-lg p-3">
                <p className="text-sm text-muted-foreground">Total Produk</p>
                <p className="text-xl font-bold">{locationRows.length}</p>
              </div>
              <div className={`flex-1 rounded-lg p-3 ${getTotalDifference() === 0 ? 'bg-success/10' : getTotalDifference() > 0 ? 'bg-info/10' : 'bg-destructive/10'}`}>
                <p className="text-sm text-muted-foreground">Selisih Total</p>
                <p className={`text-xl font-bold ${getTotalDifference() === 0 ? 'text-success' : getTotalDifference() > 0 ? 'text-info' : 'text-destructive'}`}>
                  {getTotalDifference() > 0 ? '+' : ''}{getTotalDifference()}
                </p>
              </div>
            </div>
          )}

          {/* Products Table */}
          {selectedWarehouse && locationRows.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produk</TableHead>
                    <TableHead className="text-center">Stok Sistem</TableHead>
                    <TableHead className="text-center">Stok Aktual</TableHead>
                    <TableHead className="text-center">Selisih</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {locationRows.map((row) => {
                    const actualStock = actualFor(row);
                    const difference = actualStock - row.systemStock;
                    
                    return (
                      <TableRow key={row.key}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Package className="w-4 h-4 text-muted-foreground" />
                            <div>
                              <p className="font-medium">
                                {row.productName}
                                {row.variantName && (
                                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                                    {row.variantName}
                                  </span>
                                )}
                              </p>
                              <p className="text-xs text-muted-foreground">{row.sku}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="secondary">{row.systemStock}</Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Input
                            type="number"
                            className="w-20 mx-auto text-center"
                            placeholder={row.systemStock.toString()}
                            value={actualStocks[row.key] || ""}
                            onChange={(e) => handleActualStockChange(row.key, e.target.value)}
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={`font-medium ${difference === 0 ? 'text-muted-foreground' : difference > 0 ? 'text-success' : 'text-destructive'}`}>
                            {difference > 0 ? '+' : ''}{difference}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          {difference === 0 ? (
                            <CheckCircle2 className="w-5 h-5 text-success mx-auto" />
                          ) : (
                            <AlertTriangle className="w-5 h-5 text-warning mx-auto" />
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {selectedWarehouse && locationRows.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              Tidak ada produk ditemukan di gudang ini
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button className="flex-1" onClick={handleSubmit} disabled={!selectedWarehouse}>
            Simpan Opname
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
