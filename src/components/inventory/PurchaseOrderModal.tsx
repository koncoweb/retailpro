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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Package, Plus, Trash2, AlertTriangle, ShoppingCart } from "lucide-react";

import { ProductUnit } from "@/components/inventory/AddProductModal";

interface Product {
  id: string;
  sku: string;
  name: string;
  stock: number;
  minStock: number;
  cost: number;
  supplier: string;
  branches: Record<string, number>;
  units: ProductUnit[];
}

interface POItem {
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitName: string;
  conversionFactor: number;
  unitCost: number;
  totalCost: number;
  supplier: string;
}

interface PurchaseOrderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  branches: Array<{ id: string; name: string }>;
  onSubmit: (po: {
    poNumber: string;
    supplier: string;
    destination: string;
    items: POItem[];
    notes: string;
    expectedDate: string;
    totalAmount: number;
  }) => void;
}

export function PurchaseOrderModal({ open, onOpenChange, products, branches, onSubmit }: PurchaseOrderModalProps) {
  const [destination, setDestination] = useState("");
  const [selectedProduct, setSelectedProduct] = useState("");
  const [selectedUnit, setSelectedUnit] = useState("");
  const [quantity, setQuantity] = useState("");
  const [poItems, setPOItems] = useState<POItem[]>([]);
  const [notes, setNotes] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [selectedSupplier, setSelectedSupplier] = useState("");

  // Get low stock products
  const lowStockProducts = products.filter(p => p.stock <= p.minStock);
  
  // Get unique suppliers
  const suppliers = [...new Set(products.map(p => p.supplier))].filter(Boolean);

  const generatePONumber = () => {
    const date = new Date();
    return `PO-${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
  };

  const handleAddItem = () => {
    if (!selectedProduct || !quantity || parseInt(quantity) <= 0) {
      toast.error("Pilih produk dan masukkan jumlah");
      return;
    }

    const product = products.find(p => p.id === selectedProduct);
    if (!product) return;

    // Find selected unit or default to first unit/Pcs
    let unitName = selectedUnit || "Pcs";
    let conversionFactor = 1;
    let unitCost = product.cost;

    if (selectedUnit && selectedUnit !== "Pcs" && product.units) {
      const unit = product.units.find(u => u.name === selectedUnit);
      if (unit) {
        unitName = unit.name;
        conversionFactor = unit.conversion_factor;
        unitCost = product.cost * unit.conversion_factor;
      }
    }

    const qty = parseInt(quantity);
    const totalCost = qty * unitCost;

    const existingIndex = poItems.findIndex(item => 
      item.productId === product.id && item.unitName === unitName
    );
    
    if (existingIndex >= 0) {
      const updated = [...poItems];
      updated[existingIndex].quantity += qty;
      updated[existingIndex].totalCost = updated[existingIndex].quantity * unitCost;
      setPOItems(updated);
    } else {
      setPOItems([...poItems, {
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        quantity: qty,
        unitName,
        conversionFactor,
        unitCost,
        totalCost,
        supplier: product.supplier,
      }]);
    }

    setSelectedProduct("");
    setSelectedUnit("");
    setQuantity("");
  };

  const handleRemoveItem = (productId: string, unitName: string) => {
    setPOItems(poItems.filter(item => !(item.productId === productId && item.unitName === unitName)));
  };

  const handleAutoFillLowStock = () => {
    if (!destination) {
      toast.error("Pilih lokasi tujuan terlebih dahulu");
      return;
    }

    const itemsToAdd: POItem[] = [];
    lowStockProducts.forEach(product => {
      const locationStock = product.branches[destination] || 0;
      const needed = product.minStock - locationStock;
      if (needed > 0) {
        const existing = poItems.find(item => item.productId === product.id);
        if (!existing) {
          itemsToAdd.push({
            productId: product.id,
            productName: product.name,
            sku: product.sku,
            quantity: Math.max(needed, product.minStock), // Order at least minStock amount
            unitName: "Pcs",
            conversionFactor: 1,
            unitCost: product.cost,
            totalCost: Math.max(needed, product.minStock) * product.cost,
            supplier: product.supplier,
          });
        }
      }
    });

    if (itemsToAdd.length > 0) {
      setPOItems([...poItems, ...itemsToAdd]);
      toast.success(`${itemsToAdd.length} produk stok rendah ditambahkan`);
    } else {
      toast.info("Tidak ada produk stok rendah yang perlu ditambahkan");
    }
  };

  const handleSubmit = () => {
    if (!destination) {
      toast.error("Pilih lokasi tujuan");
      return;
    }

    if (poItems.length === 0) {
      toast.error("Tambahkan minimal 1 produk");
      return;
    }

    const totalAmount = poItems.reduce((sum, item) => sum + item.totalCost, 0);

    onSubmit({
      poNumber: generatePONumber(),
      supplier: selectedSupplier || "Multiple Suppliers",
      destination,
      items: poItems,
      notes,
      expectedDate,
      totalAmount,
    });

    toast.success("Purchase Order berhasil dibuat");
    onOpenChange(false);
    resetForm();
  };

  const resetForm = () => {
    setDestination("");
    setSelectedProduct("");
    setQuantity("");
    setPOItems([]);
    setNotes("");
    setExpectedDate("");
    setSelectedSupplier("");
  };

  const totalAmount = poItems.reduce((sum, item) => sum + item.totalCost, 0);

  const filteredProducts = selectedSupplier 
    ? products.filter(p => p.supplier === selectedSupplier)
    : products;

  const selectedProductObj = products.find(p => p.id === selectedProduct);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5" />
            Buat Purchase Order
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Low Stock Alert */}
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

          {/* Form Fields */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label>Lokasi Tujuan *</Label>
              <Select value={destination} onValueChange={setDestination}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Pilih lokasi" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Filter Supplier</Label>
              <Select value={selectedSupplier} onValueChange={setSelectedSupplier}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Semua supplier" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Semua Supplier</SelectItem>
                  {suppliers.map((supplier) => (
                    <SelectItem key={supplier} value={supplier}>{supplier}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tanggal Diharapkan</Label>
              <Input
                type="date"
                className="mt-1"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
              />
            </div>
          </div>

          {/* Add Product */}
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
                      <div className="flex items-center gap-2">
                        {product.stock <= product.minStock && (
                          <AlertTriangle className="w-3 h-3 text-warning" />
                        )}
                        <span>{product.name}</span>
                        <span className="text-muted-foreground">({product.sku})</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select 
                value={selectedUnit} 
                onValueChange={setSelectedUnit}
                disabled={!selectedProduct}
              >
                <SelectTrigger className="w-[120px]">
                  <SelectValue placeholder="Satuan" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Pcs">Pcs</SelectItem>
                  {selectedProductObj?.units?.map((unit) => (
                    <SelectItem key={unit.name} value={unit.name}>
                      {unit.name}
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

          {/* PO Items */}
          {poItems.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produk</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead className="text-center">Qty</TableHead>
                    <TableHead className="text-center">Satuan</TableHead>
                    <TableHead className="text-right">Harga Satuan</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {poItems.map((item, idx) => (
                    <TableRow key={`${item.productId}-${item.unitName}-${idx}`}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Package className="w-4 h-4 text-muted-foreground" />
                          <div>
                            <p className="font-medium">{item.productName}</p>
                            <p className="text-xs text-muted-foreground">{item.sku}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">{item.supplier}</span>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary">{item.quantity}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline">{item.unitName}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        Rp {item.unitCost.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        Rp {item.totalCost.toLocaleString()}
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
                    <TableCell colSpan={5} className="text-right font-semibold">
                      Total Amount:
                    </TableCell>
                    <TableCell className="text-right font-bold text-lg">
                      Rp {totalAmount.toLocaleString()}
                    </TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}

          {/* Notes */}
          <div>
            <Label>Catatan</Label>
            <Textarea
              placeholder="Catatan untuk PO ini..."
              className="mt-1"
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
            Buat Purchase Order
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
