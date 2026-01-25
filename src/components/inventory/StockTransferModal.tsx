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
import { Product, ProductUnit } from "@/types";

interface TransferItem {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitName: string;
  conversionFactor: number;
  availableStock: number; // In selected unit
}

interface StockTransferModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  branches: Array<{ id: string; name: string }>;
  onTransfer: (transfer: {
    from: string;
    to: string;
    items: TransferItem[];
    notes: string;
  }) => void;
}

export function StockTransferModal({ open, onOpenChange, products, branches, onTransfer }: StockTransferModalProps) {
  const [fromLocation, setFromLocation] = useState("");
  const [toLocation, setToLocation] = useState("");
  const [selectedProduct, setSelectedProduct] = useState("");
  const [selectedUnit, setSelectedUnit] = useState("");
  const [quantity, setQuantity] = useState("");
  const [transferItems, setTransferItems] = useState<TransferItem[]>([]);
  const [notes, setNotes] = useState("");

  const getAvailableStock = (productId: string, location: string) => {
    const product = products.find(p => p.id === productId);
    if (!product) return 0;
    // stock_by_branch keys might vary, assuming ID matches location ID
    return product.stock_by_branch?.[location] || 0;
  };

  const handleAddItem = () => {
    if (!selectedProduct || !quantity || parseInt(quantity) <= 0) {
      toast.error("Pilih produk dan masukkan jumlah");
      return;
    }

    const product = products.find(p => p.id === selectedProduct);
    if (!product) return;

    // Determine unit details
    let unitName = product.unit_type || "Pcs";
    let conversionFactor = 1;

    if (selectedUnit) {
      const unit = product.units?.find(u => u.name === selectedUnit);
      if (unit) {
        unitName = unit.name;
        conversionFactor = unit.conversion_factor;
      }
    }

    const baseAvailableStock = getAvailableStock(product.id, fromLocation);
    const availableStockInUnit = Math.floor(baseAvailableStock / conversionFactor);
    const qty = parseInt(quantity);

    if (qty > availableStockInUnit) {
      toast.error(`Stok tidak mencukupi. Tersedia: ${availableStockInUnit} ${unitName}`);
      return;
    }

    const existingIndex = transferItems.findIndex(item => 
      item.productId === product.id && item.unitName === unitName
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
      }]);
    }

    setSelectedProduct("");
    setSelectedUnit("");
    setQuantity("");
  };

  const handleRemoveItem = (index: number) => {
    const newItems = [...transferItems];
    newItems.splice(index, 1);
    setTransferItems(newItems);
  };

  const handleSubmit = () => {
    if (!fromLocation || !toLocation) {
      toast.error("Pilih lokasi asal dan tujuan");
      return;
    }

    if (fromLocation === toLocation) {
      toast.error("Lokasi asal dan tujuan tidak boleh sama");
      return;
    }

    if (transferItems.length === 0) {
      toast.error("Tambahkan minimal 1 produk untuk transfer");
      return;
    }

    onTransfer({
      from: fromLocation,
      to: toLocation,
      items: transferItems,
      notes,
    });

    toast.success("Transfer stok berhasil diproses");
    onOpenChange(false);
    resetForm();
  };

  const resetForm = () => {
    setFromLocation("");
    setToLocation("");
    setSelectedProduct("");
    setSelectedUnit("");
    setQuantity("");
    setTransferItems([]);
    setNotes("");
  };

  const filteredProducts = fromLocation 
    ? products.filter(p => (p.stock_by_branch?.[fromLocation] || 0) > 0)
    : products;

  const selectedProductData = products.find(p => p.id === selectedProduct);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Transfer Stok</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Location Selection */}
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Label>Dari Lokasi</Label>
              <Select value={fromLocation} onValueChange={setFromLocation}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Pilih lokasi asal" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <ArrowRight className="w-5 h-5 text-muted-foreground mt-6" />
            <div className="flex-1">
              <Label>Ke Lokasi</Label>
              <Select value={toLocation} onValueChange={setToLocation}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Pilih lokasi tujuan" />
                </SelectTrigger>
                <SelectContent>
                  {branches.filter(loc => loc.id !== fromLocation).map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Add Product */}
          {fromLocation && (
            <div className="border rounded-lg p-4 bg-muted/50">
              <Label className="text-sm font-medium">Tambah Produk</Label>
              <div className="flex gap-2 mt-2">
                <Select value={selectedProduct} onValueChange={(val) => {
                  setSelectedProduct(val);
                  setSelectedUnit(""); // Reset unit when product changes
                }}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Pilih produk" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredProducts.map((product) => (
                      <SelectItem key={product.id} value={product.id.toString()}>
                        {product.name} (Stok: {product.stock_by_branch?.[fromLocation] || 0})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {selectedProductData && (
                  <Select value={selectedUnit} onValueChange={setSelectedUnit}>
                    <SelectTrigger className="w-[120px]">
                      <SelectValue placeholder="Satuan" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={selectedProductData.unit_type || "Pcs"}>
                        {selectedProductData.unit_type || "Pcs"} (1)
                      </SelectItem>
                      {selectedProductData.units?.map((u) => (
                        <SelectItem key={u.name} value={u.name}>
                          {u.name} ({u.conversion_factor})
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
