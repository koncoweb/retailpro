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
import { Package, Search, CheckCircle2, AlertTriangle } from "lucide-react";

interface Product {
  id: string;
  sku: string;
  name: string;
  stock: number;
  branches: Record<string, number>;
}

interface StockOpnameModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  branches: Array<{ id: string; name: string }>;
  onSave: (opname: {
    location: string;
    items: Array<{
      productId: string;
      systemStock: number;
      actualStock: number;
      difference: number;
    }>;
  }) => void;
}

export function StockOpnameModal({ open, onOpenChange, products, branches, onSave }: StockOpnameModalProps) {
  const [selectedLocation, setSelectedLocation] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [actualStocks, setActualStocks] = useState<Record<string, string>>({});

  const getLocationProducts = () => {
    if (!selectedLocation) return [];
    return products.map(p => ({
      ...p,
      locationStock: p.branches[selectedLocation] || 0,
    })).filter(p => 
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchQuery.toLowerCase())
    );
  };

  const locationProducts = getLocationProducts();

  const handleActualStockChange = (productId: string, value: string) => {
    setActualStocks({ ...actualStocks, [productId]: value });
  };

  const handleSubmit = () => {
    if (!selectedLocation) {
      toast.error("Pilih lokasi terlebih dahulu");
      return;
    }

    const items = locationProducts.map(product => {
      const actualStockStr = actualStocks[product.id];
      const actualStock = actualStockStr !== undefined && actualStockStr !== "" 
        ? parseInt(actualStockStr) 
        : product.locationStock;
      
      return {
        productId: product.id,
        systemStock: product.locationStock,
        actualStock,
        difference: actualStock - product.locationStock,
      };
    });

    const hasChanges = items.some(item => item.difference !== 0);
    
    onSave({
      location: selectedLocation,
      items,
    });

    toast.success(hasChanges ? "Stock opname berhasil disimpan" : "Tidak ada perubahan stok");
    onOpenChange(false);
    setSelectedLocation("");
    setActualStocks({});
  };

  const getTotalDifference = () => {
    return locationProducts.reduce((sum, product) => {
      const actualStockStr = actualStocks[product.id];
      const actual = actualStockStr !== undefined && actualStockStr !== "" 
        ? parseInt(actualStockStr) 
        : product.locationStock;
      return sum + (actual - product.locationStock);
    }, 0);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Stock Opname</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Location Selection */}
          <div className="flex gap-4">
            <div className="grid gap-2">
              <Label>Lokasi Opname</Label>
              <Select value={selectedLocation} onValueChange={setSelectedLocation}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih lokasi" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedLocation && (
              <div className="flex-1">
                <Label>Cari Produk</Label>
                <div className="relative mt-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Cari SKU atau nama..."
                    className="pl-10"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Summary */}
          {selectedLocation && (
            <div className="flex gap-4">
              <div className="flex-1 bg-muted/50 rounded-lg p-3">
                <p className="text-sm text-muted-foreground">Total Produk</p>
                <p className="text-xl font-bold">{locationProducts.length}</p>
              </div>
              <div className={`flex-1 rounded-lg p-3 ${getTotalDifference() === 0 ? 'bg-success/10' : getTotalDifference() > 0 ? 'bg-info/10' : 'bg-destructive/10'}`}>
                <p className="text-sm text-muted-foreground">Selisih Total</p>
                <p className={`text-xl font-bold ${getTotalDifference() === 0 ? 'text-success' : getTotalDifference() > 0 ? 'text-info' : 'text-destructive'}`}>
                  {getTotalDifference() > 0 ? '+' : ''}{getTotalDifference()}
                </p>
              </div>
            </div>
          )}

          {/* Products Table */}
          {selectedLocation && locationProducts.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produk</TableHead>
                    <TableHead className="text-center">Stok Sistem</TableHead>
                    <TableHead className="text-center">Stok Aktual</TableHead>
                    <TableHead className="text-center">Selisih</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {locationProducts.map((product) => {
                    const actualStockStr = actualStocks[product.id];
                    const actualStock = actualStockStr !== undefined && actualStockStr !== "" 
                      ? parseInt(actualStockStr) 
                      : product.locationStock;
                    const difference = actualStock - product.locationStock;
                    
                    return (
                      <TableRow key={product.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Package className="w-4 h-4 text-muted-foreground" />
                            <div>
                              <p className="font-medium">{product.name}</p>
                              <p className="text-xs text-muted-foreground">{product.sku}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="secondary">{product.locationStock}</Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Input
                            type="number"
                            className="w-20 mx-auto text-center"
                            placeholder={product.locationStock.toString()}
                            value={actualStocks[product.id] || ""}
                            onChange={(e) => handleActualStockChange(product.id, e.target.value)}
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={`font-medium ${difference === 0 ? 'text-muted-foreground' : difference > 0 ? 'text-success' : 'text-destructive'}`}>
                            {difference > 0 ? '+' : ''}{difference}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          {difference === 0 ? (
                            <CheckCircle2 className="w-5 h-5 text-success mx-auto" />
                          ) : (
                            <AlertTriangle className="w-5 h-5 text-warning mx-auto" />
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {selectedLocation && locationProducts.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              Tidak ada produk ditemukan di lokasi ini
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button className="flex-1" onClick={handleSubmit} disabled={!selectedLocation}>
            Simpan Opname
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
