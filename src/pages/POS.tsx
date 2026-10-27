import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { useTenant } from "@/contexts/TenantContext";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Barcode, Plus, Minus, Trash2, CreditCard, Banknote, Wallet, QrCode, User, Percent, X, Clock, AlertTriangle, Package, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Product, Branch, Transaction, CartItem } from "@/types";
import { query, runTransaction, batchQuery, parseJson, type BatchStatement } from "@/lib/db";
import { logAuditTx } from "@/lib/audit";
import { resolveBranchWarehouse } from "@/lib/warehouse";
import { getStockIssueMethod } from "@/lib/tenant-settings";
import { sortBatchesForIssue } from "@/lib/stock-issue";

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
  const { user } = useAuth();
  // Branch scoping comes from the verified tenant session, not from row order.
  // The previous `res.rows[0].id` fallback quietly rang sales up against
  // whichever branch sorted first, which became a real risk once the database
  // (RLS) stopped enforcing a branch for us.
  const { session: tenantSession } = useTenant();
  const navigate = useNavigate();
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
  const [currentShiftId, setCurrentShiftId] = useState<string | null>(null);
  
  const [products, setProducts] = useState<Product[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [currentBranchId, setCurrentBranchId] = useState<string>("");
  /** Stockroom the till sells from; resolved from the branch↔warehouse map. */
  const [currentWarehouseId, setCurrentWarehouseId] = useState<string | null>(null);

  const [isUnitSelectionOpen, setIsUnitSelectionOpen] = useState(false);
  const [selectedProductForUnit, setSelectedProductForUnit] = useState<Product | null>(null);

  const currentBranch = useMemo(() =>
    branches.find(b => b.id === currentBranchId) || { id: "", name: "Loading...", tenant_id: "" } as Branch,
    [branches, currentBranchId]
  );
  
  /** Company-level roles may ring up any branch; staff are scoped to theirs. */
  const canSwitchBranch = useMemo(
    () => ["platform_owner", "tenant_owner", "tenant_admin", "admin"].includes(user?.role ?? ""),
    [user?.role]
  );

  const fetchBranches = async () => {
    try {
        const res = await query('SELECT * FROM branches ORDER BY name');
        setBranches(res.rows);
        if (currentBranchId || res.rows.length === 0) return;

        // Precedence: the branch on the tenant session (resolved at sign-in),
        // then this person's assigned branch, and only then the first branch —
        // which is the owner case, where every branch is in scope.
        const rows = res.rows as Branch[];
        const preferred =
          rows.find((b) => b.id === tenantSession?.branchId) ??
          rows.find((b) => b.id === user?.assigned_branch_id) ??
          rows[0];
        setCurrentBranchId(preferred.id);
    } catch (error) {
        console.error("Failed to fetch branches:", error);
    }
  };

  /**
   * Register load is two round-trips: branches, then a single batch carrying
   * the branch catalogue (product + units + stock via JSON1) and this cashier's
   * open shift. The shift lookup used to be a third sequential round-trip in
   * its own effect, and it also popped the open-shift dialog whenever a shift
   * was found — which invited the cashier to open a duplicate.
   */
  const fetchProducts = async () => {
    if (!currentBranchId) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userId = (user as any)?.id as string | undefined;
    try {
        // A till sells from one stockroom. Resolve it before pricing the grid,
        // otherwise stock would be aggregated across every warehouse.
        const warehouseId = await resolveBranchWarehouse(currentBranchId);
        setCurrentWarehouseId(warehouseId);
        if (!warehouseId) {
          setProducts([]);
          return;
        }

        const statements: BatchStatement[] = [
          {
            sql: `
              SELECT 
                p.*, 
                COALESCE(SUM(pb.quantity_current), 0) as stock,
                COALESCE((
                   SELECT json_group_array(json_object(
                     'id', id, 
                     'name', name, 
                     'conversion_factor', conversion_factor, 
                     'price', price,
                     'barcode', barcode
                   ))
                   FROM product_units 
                   WHERE product_id = p.id
                ), '[]') as units
              FROM products p
              LEFT JOIN product_batches pb ON p.id = pb.product_id AND pb.warehouse_id = $1
              GROUP BY p.id
            `,
            params: [warehouseId],
          },
        ];

        if (userId) {
          // The session branch wins: it is what bootstrap resolved from the
          // registry, so a shift is never matched against another branch.
          statements.push({
            sql: `SELECT id FROM shifts WHERE user_id = $1 AND branch_id = $2 AND status = 'open'`,
            params: [userId, currentBranchId],
          });
        }

        const [productRes, shiftRes] = await batchQuery(statements);

        // Map to Product interface
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mappedProducts: Product[] = (productRes.rows as any[]).map((row) => ({
            ...row,
            price: parseFloat(row.price),
            cost: parseFloat(row.cost),
            stock_by_warehouse: { [warehouseId]: parseFloat(row.stock) },
            // JSON columns arrive as TEXT — parse them before use.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            units: parseJson<any[]>(row.units, [])
        }));
        
        setProducts(mappedProducts);

        if (!userId) return;

        if (!shiftRes || shiftRes.rows.length === 0) {
            setCurrentShiftId(null);
            setIsShiftActive(false);
            toast.warning("Silakan buka shift terlebih dahulu untuk melakukan transaksi.");
            navigate("/pos/shifts");
        } else {
            setCurrentShiftId((shiftRes.rows[0] as { id: string }).id);
            setIsShiftActive(true);
        }
    } catch (error) {
        console.error("Failed to fetch products:", error);
    }
  };

  useEffect(() => {
    fetchBranches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantSession?.branchId]);

  useEffect(() => {
    fetchProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBranchId, user]);

  // Helper to get stock for the current branch's stockroom
  const getProductStock = (product: Product) => {
    if (!currentWarehouseId) return 0;
    return product.stock_by_warehouse?.[currentWarehouseId] || 0;
  };

  const lowStockProducts = useMemo(() => 
    products.filter((p) => getProductStock(p) < p.min_stock_alert),
    [products, currentWarehouseId]
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cashierId = (user as any)?.id;

        // Stock lives in warehouses; the till deducts from this branch's
        // default stockroom. Re-resolved here so a mapping change made in
        // another tab cannot leave the sale pointed at a stale warehouse.
        const warehouseId = currentWarehouseId ?? (await resolveBranchWarehouse(currentBranchId));
        if (!warehouseId) {
          throw new Error("Gudang untuk cabang ini belum disiapkan, hubungi admin.");
        }

        // Which batch leaves first is a tenant policy (FIFO / LIFO / FEFO).
        // Read before the transaction opens: the deduction loop below sorts the
        // candidates in memory instead of re-querying settings mid-sale.
        const issueMethod = await getStockIssueMethod();

        // Tender fidelity: `amount_paid` is what the customer actually handed
        // over, not the cart total (they differ for every cash sale).
        const amountPaid = details.received ?? total;

        // Pre-flight stock check. It must happen before the transaction opens:
        // a shortage discovered halfway through used to leave a committed
        // transaction with only part of its stock deducted.
        const requiredByProduct = new Map<string, number>();
        for (const item of cart) {
          const base = item.quantity * item.conversion_factor;
          requiredByProduct.set(item.id, (requiredByProduct.get(item.id) ?? 0) + base);
        }
        for (const [productId, required] of requiredByProduct) {
          const stockRes = await query<{ available: number }>(
            `SELECT COALESCE(SUM(quantity_current), 0) AS available
               FROM product_batches
              WHERE product_id = $1 AND warehouse_id = $2 AND quantity_current > 0`,
            [productId, warehouseId]
          );
          const available = Number(stockRes.rows[0]?.available ?? 0);
          if (available + 0.001 < required) {
            const productName = cart.find((c) => c.id === productId)?.name ?? productId;
            throw new Error(
              `Stok tidak cukup untuk ${productName}: tersedia ${available}, dibutuhkan ${required}`
            );
          }
        }

        await runTransaction(async (client) => {
            // 1. Create Transaction
            const trxRes = await client.query(`
                INSERT INTO transactions 
                (branch_id, cashier_id, invoice_number, total_amount, payment_method, status, created_at, amount_paid, shift_id)
                VALUES ($1, $2, $3, $4, $5, 'completed', strftime('%Y-%m-%dT%H:%M:%fZ','now'), $6, $7)
                RETURNING id
            `, [currentBranchId, cashierId, invoiceNumber, total, finalMethod, amountPaid, currentShiftId]);
            
            const transactionId = trxRes.rows[0].id;

            // 2. Process Items
            for (const item of cart) {
                // Calculate total base units needed
                let remainingBaseQty = item.quantity * item.conversion_factor;
                
                // Candidates come back unordered; the policy decides which one
                // leaves first. `id` still breaks ties so the order is
                // deterministic when two batches share a timestamp.
                const batchesRes = await client.query(`
                    SELECT * FROM product_batches 
                    WHERE product_id = $1 AND warehouse_id = $2 AND quantity_current > 0
                `, [item.id, warehouseId]);

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const batches = sortBatchesForIssue(batchesRes.rows as any[], issueMethod);

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                for (const batch of batches) {
                    if (remainingBaseQty <= 0) break;
                    
                    const available = parseFloat(batch.quantity_current);
                    const takeBase = Math.min(remainingBaseQty, available);
                    
                    // Deduct from batch. The `>=` predicate makes the write
                    // itself the stock guard: if another till drained this batch
                    // in the meantime, nothing is written and we fail loudly
                    // instead of driving stock negative.
                    const deductRes = await client.query(`
                        UPDATE product_batches 
                        SET quantity_current = quantity_current - $1
                        WHERE id = $2 AND quantity_current >= $1
                    `, [takeBase, batch.id]);

                    if (deductRes.rowCount === 0) {
                        throw new Error(
                            `Stok ${item.name} berubah saat transaksi berjalan. Muat ulang lalu coba lagi.`
                        );
                    }
                    
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

            // 3. Audit trail. Written on the same transaction so a completed
            // sale can never exist without its audit entry, and a rolled-back
            // sale never leaves one behind.
            await logAuditTx(client, {
                action: "checkout",
                entity: "transactions",
                entityId: transactionId,
                userId: cashierId,
                details: {
                    invoice_number: invoiceNumber,
                    branch_id: currentBranchId,
                    shift_id: currentShiftId,
                    total_amount: total,
                    amount_paid: amountPaid,
                    change: amountPaid - total,
                    payment_method: finalMethod,
                    item_count: cart.length,
                    // Which batch policy produced these COGS figures.
                    stock_issue_method: issueMethod,
                },
            });
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

  /**
   * Shift open/close now writes to the `shifts` table instead of only local
   * state. Before this, a refreshed tab believed no shift was open, and a
   * closed shift left no cash-drawer record for the day's reconciliation.
   */
  const handleShiftAction = async (data: ShiftActionData) => {
    const userId = user?.id;
    const shiftBranchId = tenantSession?.branchId || currentBranchId;

    try {
      if (shiftMode === "open") {
        // A second open shift for the same cashier would split the drawer
        // reconciliation in two, so refuse instead of inserting.
        const existing = await query<{ id: string }>(
          `SELECT id FROM shifts WHERE user_id = $1 AND branch_id = $2 AND status = 'open'`,
          [userId, shiftBranchId]
        );
        if (existing.rows.length > 0) {
          setCurrentShiftId(existing.rows[0].id);
          setIsShiftActive(true);
          setIsShiftOpen(false);
          toast.info("Shift Anda masih terbuka.");
          return;
        }

        const res = await query<{ id: string }>(
          `INSERT INTO shifts (branch_id, user_id, start_time, initial_cash, status)
           VALUES ($1, $2, strftime('%Y-%m-%dT%H:%M:%fZ','now'), $3, 'open')
           RETURNING id`,
          [shiftBranchId, userId, data.pettyCash ?? 0]
        );
        const shiftId = res.rows[0].id;
        setCurrentShiftId(shiftId);
        setIsShiftActive(true);
        setShiftData({
          openTime: data.openTime ?? new Date(),
          pettyCash: data.pettyCash ?? 0,
          transactions: [],
        });
        toast.success(`Shift dibuka dengan petty cash ${formatCurrency(data.pettyCash ?? 0)}`);
        return;
      }

      // Closing: expected cash is recomputed from the ledger, not from the
      // modal's client-side running total, so a missed refresh cannot fake a
      // balanced drawer.
      const actualCash = data.actualCash ?? 0;
      const shiftRes = await query<{ initial_cash: number; cash_total: number }>(
        `SELECT COALESCE(s.initial_cash, 0) AS initial_cash,
                COALESCE((SELECT SUM(t.total_amount)
                            FROM transactions t
                           WHERE t.shift_id = s.id AND t.payment_method = 'cash'), 0) AS cash_total
           FROM shifts s
          WHERE s.id = $1`,
        [currentShiftId]
      );
      const expectedCash =
        Number(shiftRes.rows[0]?.initial_cash ?? 0) + Number(shiftRes.rows[0]?.cash_total ?? 0);

      if (currentShiftId) {
        await query(
          `UPDATE shifts
              SET end_time = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                  final_cash = $1,
                  expected_cash = $2,
                  difference = $3,
                  status = 'closed'
            WHERE id = $4`,
          [actualCash, expectedCash, actualCash - expectedCash, currentShiftId]
        );
      }

      setCurrentShiftId(null);
      setIsShiftActive(false);
      setShiftData(null);
      setTransactions([]);
      setIsShiftOpen(false);

      const difference = actualCash - expectedCash;
      if (Math.abs(difference) < 1) {
        toast.success(`Shift ditutup. Kas sesuai (${formatCurrency(expectedCash)}).`);
      } else {
        toast.warning(
          `Shift ditutup dengan selisih ${formatCurrency(difference)} (seharusnya ${formatCurrency(expectedCash)}).`
        );
      }
    } catch (error) {
      console.error("Shift action failed:", error);
      toast.error("Gagal memproses shift: " + (error instanceof Error ? error.message : "Unknown error"));
    }
  };

  const openShiftModal = (mode: "open" | "close") => { setShiftMode(mode); setIsShiftOpen(true); };

  return (
    <POSLayout>
      <div className="h-[calc(100vh-8rem)] md:h-[calc(100vh-6rem)] flex flex-col lg:flex-row gap-4">
        {/* Products */}
        <div className="flex-1 flex flex-col bg-card rounded-xl border overflow-hidden min-h-0">
          <div className="p-3 md:p-4 border-b space-y-3">
            <div className="flex justify-between items-center">
                {/* Owners and admins can ring up any branch; everyone else stays
                    pinned to the branch resolved from their tenant session. A
                    sale cannot post to "all branches", so no aggregate option
                    is offered here — only the read-side dashboards aggregate. */}
                {canSwitchBranch ? (
                  <Select value={currentBranchId} onValueChange={setCurrentBranchId}>
                    <SelectTrigger className="w-auto min-w-[160px] h-8 gap-2 text-sm">
                      <MapPin className="w-4 h-4" />
                      <SelectValue placeholder="Pilih cabang" />
                    </SelectTrigger>
                    <SelectContent>
                      {branches.map((branch) => (
                        <SelectItem key={branch.id} value={branch.id}>
                          {branch.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 px-3 py-1 rounded-full">
                      <MapPin className="w-4 h-4" />
                      <span>{currentBranch.name}</span>
                  </div>
                )}
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
