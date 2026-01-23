import { useState, useMemo } from "react";
import { POSLayout } from "@/components/layout/POSLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PaymentModal, PaymentDetails } from "@/components/pos/PaymentModal";
import { ShiftModal, ShiftActionData } from "@/components/pos/ShiftModal";
import { Search, Barcode, Plus, Minus, Trash2, CreditCard, Banknote, Wallet, QrCode, User, Percent, X, Clock, AlertTriangle, Package, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Product, Branch, Transaction, CartItem } from "@/types";
import { mockProducts, mockBranches } from "@/data/mockData";

// Mock Session Data (In real app, this comes from Context/Auth)
// Using first branch from mock data as current branch
const currentBranch: Branch = mockBranches[0];

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

  // Helper to get stock for current branch
  const getProductStock = (product: Product) => {
    return product.stock_by_branch[currentBranch.id] || 0;
  };

  const lowStockProducts = useMemo(() => 
    mockProducts.filter((p) => getProductStock(p) < p.min_stock_alert),
    []
  );

  const addToCart = (product: Product) => {
    if (!isShiftActive) { toast.error("Buka shift terlebih dahulu"); return; }
    
    const stock = getProductStock(product);
    if (stock <= 0) { toast.error("Stok produk habis di cabang ini"); return; }
    
    setCart((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      if (existing) {
        if (existing.quantity >= stock) {
          toast.error(`Stok tersedia hanya ${stock} unit`);
          return prev;
        }
        return prev.map((item) => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const updateQuantity = (id: string, delta: number) => {
    const product = mockProducts.find(p => p.id === id);
    if (!product) return;
    
    const stock = getProductStock(product);
    
    setCart((prev) => prev.map((item) => {
      if (item.id === id) {
        const newQty = item.quantity + delta;
        if (newQty > stock) {
          toast.error(`Stok tersedia hanya ${stock} unit`);
          return item;
        }
        return { ...item, quantity: Math.max(0, newQty) };
      }
      return item;
    }).filter((item) => item.quantity > 0));
  };
  
  const setQuantity = (id: string, qty: number) => {
    const product = mockProducts.find(p => p.id === id);
    if (!product) return;

    const stock = getProductStock(product);
    
    if (qty <= 0) {
      setCart((prev) => prev.filter((item) => item.id !== id));
    } else if (qty > stock) {
      toast.error(`Stok tersedia hanya ${stock} unit`);
      setCart((prev) => prev.map((item) => item.id === id ? { ...item, quantity: stock } : item));
    } else {
      setCart((prev) => prev.map((item) => item.id === id ? { ...item, quantity: qty } : item));
    }
  };

  const removeFromCart = (id: string) => setCart((prev) => prev.filter((item) => item.id !== id));
  const clearCart = () => { setCart([]); setDiscount(0); };

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discountAmount = subtotal * (discount / 100);
  const total = subtotal - discountAmount;
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);

  const filteredProducts = mockProducts.filter((product) => {
    const matchesSearch = product.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === "Semua" || product.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const handlePaymentComplete = (method: string, details: PaymentDetails) => {
    let finalMethod = method;
    if (method === 'card' && details.cardType) {
      finalMethod = details.cardType;
    }

    const trx: Transaction = {
      id: `TRX-${Date.now()}`,
      tenant_id: currentBranch.tenant_id,
      branch_id: currentBranch.id,
      cashier_id: "user-001", // Mock user
      invoice_number: `INV/${Date.now()}`,
      created_at: new Date().toISOString(),
      total_amount: total,
      payment_method: finalMethod as Transaction['payment_method'],
      status: 'completed',
      items: cart.map(item => ({
        id: `ITEM-${Date.now()}-${item.id}`,
        product_id: item.id,
        product_name: item.name,
        quantity: item.quantity,
        unit_price: item.price,
        subtotal: item.price * item.quantity
      }))
    };
    
    setTransactions((prev) => [...prev, trx]);
    clearCart();
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
              <div key={item.id} className="flex items-center gap-2 md:gap-3 p-2 md:p-3 rounded-lg bg-muted/50">
                <div className="w-10 h-10 md:w-12 md:h-12 rounded-lg bg-gradient-to-br from-primary/20 to-info/20 flex items-center justify-center text-lg md:text-xl">📦</div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-xs md:text-sm truncate">{item.name}</p>
                  <p className="text-xs md:text-sm text-primary font-semibold">{formatCurrency(item.price)}</p>
                  <p className="text-xs text-muted-foreground">Total: {formatCurrency(item.price * item.quantity)}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="iconSm" onClick={() => updateQuantity(item.id, -1)}><Minus className="w-3 h-3" /></Button>
                  <Input
                    type="number"
                    min="1"
                    value={item.quantity}
                    onChange={(e) => setQuantity(item.id, parseInt(e.target.value) || 0)}
                    className="w-12 md:w-14 text-center font-medium text-sm h-8 px-1"
                  />
                  <Button variant="outline" size="iconSm" onClick={() => updateQuantity(item.id, 1)}><Plus className="w-3 h-3" /></Button>
                </div>
                <Button variant="ghost" size="iconSm" onClick={() => removeFromCart(item.id)} className="text-destructive"><X className="w-4 h-4" /></Button>
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
    </POSLayout>
  );
}
