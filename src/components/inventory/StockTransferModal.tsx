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

interface Product {
  id: number;
  sku: string;
  name: string;
  stock: number;
  branches: Record<string, number>;
}

interface TransferItem {
  productId: number;
  productName: string;
  sku: string;
  quantity: number;
  availableStock: number;
}

interface StockTransferModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  onTransfer: (transfer: {
    from: string;
    to: string;
    items: TransferItem[];
    notes: string;
  }) => void;
}

const locations = [
  { id: "pusat", name: "Gudang Pusat" },
  { id: "jakarta", name: "Cabang Jakarta" },
  { id: "surabaya", name: "Cabang Surabaya" },
  { id: "bandung", name: "Cabang Bandung" },
  { id: "medan", name: "Cabang Medan" },
];

export function StockTransferModal({ open, onOpenChange, products, onTransfer }: StockTransferModalProps) {
  const [fromLocation, setFromLocation] = useState("");
  const [toLocation, setToLocation] = useState("");
  const [selectedProduct, setSelectedProduct] = useState("");
  const [quantity, setQuantity] = useState("");
  const [transferItems, setTransferItems] = useState<TransferItem[]>([]);
  const [notes, setNotes] = useState("");

  const getAvailableStock = (productId: number, location: string) => {
    const product = products.find(p => p.id === productId);
    if (!product) return 0;
    return product.branches[location] || 0;
  };

  const handleAddItem = () => {
    if (!selectedProduct || !quantity || parseInt(quantity) <= 0) {
      toast.error("Pilih produk dan masukkan jumlah");
      return;
    }

    const product = products.find(p => p.id === parseInt(selectedProduct));
    if (!product) return;

    const availableStock = getAvailableStock(product.id, fromLocation);
    const qty = parseInt(quantity);

    if (qty > availableStock) {
      toast.error(`Stok tidak mencukupi. Tersedia: ${availableStock}`);
      return;
    }

    const existingIndex = transferItems.findIndex(item => item.productId === product.id);
    if (existingIndex >= 0) {
      const updated = [...transferItems];
      updated[existingIndex].quantity += qty;
      setTransferItems(updated);
    } else {
      setTransferItems([...transferItems, {
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        quantity: qty,
        availableStock,
      }]);
    }

    setSelectedProduct("");
    setQuantity("");
  };

  const handleRemoveItem = (productId: number) => {
    setTransferItems(transferItems.filter(item => item.productId !== productId));
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
    setQuantity("");
    setTransferItems([]);
    setNotes("");
  };

  const filteredProducts = fromLocation 
    ? products.filter(p => (p.branches[fromLocation] || 0) > 0)
    : products;

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
                  {locations.map((loc) => (
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
                  {locations.filter(loc => loc.id !== fromLocation).map((loc) => (
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
                <Select value={selectedProduct} onValueChange={setSelectedProduct}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Pilih produk" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredProducts.map((product) => (
                      <SelectItem key={product.id} value={product.id.toString()}>
                        {product.name} (Stok: {product.branches[fromLocation] || 0})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  placeholder="Jumlah"
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
                  {transferItems.map((item) => (
                    <TableRow key={item.productId}>
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
                        <Badge variant="secondary">{item.quantity} unit</Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveItem(item.productId)}
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
