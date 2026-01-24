import { Branch, Product, Transaction } from '@/types';

export const mockBranches: Branch[] = [
  {
    id: "branch-001",
    tenant_id: "tenant-001",
    name: "Cabang Pusat (Jakarta)",
    address: "Jl. Sudirman No. 1, Jakarta",
    phone: "021-1234567",
    is_active: true,
  },
  {
    id: "branch-002",
    tenant_id: "tenant-001",
    name: "Cabang Surabaya",
    address: "Jl. Tunjungan No. 10, Surabaya",
    phone: "031-7654321",
    is_active: true,
  },
];

export const mockProducts: Product[] = [
  {
    id: "PROD-001",
    tenant_id: "tenant-001",
    sku: "SKU-001",
    name: "Kopi Robusta Premium",
    category: "Minuman",
    description: "Kopi robusta pilihan dengan aroma kuat",
    price: 45000,
    cost: 25000,
    unit_type: "pcs",
    min_stock_alert: 10,
    stock_by_branch: {
      "branch-001": 50,
      "branch-002": 25,
    },
  },
  {
    id: "PROD-002",
    tenant_id: "tenant-001",
    sku: "SKU-002",
    name: "Teh Hijau Jasmine",
    category: "Minuman",
    price: 35000,
    cost: 18000,
    unit_type: "pcs",
    min_stock_alert: 15,
    stock_by_branch: {
      "branch-001": 100,
      "branch-002": 80,
    },
  },
  {
    id: "PROD-003",
    tenant_id: "tenant-001",
    sku: "SKU-003",
    name: "Roti Bakar Coklat",
    category: "Makanan",
    price: 25000,
    cost: 12000,
    unit_type: "porsi",
    min_stock_alert: 5,
    stock_by_branch: {
      "branch-001": 20,
      "branch-002": 0,
    },
  },
  {
    id: "PROD-004",
    tenant_id: "tenant-001",
    sku: "SKU-004",
    name: "Nasi Goreng Spesial",
    category: "Makanan",
    price: 35000,
    cost: 15000,
    unit_type: "porsi",
    min_stock_alert: 5,
    stock_by_branch: {
      "branch-001": 15,
      "branch-002": 10,
    },
  },
  {
    id: "PROD-005",
    tenant_id: "tenant-001",
    sku: "SKU-005",
    name: "Es Jeruk Murni",
    category: "Minuman",
    price: 15000,
    cost: 5000,
    unit_type: "gelas",
    min_stock_alert: 20,
    stock_by_branch: {
      "branch-001": 40,
      "branch-002": 30,
    },
  }
];

export const mockTransactions: Transaction[] = [
  {
    id: "TRX-001",
    tenant_id: "tenant-001",
    branch_id: "branch-001",
    cashier_id: "user-001",
    invoice_number: "INV/20240115/001",
    total_amount: 135000,
    payment_method: "cash",
    status: "completed",
    created_at: "2024-01-15T14:30:00Z",
    items: [
      {
        id: "ITEM-001",
        tenant_id: "tenant-001",
        product_id: "PROD-001",
        product_name: "Kopi Robusta Premium",
        quantity: 2,
        unit_price: 45000,
        subtotal: 90000,
      },
      {
        id: "ITEM-002",
        tenant_id: "tenant-001",
        product_id: "PROD-002",
        product_name: "Teh Hijau Jasmine",
        quantity: 1,
        unit_price: 45000, // Adjusted to match mock total
        subtotal: 45000,
      },
    ],
  },
   {
    id: "TRX-002",
    tenant_id: "tenant-001",
    branch_id: "branch-002",
    cashier_id: "user-002",
    invoice_number: "INV/20240115/002",
    total_amount: 70000,
    payment_method: "card",
    status: "completed",
    created_at: "2024-01-15T15:00:00Z",
    items: [
      {
        id: "ITEM-003",
        tenant_id: "tenant-001",
        product_id: "PROD-002",
        product_name: "Teh Hijau Jasmine",
        quantity: 2,
        unit_price: 35000,
        subtotal: 70000,
      },
    ],
  },
];
