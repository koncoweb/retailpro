export type UserRole = 'platform_owner' | 'tenant_owner' | 'tenant_admin' | 'store_manager' | 'cashier' | 'admin';

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
  is_active?: boolean;
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
  
  // Frontend helper for multi-branch stock view
  // In real DB, this comes from aggregation of product_batches
  stock_by_branch: Record<string, number>; 
}

export interface ProductBatch {
  id: string;
  tenant_id: string;
  branch_id: string;
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
  // In a real scenario, we might select specific batch if manually picking,
  // but usually FIFO is automatic on backend.
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
