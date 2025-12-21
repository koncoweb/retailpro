import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Edit, Trash2, Percent, Receipt } from "lucide-react";
import { toast } from "sonner";

interface TaxDiscount {
  id: string;
  name: string;
  type: "tax" | "discount";
  value: number;
  isPercentage: boolean;
  isActive: boolean;
  applyTo: "all" | "specific";
}

const initialItems: TaxDiscount[] = [
  { id: "1", name: "PPN", type: "tax", value: 11, isPercentage: true, isActive: true, applyTo: "all" },
  { id: "2", name: "Service Charge", type: "tax", value: 5, isPercentage: true, isActive: false, applyTo: "all" },
  { id: "3", name: "Diskon Member", type: "discount", value: 10, isPercentage: true, isActive: true, applyTo: "specific" },
  { id: "4", name: "Diskon Promo", type: "discount", value: 15, isPercentage: true, isActive: true, applyTo: "all" },
];

export function TaxDiscountSettings() {
  const [items, setItems] = useState<TaxDiscount[]>(initialItems);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<TaxDiscount | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    type: "tax" as "tax" | "discount",
    value: "",
    isPercentage: true,
    applyTo: "all" as "all" | "specific",
  });

  const handleSave = () => {
    if (!formData.name || !formData.value) {
      toast.error("Lengkapi semua field");
      return;
    }

    if (editingItem) {
      setItems((prev) =>
        prev.map((item) =>
          item.id === editingItem.id
            ? { ...item, ...formData, value: parseFloat(formData.value), isActive: item.isActive }
            : item
        )
      );
      toast.success("Berhasil diperbarui");
    } else {
      setItems((prev) => [
        ...prev,
        { 
          id: Date.now().toString(), 
          ...formData, 
          value: parseFloat(formData.value),
          isActive: true 
        },
      ]);
      toast.success("Berhasil ditambahkan");
    }

    setIsDialogOpen(false);
    setEditingItem(null);
    setFormData({ name: "", type: "tax", value: "", isPercentage: true, applyTo: "all" });
  };

  const handleEdit = (item: TaxDiscount) => {
    setEditingItem(item);
    setFormData({
      name: item.name,
      type: item.type,
      value: item.value.toString(),
      isPercentage: item.isPercentage,
      applyTo: item.applyTo,
    });
    setIsDialogOpen(true);
  };

  const handleDelete = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    toast.success("Berhasil dihapus");
  };

  const handleToggle = (id: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, isActive: !item.isActive } : item
      )
    );
  };

  const taxes = items.filter((item) => item.type === "tax");
  const discounts = items.filter((item) => item.type === "discount");

  return (
    <div className="bg-card rounded-xl border p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between pb-4 border-b">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-warning/10">
            <Percent className="w-5 h-5 text-warning" />
          </div>
          <div>
            <h3 className="font-semibold">Pengaturan Pajak & Diskon</h3>
            <p className="text-sm text-muted-foreground">Kelola pajak dan diskon manual</p>
          </div>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2" onClick={() => {
              setEditingItem(null);
              setFormData({ name: "", type: "tax", value: "", isPercentage: true, applyTo: "all" });
            }}>
              <Plus className="w-4 h-4" />
              Tambah
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingItem ? "Edit" : "Tambah"} Pajak/Diskon</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Nama</Label>
                <Input
                  placeholder="Contoh: PPN"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Tipe</Label>
                <Select
                  value={formData.type}
                  onValueChange={(value: "tax" | "discount") => setFormData({ ...formData, type: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tax">Pajak</SelectItem>
                    <SelectItem value="discount">Diskon</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nilai</Label>
                  <Input
                    type="number"
                    placeholder="10"
                    value={formData.value}
                    onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Format</Label>
                  <Select
                    value={formData.isPercentage ? "percentage" : "fixed"}
                    onValueChange={(value) => setFormData({ ...formData, isPercentage: value === "percentage" })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percentage">Persentase (%)</SelectItem>
                      <SelectItem value="fixed">Nominal (Rp)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Berlaku Untuk</Label>
                <Select
                  value={formData.applyTo}
                  onValueChange={(value: "all" | "specific") => setFormData({ ...formData, applyTo: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Transaksi</SelectItem>
                    <SelectItem value="specific">Transaksi Tertentu</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setIsDialogOpen(false)}>
                Batal
              </Button>
              <Button className="flex-1" onClick={handleSave}>
                Simpan
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Taxes */}
      <div className="space-y-3">
        <h4 className="font-medium flex items-center gap-2">
          <Receipt className="w-4 h-4 text-primary" />
          Pajak
        </h4>
        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Nilai</TableHead>
                <TableHead>Berlaku</TableHead>
                <TableHead className="text-center">Aktif</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {taxes.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell>{item.isPercentage ? `${item.value}%` : `Rp ${item.value.toLocaleString()}`}</TableCell>
                  <TableCell>{item.applyTo === "all" ? "Semua" : "Tertentu"}</TableCell>
                  <TableCell className="text-center">
                    <Switch checked={item.isActive} onCheckedChange={() => handleToggle(item.id)} />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="iconSm" onClick={() => handleEdit(item)}>
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="iconSm" className="text-destructive" onClick={() => handleDelete(item.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Discounts */}
      <div className="space-y-3">
        <h4 className="font-medium flex items-center gap-2">
          <Percent className="w-4 h-4 text-success" />
          Diskon
        </h4>
        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Nilai</TableHead>
                <TableHead>Berlaku</TableHead>
                <TableHead className="text-center">Aktif</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {discounts.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell>{item.isPercentage ? `${item.value}%` : `Rp ${item.value.toLocaleString()}`}</TableCell>
                  <TableCell>{item.applyTo === "all" ? "Semua" : "Tertentu"}</TableCell>
                  <TableCell className="text-center">
                    <Switch checked={item.isActive} onCheckedChange={() => handleToggle(item.id)} />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="iconSm" onClick={() => handleEdit(item)}>
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="iconSm" className="text-destructive" onClick={() => handleDelete(item.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
