import { useState, useEffect } from "react";
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
import { toast } from "sonner";
import { Trash2, Plus } from "lucide-react";

export interface ProductUnit {
  id?: string;
  name: string;
  conversion_factor: number;
  price: number;
  barcode: string;
}

interface AddProductModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (product: {
    sku: string;
    name: string;
    category: string;
    price: number; // Base unit price
    cost: number;
    stock: number;
    minStock: number;
    supplier: string;
    branches: Record<string, number>;
    units: ProductUnit[];
  }) => void;
  categories: string[];
  branches: { id: string; name: string }[];
  mode?: "add" | "edit";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialData?: any;
}

export function AddProductModal({ 
  open, 
  onOpenChange, 
  onAdd, 
  categories, 
  branches, 
  mode = "add", 
  initialData 
}: AddProductModalProps) {
  const [formData, setFormData] = useState({
    sku: "",
    name: "",
    category: "",
    price: "",
    cost: "",
    minStock: "",
    supplier: "",
  });
  const [branchStocks, setBranchStocks] = useState<Record<string, string>>({});
  const [units, setUnits] = useState<ProductUnit[]>([
    { name: "Pcs", conversion_factor: 1, price: 0, barcode: "" }
  ]);

  useEffect(() => {
    if (initialData && mode === "edit") {
      setFormData({
        sku: initialData.sku,
        name: initialData.name,
        category: initialData.category,
        price: initialData.price.toString(),
        cost: initialData.cost.toString(),
        minStock: initialData.minStock.toString(),
        supplier: initialData.supplier,
      });
      const stocks: Record<string, string> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const branchData = initialData.branches || {};
      Object.entries(branchData).forEach(([key, value]) => {
        stocks[key] = String(value);
      });
      setBranchStocks(stocks);
      
      // Load units if available in initialData
      if (initialData.units && Array.isArray(initialData.units)) {
        setUnits(initialData.units);
      } else {
        // Default unit if none
        setUnits([{ name: "Pcs", conversion_factor: 1, price: initialData.price || 0, barcode: "" }]);
      }
    } else if (mode === "add" && open) {
      setFormData({ sku: "", name: "", category: "", price: "", cost: "", minStock: "", supplier: "" });
      setBranchStocks({});
      setUnits([{ name: "Pcs", conversion_factor: 1, price: 0, barcode: "" }]);
    }
  }, [initialData, mode, open]);

  // Sync base price with first unit price
  useEffect(() => {
    if (units.length > 0 && formData.price) {
      const basePrice = parseFloat(formData.price);
      if (units[0].price !== basePrice) {
        const newUnits = [...units];
        newUnits[0] = { ...newUnits[0], price: basePrice };
        setUnits(newUnits);
      }
    }
  }, [formData.price]);

  const handleUnitChange = (index: number, field: keyof ProductUnit, value: string | number) => {
    const newUnits = [...units];
    newUnits[index] = { ...newUnits[index], [field]: value };
    setUnits(newUnits);

    // If changing base unit price, sync with main price field
    if (index === 0 && field === 'price') {
      setFormData(prev => ({ ...prev, price: value.toString() }));
    }
  };

  const addUnit = () => {
    setUnits([...units, { name: "", conversion_factor: 1, price: 0, barcode: "" }]);
  };

  const removeUnit = (index: number) => {
    if (index === 0) return; // Cannot remove base unit
    const newUnits = units.filter((_, i) => i !== index);
    setUnits(newUnits);
  };

  const handleSubmit = () => {
    if (!formData.sku || !formData.name || !formData.category) {
      toast.error("Mohon lengkapi data produk");
      return;
    }

    const branchStockNumbers: Record<string, number> = {};
    let totalStock = 0;
    Object.entries(branchStocks).forEach(([key, value]) => {
      const num = parseInt(value) || 0;
      branchStockNumbers[key] = num;
      totalStock += num;
    });

    onAdd({
      sku: formData.sku,
      name: formData.name,
      category: formData.category,
      price: parseFloat(formData.price) || 0,
      cost: parseFloat(formData.cost) || 0,
      stock: totalStock,
      minStock: parseInt(formData.minStock) || 0,
      supplier: formData.supplier,
      branches: branchStockNumbers,
      units: units,
    });

    toast.success("Produk berhasil disimpan");
    onOpenChange(false);
    // Reset form
    setFormData({ sku: "", name: "", category: "", price: "", cost: "", minStock: "", supplier: "" });
    setBranchStocks({});
    setUnits([{ name: "Pcs", conversion_factor: 1, price: 0, barcode: "" }]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === 'add' ? 'Tambah Produk Baru' : 'Edit Produk'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>SKU *</Label>
              <Input
                placeholder="PRD-007"
                value={formData.sku}
                onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label>Nama Produk *</Label>
              <Input
                placeholder="Nama produk"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Kategori *</Label>
              <Select
                value={formData.category}
                onValueChange={(value) => setFormData({ ...formData, category: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pilih kategori" />
                </SelectTrigger>
                <SelectContent>
                  {categories.filter(c => c !== "Semua").map((cat) => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Supplier</Label>
              <Input
                placeholder="Nama supplier"
                value={formData.supplier}
                onChange={(e) => setFormData({ ...formData, supplier: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="grid gap-2">
              <Label>Harga Jual (Base) *</Label>
              <Input
                type="number"
                placeholder="0"
                value={formData.price}
                onChange={(e) => setFormData({ ...formData, price: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label>Harga Modal</Label>
              <Input
                type="number"
                placeholder="0"
                value={formData.cost}
                onChange={(e) => setFormData({ ...formData, cost: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label>Stok Minimum</Label>
              <Input
                type="number"
                placeholder="0"
                value={formData.minStock}
                onChange={(e) => setFormData({ ...formData, minStock: e.target.value })}
              />
            </div>
          </div>

          {/* Units Section */}
          <div className="border-t pt-4">
            <div className="flex justify-between items-center mb-3">
              <Label className="text-base font-semibold">Satuan & Konversi</Label>
              <Button size="sm" variant="outline" onClick={addUnit}>
                <Plus className="w-4 h-4 mr-2" />
                Tambah Satuan
              </Button>
            </div>
            <div className="space-y-3">
              {units.map((unit, index) => (
                <div key={index} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-3">
                    <Label className="text-xs">Satuan</Label>
                    <Input 
                      value={unit.name} 
                      onChange={(e) => handleUnitChange(index, 'name', e.target.value)}
                      placeholder="Pcs/Box"
                    />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Konversi</Label>
                    <Input 
                      type="number" 
                      value={unit.conversion_factor} 
                      onChange={(e) => handleUnitChange(index, 'conversion_factor', parseFloat(e.target.value) || 1)}
                      disabled={index === 0} // Base unit always 1
                    />
                  </div>
                  <div className="col-span-3">
                    <Label className="text-xs">Harga Jual</Label>
                    <Input 
                      type="number" 
                      value={unit.price} 
                      onChange={(e) => handleUnitChange(index, 'price', parseFloat(e.target.value) || 0)}
                    />
                  </div>
                  <div className="col-span-3">
                    <Label className="text-xs">Barcode</Label>
                    <Input 
                      value={unit.barcode || ''} 
                      onChange={(e) => handleUnitChange(index, 'barcode', e.target.value)}
                      placeholder="Scan..."
                    />
                  </div>
                  <div className="col-span-1">
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => removeUnit(index)}
                      disabled={index === 0}
                      className="text-destructive"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t pt-4">
            <Label className="text-base font-semibold">Stok Awal per Lokasi</Label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
              {branches.map((branch) => (
                <div key={branch.id} className="grid gap-1">
                  <Label className="text-sm text-muted-foreground">{branch.name}</Label>
                  <Input
                    type="number"
                    placeholder="0"
                    value={branchStocks[branch.id]}
                    onChange={(e) => setBranchStocks({ ...branchStocks, [branch.id]: e.target.value })}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button className="flex-1" onClick={handleSubmit}>
            {mode === "edit" ? "Simpan Perubahan" : "Simpan Produk"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
