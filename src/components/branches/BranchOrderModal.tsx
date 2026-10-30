import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { AlertTriangle, ClipboardList, Package, Plus, Trash2 } from "lucide-react";
import {
  STOCK_REQUEST_PRIORITY_LABEL,
} from "@/lib/branch-orders";

/** The three fields of a product the ordering screen needs. */
export interface OrderProductOption {
  id: string;
  sku: string;
  name: string;
  /** Base units sitting in the gudang that will fulfil the order. */
  stock: number;
  minStock: number;
  units: { name: string; conversion_factor: number }[];
}

export interface OrderBranchOption {
  id: string;
  code: string | null;
  name: string;
}

export interface BranchOrderLine {
  productId: string;
  /** Base units; the unit is only how the shop typed it. */
  quantity: number;
  unitName: string;
  conversionFactor: number;
}

export interface BranchOrderDraft {
  branchId: string;
  priority: "normal" | "urgent";
  neededDate: string;
  notes: string;
  /** true = straight to the gudang queue, false = keep as a draft. */
  submit: boolean;
  items: BranchOrderLine[];
}

interface BranchOrderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branches: OrderBranchOption[];
  products: OrderProductOption[];
  /** A store manager can only order for their own shop. */
  lockedBranchId?: string | null;
  /** Prefill from a low-stock row: product plus the base units it is short. */
  prefill?: { productId: string; quantity?: number } | null;
  onSubmit: (draft: BranchOrderDraft) => void;
  isSaving?: boolean;
}

interface DraftRow {
  productId: string;
  productName: string;
  sku: string;
  /** Quantity in the chosen unit. */
  quantity: number;
  unitName: string;
  conversionFactor: number;
  /** Base units, converted once — this is what gets stored. */
  baseQuantity: number;
  warehouseStock: number;
  minStock: number;
}

export function BranchOrderModal({
  open,
  onOpenChange,
  branches,
  products,
  lockedBranchId,
  prefill,
  onSubmit,
  isSaving,
}: BranchOrderModalProps) {
  const [branchId, setBranchId] = useState(lockedBranchId ?? "");
  const [priority, setPriority] = useState<"normal" | "urgent">("normal");
  const [neededDate, setNeededDate] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedProduct, setSelectedProduct] = useState("");
  const [selectedUnit, setSelectedUnit] = useState("Pcs");
  const [quantity, setQuantity] = useState("");
  const [rows, setRows] = useState<DraftRow[]>([]);

  const shortProducts = products.filter((product) => product.stock <= product.minStock);

  /** A fresh open always starts blank; this must not re-run when `products` reloads. */
  useEffect(() => {
    if (!open) return;
    setBranchId(lockedBranchId ?? "");
    setPriority("normal");
    setNeededDate("");
    setNotes("");
    setSelectedProduct("");
    setSelectedUnit("Pcs");
    setQuantity("");
    setRows([]);
  }, [open, lockedBranchId]);

  /**
   * `?product=` prefill from a low-stock row.
   *
   * The orders page opens this dialog from a query string on its first render,
   * before the product list has finished loading — so the line is added here,
   * once the catalogue actually contains the product, instead of inside the
   * reset above where it would find nothing and leave a blank form. Adding is
   * idempotent: re-running with the same product (a reloaded catalogue) must not
   * duplicate the line.
   */
  useEffect(() => {
    if (!open || !prefill?.productId) return;
    const product = products.find((item) => item.id === prefill.productId);
    if (!product) return;

    // The gudang shortage is measured in base units, and every product carries
    // exactly one factor-1 unit to express them with.
    const shortfall = Math.max(product.minStock - product.stock, prefill.quantity ?? 0, 1);
    const baseUnit = product.units.find((item) => item.conversion_factor === 1) ?? product.units[0];

    setRows((current) => {
      if (current.some((row) => row.productId === product.id)) return current;
      return [
        ...current,
        {
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          quantity: shortfall,
          unitName: baseUnit?.name ?? "Pcs",
          conversionFactor: 1,
          baseQuantity: shortfall,
          warehouseStock: product.stock,
          minStock: product.minStock,
        },
      ];
    });
  }, [open, prefill, products]);

  const selectedBranch = branches.find((branch) => branch.id === branchId) ?? null;
  const selectedProductObj = products.find((product) => product.id === selectedProduct) ?? null;

  const handleAddRow = () => {
    if (!selectedProductObj) {
      toast.error("Pilih produk terlebih dahulu");
      return;
    }
    const parsed = Number(quantity);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast.error("Jumlah harus lebih dari nol");
      return;
    }

    const unit = selectedProductObj.units.find((item) => item.name === selectedUnit);
    const conversionFactor = unit?.conversion_factor ?? 1;
    const baseQuantity = parsed * conversionFactor;

    const existing = rows.find(
      (row) => row.productId === selectedProductObj.id && row.unitName === selectedUnit
    );
    if (existing) {
      setRows(
        rows.map((row) =>
          row === existing
            ? {
                ...row,
                quantity: row.quantity + parsed,
                baseQuantity: row.baseQuantity + baseQuantity,
              }
            : row
        )
      );
    } else {
      setRows([
        ...rows,
        {
          productId: selectedProductObj.id,
          productName: selectedProductObj.name,
          sku: selectedProductObj.sku,
          quantity: parsed,
          unitName: selectedUnit,
          conversionFactor,
          baseQuantity,
          warehouseStock: selectedProductObj.stock,
          minStock: selectedProductObj.minStock,
        },
      ]);
    }

    setSelectedProduct("");
    setSelectedUnit("Pcs");
    setQuantity("");
  };

  /**
   * Fills the request with everything the gudang is short of.
   *
   * The shop asks for what it is missing above its own minimum, which is the
   * same figure the low-stock alert shows — no guessing a quantity.
   */
  const handleFillFromMinimum = () => {
    const missing = shortProducts.filter(
      (product) => !rows.some((row) => row.productId === product.id)
    );
    if (missing.length === 0) {
      toast.info("Tidak ada produk stok minimum yang belum ada di pesanan");
      return;
    }

    setRows([
      ...rows,
      ...missing.map((product) => {
        const needed = Math.max(product.minStock - product.stock, 1);
        // Same rule as the low-stock prefill: the shortfall is in base units, so
        // it is expressed with the product's own factor-1 unit rather than "Pcs".
        const baseUnit = product.units.find((item) => item.conversion_factor === 1) ?? product.units[0];
        return {
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          quantity: needed,
          unitName: baseUnit?.name ?? "Pcs",
          conversionFactor: 1,
          baseQuantity: needed,
          warehouseStock: product.stock,
          minStock: product.minStock,
        };
      }),
    ]);
    toast.success(`${missing.length} produk stok minimum ditambahkan`);
  };

  const handleRemoveRow = (productId: string, unitName: string) => {
    setRows(
      rows.filter((row) => !(row.productId === productId && row.unitName === unitName))
    );
  };

  const submitDraft = (submit: boolean) => {
    if (!branchId) {
      toast.error("Pilih cabang pemesan");
      return;
    }
    if (rows.length === 0) {
      toast.error("Tambahkan minimal 1 produk");
      return;
    }

    onSubmit({
      branchId,
      priority,
      neededDate,
      notes: notes.trim(),
      submit,
      items: rows.map((row) => ({
        productId: row.productId,
        quantity: row.baseQuantity,
        unitName: row.unitName,
        conversionFactor: row.conversionFactor,
      })),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="w-5 h-5" />
            Buat Pesanan Cabang
          </DialogTitle>
          <DialogDescription>
            Pesanan dikirim ke gudang pusat; stok baru berpindah saat gudang mengirimnya.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label>Cabang Pemesan *</Label>
              <Select
                value={branchId}
                onValueChange={setBranchId}
                disabled={Boolean(lockedBranchId)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Pilih cabang" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.code ? `${branch.code} · ${branch.name}` : branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {lockedBranchId && (
                <p className="text-xs text-muted-foreground mt-1">
                  Terkunci ke cabang Anda.
                </p>
              )}
            </div>
            <div>
              <Label>Prioritas</Label>
              <Select
                value={priority}
                onValueChange={(value) => setPriority(value as "normal" | "urgent")}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STOCK_REQUEST_PRIORITY_LABEL).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Dibutuhkan Tanggal</Label>
              <Input
                type="date"
                className="mt-1"
                value={neededDate}
                onChange={(event) => setNeededDate(event.target.value)}
              />
            </div>
          </div>

          <div className="border rounded-lg p-4 bg-muted/50">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="text-sm font-medium">Tambah Produk</Label>
              {shortProducts.length > 0 && (
                <Button variant="outline" size="sm" className="gap-1" onClick={handleFillFromMinimum}>
                  <AlertTriangle className="w-3 h-3 text-warning" />
                  Isi dari stok minimum ({shortProducts.length})
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              <Select value={selectedProduct} onValueChange={(value) => {
                setSelectedProduct(value);
                // Default to the product's own base unit: "Pcs" matches no
                // option for a product sold in kg, and the row would then be
                // recorded under a unit the product does not have.
                const picked = products.find((product) => product.id === value);
                setSelectedUnit(picked?.units[0]?.name ?? "Pcs");
              }}>
                <SelectTrigger className="flex-1 min-w-[220px]">
                  <SelectValue placeholder="Pilih produk..." />
                </SelectTrigger>
                <SelectContent>
                  {products.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.name} · {product.sku}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={selectedUnit}
                onValueChange={setSelectedUnit}
                disabled={!selectedProductObj}
              >
                <SelectTrigger className="w-[120px]">
                  <SelectValue placeholder="Satuan" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Pcs">Pcs</SelectItem>
                  {selectedProductObj?.units.map((unit) => (
                    <SelectItem key={unit.name} value={unit.name}>
                      {unit.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Input
                type="number"
                min={1}
                placeholder="Jumlah"
                className="w-28"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
              <Button onClick={handleAddRow}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            {selectedProductObj && (
              <p className="text-xs text-muted-foreground mt-2">
                Stok gudang {selectedProductObj.stock} · stok minimum {selectedProductObj.minStock}
                {selectedProductObj.stock <= selectedProductObj.minStock && " · di bawah minimum"}
              </p>
            )}
          </div>

          {rows.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produk</TableHead>
                    <TableHead className="text-center">Jumlah</TableHead>
                    <TableHead className="text-center">Satuan</TableHead>
                    <TableHead className="text-center">Stok Gudang</TableHead>
                    <TableHead className="text-center">Stok Minimum</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={`${row.productId}-${row.unitName}`}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Package className="w-4 h-4 text-muted-foreground" />
                          <div>
                            <p className="font-medium">{row.productName}</p>
                            <p className="text-xs text-muted-foreground">{row.sku}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary">{row.quantity}</Badge>
                        {row.conversionFactor !== 1 && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {row.baseQuantity} Pcs
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline">{row.unitName}</Badge>
                      </TableCell>
                      <TableCell className="text-center">{row.warehouseStock}</TableCell>
                      <TableCell className="text-center">
                        <span
                          className={
                            row.warehouseStock <= row.minStock ? "text-warning font-medium" : ""
                          }
                        >
                          {row.minStock}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveRow(row.productId, row.unitName)}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div>
            <Label>Catatan</Label>
            <Textarea
              placeholder="Catatan untuk gudang, mis. jam pengiriman atau prioritas rak..."
              className="mt-1"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>

          {selectedBranch && (
            <p className="text-xs text-muted-foreground">
              Pesanan atas nama {selectedBranch.name} dikirim ke gudang pusat.
            </p>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button variant="secondary" className="flex-1" disabled={isSaving} onClick={() => submitDraft(false)}>
            Simpan Draf
          </Button>
          <Button className="flex-1" disabled={isSaving} onClick={() => submitDraft(true)}>
            Kirim ke Gudang
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
