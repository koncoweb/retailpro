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
import { toast } from "sonner";
import { Trash2, Plus, Check, ChevronsUpDown, Barcode as BarcodeIcon, Download, RefreshCw } from "lucide-react";
import { query } from "@/lib/db";
import { BarcodeGenerator } from "@/components/ui/BarcodeGenerator";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { generateNextSku } from "@/lib/inventory-utils";

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
  categories: string[]; // Keep for compatibility, but we'll fetch from DB too
  branches: { id: string; name: string }[];
  mode?: "add" | "edit";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialData?: any;
}

export function AddProductModal({ 
  open, 
  onOpenChange, 
  onAdd, 
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
  
  // Combobox states
  const [openCategory, setOpenCategory] = useState(false);
  const [openSupplier, setOpenSupplier] = useState(false);
  const [dbCategories, setDbCategories] = useState<{id: string, name: string}[]>([]);
  const [dbSuppliers, setDbSuppliers] = useState<{id: string, name: string}[]>([]);

  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState("");

  const fetchMasterData = async () => {
    try {
      // Fetch Categories
      const catRes = await query("SELECT id, name FROM categories ORDER BY name ASC");
      setDbCategories(catRes.rows);
      
      // Fetch Suppliers
      const supRes = await query("SELECT id, name FROM suppliers ORDER BY name ASC");
      setDbSuppliers(supRes.rows);
    } catch (error) {
      console.error("Failed to fetch master data:", error);
    }
  };

  // Fetch Categories and Suppliers
  useEffect(() => {
    if (open) {
      fetchMasterData();
    }
  }, [open]);

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

  // Generate SKU
  const generateSku = async (categoryName?: string) => {
    const catToUse = categoryName || formData.category;
    if (!catToUse) {
      toast.error("Pilih kategori terlebih dahulu");
      return;
    }

    try {
      // Prepare prefix for DB query pattern
      const prefix = catToUse.substring(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, "CAT");
      // Note: We duplicate some logic here for the DB query pattern, 
      // but the actual generation is unified in the util.
      // Ideally we should export the prefix generator too if we want perfect DRY.
      
      const date = new Date();
      const dateStr = date.toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
      // Use wildcard for sequence
      const baseSkuPattern = `${prefix}-${dateStr}-%`; 
      
      // Query DB for latest sequence
      const res = await query(`SELECT sku FROM products WHERE sku LIKE $1 ORDER BY sku DESC LIMIT 1`, [baseSkuPattern]);
      
      let lastSku = null;
      if (res.rows.length > 0) {
        lastSku = res.rows[0].sku;
      }
      
      const newSku = generateNextSku(catToUse, date, lastSku);
      setFormData(prev => ({ ...prev, sku: newSku }));
      toast.success("SKU generated: " + newSku);
    } catch (error) {
      console.error("Failed to generate SKU:", error);
      toast.error("Gagal generate SKU");
    }
  };

  // Auto-generate SKU when category changes (only if SKU is empty and mode is add)
  useEffect(() => {
    if (mode === 'add' && formData.category && !formData.sku) {
      // Optional: Auto-generate or just let user click button. 
      // Requirement: "generate SKU automatically... when form opened" -> But needs category.
      // So best is to generate when category is selected if SKU is empty.
      generateSku(formData.category);
    }
  }, [formData.category]);

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

  const downloadBarcode = (value: string) => {
    const svg = document.getElementById(`barcode-${value}`)?.querySelector('svg');
    if (svg) {
        const serializer = new XMLSerializer();
        const source = serializer.serializeToString(svg);
        const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(source);
        
        const link = document.createElement('a');
        link.download = `${value}.svg`;
        link.href = url;
        link.click();
    } else {
        toast.error("Barcode preview not found");
    }
  };

  const handleSubmit = async () => {
    if (!formData.sku || !formData.name || !formData.category) {
      toast.error("Mohon lengkapi data produk");
      return;
    }

    // Ensure category exists in master data (if new)
    const catExists = dbCategories.some(c => c.name.toLowerCase() === formData.category.toLowerCase());
    if (!catExists) {
      try {
        await query("INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", [formData.category]);
      } catch (e) {
        console.error("Failed to save new category:", e);
      }
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

  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) return;
    const name = newCategoryName.trim();
    
    // Check duplicate locally first
    if (dbCategories.some(c => c.name.toLowerCase() === name.toLowerCase())) {
        toast.error("Kategori sudah ada");
        return;
    }

    try {
        await query("INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", [name]);
        toast.success("Kategori berhasil ditambahkan");
        
        // Refresh list and select it
        await fetchMasterData();
        setFormData(prev => ({ ...prev, category: name }));
        setOpenCategory(false);
        setShowAddCategory(false);
        setNewCategoryName("");
    } catch (error) {
        console.error("Failed to add category:", error);
        toast.error("Gagal menambahkan kategori");
    }
  };

  const handleAddSupplier = async () => {
    if (!newSupplierName.trim()) return;
    const name = newSupplierName.trim();

    // Check duplicate locally
    if (dbSuppliers.some(s => s.name.toLowerCase() === name.toLowerCase())) {
        toast.error("Supplier sudah ada");
        return;
    }

    try {
        await query("INSERT INTO suppliers (name) VALUES ($1)", [name]);
        toast.success("Supplier berhasil ditambahkan");
        
        // Refresh list and select it
        await fetchMasterData();
        setFormData(prev => ({ ...prev, supplier: name }));
        setOpenSupplier(false);
        setShowAddSupplier(false);
        setNewSupplierName("");
    } catch (error) {
        console.error("Failed to add supplier:", error);
        toast.error("Gagal menambahkan supplier");
    }
  };

  return (
    <>
    <Dialog open={showAddCategory} onOpenChange={setShowAddCategory}>
        <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
                <DialogTitle>Tambah Kategori Baru</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                    <Label htmlFor="cat-name">Nama Kategori</Label>
                    <Input 
                        id="cat-name" 
                        value={newCategoryName} 
                        onChange={(e) => setNewCategoryName(e.target.value)} 
                        placeholder="Contoh: Elektronik"
                        onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
                    />
                </div>
                <Button onClick={handleAddCategory}>Simpan</Button>
            </div>
        </DialogContent>
    </Dialog>

    <Dialog open={showAddSupplier} onOpenChange={setShowAddSupplier}>
        <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
                <DialogTitle>Tambah Supplier Baru</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                    <Label htmlFor="sup-name">Nama Supplier</Label>
                    <Input 
                        id="sup-name" 
                        value={newSupplierName} 
                        onChange={(e) => setNewSupplierName(e.target.value)} 
                        placeholder="Contoh: PT Sumber Makmur"
                        onKeyDown={(e) => e.key === 'Enter' && handleAddSupplier()}
                    />
                </div>
                <Button onClick={handleAddSupplier}>Simpan</Button>
            </div>
        </DialogContent>
    </Dialog>

    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === 'add' ? 'Tambah Produk Baru' : 'Edit Produk'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Kategori *</Label>
              <Popover open={openCategory} onOpenChange={setOpenCategory}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={openCategory}
                    className="justify-between"
                  >
                    {formData.category
                      ? formData.category
                      : "Pilih kategori..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[300px] p-0">
                  <Command>
                    <CommandInput placeholder="Cari kategori..." />
                    <CommandList>
                      <CommandEmpty>
                        <div className="p-2">
                            <p className="text-sm text-muted-foreground mb-2">Kategori tidak ditemukan.</p>
                            <Button size="sm" className="w-full" onClick={() => {
                                setShowAddCategory(true);
                                setOpenCategory(false);
                            }}>
                                Tambah Kategori Baru
                            </Button>
                        </div>
                      </CommandEmpty>
                      <CommandGroup>
                        {dbCategories.map((category) => (
                          <CommandItem
                            key={category.id}
                            value={category.name}
                            onSelect={(currentValue) => {
                              setFormData({ ...formData, category: currentValue });
                              setOpenCategory(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                formData.category === category.name ? "opacity-100" : "opacity-0"
                              )}
                            />
                            {category.name}
                          </CommandItem>
                        ))}
                         <CommandItem 
                            value="tambah-baru-manual"
                            onSelect={() => {
                                setShowAddCategory(true);
                                setOpenCategory(false);
                            }}
                            className="text-blue-500 font-medium"
                         >
                            <Plus className="mr-2 h-4 w-4" /> Tambah Kategori Baru
                         </CommandItem>
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="grid gap-2">
              <Label>Supplier</Label>
               <Popover open={openSupplier} onOpenChange={setOpenSupplier}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={openSupplier}
                    className="justify-between"
                  >
                    {formData.supplier
                      ? formData.supplier
                      : "Pilih supplier..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[300px] p-0">
                  <Command>
                    <CommandInput placeholder="Cari supplier..." />
                    <CommandList>
                      <CommandEmpty>
                        <div className="p-2">
                            <p className="text-sm text-muted-foreground mb-2">Supplier tidak ditemukan.</p>
                            <Button size="sm" className="w-full" onClick={() => {
                                setShowAddSupplier(true);
                                setOpenSupplier(false);
                            }}>
                                Tambah Supplier Baru
                            </Button>
                        </div>
                      </CommandEmpty>
                      <CommandGroup>
                        {dbSuppliers.map((supplier) => (
                          <CommandItem
                            key={supplier.id}
                            value={supplier.name}
                            onSelect={(currentValue) => {
                              setFormData({ ...formData, supplier: currentValue });
                              setOpenSupplier(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                formData.supplier === supplier.name ? "opacity-100" : "opacity-0"
                              )}
                            />
                            {supplier.name}
                          </CommandItem>
                        ))}
                         <CommandItem 
                            value="tambah-baru-manual"
                            onSelect={() => {
                                setShowAddSupplier(true);
                                setOpenSupplier(false);
                            }}
                            className="text-blue-500 font-medium"
                         >
                            <Plus className="mr-2 h-4 w-4" /> Tambah Supplier Baru
                         </CommandItem>
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
             <div className="grid gap-2">
              <Label>SKU *</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="PRD-007"
                  value={formData.sku}
                  onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                />
                <Button 
                    variant="outline" 
                    size="icon" 
                    onClick={() => generateSku()} 
                    title="Generate SKU"
                >
                    <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Format: KAT-YYMMDD-XXX (Auto-generated)
              </p>
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
              <Label className="text-base font-semibold">Satuan & Barcode</Label>
              <Button size="sm" variant="outline" onClick={addUnit}>
                <Plus className="w-4 h-4 mr-2" />
                Tambah Satuan
              </Button>
            </div>
            <div className="space-y-4">
              {units.map((unit, index) => (
                <div key={index} className="space-y-3 p-3 border rounded-lg bg-slate-50 dark:bg-slate-900">
                  <div className="grid grid-cols-12 gap-2 items-end">
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
                      <Label className="text-xs">Kode Barcode</Label>
                       <div className="flex gap-1">
                          <Input 
                            value={unit.barcode || ''} 
                            onChange={(e) => handleUnitChange(index, 'barcode', e.target.value)}
                            placeholder="Scan/Input..."
                          />
                          <Button 
                            variant="ghost" 
                            size="icon"
                            onClick={() => handleUnitChange(index, 'barcode', formData.sku ? `${formData.sku}-${unit.name}` : `${Date.now()}`)}
                            title="Generate Default"
                          >
                             <BarcodeIcon className="h-4 w-4" />
                          </Button>
                       </div>
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
                  
                  {/* Barcode Preview */}
                  {unit.barcode && (
                     <div className="flex items-center gap-4 bg-white dark:bg-black p-2 rounded border justify-between">
                        <div id={`barcode-${unit.barcode}`} className="overflow-hidden bg-white p-1 rounded">
                           <BarcodeGenerator value={unit.barcode} width={1.5} height={40} fontSize={12} />
                        </div>
                        <Button variant="outline" size="sm" onClick={() => downloadBarcode(unit.barcode)}>
                           <Download className="w-4 h-4 mr-2" />
                           Download SVG
                        </Button>
                     </div>
                  )}
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
    </>
  );
}
