# RetailPro - Backend Architecture & Implementation Documentation

Dokumen ini menjelaskan detail teknis implementasi Backend, Database Schema, dan Security Policy untuk RetailPro sebagai aplikasi Multi-Tenant SaaS.

## 1. Technology Stack

### Core Infrastructure (Neon Ecosystem)
*   **Database:** [Neon (Serverless PostgreSQL)](https://neon.tech) - *Neon DB Docs*
    *   Fitur: Branching, Autoscaling, RLS (Row Level Security).
*   **Authentication:** [Neon Auth](https://neon.tech/docs/auth/overview)
    *   Fitur: User Management, Session, RBAC (Role Based Access Control) terintegrasi dengan RLS.
*   **Connectivity:** [Neon Serverless Driver](https://www.npmjs.com/package/@neondatabase/serverless) - *neonconnect*
    *   Usage: Direct secure connection from Client to Database via HTTP/WebSockets.

### Application Stack (Frontend & Logic)
*   **Framework:** React 18 + Vite
*   **Language:** TypeScript
*   **UI Components:** Shadcn/UI + Tailwind CSS
*   **Data Fetching:** TanStack Query (React Query)
*   **State Management:** React Context (untuk Auth & Tenant State)

### Development & Build Scripts
Berikut adalah script standar yang digunakan dalam pengembangan (sesuai `package.json`):

*   `npm run dev`: Menjalankan local development server menggunakan Vite.
*   `npm run build`: Melakukan build aplikasi untuk production (TypeScript compilation + Vite bundling).
*   `npm run lint`: Menjalankan ESLint untuk pemeriksaan kualitas kode dan error detection.
*   `npm run preview`: Menjalankan preview server lokal untuk hasil build production.

## 2. Database Schema & Relations

Berikut adalah definisi Schema (SQL-like) yang telah disinkronkan dengan hierarki Role dan kebutuhan Multi-Tenant.

### A. Authentication & Tenant Management (System Scope)

```sql
-- Table: tenants
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(50) UNIQUE NOT NULL,
  plan VARCHAR(20) DEFAULT 'free', -- free, pro, enterprise
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Table: branches
CREATE TABLE branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  name VARCHAR(100) NOT NULL,
  address TEXT,
  timezone VARCHAR(50) DEFAULT 'Asia/Jakarta'
);

-- Table: users (Extended Neon Auth)
CREATE TABLE users (
  id UUID PRIMARY KEY, -- Managed by Neon Auth
  tenant_id UUID REFERENCES tenants(id),
  email VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL, -- tenant_owner, tenant_admin, store_manager, cashier
  assigned_branch_id UUID REFERENCES branches(id), -- NULL for Owner/Admin
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Table: audit_logs (Security & Compliance)
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  user_id UUID REFERENCES users(id),
  action VARCHAR(50) NOT NULL, -- CREATE, UPDATE, DELETE, LOGIN, LOGOUT
  entity VARCHAR(50) NOT NULL, -- products, transactions, users
  entity_id UUID, -- ID of the affected record
  details JSONB, -- Old vs New values
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Table: notifications (System Alerts)
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  user_id UUID REFERENCES users(id), -- Nullable if broadcast to tenant
  title VARCHAR(100) NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(20) DEFAULT 'info', -- info, warning, error, success
  is_read BOOLEAN DEFAULT FALSE,
  link VARCHAR(255), -- Action URL
  created_at TIMESTAMP DEFAULT NOW()
);
```

### B. Inventory & Catalog (Shared Catalog, Local Stock)

Konsep: **Katalog Produk** bersifat Global per Tenant (diatur Pusat), tapi **Stok** bersifat Lokal per Cabang (diatur Batch).

```sql
-- Table: products (Master Data)
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  sku VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  min_stock_level INT DEFAULT 5, -- Global warning level
  is_tracked BOOLEAN DEFAULT TRUE, -- Service vs Goods
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tenant_id, sku) -- SKU unik per Tenant
);

-- Table: product_units (Multi-Satuan)
CREATE TABLE product_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id),
  name VARCHAR(20) NOT NULL, -- e.g., "Box", "Pcs"
  conversion_factor DECIMAL(10,2) DEFAULT 1, -- 1 Box = 24 Pcs
  barcode VARCHAR(100),
  price DECIMAL(15,2) NOT NULL
);

-- Table: product_batches (Inventory Real-time)
-- Stok dicatat per batch masuk untuk mendukung FIFO
CREATE TABLE product_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  branch_id UUID REFERENCES branches(id), -- Stok milik cabang mana
  product_id UUID REFERENCES products(id),
  batch_number VARCHAR(50),
  expiry_date DATE,
  quantity_initial DECIMAL(15,2), -- Stok awal saat terima
  quantity_current DECIMAL(15,2), -- Stok saat ini (berkurang saat terjual)
  cost_price DECIMAL(15,2), -- Harga beli (HPP)
  received_at TIMESTAMP DEFAULT NOW()
);
```

### C. Transactions (POS)

```sql
-- Table: transactions
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  branch_id UUID REFERENCES branches(id),
  cashier_id UUID REFERENCES users(id),
  customer_id UUID REFERENCES customers(id), -- Nullable
  invoice_number VARCHAR(50) NOT NULL,
  total_amount DECIMAL(15,2) NOT NULL,
  payment_method VARCHAR(20), -- cash, qris, debit
  status VARCHAR(20) DEFAULT 'completed', -- pending, completed, void
  created_at TIMESTAMP DEFAULT NOW()
);

-- Table: transaction_items
CREATE TABLE transaction_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID REFERENCES transactions(id),
  product_id UUID REFERENCES products(id),
  batch_id UUID REFERENCES product_batches(id), -- FIFO Deduction Trace
  quantity DECIMAL(10,2) NOT NULL,
  unit_price DECIMAL(15,2) NOT NULL, -- Harga jual saat itu
  cost_price DECIMAL(15,2) NOT NULL, -- HPP dari Batch (untuk profit reporting)
  subtotal DECIMAL(15,2) NOT NULL
);

### D. Inventory Mutations (Stock Transfers)

Modul ini menangani perpindahan stok antar cabang atau dari Pusat (Gudang Utama) ke Cabang.

```sql
-- Table: stock_transfers
CREATE TABLE stock_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  reference_number VARCHAR(50) NOT NULL, -- No. Surat Jalan
  source_branch_id UUID REFERENCES branches(id), -- Asal Barang
  destination_branch_id UUID REFERENCES branches(id), -- Tujuan
  status VARCHAR(20) DEFAULT 'draft', -- draft, pending_approval, in_transit, received, cancelled
  requested_by UUID REFERENCES users(id), -- User pembuat request
  approved_by UUID REFERENCES users(id), -- User yang menyetujui pengiriman
  received_by UUID REFERENCES users(id), -- User yang menerima barang
  sent_at TIMESTAMP,
  received_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Table: transfer_items
CREATE TABLE transfer_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID REFERENCES stock_transfers(id),
  product_id UUID REFERENCES products(id),
  source_batch_id UUID REFERENCES product_batches(id), -- Batch asal yang diambil
  quantity_sent DECIMAL(10,2) NOT NULL,
  quantity_received DECIMAL(10,2), -- Diisi saat penerimaan (bisa selisih jika rusak/hilang)
  notes TEXT -- Catatan kondisi barang
);
```

## 3. Role-Based Access Control (RBAC) Matrix

Tabel ini mensinkronkan requirements Role dengan akses Database.

| Role | Scope | Products (Katalog) | Stock (Batches) | Transactions | Stock Transfer | Users | Reports |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Platform Owner** | Global | Read-Only (Debug) | Read-Only | Read-Only | Read-Only | **Manage (All)** | Global Stats |
| **Tenant Owner** | Tenant | **Full Access** | Full Access | Full Access | **Full Access** | **Manage (Tenant)** | Full Access |
| **Tenant Admin** | Tenant | **Full Access** | Full Access | Full Access | **Full Access** | Read-Only | Full Access |
| **Store Manager** | **Branch** | Read-Only | **Manage (Branch)** | Void/Refund | **Request/Receive (Own Branch)** | No Access | Branch Only |
| **Cashier** | **Branch** | Read-Only | Read-Only | **Create Only** | No Access | No Access | Shift Only |

### Sinkronisasi Logic Role:
1.  **Store Manager vs Stock:** Store Manager tidak bisa mengubah nama/harga produk (Katalog Pusat), tapi bisa melakukan *Stock Opname* atau *Receive Goods* (Input Batch baru) di cabangnya.
2.  **Stock Transfer Authority:**
    *   **Tenant Owner/Admin:** Bisa membuat transfer antar *sembarang* cabang (misal: realokasi stok dari Cabang A ke B karena Cabang A sepi).
    *   **Store Manager:** Hanya bisa membuat request ("Minta Stok" dari Pusat/Cabang Lain) atau mengirim stok *keluar* dari cabangnya sendiri. Tidak bisa menginisiasi transfer antar cabang lain.
3.  **Cashier vs Stock:** Cashier hanya mengurangi stok via Transaksi, tidak bisa mengedit manual.
4.  **Tenant Admin vs User:** Tenant Admin bisa melihat daftar user untuk operasional, tapi tidak bisa `CREATE` user baru untuk mencegah fraud/unauthorized access, hanya Owner yang bisa.

## 4. Business Logic Implementation

### A. Row Level Security (RLS) Policy
Setiap query ke database akan otomatis difilter oleh Neon Postgres berdasarkan user session.

**Contoh Policy (SQL):**
```sql
-- Aktifkan RLS
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- Policy untuk Tenant Isolation (Semua user)
CREATE POLICY tenant_isolation_policy ON products
USING (tenant_id = (current_setting('app.current_tenant_id')::uuid));

-- Policy tambahan untuk Branch Isolation (Store Manager & Cashier)
-- Store Manager hanya bisa melihat Transactions miliknya
CREATE POLICY branch_isolation_policy ON transactions
USING (
  branch_id = (current_setting('app.current_branch_id')::uuid) 
  OR 
  (current_setting('app.user_role') IN ('owner', 'admin')) -- Owner/Admin bebas
);

-- Policy for Store Manager Branch Isolation
-- Store Manager hanya bisa melihat data cabangnya sendiri
CREATE POLICY branch_access_policy ON branches
USING (
  id = (current_setting('app.current_branch_id')::uuid)
  OR
  (current_setting('app.user_role') IN ('owner', 'admin'))
);

-- Policy for User Visibility
-- Store Manager bisa melihat staff di cabangnya
CREATE POLICY user_branch_policy ON users
USING (
  assigned_branch_id = (current_setting('app.current_branch_id')::uuid)
  OR
  (current_setting('app.user_role') IN ('owner', 'admin'))
  OR
  id = (current_setting('app.current_user_id')::uuid) -- Self
);

-- Policy untuk Stock Transfers (Complex)
-- Store Manager bisa melihat transfer jika dia adalah SENDER atau RECEIVER
CREATE POLICY transfer_visibility_policy ON stock_transfers
USING (
  tenant_id = (current_setting('app.current_tenant_id')::uuid)
  AND (
    (current_setting('app.user_role') IN ('owner', 'admin'))
    OR
    source_branch_id = (current_setting('app.current_branch_id')::uuid)
    OR
    destination_branch_id = (current_setting('app.current_branch_id')::uuid)
  )
);
```

### B. Algoritma FIFO (First-In-First-Out)
Logika ini harus dijalankan di sisi Backend (API) saat Checkout.

**Proses Checkout:**
1.  User kirim request: `Items: [{product_id: A, qty: 10}]`
2.  Backend cari `product_batches` untuk `product_id = A` di `branch_id = X`.
3.  Urutkan berdasarkan `expiry_date ASC` (atau `received_at ASC`).
4.  **Looping Deduksi:**
    *   Ambil Batch 1 (Sisa 4). Order butuh 10. Ambil semua (4). Sisa Order 6.
    *   Ambil Batch 2 (Sisa 20). Order butuh 6. Ambil 6. Sisa Batch 14.
5.  Create `transaction_items` (Split menjadi 2 baris sesuai batch yang diambil).
    *   Item 1: Qty 4, HPP (dari Batch 1)
    *   Item 2: Qty 6, HPP (dari Batch 2)
6.  *Commit Transaction.*

### C. Logic Stock Transfer (Mutation)
Perpindahan stok harus menjaga data HPP dan Expiry Date (Traceability).

**Workflow:**
1.  **Creation (Status: Draft/Pending):** User memilih Product & Qty. Sistem belum mengurangi stok, hanya validasi ketersediaan.
2.  **Approval/Send (Status: In Transit):**
    *   Sistem mengurangi `quantity_current` di `product_batches` (Source Branch).
    *   Stok dianggap "melayang" (tidak ada di batch manapun yang aktif dijual).
3.  **Receive (Status: Received):**
    *   User tujuan memverifikasi fisik barang.
    *   Sistem membuat **Batch Baru** di `product_batches` (Destination Branch).
    *   **PENTING:** Batch baru ini menyalin `cost_price` (HPP) dan `expiry_date` dari batch asal. Ini menjaga akurasi laporan laba rugi meskipun barang dipindah-pindah.

## 5. Next Steps for Developer

1.  **Setup Neon Project:** Buat project baru via Dashboard/MCP.
2.  **Migration:** Jalankan script DDL di atas.
3.  **Seed Data:** Buat 1 Tenant, 2 Branch, 1 Owner, 1 Cashier untuk testing.
4.  **Backend API:** Buat endpoint `/checkout` yang mengimplementasikan logika FIFO di atas.
