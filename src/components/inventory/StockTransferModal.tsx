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
import { ArrowRight, Package, Plus, Trash2 } from "lucide-react";
import { warehouseLabel, type WarehouseOption } from "@/lib/warehouse";

/**
 * One sellable variant of a product, as a transfer needs it: its own stock per
 * warehouse and its own packs. A carton of one flavour is not the piece of
 * another, so the two have to be picked separately.
 */
export interface TransferVariant {
  id: string;
  /** Human label: "Susu 250ml". */
  label: string;
  sku: string;
  /**
   * On-hand quantity per warehouse id, in base units. Optional because a caller
   * that only knows product-level stock (the branch transfer page) still passes
   * `Product[]`; the picker then falls back to the product figure.
   */
  warehouses?: Record<string, number>;
  units: Array<{ name: string; conversion_factor: number }>;
}

/**
 * What this modal needs from a product.
 *
 * `variants` is optional on purpose: a caller with no variant data (the branch
 * transfer page) keeps working unchanged and moves stock product-wide, which
 * `createTransfer` still accepts.
 */
export interface TransferProduct {
  id: string;
  sku: string;
  name: string;
  unit_type?: string;
  units?: Array<{ name: string; conversion_factor: number }>;
  stock_by_warehouse?: Record<string, number>;
  variants?: TransferVariant[];
}

export interface TransferItem {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitName: string;
  conversionFactor: number;
  availableStock: number; // In selected unit
  /** Which variant moves; null means "the whole product". */
  variantId: string | null;
  variantName: string;
}

interface StockTransferModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: TransferProduct[];
  warehouses: WarehouseOption[];
  onTransfer: (transfer: {
    from: string;
    to: string;
    items: TransferItem[];
    notes: string;
  }) => void;
}

export function StockTransferModal({ open, onOpenChange, products, warehouses, onTransfer }: StockTransferModalProps) {
  const [fromWarehouse, setFromWarehouse] = useState("");
  const [toWarehouse, setToWarehouse] = useState("");
  const [selectedProduct, setSelectedProduct] = useState("");
  const [selectedVariant, setSelectedVariant] = useState("");
  const [selectedUnit, setSelectedUnit] = useState("");
  const [quantity, setQuantity] = useState("");
  const [transferItems, setTransferItems] = useState<TransferItem[]>([]);
  const [notes, setNotes] = useState("");

  const variantsOf = (product: TransferProduct | undefined) => product?.variants ?? [];

  /** Stock of one variant — or of the product as a whole — in one warehouse. */
  const getAvailableStock = (
    product: TransferProduct | undefined,
    warehouseId: string,
    variantId?: string | null
  ) => {
    if (!product) return 0;
    if (variantId) {
      const variant = product.variants?.find((row) => row.id === variantId);
      if (variant) return variant.warehouses?.[warehouseId] ?? product.stock_by_warehouse?.[warehouseId] ?? 0;
    }
    // Keys are warehouse ids.
    return product.stock_by_warehouse?.[warehouseId] ?? 0;
  };

  /**
   * The packs this selection may be moved in. A variant's own packs win; the
   * base unit is always offered so a product with no packs stays movable.
   *
   * Names are unique because they are the `SelectItem` values — two packs that
   * share a name would make the picker ambiguous.
   */
  const unitOptionsFor = (product: TransferProduct | undefined, variantId: string | null) => {
    if (!product) return [];
    const variant = product.variants?.find((row) => row.id === variantId);
    const packs = variant?.units ?? product.units ?? [];
    const baseName = product.unit_type || "Pcs";

    const options: Array<{ name: string; conversion_factor: number }> = [];
    for (const unit of packs) {
      const name = unit.name || baseName;
      if (options.some((option) => option.name === name)) continue;
      options.push({ name, conversion_factor: Number(unit.conversion_factor) || 1 });
    }
    if (!options.some((option) => option.conversion_factor === 1)) {
      options.unshift({ name: baseName, conversion_factor: 1 });
    }
    return options;
  };

  const handleAddItem = () => {
    if (!selectedProduct || !quantity || parseInt(quantity) <= 0) {
      toast.error("Pilih produk dan masukkan jumlah");
      return;
    }

    const product = products.find(p => p.id === selectedProduct);
    if (!product) return;

    // A product with variants must move ONE of them: the packs and the stock
    // available belong to the variant, not to the product as a whole.
    const variants = variantsOf(product);
    const variantId = variants.length > 0 ? selectedVariant || variants[0].id : null;
    const variant = variants.find((row) => row.id === variantId);

    // Determine unit details
    const options = unitOptionsFor(product, variantId);
    const chosen = options.find((option) => option.name === selectedUnit) ?? options[0];
    const unitName = chosen?.name ?? (product.unit_type || "Pcs");
    const conversionFactor = chosen?.conversion_factor ?? 1;

    const baseAvailableStock = getAvailableStock(product, fromWarehouse, variantId);
    const availableStockInUnit = Math.floor(baseAvailableStock / conversionFactor);
    const qty = parseInt(quantity);

    if (qty > availableStockInUnit) {
      toast.error(`Stok tidak mencukupi. Tersedia: ${availableStockInUnit} ${unitName}`);
      return;
    }

    const existingIndex = transferItems.findIndex(item => 
      item.productId === product.id &&
      item.variantId === variantId &&
      item.unitName === unitName
    );

    if (existingIndex >= 0) {
      const updated = [...transferItems];
      const newQty = updated[existingIndex].quantity + qty;
      
      if (newQty > availableStockInUnit) {
        toast.error(`Total stok melebihi batas. Tersedia: ${availableStockInUnit} ${unitName}`);
        return;
      }
      
      updated[existingIndex].quantity = newQty;
      setTransferItems(updated);
    } else {
      setTransferItems([...transferItems, {
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        quantity: qty,
        unitName,
        conversionFactor,
        availableStock: availableStockInUnit,
        variantId,
        variantName: variant?.label ?? "",
      }]);
    }

    setSelectedProduct("");
    setSelectedVariant("");
    setSelectedUnit("");
    setQuantity("");
  };

  const handleRemoveItem = (index: number) => {
    const newItems = [...transferItems];
    newItems.splice(index, 1);
    setTransferItems(newItems);
  };

  const handleSubmit = () => {
    if (!fromWarehouse || !toWarehouse) {
      toast.error("Pilih gudang asal dan tujuan");
      return;
    }

    if (fromWarehouse === toWarehouse) {
      toast.error("Gudang asal dan tujuan tidak boleh sama");
      return;
    }

    if (transferItems.length === 0) {
      toast.error("Tambahkan minimal 1 produk untuk transfer");
      return;
    }

    onTransfer({
      from: fromWarehouse,
      to: toWarehouse,
      items: transferItems,
      notes,
    });

    toast.success("Transfer stok berhasil diproses");
    onOpenChange(false);
    resetForm();
  };

  const resetForm = () => {
    setFromWarehouse("");
    setToWarehouse("");
    setSelectedProduct("");
    setSelectedUnit("");
    setQuantity("");
    setTransferItems([]);
    setNotes("");
  };

  /** Picking a product also picks the variant most likely to be moved. */
  const pickProduct = (productId: string) => {
    setSelectedProduct(productId);
    setSelectedUnit("");
    const product = products.find((p) => p.id === productId);
    const variants = variantsOf(product);
    const withStock = variants.find((row) => getAvailableStock(product, fromWarehouse, row.id) > 0);
    setSelectedVariant(withStock?.id ?? variants[0]?.id ?? "");
  };

  /** A product counts as available when the product or any variant holds stock. */
  const filteredProducts = fromWarehouse 
    ? products.filter(p =>
        (p.stock_by_warehouse?.[fromWarehouse] || 0) > 0 ||
        variantsOf(p).some((row) => getAvailableStock(p, fromWarehouse, row.id) > 0)
      )
    : products;

  const selectedProductData = products.find(p => p.id === selectedProduct);
  const selectedVariants = variantsOf(selectedProductData);
  const activeVariantId = selectedVariant || selectedVariants[0]?.id || null;
  const selectedUnitOptions = unitOptionsFor(selectedProductData, activeVariantId);
  const selectedStock = getAvailableStock(selectedProductData, fromWarehouse, activeVariantId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Transfer Stok</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Warehouse Selection */}
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Label>Dari Gudang</Label>
              <Select value={fromWarehouse} onValueChange={setFromWarehouse}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Pilih gudang asal" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((warehouse) => (
                    <SelectItem key={warehouse.id} value={warehouse.id}>{warehouseLabel(warehouse)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <ArrowRight className="w-5 h-5 text-muted-foreground mt-6" />
            <div className="flex-1">
              <Label>Ke Gudang</Label>
              <Select value={toWarehouse} onValueChange={setToWarehouse}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Pilih gudang tujuan" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.filter((warehouse) => warehouse.id !== fromWarehouse).map((warehouse) => (
                    <SelectItem key={warehouse.id} value={warehouse.id}>{warehouseLabel(warehouse)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Add Product */}
          {fromWarehouse && (
            <div className="border rounded-lg p-4 bg-muted/50">
              <Label className="text-sm font-medium">Tambah Produk</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                <Select value={selectedProduct} onValueChange={pickProduct}>
                  <SelectTrigger className="flex-1 min-w-[200px]">
                    <SelectValue placeholder="Pilih produk" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredProducts.map((product) => (
                      <SelectItem key={product.id} value={product.id.toString()}>
                        {product.name} (Stok: {product.stock_by_warehouse?.[fromWarehouse] || 0})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Only shown when the product actually has variants, so a
                    single-variant catalogue looks exactly as before. */}
                {selectedProductData && selectedVariants.length > 0 && (
                  <Select
                    value={activeVariantId ?? ""}
                    onValueChange={(val) => {
                      setSelectedVariant(val);
                      setSelectedUnit("");
                    }}
                  >
                    <SelectTrigger className="w-[170px]">
                      <SelectValue placeholder="Varian" />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedVariants.map((variant) => (
                        <SelectItem key={variant.id} value={variant.id}>
                          {variant.label} ({getAvailableStock(selectedProductData, fromWarehouse, variant.id)})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {selectedProductData && (
                  <Select
                    value={selectedUnit || selectedUnitOptions[0]?.name || ""}
                    onValueChange={setSelectedUnit}
                  >
                    <SelectTrigger className="w-[120px]">
                      <SelectValue placeholder="Satuan" />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedUnitOptions.map((option) => (
                        <SelectItem key={option.name} value={option.name}>
                          {option.name} ({option.conversion_factor})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                <Input
                  type="number"
                  placeholder="Jml"
                  className="w-24"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
                <Button onClick={handleAddItem}>
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              {selectedProductData && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Stok tersedia di gudang asal: {selectedStock}{" "}
                  {activeVariantId ? "satuan dasar varian ini" : "satuan dasar"}
                </p>
              )}
            </div>
          )}

          {/* Transfer Items */}
          {transferItems.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produk</TableHead>
                    <TableHead className="text-center">Jumlah</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transferItems.map((item, index) => (
                    <TableRow key={`${item.productId}-${item.variantId ?? "all"}-${item.unitName}`}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Package className="w-4 h-4 text-muted-foreground" />
                          <div>
                            <p className="font-medium">{item.productName}</p>
                            <p className="text-xs text-muted-foreground">
                              {item.sku}
                              {item.variantName ? ` · ${item.variantName}` : ""}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary">
                          {item.quantity} {item.unitName}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveItem(index)}
                          type="button"
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

          {/* Notes */}
          <div className="grid gap-2">
            <Label>Catatan (Opsional)</Label>
            <Input
              placeholder="Catatan transfer..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button className="flex-1" onClick={handleSubmit}>
            Proses Transfer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
