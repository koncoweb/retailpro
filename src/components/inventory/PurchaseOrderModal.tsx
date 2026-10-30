import { useEffect, useMemo, useState } from "react";
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Package,
  Plus,
  Trash2,
  AlertTriangle,
  ShoppingCart,
  Check,
  ChevronsUpDown,
  Info,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isRackWarehouse, warehouseLabel, type WarehouseOption } from "@/lib/warehouse";
import { isoToday, validatePurchaseOrder } from "@/lib/procurement";

import { ProductUnit } from "@/components/inventory/AddProductModal";

interface Product {
  id: string;
  sku: string;
  name: string;
  stock: number;
  minStock: number;
  cost: number;
  supplier: string;
  /** Main vendor of the product, plus every vendor linked through vendor_products. */
  supplierId?: string | null;
  vendorIds?: string[];
  /**
   * `vendor_products.last_cost` keyed by vendor, so the order starts from the
   * price this vendor last charged instead of the product's average cost.
   */
  vendorCosts?: Record<string, number>;
  warehouses: Record<string, number>;
  units: ProductUnit[];
}

/** The panel hands over the same product rows the inventory table already holds. */
export type PurchaseOrderProduct = Product;

/** Vendor master fields the purchasing screen needs. */
export interface VendorOption {
  id: string;
  name: string;
  code?: string | null;
  payment_terms_days?: number;
  lead_time_days?: number;
}

export interface PurchaseOrderDraftLine {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitName: string;
  conversionFactor: number;
  unitCost: number;
  subtotal: number;
}

/** Exactly what the editor produces: a draft. Nothing has left the building. */
export interface PurchaseOrderDraftValues {
  supplierId: string;
  supplierName: string;
  /** Copied from the vendor so a later edit to the vendor cannot move old bills. */
  paymentTermsDays: number;
  destinationWarehouseId: string;
  expectedDate: string;
  notes: string;
  items: PurchaseOrderDraftLine[];
  totalAmount: number;
}

interface PurchaseOrderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  /** Active warehouses only — the caller filters with `activeWarehouses()`. */
  warehouses: WarehouseOption[];
  vendors: VendorOption[];
  /** Preselected destination, normally the gudang this branch orders from. */
  defaultWarehouseId?: string | null;
  /** Edit mode: an existing draft, or null to create a new one. */
  initialDraft?: PurchaseOrderDraftValues | null;
  /**
   * Persist the draft. Rejecting keeps the dialog open and shows the message;
   * resolving lets the dialog close. The caller owns the success toast.
   */
  onSubmit: (draft: PurchaseOrderDraftValues, options: { submit: boolean }) => Promise<void>;
}

const BASE_UNIT_FALLBACK = "Pcs";

/** The unit a product is stocked in, used as the default line unit. */
function baseUnitOf(product: Product): { name: string; conversionFactor: number } {
  const base = product.units?.find((unit) => Number(unit.conversion_factor) === 1);
  return { name: base?.name ?? BASE_UNIT_FALLBACK, conversionFactor: 1 };
}

/** `0,5` typed as "0,5" still means half a kilogram. */
function parseNumber(value: string): number {
  return Number(value.replace(",", "."));
}

function hasTooManyDecimals(value: number): boolean {
  return Math.round(value * 1000) !== value * 1000;
}

export function PurchaseOrderModal({
  open,
  onOpenChange,
  products,
  warehouses,
  vendors,
  defaultWarehouseId,
  initialDraft,
  onSubmit,
}: PurchaseOrderModalProps) {
  const [destinationWarehouse, setDestinationWarehouse] = useState("");
  const [selectedProduct, setSelectedProduct] = useState("");
  const [selectedUnit, setSelectedUnit] = useState("");
  const [quantity, setQuantity] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [items, setItems] = useState<PurchaseOrderDraftLine[]>([]);
  const [notes, setNotes] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [selectedVendor, setSelectedVendor] = useState("");
  const [openCombobox, setOpenCombobox] = useState(false);
  const [saving, setSaving] = useState<"draft" | "submit" | null>(null);

  const lowStockProducts = products.filter((product) => product.stock <= product.minStock);

  const vendorOf = (id: string) => vendors.find((vendor) => vendor.id === id) ?? null;

  /** Does this product come from the selected vendor (main vendor or linked)? */
  const belongsToVendor = (product: Product, vendorId: string) =>
    product.supplierId === vendorId || (product.vendorIds ?? []).includes(vendorId);

  const filteredProducts = selectedVendor
    ? products.filter((product) => belongsToVendor(product, selectedVendor))
    : products;

  const selectedProductObj = products.find((product) => product.id === selectedProduct);
  const selectedWarehouse = warehouses.find((warehouse) => warehouse.id === destinationWarehouse) ?? null;

  /** What this vendor charges for the product's base unit. */
  const baseCostOf = (product: Product): number => {
    const lastCost = selectedVendor ? product.vendorCosts?.[selectedVendor] : undefined;
    return Number(lastCost ?? product.cost ?? 0);
  };

  /** Unit price for the chosen unit: the base cost times its conversion. */
  const unitCostOf = (product: Product, unitName: string): number => {
    const unit = product.units?.find((candidate) => candidate.name === unitName);
    const factor = Number(unit?.conversion_factor ?? 1) || 1;
    return Math.round(baseCostOf(product) * factor);
  };

  // Re-seed on every open: a dialog that keeps the previous order's lines is how
  // duplicate purchase orders get created by accident.
  useEffect(() => {
    if (!open) return;
    if (initialDraft) {
      setSelectedVendor(initialDraft.supplierId);
      setDestinationWarehouse(initialDraft.destinationWarehouseId);
      setExpectedDate(initialDraft.expectedDate);
      setNotes(initialDraft.notes);
      setItems(initialDraft.items);
    } else {
      setSelectedVendor("");
      setDestinationWarehouse(defaultWarehouseId ?? "");
      setExpectedDate("");
      setNotes("");
      setItems([]);
    }
    setSelectedProduct("");
    setSelectedUnit("");
    setQuantity("");
    setCostPrice("");
    setSaving(null);
  }, [open, initialDraft, defaultWarehouseId]);

  const totalAmount = useMemo(
    () => items.reduce((sum, item) => sum + item.subtotal, 0),
    [items]
  );

  const unitOptions = useMemo(() => {
    const names = (selectedProductObj?.units ?? []).map((unit) => unit.name);
    const base = baseUnitOf(selectedProductObj ?? ({ units: [] } as unknown as Product)).name;
    return Array.from(new Set([base, ...names]));
  }, [selectedProductObj]);

  const handleSelectProduct = (product: Product) => {
    setSelectedProduct(product.id);
    const base = baseUnitOf(product);
    setSelectedUnit(base.name);
    setCostPrice(String(baseCostOf(product)));
    setOpenCombobox(false);
  };

  const handleSelectUnit = (unitName: string) => {
    setSelectedUnit(unitName);
    if (selectedProductObj) setCostPrice(String(unitCostOf(selectedProductObj, unitName)));
  };

  const handleAddItem = () => {
    if (!selectedProductObj) {
      toast.error("Pilih produk terlebih dahulu");
      return;
    }

    const qty = parseNumber(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("Jumlah harus lebih dari 0");
      return;
    }
    if (hasTooManyDecimals(qty)) {
      toast.error("Jumlah maksimal 3 angka di belakang koma");
      return;
    }

    const unitName = selectedUnit || baseUnitOf(selectedProductObj).name;
    const unit = selectedProductObj.units?.find((candidate) => candidate.name === unitName);
    const conversionFactor = Number(unit?.conversion_factor ?? 1) || 1;
    const cost = costPrice.trim() ? parseNumber(costPrice) : unitCostOf(selectedProductObj, unitName);
    if (!Number.isFinite(cost) || cost < 0) {
      toast.error("Harga satuan tidak valid");
      return;
    }

    const existing = items.findIndex(
      (item) => item.productId === selectedProductObj.id && item.unitName === unitName
    );
    if (existing >= 0) {
      const next = [...items];
      const merged = next[existing].quantity + qty;
      next[existing] = {
        ...next[existing],
        quantity: merged,
        unitCost: cost,
        subtotal: Math.round(merged * cost),
      };
      setItems(next);
    } else {
      setItems([
        ...items,
        {
          productId: selectedProductObj.id,
          productName: selectedProductObj.name,
          sku: selectedProductObj.sku,
          quantity: qty,
          unitName,
          conversionFactor,
          unitCost: cost,
          subtotal: Math.round(qty * cost),
        },
      ]);
    }

    setSelectedProduct("");
    setSelectedUnit("");
    setQuantity("");
    setCostPrice("");
  };

  const handleRemoveItem = (productId: string, unitName: string) => {
    setItems((current) =>
      current.filter((item) => !(item.productId === productId && item.unitName === unitName))
    );
  };

  /**
   * "Tambahkan Semua" fills the destination's shortfall, priced at this
   * vendor's last cost and in the product's own base unit — the old version
   * assumed every product was `Pcs` at the average cost.
   */
  const handleAutoFillLowStock = () => {
    if (!destinationWarehouse) {
      toast.error("Pilih gudang tujuan terlebih dahulu");
      return;
    }

    const additions: PurchaseOrderDraftLine[] = [];
    for (const product of lowStockProducts) {
      if (selectedVendor && !belongsToVendor(product, selectedVendor)) continue;
      const locationStock = product.warehouses[destinationWarehouse] || 0;
      const needed = product.minStock - locationStock;
      if (needed <= 0) continue;
      if (items.some((item) => item.productId === product.id)) continue;

      const base = baseUnitOf(product);
      const unitCost = unitCostOf(product, base.name);
      const ordered = Math.max(needed, product.minStock);
      additions.push({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        quantity: ordered,
        unitName: base.name,
        conversionFactor: base.conversionFactor,
        unitCost,
        subtotal: Math.round(ordered * unitCost),
      });
    }

    if (additions.length > 0) {
      setItems((current) => [...current, ...additions]);
      toast.success(`${additions.length} produk stok rendah ditambahkan`);
    } else {
      toast.info("Tidak ada produk stok rendah yang perlu ditambahkan");
    }
  };

  const handleSave = async (submit: boolean) => {
    if (saving) return;

    const vendor = vendorOf(selectedVendor);
    if (!vendor) {
      toast.error("Pilih vendor terlebih dahulu");
      return;
    }

    const draft: PurchaseOrderDraftValues = {
      supplierId: vendor.id,
      supplierName: vendor.name,
      paymentTermsDays: Number(vendor.payment_terms_days ?? 0),
      destinationWarehouseId: destinationWarehouse,
      expectedDate,
      notes: notes.trim(),
      items,
      totalAmount,
    };

    // Same guards the write path applies, evaluated before anything is sent.
    const invalid = validatePurchaseOrder(
      {
        supplierId: draft.supplierId,
        destinationWarehouseId: draft.destinationWarehouseId,
        expectedDate: draft.expectedDate || null,
        items: items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          unitName: item.unitName,
          conversionFactor: item.conversionFactor,
          unitCost: item.unitCost,
        })),
      },
      isoToday()
    );
    if (invalid) {
      toast.error(invalid);
      return;
    }

    setSaving(submit ? "submit" : "draft");
    try {
      await onSubmit(draft, { submit });
      onOpenChange(false);
    } catch (error) {
      // A partial write is impossible here (one transaction), so the draft is
      // still intact and the operator can simply retry.
      toast.error(error instanceof Error ? error.message : "Gagal menyimpan purchase order");
    } finally {
      setSaving(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5" />
            {initialDraft ? "Ubah Draf Purchase Order" : "Buat Purchase Order"}
          </DialogTitle>
          <DialogDescription>
            Nomor PO dibuat otomatis saat disimpan. Mengajukan tidak memindahkan stok — barang
            baru masuk lewat penerimaan barang.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {lowStockProducts.length > 0 && (
            <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-warning" />
                <span className="text-sm">
                  <strong>{lowStockProducts.length}</strong> produk stok rendah
                </span>
              </div>
              <Button variant="outline" size="sm" onClick={handleAutoFillLowStock}>
                Tambahkan Semua
              </Button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label>Gudang Tujuan *</Label>
              <Select value={destinationWarehouse} onValueChange={setDestinationWarehouse}>
                <SelectTrigger className="mt-1">
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
              {selectedWarehouse && isRackWarehouse(selectedWarehouse) && (
                <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
                  <Info className="w-3 h-3 mt-0.5 shrink-0" />
                  Penerimaan langsung ke rak — stok tidak melewati gudang.
                </p>
              )}
            </div>
            <div>
              <Label>Vendor *</Label>
              <Select
                value={selectedVendor}
                onValueChange={(value) => {
                  setSelectedVendor(value);
                  const vendor = vendorOf(value);
                  const leadTime = Number(vendor?.lead_time_days ?? 0);
                  if (leadTime > 0 && !expectedDate) {
                    const date = new Date();
                    date.setDate(date.getDate() + leadTime);
                    setExpectedDate(date.toISOString().slice(0, 10));
                  }
                  // Lines belonging to another vendor can no longer be ordered
                  // from this one.
                  setItems((current) =>
                    current.filter((item) => {
                      const product = products.find((candidate) => candidate.id === item.productId);
                      return product ? belongsToVendor(product, value) : false;
                    })
                  );
                }}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Pilih vendor" />
                </SelectTrigger>
                <SelectContent>
                  {vendors.map((vendor) => (
                    <SelectItem key={vendor.id} value={vendor.id}>
                      {vendor.code ? `${vendor.code} · ${vendor.name}` : vendor.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {vendorOf(selectedVendor) && (
                <p className="text-xs text-muted-foreground mt-1">
                  Termin {Number(vendorOf(selectedVendor)?.payment_terms_days ?? 0)} hari · Lead
                  time {Number(vendorOf(selectedVendor)?.lead_time_days ?? 0)} hari
                </p>
              )}
            </div>
            <div>
              <Label>Tanggal Diharapkan</Label>
              <Input
                type="date"
                className="mt-1"
                value={expectedDate}
                onChange={(event) => setExpectedDate(event.target.value)}
              />
            </div>
          </div>

          <div className="border rounded-lg p-4 bg-muted/50">
            <Label className="text-sm font-medium">Tambah Produk</Label>
            <div className="flex gap-2 mt-2">
              <Popover open={openCombobox} onOpenChange={setOpenCombobox}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={openCombobox}
                    className="flex-1 justify-between"
                  >
                    {selectedProduct
                      ? filteredProducts.find((product) => product.id === selectedProduct)?.name
                      : "Pilih produk..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[300px] p-0">
                  <Command>
                    <CommandInput placeholder="Cari produk..." />
                    <CommandList>
                      <CommandEmpty>Produk tidak ditemukan.</CommandEmpty>
                      <CommandGroup>
                        {filteredProducts.map((product) => (
                          <CommandItem
                            key={product.id}
                            value={product.name}
                            onSelect={() => handleSelectProduct(product)}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                selectedProduct === product.id ? "opacity-100" : "opacity-0"
                              )}
                            />
                            <div className="flex flex-col">
                              <span className="flex items-center gap-2">
                                {product.name}
                                {product.stock <= product.minStock && (
                                  <AlertTriangle className="w-3 h-3 text-warning" />
                                )}
                              </span>
                              <span className="text-xs text-muted-foreground">{product.sku}</span>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              <Select value={selectedUnit} onValueChange={handleSelectUnit} disabled={!selectedProduct}>
                <SelectTrigger className="w-[120px]">
                  <SelectValue placeholder="Satuan" />
                </SelectTrigger>
                <SelectContent>
                  {unitOptions.map((unitName) => (
                    <SelectItem key={unitName} value={unitName}>
                      {unitName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Input
                type="number"
                step="0.001"
                min="0"
                placeholder="Harga Satuan"
                className="w-32"
                value={costPrice}
                onChange={(event) => setCostPrice(event.target.value)}
              />
              <Input
                type="number"
                step="0.001"
                min="0"
                placeholder="Jumlah"
                className="w-24"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
              <Button onClick={handleAddItem}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {items.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produk</TableHead>
                    <TableHead className="text-center">Qty</TableHead>
                    <TableHead className="text-center">Satuan</TableHead>
                    <TableHead className="text-right">Harga Satuan</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={`${item.productId}-${item.unitName}`}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Package className="w-4 h-4 text-muted-foreground" />
                          <div>
                            <p className="font-medium">{item.productName}</p>
                            <p className="text-xs text-muted-foreground">{item.sku}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary">{Number(item.quantity.toFixed(3))}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline">{item.unitName}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        Rp {item.unitCost.toLocaleString("id-ID")}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        Rp {item.subtotal.toLocaleString("id-ID")}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveItem(item.productId, item.unitName)}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/50">
                    <TableCell colSpan={4} className="text-right font-semibold">
                      Total PO:
                    </TableCell>
                    <TableCell className="text-right font-bold text-lg">
                      Rp {totalAmount.toLocaleString("id-ID")}
                    </TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}

          <div>
            <Label>Catatan</Label>
            <Textarea
              placeholder="Catatan untuk PO ini..."
              className="mt-1"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => handleSave(false)}
            disabled={saving !== null}
          >
            {saving === "draft" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Simpan Draf
          </Button>
          <Button className="flex-1" onClick={() => handleSave(true)} disabled={saving !== null}>
            {saving === "submit" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Simpan & Ajukan
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
