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
import {
  Trash2,
  Plus,
  Check,
  ChevronsUpDown,
  Barcode as BarcodeIcon,
  Download,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { query } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
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
import { formatCurrency } from "@/lib/formatters";
import { warehouseLabel, type WarehouseOption } from "@/lib/warehouse";
import {
  DEFAULT_PRICE_SETTINGS,
  PRICING_SETTING_KEY,
  isBlockingIssue,
  priceIssueMessage,
  priceIssues,
  type PackInput,
  type PriceSettings,
} from "@/lib/pricing";
import {
  expandCombinations,
  parseVariantGroups,
  sanitizeGroups,
  variantKey,
  variantLabel,
  variantSku,
  type VariantAttributeGroup,
  type VariantAttributes,
} from "@/lib/variants";
import { readTenantSetting } from "@/lib/tenant-settings";

/**
 * One sellable pack of one variant (a "pecahan"): "Karton" holds 24 base units
 * and carries its OWN buy and sell price. Nothing here is derived from another
 * pack — a carton is not automatically 24 x the pcs price, which is exactly the
 * mistake this screen used to make.
 */
export interface ProductUnit {
  id?: string;
  /** Owning `product_variants.id`, filled in when rows are read back. */
  variant_id?: string | null;
  name: string;
  conversion_factor: number;
  /** Sell price for THIS pack, in rupiah. */
  price: number;
  /** Buy price for THIS pack, in rupiah; `cost / conversion_factor` is per base. */
  cost: number;
  barcode: string;
}

/** One row of the variant matrix: attributes, its packs, its opening stock. */
export interface ProductVariantDraft {
  /** `variantKey(attributes)`; empty string for a product without variants. */
  key: string;
  /** `product_variants.id` when the row already exists. */
  id?: string;
  attributes: VariantAttributes;
  sku: string;
  barcode: string;
  units: ProductUnit[];
  /** Opening/on-hand target per warehouse id, in base units. */
  stock: Record<string, number>;
}

/** Exactly what the form hands the page, so the SQL never has to re-derive it. */
export interface ProductFormPayload {
  sku: string;
  name: string;
  category: string;
  /** Model summary: factor-1 sell price of the first variant. */
  price: number;
  /** Model summary: factor-1 buy price of the first variant. */
  cost: number;
  /** Sum of every variant's opening stock. */
  stock: number;
  minStock: number;
  supplier: string;
  /** Per-warehouse total, for the table's stock column. */
  warehouses: Record<string, number>;
  /** `products.variant_attributes`; empty means a single default variant. */
  variantGroups: VariantAttributeGroup[];
  variants: ProductVariantDraft[];
}

interface AddProductModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (product: ProductFormPayload) => void;
  categories: string[]; // Keep for compatibility, but we'll fetch from DB too
  warehouses: WarehouseOption[];
  mode?: "add" | "edit";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialData?: any;
}

/** The one pack every product starts with: the base unit itself. */
function defaultPacks(): ProductUnit[] {
  return [{ name: "Pcs", conversion_factor: 1, price: 0, cost: 0, barcode: "" }];
}

/**
 * Build one matrix row, keeping whatever the owner already typed for that
 * combination so editing a group never wipes a price.
 */
function makeVariant(
  attributes: VariantAttributes,
  baseSku: string,
  previous?: ProductVariantDraft
): ProductVariantDraft {
  return {
    key: variantKey(attributes),
    id: previous?.id,
    attributes,
    sku: previous?.sku || (baseSku ? variantSku(baseSku, attributes) : ""),
    barcode: previous?.barcode ?? "",
    units: previous?.units ?? defaultPacks(),
    stock: previous?.stock ?? {},
  };
}

/** Re-expand the groups, matching existing rows by their attribute identity. */
function reconcileVariants(
  previous: readonly ProductVariantDraft[],
  groups: readonly VariantAttributeGroup[],
  baseSku: string
): ProductVariantDraft[] {
  const combinations = expandCombinations(groups);
  const wanted: VariantAttributes[] = combinations.length > 0 ? combinations : [{}];
  return wanted.map((attributes) => {
    const key = variantKey(attributes);
    return makeVariant(attributes, baseSku, previous.find((row) => row.key === key));
  });
}

function toPackInput(unit: ProductUnit): PackInput {
  return {
    unitName: unit.name || "Satuan",
    conversionFactor: Number(unit.conversion_factor) || 1,
    cost: Number(unit.cost) || 0,
    price: Number(unit.price) || 0,
  };
}

/** Stock inputs are keyed per variant, so each combination keeps its own count. */
const stockKey = (rowKey: string, warehouseId: string) => `${rowKey}|${warehouseId}`;

export function AddProductModal({ 
  open, 
  onOpenChange, 
  onAdd, 
  warehouses, 
  mode = "add", 
  initialData 
}: AddProductModalProps) {
  const [formData, setFormData] = useState({
    sku: "",
    name: "",
    category: "",
    minStock: "",
    supplier: "",
  });
  const [stockInputs, setStockInputs] = useState<Record<string, string>>({});
  const [variantGroups, setVariantGroups] = useState<VariantAttributeGroup[]>([]);
  const [variants, setVariants] = useState<ProductVariantDraft[]>([makeVariant({}, "")]);
  // Read once per open; a tenant may run a different margin floor than the default.
  const [priceSettings, setPriceSettings] = useState<PriceSettings>(DEFAULT_PRICE_SETTINGS);
  
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
        minStock: initialData.minStock.toString(),
        supplier: initialData.supplier,
      });

      const groups = parseVariantGroups(initialData.variantGroups ?? initialData.variant_attributes ?? []);
      setVariantGroups(groups);

      // Rows written before migration 006 have no variant record; the product's
      // own units are then the single Default variant.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stored: any[] = Array.isArray(initialData.variants) ? initialData.variants : [];
      const drafts: ProductVariantDraft[] =
        stored.length > 0
          ? stored.map((row) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const packs: any[] = Array.isArray(row.units) ? row.units : [];
              const attributes = row.attributes ?? {};
              return {
                key: variantKey(attributes),
                id: row.id,
                attributes,
                sku: row.sku ?? initialData.sku,
                barcode: row.barcode ?? "",
                units:
                  packs.length > 0
                    ? packs.map((pack) => ({
                        ...pack,
                        cost: Number(pack.cost ?? initialData.cost ?? 0),
                        price: Number(pack.price ?? 0),
                      }))
                    : defaultPacks(),
                stock: row.warehouses ?? {},
              };
            })
          : [
              {
                key: "",
                attributes: {},
                sku: initialData.sku,
                barcode: "",
                units:
                  Array.isArray(initialData.units) && initialData.units.length > 0
                    ? initialData.units.map((unit: ProductUnit) => ({ ...unit }))
                    : defaultPacks(),
                stock: initialData.warehouses ?? {},
              },
            ];
      setVariants(drafts);

      const stocks: Record<string, string> = {};
      for (const row of drafts) {
        for (const [warehouseId, quantity] of Object.entries(row.stock)) {
          stocks[stockKey(row.key, warehouseId)] = String(quantity);
        }
      }
      setStockInputs(stocks);
    } else if (mode === "add" && open) {
      setFormData({ sku: "", name: "", category: "", minStock: "", supplier: "" });
      setStockInputs({});
      setVariantGroups([]);
      setVariants([makeVariant({}, "")]);
    }
  }, [initialData, mode, open]);

  // Margin floor is a tenant setting; failing to read it must not block the form.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    readTenantSetting<PriceSettings | null>(PRICING_SETTING_KEY, null)
      .then((stored) => {
        if (!cancelled && stored) setPriceSettings({ ...DEFAULT_PRICE_SETTINGS, ...stored });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open]);

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
      applySku(newSku);
      toast.success("SKU generated: " + newSku);
    } catch (error) {
      console.error("Failed to generate SKU:", error);
      toast.error("Gagal generate SKU");
    }
  };

  // Auto-generate SKU when category changes (only if SKU is empty and mode is add)
  useEffect(() => {
    if (mode === 'add' && formData.category && !formData.sku) {
      generateSku(formData.category);
    }
  }, [formData.category]);

  /**
   * The model SKU prefixes every variant SKU, so changing it must move the SKUs
   * that were generated from it — but never one the owner typed by hand.
   */
  const applySku = (value: string) => {
    const previousBase = formData.sku;
    setFormData((current) => ({ ...current, sku: value }));
    setVariants((rows) =>
      rows.map((row) => {
        if (row.sku && row.sku !== variantSku(previousBase, row.attributes)) return row;
        return { ...row, sku: value ? variantSku(value, row.attributes) : "" };
      })
    );
  };

  /** Re-expanding the groups is what keeps one card per combination. */
  const applyGroups = (next: VariantAttributeGroup[]) => {
    setVariantGroups(next);
    setVariants((current) => reconcileVariants(current, next, formData.sku));
  };

  const addGroup = () => applyGroups([...variantGroups, { name: "", values: [] }]);

  const removeGroup = (index: number) =>
    applyGroups(variantGroups.filter((_, groupIndex) => groupIndex !== index));

  const updateGroup = (index: number, patch: Partial<VariantAttributeGroup>) =>
    applyGroups(
      variantGroups.map((group, groupIndex) => (groupIndex === index ? { ...group, ...patch } : group))
    );

  /** Values are authored as a comma-separated list; blanks are ignored on expand. */
  const updateGroupValues = (index: number, raw: string) =>
    updateGroup(index, { values: raw.split(",").map((value) => value.trim()) });

  const updateVariant = (rowKey: string, patch: Partial<ProductVariantDraft>) => {
    setVariants((rows) => rows.map((row) => (row.key === rowKey ? { ...row, ...patch } : row)));
  };

  const handlePackChange = (
    rowKey: string,
    index: number,
    field: keyof ProductUnit,
    value: string | number
  ) => {
    setVariants((rows) =>
      rows.map((row) => {
        if (row.key !== rowKey) return row;
        return {
          ...row,
          units: row.units.map((unit, unitIndex) =>
            unitIndex === index ? { ...unit, [field]: value } : unit
          ),
        };
      })
    );
  };

  const addPack = (rowKey: string) => {
    setVariants((rows) =>
      rows.map((row) =>
        row.key === rowKey
          ? {
              ...row,
              units: [...row.units, { name: "", conversion_factor: 1, price: 0, cost: 0, barcode: "" }],
            }
          : row
      )
    );
  };

  const removePack = (rowKey: string, index: number) => {
    if (index === 0) return; // Stock is counted in the base pack.
    setVariants((rows) =>
      rows.map((row) =>
        row.key === rowKey ? { ...row, units: row.units.filter((_, i) => i !== index) } : row
      )
    );
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

    // Normalise before validating: a blank pack name or a zero conversion
    // factor would otherwise reach the unique index and fail the whole save.
    const variantsToSave: ProductVariantDraft[] = variants.map((row) => ({
      ...row,
      sku: (row.sku || variantSku(formData.sku, row.attributes)).trim() || formData.sku,
      units: row.units.map((unit, index) => ({
        ...unit,
        name: unit.name.trim() || (index === 0 ? "Pcs" : `Satuan ${index + 1}`),
        conversion_factor: index === 0 ? 1 : Number(unit.conversion_factor) || 1,
        cost: Number(unit.cost) || 0,
        price: Number(unit.price) || 0,
      })),
      stock: Object.fromEntries(
        warehouses.map((warehouse) => [
          warehouse.id,
          parseInt(stockInputs[stockKey(row.key, warehouse.id)] ?? "") || 0,
        ])
      ),
    }));

    // A pack bought for more than it sells blocks the save; the ladder and
    // margin warnings are shown inline on the card instead.
    const blocking = variantsToSave.flatMap((row) =>
      priceIssues(row.units.map(toPackInput), priceSettings).filter(isBlockingIssue)
    );
    if (blocking.length > 0) {
      toast.error(priceIssueMessage(blocking[0]));
      return;
    }

    const summaryVariant = variantsToSave[0];
    const summaryPack = summaryVariant
      ? summaryVariant.units.find((unit) => Number(unit.conversion_factor) === 1) ??
        summaryVariant.units[0]
      : undefined;

    const warehouseStockNumbers: Record<string, number> = {};
    let totalStock = 0;
    for (const row of variantsToSave) {
      for (const [warehouseId, quantity] of Object.entries(row.stock)) {
        if (!quantity) continue;
        warehouseStockNumbers[warehouseId] = (warehouseStockNumbers[warehouseId] ?? 0) + quantity;
        totalStock += quantity;
      }
    }

    onAdd({
      sku: formData.sku,
      name: formData.name,
      category: formData.category,
      price: Number(summaryPack?.price) || 0,
      cost: Number(summaryPack?.cost) || 0,
      stock: totalStock,
      minStock: parseInt(formData.minStock) || 0,
      supplier: formData.supplier,
      warehouses: warehouseStockNumbers,
      variantGroups: sanitizeGroups(variantGroups),
      variants: variantsToSave,
    });

    toast.success("Produk berhasil disimpan");
    onOpenChange(false);
    // Reset form
    setFormData({ sku: "", name: "", category: "", minStock: "", supplier: "" });
    setStockInputs({});
    setVariantGroups([]);
    setVariants([makeVariant({}, "")]);
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

  // The model-level price is a READ-ONLY summary: the price of the base pack of
  // the first variant. Editing happens per pack, never here.
  const summaryVariant = variants[0];
  const summaryPack = summaryVariant
    ? summaryVariant.units.find((unit) => Number(unit.conversion_factor) === 1) ??
      summaryVariant.units[0]
    : undefined;
  const summaryCost = Number(summaryPack?.cost) || 0;
  const summaryPrice = Number(summaryPack?.price) || 0;
  const summaryMargin = summaryPrice > 0 ? ((summaryPrice - summaryCost) / summaryPrice) * 100 : 0;

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
      <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto">
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

          <div className="grid grid-cols-3 gap-4 rounded-lg border bg-slate-50 p-3 dark:bg-slate-900">
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground">Harga Beli Acuan</Label>
              <p className="text-base font-semibold">{formatCurrency(summaryCost)}</p>
              <p className="text-[11px] text-muted-foreground">Dari pecahan isi 1 varian pertama</p>
            </div>
            <div className="grid gap-1">
              <Label className="text-xs text-muted-foreground">Harga Jual Acuan</Label>
              <p className="text-base font-semibold">{formatCurrency(summaryPrice)}</p>
              <p className="text-[11px] text-muted-foreground">Margin {summaryMargin.toFixed(1)}%</p>
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

          {/* Attribute groups: empty means the product has one Default variant. */}
          <div className="border-t pt-4">
            <div className="flex justify-between items-start mb-3 gap-3">
              <div>
                <Label className="text-base font-semibold">Grup Varian</Label>
                <p className="text-xs text-muted-foreground">
                  Kosongkan bila produk tidak punya varian. Contoh: Rasa = Susu, Hitam.
                </p>
              </div>
              <Button size="sm" variant="outline" type="button" onClick={addGroup}>
                <Plus className="w-4 h-4 mr-2" />
                Tambah Grup
              </Button>
            </div>
            {variantGroups.length === 0 ? (
              <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                Produk ini dijual sebagai satu varian saja (Default).
              </p>
            ) : (
              <div className="space-y-2">
                {variantGroups.map((group, index) => (
                  <div key={index} className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-4">
                      <Label className="text-xs">Nama Grup</Label>
                      <Input
                        value={group.name}
                        onChange={(e) => updateGroup(index, { name: e.target.value })}
                        placeholder="Rasa"
                      />
                    </div>
                    <div className="col-span-7">
                      <Label className="text-xs">Nilai (pisahkan dengan koma)</Label>
                      <Input
                        value={group.values.join(", ")}
                        onChange={(e) => updateGroupValues(index, e.target.value)}
                        placeholder="Susu, Hitam"
                      />
                    </div>
                    <div className="col-span-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        type="button"
                        className="text-destructive"
                        onClick={() => removeGroup(index)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Variant matrix: one card per combination, one pack row per pecahan. */}
          <div className="border-t pt-4">
            <div className="flex justify-between items-center mb-3">
              <Label className="text-base font-semibold">Pecahan & Harga per Varian</Label>
              <span className="text-xs text-muted-foreground">
                {variants.length} varian
              </span>
            </div>
            <div className="space-y-4">
              {variants.map((row) => {
                const baseName =
                  row.units.find((unit) => Number(unit.conversion_factor) === 1)?.name || "Pcs";
                const warnings = priceIssues(row.units.map(toPackInput), priceSettings).filter(
                  (issue) => !isBlockingIssue(issue)
                );

                return (
                  <div key={row.key || "default"} className="rounded-lg border">
                    <div className="flex flex-wrap items-center gap-2 border-b bg-slate-50 px-3 py-2 dark:bg-slate-900">
                      <Badge variant="secondary">{variantLabel(row.attributes, variantGroups)}</Badge>
                      <div className="flex flex-1 items-center gap-1">
                        <Input
                          className="h-8 max-w-[240px] text-xs"
                          value={row.sku}
                          onChange={(e) => updateVariant(row.key, { sku: e.target.value })}
                          placeholder="SKU varian"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          type="button"
                          className="h-8 w-8"
                          title="Generate ulang SKU"
                          onClick={() =>
                            updateVariant(row.key, { sku: variantSku(formData.sku, row.attributes) })
                          }
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <Button size="sm" variant="outline" type="button" onClick={() => addPack(row.key)}>
                        <Plus className="w-3.5 h-3.5 mr-1" />
                        Pecahan
                      </Button>
                    </div>

                    <div className="space-y-3 p-3">
                      {row.units.map((unit, index) => {
                        const factor = Number(unit.conversion_factor) || 1;
                        const baseCost = (Number(unit.cost) || 0) / factor;
                        const basePrice = (Number(unit.price) || 0) / factor;
                        const margin =
                          unit.price > 0 ? ((unit.price - unit.cost) / unit.price) * 100 : 0;

                        return (
                          <div key={index} className="space-y-2 border-b pb-3 last:border-0 last:pb-0">
                            <div className="grid grid-cols-12 gap-2 items-end">
                              <div className="col-span-3">
                                <Label className="text-xs">Satuan</Label>
                                <Input
                                  value={unit.name}
                                  onChange={(e) =>
                                    handlePackChange(row.key, index, "name", e.target.value)
                                  }
                                  placeholder="Pcs / Karton"
                                />
                              </div>
                              <div className="col-span-2">
                                <Label className="text-xs">Isi</Label>
                                <Input
                                  type="number"
                                  value={unit.conversion_factor}
                                  onChange={(e) =>
                                    handlePackChange(
                                      row.key,
                                      index,
                                      "conversion_factor",
                                      parseFloat(e.target.value) || 1
                                    )
                                  }
                                  disabled={index === 0}
                                />
                              </div>
                              <div className="col-span-2">
                                <Label className="text-xs">Harga Beli</Label>
                                <Input
                                  type="number"
                                  value={unit.cost || ""}
                                  onChange={(e) =>
                                    handlePackChange(
                                      row.key,
                                      index,
                                      "cost",
                                      parseFloat(e.target.value) || 0
                                    )
                                  }
                                />
                              </div>
                              <div className="col-span-2">
                                <Label className="text-xs">Harga Jual</Label>
                                <Input
                                  type="number"
                                  value={unit.price || ""}
                                  onChange={(e) =>
                                    handlePackChange(
                                      row.key,
                                      index,
                                      "price",
                                      parseFloat(e.target.value) || 0
                                    )
                                  }
                                />
                              </div>
                              <div className="col-span-2">
                                <Label className="text-xs">Barcode</Label>
                                <div className="flex gap-1">
                                  <Input
                                    value={unit.barcode || ""}
                                    onChange={(e) =>
                                      handlePackChange(row.key, index, "barcode", e.target.value)
                                    }
                                    placeholder="Scan/Input"
                                  />
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    type="button"
                                    title="Generate Default"
                                    onClick={() =>
                                      handlePackChange(
                                        row.key,
                                        index,
                                        "barcode",
                                        `${row.sku || formData.sku}-${unit.name || factor}`
                                      )
                                    }
                                  >
                                    <BarcodeIcon className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                              <div className="col-span-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  type="button"
                                  onClick={() => removePack(row.key, index)}
                                  disabled={index === 0}
                                  className="text-destructive"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>

                            <p className="text-[11px] text-muted-foreground">
                              {formatCurrency(baseCost)} / {baseName} dibeli · {formatCurrency(basePrice)} /{" "}
                              {baseName} dijual · margin {margin.toFixed(1)}%
                            </p>

                            {unit.barcode && (
                              <div className="flex items-center gap-4 justify-between rounded border bg-white p-2 dark:bg-black">
                                <div id={`barcode-${unit.barcode}`} className="overflow-hidden rounded bg-white p-1">
                                  <BarcodeGenerator value={unit.barcode} width={1.5} height={40} fontSize={12} />
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  type="button"
                                  onClick={() => downloadBarcode(unit.barcode)}
                                >
                                  <Download className="w-4 h-4 mr-2" />
                                  Download SVG
                                </Button>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {warnings.length > 0 && (
                        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                          <div className="flex items-center gap-2 font-medium">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Perlu diperiksa
                          </div>
                          <ul className="mt-1 list-disc pl-5">
                            {warnings.map((issue, issueIndex) => (
                              <li key={issueIndex}>{priceIssueMessage(issue)}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="border-t pt-4">
            <Label className="text-base font-semibold">Stok Awal per Gudang</Label>
            <p className="text-xs text-muted-foreground mb-3">
              Stok dicatat dalam pecahan isi 1, terpisah per varian.
            </p>
            <div className="space-y-3">
              {variants.map((row) => (
                <div key={row.key || "default"} className="rounded-lg border p-3">
                  <p className="text-sm font-medium mb-2">
                    {variantLabel(row.attributes, variantGroups)}
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {warehouses.map((warehouse) => (
                      <div key={warehouse.id} className="grid gap-1">
                        <Label className="text-sm text-muted-foreground">
                          {warehouseLabel(warehouse)}
                        </Label>
                        <Input
                          type="number"
                          placeholder="0"
                          value={stockInputs[stockKey(row.key, warehouse.id)] ?? ""}
                          onChange={(e) =>
                            setStockInputs((current) => ({
                              ...current,
                              [stockKey(row.key, warehouse.id)]: e.target.value,
                            }))
                          }
                        />
                      </div>
                    ))}
                  </div>
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
