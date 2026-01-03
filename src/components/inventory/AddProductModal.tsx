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
import { toast } from "sonner";

interface AddProductModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (product: {
    sku: string;
    name: string;
    category: string;
    price: number;
    cost: number;
    stock: number;
    minStock: number;
    supplier: string;
    branches: Record<string, number>;
  }) => void;
  categories: string[];
}

const branches = [
  { id: "pusat", name: "Gudang Pusat" },
  { id: "jakarta", name: "Cabang Jakarta" },
  { id: "surabaya", name: "Cabang Surabaya" },
  { id: "bandung", name: "Cabang Bandung" },
  { id: "medan", name: "Cabang Medan" },
];

export function AddProductModal({ open, onOpenChange, onAdd, categories }: AddProductModalProps) {
  const [formData, setFormData] = useState({
    sku: "",
    name: "",
    category: "",
    price: "",
    cost: "",
    minStock: "",
    supplier: "",
  });
  const [branchStocks, setBranchStocks] = useState<Record<string, string>>({
    pusat: "",
    jakarta: "",
    surabaya: "",
    bandung: "",
    medan: "",
  });

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
    });

    toast.success("Produk berhasil ditambahkan");
    onOpenChange(false);
    setFormData({ sku: "", name: "", category: "", price: "", cost: "", minStock: "", supplier: "" });
    setBranchStocks({ pusat: "", jakarta: "", surabaya: "", bandung: "", medan: "" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tambah Produk Baru</DialogTitle>
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
              <Label>Harga Jual</Label>
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

          <div className="border-t pt-4">
            <Label className="text-base font-semibold">Stok per Lokasi</Label>
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
            Simpan Produk
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
