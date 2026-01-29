import { useState, useMemo, useEffect } from "react";
import { POSLayout } from "@/components/layout/POSLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PaymentModal, PaymentDetails } from "@/components/pos/PaymentModal";
import { ShiftModal, ShiftActionData } from "@/components/pos/ShiftModal";
import { Search, Barcode, Plus, Minus, Trash2, CreditCard, Banknote, Wallet, QrCode, User, Percent, X, Clock, AlertTriangle, Package, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Product, Branch, Transaction, CartItem } from "@/types";
import { query, runTransaction } from "@/lib/db";

// Mock Session Data (In real app, this comes from Context/Auth)
const categories = ["Semua", "Makanan", "Minuman", "Snack", "Personal Care"];
const banks = [{ id: "bca", name: "BCA", type: "Debit & Kredit" }, { id: "mandiri", name: "Mandiri", type: "Debit & Kredit" }, { id: "bni", name: "BNI", type: "Debit" }];

interface ShiftDataState {
  openTime: Date;
  pettyCash: number;
  transactions: Transaction[];
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(value);
}

export default function POS() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Semua");
  const [discount, setDiscount] = useState(0);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [isShiftOpen, setIsShiftOpen] = useState(false);
  const [shiftMode, setShiftMode] = useState<"open" | "close">("open");
  const [isShiftActive, setIsShiftActive] = useState(false);
  const [shiftData, setShiftData] = useState<ShiftDataState | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [showLowStock, setShowLowStock] = useState(true);
  
  const [products, setProducts] = useState<Product[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [currentBranchId, setCurrentBranchId] = useState<string>("");

  const [isUnitSelectionOpen, setIsUnitSelectionOpen] = useState(false);
  const [selectedProductForUnit, setSelectedProductForUnit] = useState<Product | null>(null);

  const currentBranch = useMemo(() => 
    branches.find(b => b.id === currentBranchId) || { id: "", name: "Loading...", tenant_id: "" } as Branch,
    [branches, currentBranchId]
  );

  const fetchBranches = async () => {
    try {
        const res = await query('SELECT * FROM branches ORDER BY name');
        setBranches(res.rows);
        if (res.rows.length > 0 && !currentBranchId) {
            setCurrentBranchId(res.rows[0].id);
        }
    } catch (error) {
        console.error("Failed to fetch branches:", error);
    }
  };

  const fetchProducts = async () => {
    if (!currentBranchId) return;
    try {
        // Fetch products with stock aggregated for current branch
        const res = await query(`
            SELECT 
              p.*, 
              COALESCE(SUM(pb.quantity_current), 0) as stock,
              (
                 SELECT json_agg(json_build_object(
                   'id', id, 
                   'name', name, 
                   'conversion_factor', conversion_factor, 
                   'price', price,
                   'barcode', barcode
                 ))
                 FROM product_units 
                 WHERE product_id = p.id
              ) as units
            FROM products p
            LEFT JOIN product_batches pb ON p.id = pb.product_id AND pb.branch_id = $1
            GROUP BY p.id
        `, [currentBranchId]);
        
        // Map to Product interface
        const mappedProducts: Product[] = res.rows.map((row: any) => ({
            ...row,
            price: parseFloat(row.price),
            cost: parseFloat(row.cost),
            stock_by_branch: { [currentBranchId]: parseFloat(row.stock) },
            units: row.units || []
        }));
        
        setProducts(mappedProducts);
    } catch (error) {
        console.error("Failed to fetch products:", error);
    }
  };

  useEffect(() => {
    fetchBranches();
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [currentBranchId]);

  // Helper to get stock for current branch
  const getProductStock = (product: Product) => {
    return product.stock_by_branch?.[currentBranch.id] || 0;
  };

  const lowStockProducts = useMemo(() => 
    products.filter((p) => getProductStock(p) < p.min_stock_alert),
    [products, currentBranch.id]
  );

  const addToCart = (product: Product) => {
    if (!isShiftActive) { toast.error("Buka shift terlebih dahulu"); return; }
    
    const stock = getProductStock(product);
    if (stock <= 0) { toast.error("Stok produk habis di cabang ini"); return; }

    // Check if product has multiple units
    if (product.units && product.units.length > 0) {
      setSelectedProductForUnit(product);
      setIsUnitSelectionOpen(true);
      return;
    }

    // Default to Pcs if no units
    addCartItem(product, product.unit_type || "Pcs", 1, product.price);
  };

  const addCartItem = (product: Product, unitName: string, conversionFactor: number, price: number) => {
    const stock = getProductStock(product);
    
    setCart((prev) => {
      const existing = prev.find((item) => item.id === product.id && item.unit_name === unitName);
      
      const currentTotalBaseQty = prev.filter(i => i.id === product.id).reduce((sum, i) => sum + (i.quantity * i.conversion_factor), 0);
      const addedBaseQty = 1 * conversionFactor;

      if (currentTotalBaseQty + addedBaseQty > stock) {
         toast.error(`Stok tersedia hanya ${stock} (Base Unit)`);
         return prev;
      }

      if (existing) {
        return prev.map((item) => (item.id === product.id && item.unit_name === unitName) ? { ...item, quantity: item.quantity + 1 } : item);
      }
      
      return [...prev, { 
        id: product.id,
        sku: product.sku,
        name: product.name,
        quantity: 1,
        price: price, 
        unit_name: unitName,
        conversion_factor: conversionFactor
      }];
    });
  };

  const updateQuantity = (id: string, unitName: string, delta: number) => {
    const product = products.find(p => p.id === id);
    if (!product) return;
    
    const stock = getProductStock(product);
    
    setCart((prev) => {
      // Calculate total base quantity currently in cart for this product
      const currentTotalBaseQty = prev.filter(i => i.id === id).reduce((sum, i) => sum + (i.quantity * i.conversion_factor), 0);
      
      return prev.map((item) => {
        if (item.id === id && item.unit_name === unitName) {
          const newQty = item.quantity + delta;
          const newBaseQty = newQty * item.conversion_factor;
          const oldBaseQty = item.quantity * item.conversion_factor;
          
          if (newQty > 0 && (currentTotalBaseQty - oldBaseQty + newBaseQty) > stock) {
            toast.error(`Stok tersedia hanya ${stock} (Base Unit)`);
            return item;
          }
          return { ...item, quantity: Math.max(0, newQty) };
        }
        return item;
      }).filter(item => item.quantity > 0);
    });
  };

  const setQuantity = (id: string, unitName: string, qty: number) => {
    const product = products.find(p => p.id === id);
    if (!product) return;
    
    const stock = getProductStock(product);

    setCart((prev) => {
      const currentTotalBaseQty = prev.filter(i => i.id === id).reduce((sum, i) => sum + (i.quantity * i.conversion_factor), 0);

      return prev.map((item) => {
         if (item.id === id && item.unit_name === unitName) {
            const newBaseQty = qty * item.conversion_factor;
            const oldBaseQty = item.quantity * item.conversion_factor;
            
            if (qty > 0 && (currentTotalBaseQty - oldBaseQty + newBaseQty) > stock) {
               toast.error(`Stok tersedia hanya ${stock} (Base Unit)`);
               return item; 
            }
            return { ...item, quantity: Math.max(0, qty) };
         }
         return item;
      }).filter(item => item.quantity > 0);
    });
  };

  const removeFromCart = (id: string, unitName: string) => {
    setCart((prev) => prev.filter((item) => !(item.id === id && item.unit_name === unitName)));
  };
  const clearCart = () => { setCart([]); setDiscount(0); };

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discountAmount = subtotal * (discount / 100);
  const total = subtotal - discountAmount;
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);

  const filteredProducts = products.filter((product) => {
    const matchesSearch = product.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === "Semua" || product.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const handlePaymentComplete = async (method: string, details: PaymentDetails) => {
    try {
        let finalMethod = method;
        if (method === 'card' && details.cardType) {
            finalMethod = details.cardType;
        }

        const invoiceNumber = `INV/${Date.now()}`;
        
        await runTransaction(async (client) => {
            // 1. Create Transaction
            const trxRes = await client.query(`
                INSERT INTO transactions 
                (branch_id, cashier_id, invoice_number, total_amount, payment_method, status, created_at, amount_paid)
                VALUES ($1, $2, $3, $4, $5, 'completed', NOW(), $4)
                RETURNING id
            `, [currentBranchId, 'user-001', invoiceNumber, total, finalMethod]);
            
            const transactionId = trxRes.rows[0].id;

            // 2. Process Items
            for (const item of cart) {
                // Calculate total base units needed
                let remainingBaseQty = item.quantity * item.conversion_factor;
                
                // Fetch batches FIFO
                const batchesRes = await client.query(`
                    SELECT * FROM product_batches 
                    WHERE product_id = $1 AND branch_id = $2 AND quantity_current > 0 
                    ORDER BY received_at ASC
                `, [item.id, currentBranchId]);
                
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                for (const batch of batchesRes.rows as any[]) {
                    if (remainingBaseQty <= 0) break;
                    
                    const available = parseFloat(batch.quantity_current);
                    const takeBase = Math.min(remainingBaseQty, available);
                    
                    // Deduct from batch
                    await client.query(`
                        UPDATE product_batches 
                        SET quantity_current = quantity_current - $1
                        WHERE id = $2
                    `, [takeBase, batch.id]);
                    
                    // Calculate quantity in sold units for this batch portion
                    const quantityInSoldUnit = takeBase / item.conversion_factor;
                    
                    // Add transaction item
                    await client.query(`
                        INSERT INTO transaction_items
                        (transaction_id, product_id, batch_id, quantity, unit_price, cost_price, subtotal, unit_name, conversion_factor)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    `, [
                        transactionId, 
                        item.id, 
                        batch.id, 
                        quantityInSoldUnit, 
                        item.price, 
                        parseFloat(batch.cost_price) * item.conversion_factor, // Cost per sold unit
                        item.price * quantityInSoldUnit,
                        item.unit_name,
                        item.conversion_factor
                    ]);
                    
                    remainingBaseQty -= takeBase;
                }
                
                if (remainingBaseQty > 0.001) { // Tolerance for float math
                    throw new Error(`Insufficient stock for product ${item.name} (Need ${remainingBaseQty} more base units)`);
                }
            }
        });

        toast.success("Transaksi berhasil!");
        clearCart();
        setIsPaymentOpen(false);
        // Refresh products to show updated stock
        fetchProducts();
        
    } catch (error) {
        console.error("Payment failed:", error);
        toast.error("Transaksi gagal: " + (error instanceof Error ? error.message : "Unknown error"));
    }
  };

  const handleShiftAction = (data: ShiftActionData) => {
    if (shiftMode === "open") { 
        setIsShiftActive(true); 
        setShiftData({ 
            openTime: data.openTime!, 
            pettyCash: data.pettyCash!, 
            transactions: [] 
        }); 
        toast.success(`Shift dibuka dengan petty cash ${formatCurrency(data.pettyCash!)}`); 
    }
    else { setIsShiftActive(false); setShiftData(null); setTransactions([]); }
  };

  const openShiftModal = (mode: "open" | "close") => { setShiftMode(mode); setIsShiftOpen(true); };

  return (
    <POSLayout>
      <div className="h-[calc(100vh-8rem)] md:h-[calc(100vh-6rem)] flex flex-col lg:flex-row gap-4">
        {/* Products */}
        <div className="flex-1 flex flex-col bg-card rounded-xl border overflow-hidden min-h-0">
          <div className="p-3 md:p-4 border-b space-y-3">
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 px-3 py-1 rounded-full">
                    <MapPin className="w-4 h-4" />
                    <span>{currentBranch.name}</span>
                </div>
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input placeholder="Cari produk..." className="pl-10" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} /></div>
              <Button variant="outline" size="icon"><Barcode className="w-5 h-5" /></Button>
              {!isShiftActive ? <Button onClick={() => openShiftModal("open")} className="gap-2"><Clock className="w-4 h-4" /><span className="hidden sm:inline">Buka Shift</span></Button> : <Button variant="destructive" onClick={() => openShiftModal("close")} className="gap-2"><Clock className="w-4 h-4" /><span className="hidden sm:inline">Tutup Shift</span></Button>}
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">{categories.map((category) => (<Button key={category} variant={selectedCategory === category ? "default" : "outline"} size="sm" onClick={() => setSelectedCategory(category)} className="whitespace-nowrap text-xs md:text-sm">{category}</Button>))}</div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 md:p-4">
            {/* Low Stock Alert */}
            {showLowStock && lowStockProducts.length > 0 && (
              <div className="mb-4 p-3 rounded-lg border border-warning/30 bg-warning/5">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-warning" />
                    <span className="text-sm font-medium text-warning">Stok Minimum Alert ({lowStockProducts.length} produk)</span>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setShowLowStock(false)} className="h-6 w-6 p-0">
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {lowStockProducts.map((item) => {
                    const stock = getProductStock(item);
                    return (
                    <div key={item.id} className="flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-md bg-warning/10 border border-warning/20">
                      <Package className="w-4 h-4 text-warning" />
                      <div>
                        <p className="text-xs font-medium">{item.name}</p>
                        <p className="text-xs text-muted-foreground">Stok: <span className="text-warning font-bold">{stock}</span> / {item.min_stock_alert}</p>
                      </div>
                    </div>
                  )})}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 md:gap-3">
              {filteredProducts.map((product) => {
                const stock = getProductStock(product);
                const isLowStock = stock < product.min_stock_alert;
                const isOutOfStock = stock <= 0;
                return (
                  <button 
                    key={product.id} 
                    onClick={() => addToCart(product)} 
                    disabled={isOutOfStock}
                    className={`p-3 md:p-4 rounded-xl border transition-all text-left group relative ${
                      isOutOfStock 
                        ? 'bg-muted/30 opacity-60 cursor-not-allowed border-destructive/30' 
                        : isLowStock 
                          ? 'bg-muted/50 hover:bg-primary/10 border-warning/50' 
                          : 'bg-muted/50 hover:bg-primary/10 border-transparent hover:border-primary/30'
                    }`}
                  >
                    {isOutOfStock && (
                      <div className="absolute inset-0 flex items-center justify-center bg-background/60 rounded-xl z-10">
                        <Badge variant="destructive" className="text-xs">HABIS</Badge>
                      </div>
                    )}
                    <div className="aspect-square rounded-lg bg-gradient-to-br from-primary/20 to-info/20 mb-2 md:mb-3 flex items-center justify-center relative">
                      <span className="text-2xl md:text-3xl">📦</span>
                      {isLowStock && !isOutOfStock && <div className="absolute top-1 right-1"><AlertTriangle className="w-4 h-4 text-warning" /></div>}
                    </div>
                    <h4 className={`font-medium text-xs md:text-sm line-clamp-2 ${!isOutOfStock && 'group-hover:text-primary'}`}>{product.name}</h4>
                    <p className="text-xs text-muted-foreground mt-1">{product.sku}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="font-bold text-primary text-xs md:text-sm">{formatCurrency(product.price)}</span>
                      <Badge variant={isOutOfStock ? "destructive" : isLowStock ? "destructive" : "secondary"} className="text-xs">
                        {isOutOfStock ? "0" : stock}
                      </Badge>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Cart */}
        <div className="w-full lg:w-96 flex flex-col bg-card rounded-xl border overflow-hidden">
          <div className="p-3 md:p-4 border-b"><div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold">Keranjang</h2><p className="text-sm text-muted-foreground">{totalItems} item</p></div>{cart.length > 0 && <Button variant="ghost" size="sm" onClick={clearCart} className="text-destructive"><Trash2 className="w-4 h-4 mr-1" />Hapus</Button>}</div></div>
          <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-2 md:space-y-3 min-h-[150px] max-h-[200px] lg:max-h-none">
            {cart.length === 0 ? <div className="h-full flex flex-col items-center justify-center text-muted-foreground py-8"><QrCode className="w-12 h-12 md:w-16 md:h-16 mb-4 opacity-50" /><p className="font-medium">Keranjang kosong</p><p className="text-sm">Scan barcode atau pilih produk</p></div> : cart.map((item) => (
              <div key={`${item.id}-${item.unit_name}`} className="flex items-center gap-2 md:gap-3 p-2 md:p-3 rounded-lg bg-muted/50">
                <div className="w-10 h-10 md:w-12 md:h-12 rounded-lg bg-gradient-to-br from-primary/20 to-info/20 flex items-center justify-center text-lg md:text-xl">📦</div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-xs md:text-sm truncate">
                    {item.name}
                    <span className="ml-1 text-[10px] text-muted-foreground px-1.5 py-0.5 bg-background rounded border">{item.unit_name}</span>
                  </p>
                  <p className="text-xs md:text-sm text-primary font-semibold">{formatCurrency(item.price)}</p>
                  <p className="text-xs text-muted-foreground">Total: {formatCurrency(item.price * item.quantity)}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="iconSm" onClick={() => updateQuantity(item.id, item.unit_name, -1)}><Minus className="w-3 h-3" /></Button>
                  <Input
                    type="number"
                    min="1"
                    value={item.quantity}
                    onChange={(e) => setQuantity(item.id, item.unit_name, parseInt(e.target.value) || 0)}
                    className="w-12 md:w-14 text-center font-medium text-sm h-8 px-1"
                  />
                  <Button variant="outline" size="iconSm" onClick={() => updateQuantity(item.id, item.unit_name, 1)}><Plus className="w-3 h-3" /></Button>
                </div>
                <Button variant="ghost" size="iconSm" onClick={() => removeFromCart(item.id, item.unit_name)} className="text-destructive"><X className="w-4 h-4" /></Button>
              </div>
            ))}
          </div>
          <div className="border-t p-3 md:p-4 space-y-3 md:space-y-4">
            <div className="flex items-center gap-2"><Button variant="outline" size="sm" className="gap-1"><User className="w-4 h-4" />Member</Button><Button variant={discount > 0 ? "default" : "outline"} size="sm" className="gap-1" onClick={() => setDiscount(discount > 0 ? 0 : 10)}><Percent className="w-4 h-4" />{discount > 0 ? `${discount}%` : "Diskon"}</Button></div>
            <div className="space-y-2 text-sm"><div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatCurrency(subtotal)}</span></div>{discount > 0 && <div className="flex justify-between text-success"><span>Diskon ({discount}%)</span><span>-{formatCurrency(discountAmount)}</span></div>}<div className="flex justify-between text-lg font-bold pt-2 border-t"><span>Total</span><span className="text-primary">{formatCurrency(total)}</span></div></div>
            <div className="grid grid-cols-3 gap-2"><Button variant="posSecondary" size="pos" className="flex-col gap-1"><Banknote className="w-5 h-5 md:w-6 md:h-6" /><span className="text-xs">Tunai</span></Button><Button variant="posSecondary" size="pos" className="flex-col gap-1"><CreditCard className="w-5 h-5 md:w-6 md:h-6" /><span className="text-xs">Kartu</span></Button><Button variant="posSecondary" size="pos" className="flex-col gap-1"><Wallet className="w-5 h-5 md:w-6 md:h-6" /><span className="text-xs">E-Wallet</span></Button></div>
            <Button variant="posPayment" size="xl" className="w-full" disabled={cart.length === 0 || !isShiftActive} onClick={() => setIsPaymentOpen(true)}>Bayar {formatCurrency(total)}</Button>
          </div>
        </div>
      </div>

      <PaymentModal open={isPaymentOpen} onOpenChange={setIsPaymentOpen} total={total} onPaymentComplete={handlePaymentComplete} banks={banks} />
      <ShiftModal open={isShiftOpen} onOpenChange={setIsShiftOpen} mode={shiftMode} shiftData={shiftData ? { ...shiftData, transactions } : undefined} onShiftAction={handleShiftAction} />
      
      <Dialog open={isUnitSelectionOpen} onOpenChange={setIsUnitSelectionOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Pilih Satuan - {selectedProductForUnit?.name}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            {selectedProductForUnit && (
              <>
                <Button 
                  variant="outline" 
                  className="justify-between h-auto py-3"
                  onClick={() => {
                    if (selectedProductForUnit) {
                      addCartItem(selectedProductForUnit, selectedProductForUnit.unit_type || "Pcs", 1, selectedProductForUnit.price);
                      setIsUnitSelectionOpen(false);
                    }
                  }}
                >
                  <div className="flex flex-col items-start">
                    <span className="font-medium">{selectedProductForUnit.unit_type || "Pcs"} (1)</span>
                    <span className="text-xs text-muted-foreground">Satuan Dasar</span>
                  </div>
                  <span className="font-bold">{formatCurrency(selectedProductForUnit.price)}</span>
                </Button>
                
                {selectedProductForUnit.units?.map((u) => (
                  <Button 
                    key={u.name} 
                    variant="outline" 
                    className="justify-between h-auto py-3"
                    onClick={() => {
                      if (selectedProductForUnit) {
                        addCartItem(selectedProductForUnit, u.name, u.conversion_factor, u.price);
                        setIsUnitSelectionOpen(false);
                      }
                    }}
                  >
                    <div className="flex flex-col items-start">
                      <span className="font-medium">{u.name} ({u.conversion_factor})</span>
                      <span className="text-xs text-muted-foreground">Konversi: {u.conversion_factor} {selectedProductForUnit.unit_type || "Pcs"}</span>
                    </div>
                    <span className="font-bold">{formatCurrency(u.price)}</span>
                  </Button>
                ))}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </POSLayout>
  );
}
