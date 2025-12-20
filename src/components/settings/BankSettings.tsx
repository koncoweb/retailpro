import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Plus, Edit, Trash2, CreditCard } from "lucide-react";
import { toast } from "sonner";

interface Bank {
  id: string;
  name: string;
  type: string;
  accountNumber: string;
  accountName: string;
}

const initialBanks: Bank[] = [
  { id: "1", name: "BCA", type: "Debit & Kredit", accountNumber: "1234567890", accountName: "PT RetailPro" },
  { id: "2", name: "Mandiri", type: "Debit & Kredit", accountNumber: "0987654321", accountName: "PT RetailPro" },
  { id: "3", name: "BNI", type: "Debit", accountNumber: "5678901234", accountName: "PT RetailPro" },
];

export function BankSettings() {
  const [banks, setBanks] = useState<Bank[]>(initialBanks);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingBank, setEditingBank] = useState<Bank | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    type: "Debit & Kredit",
    accountNumber: "",
    accountName: "",
  });

  const handleSave = () => {
    if (!formData.name || !formData.accountNumber || !formData.accountName) {
      toast.error("Lengkapi semua field");
      return;
    }

    if (editingBank) {
      setBanks((prev) =>
        prev.map((b) =>
          b.id === editingBank.id ? { ...b, ...formData } : b
        )
      );
      toast.success("Bank berhasil diperbarui");
    } else {
      setBanks((prev) => [
        ...prev,
        { id: Date.now().toString(), ...formData },
      ]);
      toast.success("Bank berhasil ditambahkan");
    }

    setIsDialogOpen(false);
    setEditingBank(null);
    setFormData({ name: "", type: "Debit & Kredit", accountNumber: "", accountName: "" });
  };

  const handleEdit = (bank: Bank) => {
    setEditingBank(bank);
    setFormData({
      name: bank.name,
      type: bank.type,
      accountNumber: bank.accountNumber,
      accountName: bank.accountName,
    });
    setIsDialogOpen(true);
  };

  const handleDelete = (id: string) => {
    setBanks((prev) => prev.filter((b) => b.id !== id));
    toast.success("Bank berhasil dihapus");
  };

  return (
    <div className="bg-card rounded-xl border p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between pb-4 border-b">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-info/10">
            <CreditCard className="w-5 h-5 text-info" />
          </div>
          <div>
            <h3 className="font-semibold">Pengaturan Bank</h3>
            <p className="text-sm text-muted-foreground">Kelola bank untuk transaksi kartu</p>
          </div>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2" onClick={() => setEditingBank(null)}>
              <Plus className="w-4 h-4" />
              Tambah Bank
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingBank ? "Edit Bank" : "Tambah Bank Baru"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Nama Bank</Label>
                <Input
                  placeholder="Contoh: BCA"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Tipe Kartu</Label>
                <Select
                  value={formData.type}
                  onValueChange={(value) => setFormData({ ...formData, type: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Debit">Debit</SelectItem>
                    <SelectItem value="Kredit">Kredit</SelectItem>
                    <SelectItem value="Debit & Kredit">Debit & Kredit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Nomor Rekening</Label>
                <Input
                  placeholder="Contoh: 1234567890"
                  value={formData.accountNumber}
                  onChange={(e) => setFormData({ ...formData, accountNumber: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Nama Pemilik Rekening</Label>
                <Input
                  placeholder="Contoh: PT RetailPro"
                  value={formData.accountName}
                  onChange={(e) => setFormData({ ...formData, accountName: e.target.value })}
                />
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

      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bank</TableHead>
              <TableHead>Tipe</TableHead>
              <TableHead>No. Rekening</TableHead>
              <TableHead>Nama Rekening</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {banks.map((bank) => (
              <TableRow key={bank.id}>
                <TableCell className="font-medium">{bank.name}</TableCell>
                <TableCell>{bank.type}</TableCell>
                <TableCell className="font-mono">{bank.accountNumber}</TableCell>
                <TableCell>{bank.accountName}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="iconSm" onClick={() => handleEdit(bank)}>
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="iconSm"
                      className="text-destructive"
                      onClick={() => handleDelete(bank.id)}
                    >
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
  );
}
