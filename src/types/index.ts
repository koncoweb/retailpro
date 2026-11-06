export type UserRole =
  | 'platform_owner'
  | 'tenant_owner'
  | 'tenant_admin'
  | 'store_manager'
  | 'cashier'
  | 'warehouse'
  /** Sits at the purchasing desk: raises orders, cannot approve them. */
  | 'purchasing'
  | 'staff'
  | 'admin';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: 'free' | 'pro' | 'enterprise';
  status: 'active' | 'pending' | 'suspended';
}

export interface Branch {
  id: string;
  tenant_id: string;
  name: string;
  address: string;
  phone?: string;
  /** Sales channel: a physical store, an online store, or both. */
  type?: 'store' | 'online' | 'hybrid';
  /** Exactly one branch per tenant is the head office. */
  is_headquarters?: boolean;
  parent_branch_id?: string | null;
  is_active?: boolean;
}

/**
 * A stocking location. Warehouses hold `product_batches`; branches sell from
 * them. `branch_id` is the owning branch (null = company-wide/shared).
 */
export interface Warehouse {
  id: string;
  name: string;
  code: string | null;
  type: string;
  branch_id: string | null;
  address?: string | null;
  status: string;
  is_default: number;
}

export interface User {
  id: string;
  tenant_id: string;
  email: string;
  role: UserRole;
  assigned_branch_id?: string;
  name: string;
}

export interface ProductUnit {
  id?: string;
  name: string;
  conversion_factor: number;
  price: number;
  barcode: string;
  /** Buy price per pack; 0 when the vendor has not quoted it yet. */
  cost?: number;
}

/**
 * One sellable SKU of a product: the flavour or size that is actually stocked.
 *
 * A product is the MODEL; a variant is what carries a barcode, a price and its
 * own batches. Packs belong to the variant, so a carton of one flavour is never
 * priced from the piece of another.
 */
export interface ProductVariant {
  id: string;
  sku: string;
  /** Ready to render, e.g. "Susu 250ml"; resolved from the product's groups. */
  label: string;
  /** Selling price of this variant's base unit. */
  price: number;
  /** This variant's own packs. */
  units: ProductUnit[];
  /** On-hand quantity per warehouse id, in base units. */
  stock_by_warehouse: Record<string, number>;
}

export interface Product {
  id: string;
  tenant_id: string;
  sku: string;
  name: string;
  category: string;
  description?: string;
  price: number; // Selling Price (Base Unit)
  cost: number; // Base Cost (for reference, actual cost is in batches)
  unit_type: string;
  min_stock_alert: number;
  units: ProductUnit[]; // Multi-unit support
  /** One row per sellable SKU. Omitted by callers that only price the model. */
  variants?: ProductVariant[];
  
  // Frontend helper for multi-warehouse stock view
  // In real DB, this comes from aggregation of product_batches
  stock_by_warehouse: Record<string, number>; 
}

export interface ProductBatch {
  id: string;
  tenant_id: string;
  warehouse_id: string;
  product_id: string;
  batch_number: string;
  expiry_date?: string;
  quantity_current: number;
  cost_price: number;
}

export interface CartItem {
  id: string; // Product ID
  sku: string;
  name: string;
  price: number;
  quantity: number;
  unit_name: string;
  conversion_factor: number;
  /** Which variant sold; null means the product-wide line of a legacy item. */
  variant_id?: string | null;
  /** "Susu 250ml" for the cart line and the receipt. */
  variant_name?: string;
  /**
   * Set when the auto pack-price rule repriced a base-unit line to a bulk deal:
   * the bulk pack that won and the rupiah saved. Display-only, never persisted;
   * it exists so the cashier sees WHY the unit price dropped below the shelf.
   */
  auto_pack_unit?: string;
  auto_pack_saving?: number;
  // The cashier never picks a batch: the tenant's issue policy (FIFO / LIFO /
  // FEFO, stored in `tenants.settings.inventory.stock_issue_method`) decides
  // which batch leaves first when the sale is committed.
}

export interface Transaction {
  id: string;
  tenant_id: string;
  branch_id: string;
  cashier_id: string;
  customer_id?: string;
  invoice_number: string;
  total_amount: number;
  payment_method: 'cash' | 'card' | 'qris' | 'ewallet' | 'debit' | 'credit';
  status: 'completed' | 'void';
  created_at: string;
  items: TransactionItem[];
  /** Joined from `users` by the transaction reports query; display only. */
  cashier_name?: string | null;
}

export interface TransactionItem {
  id: string;
  tenant_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  unit_name?: string;
  conversion_factor?: number;
}

export interface Shift {
  id: string;
  tenant_id: string;
  branch_id: string;
  user_id: string;
  start_time: string;
  end_time?: string;
  initial_cash: number;
  final_cash?: number;
  expected_cash?: number;
  difference?: number;
  notes?: string;
  status: 'open' | 'closed';
  created_at: string;
}

// Mock Session State
export interface SessionState {
  tenant: Tenant;
  user: User;
  currentBranch: Branch;
}
