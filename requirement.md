# RetailPro - Multi-Tenant Retail ERP Planning

Dokumen ini berisi rencana transformasi aplikasi RetailPro dari single-tenant prototype menjadi aplikasi **Multi-Tenant SaaS** yang mendukung pengelolaan usaha retail multi-cabang.

## 1. Arsitektur Multi-Tenant

### A. Konsep Tenant
Setiap "Usaha" atau "Perusahaan" akan dianggap sebagai satu **Tenant**.
*   Satu Tenant memiliki banyak **Cabang (Branches)**.
*   Satu Tenant memiliki banyak **User (Employees)**.
*   Data antar Tenant harus terisolasi secara logis (Logical Isolation).

### B. Strategi Database (Row-Level Security)
Kita akan menggunakan strategi **Shared Database, Shared Schema** dengan kolom discriminator `tenant_id` di setiap tabel utama.
*   Semua tabel (products, transactions, employees, dll) akan memiliki kolom `tenant_id`.
*   Menggunakan fitur **Row Level Security (RLS)** di PostgreSQL (Neon DB) untuk menjamin keamanan data antar tenant.
*   Aplikasi tidak perlu menyaring `WHERE tenant_id = X` di setiap query secara manual, melainkan diatur via session variable di database.

## 2. Authentication & Authorization (Neon Auth)

Menggunakan **Neon Auth** (yang berbasis Better Auth) untuk menyimpan data user, session, dan role langsung di dalam database PostgreSQL.

### A. User Hierarchy & Roles
1.  **Platform Owner (Super Admin)**
    *   Pemegang hak akses utama database.
    *   Tugas: Mengaktifkan akun Tenant Owner yang baru mendaftar (`is_active: true`).
    *   Akses: Lintas tenant (untuk maintenance).
2.  **Tenant Owner (Pengusaha)**
    *   Mendaftar mandiri via aplikasi.
    *   Kekuasaan penuh atas data tenant (`role: 'owner'`).
    *   Bisa menambah user baru (Admin, Store Admin, Cashier).
3.  **Tenant Admin**
    *   Membantu Owner mengelola operasional pusat.
    *   Akses read/write data tenant, tapi **TIDAK BISA** menambah user baru.
4.  **Store Admin (Kepala Cabang)**
    *   Mengelola data spesifik satu cabang (`branch_id` tertentu).
5.  **Cashier / Staff**
    *   Akses operasional terbatas (POS, Stock Opname) di satu cabang.

### B. Schema Integrasi Neon Auth
Tabel `user` bawaan Neon Auth akan diextend atau direlasikan dengan tabel profile custom:

1.  **users** (Neon Auth Table + Custom Columns)
    *   `id` (UUID, PK) - Bawaan Neon Auth
    *   `email` - Bawaan Neon Auth
    *   `tenant_id` (FK -> tenants) - Custom
    *   `role` (enum: 'platform_owner', 'tenant_owner', 'tenant_admin', 'branch_manager', 'cashier') - Custom
    *   `assigned_branch_id` (FK -> branches, Nullable) - Custom
    *   `is_active` (boolean, default false for new tenants) - Custom

## 4. Fitur Frontend (Authentication & Onboarding)

### A. Halaman Registrasi Tenant (RegisterTenant)
*   **Formulir Pendaftaran**:
    *   Nama Tenant / Organisasi (Wajib)
    *   Alamat Lengkap (Wajib)
    *   Nomor Telepon (Wajib)
    *   Email Resmi (Wajib - akan menjadi email Owner)
    *   Nama Admin Utama (Wajib)
    *   Password (Wajib)
    *   Domain / Subdomain (Opsional)
    *   Logo (Opsional)
*   **Proses**:
    *   Validasi input (format email, kekuatan password, dll).
    *   Simulasi pengiriman email konfirmasi.
    *   Status awal tenant: `pending` (menunggu verifikasi Platform Owner).

### B. Halaman Login Universal (Login)
*   **Single Entry Point**: Satu halaman login untuk semua role (Super Admin, Owner, Staff).
*   **Fields**: Email & Password.
*   **Fitur**:
    *   Proteksi Brute Force (Rate Limiting - mock implementation).
    *   Lupa Password (Link ke flow reset).
*   **Redirect Logic**:
    *   `platform_owner` -> `/admin/dashboard` (Halaman Super Admin)
    *   `tenant_owner` / `tenant_admin` -> `/backoffice` (Dashboard Utama)
    *   `branch_manager` -> `/backoffice` (Dashboard Cabang)
    *   `cashier` -> `/pos` (Halaman Kasir)

## 5. Struktur Database (Schema Design)

Berikut adalah rancangan tabel utama yang dibutuhkan:

### A. Core / Identity & Settings
1.  **tenants**
    *   `id` (UUID, PK)
    *   `name` (Nama Usaha)
    *   `slug` (Subdomain/Identifier unik)
    *   `company_details` (JSONB: NPWP, SIUP, Alamat Legal, Bentuk Badan Usaha)
    *   `settings` (JSONB: Tax Rules, Currency, Timezone)
    *   `subscription_plan` (free, pro, enterprise)
    *   `status` (enum: 'pending', 'active', 'suspended')
    *   `created_at`
2.  **branches**
    *   `id` (UUID, PK)
    *   `tenant_id` (FK -> tenants)
    *   `name` (Nama Cabang, cth: "Cabang Pusat")
    *   `address`
    *   `phone`
3.  **users** (Lihat section Authentication di atas)

### B. CRM (Customer Relationship Management)
1.  **suppliers**
    *   `id` (UUID, PK)
    *   `tenant_id` (FK)
    *   `name` (Nama PT/CV/Perorangan)
    *   `contact_person`
    *   `phone`
    *   `email`
    *   `address`
    *   `settings` (JSONB: Auto-send Low Stock Alert)
2.  **customers**
    *   `id` (UUID, PK)
    *   `tenant_id` (FK)
    *   `name`
    *   `phone`
    *   `email`
    *   `total_spent` (Analisis Marketing)
    *   `last_purchase_date`
    *   `preferences` (JSONB: Kategori favorit, kebiasaan beli)

### C. Inventory Module (Advanced)
1.  **products**
    *   `id` (UUID, PK)
    *   `tenant_id` (FK)
    *   `sku`
    *   `name`
    *   `unit_type` (pcs, box, karton)
    *   `has_variants` (boolean: eceran/grosir)
    *   `min_stock_alert` (Global Setting)
2.  **product_units** (Konversi Satuan: 1 Karton = 24 Pcs)
    *   `id` (UUID, PK)
    *   `product_id` (FK)
    *   `unit_name` (cth: "Karton")
    *   `conversion_factor` (cth: 24)
    *   `barcode` (Barcode khusus untuk satuan ini)
    *   `price` (Harga jual untuk satuan ini)
3.  **product_batches** (FIFO & Expiry Tracking)
    *   `id` (UUID, PK)
    *   `tenant_id` (FK)
    *   `product_id` (FK)
    *   `branch_id` (FK)
    *   `batch_number`
    *   `quantity` (Stok di batch ini)
    *   `cost_price` (Harga beli saat batch ini masuk - History Harga)
    *   `supplier_id` (FK)
    *   `received_date`
    *   `expiry_date` (Prioritas penjualan berdasarkan ini)
4.  **stock_transfers** (Mutasi Stok Antar Cabang)
    *   `id` (UUID, PK)
    *   `tenant_id` (FK)
    *   `source_branch_id` (FK -> branches)
    *   `destination_branch_id` (FK -> branches)
    *   `status` (draft, pending, in_transit, received)
    *   `requested_by` (FK -> users)
    *   `approved_by` (FK -> users)
5.  **transfer_items**
    *   `id` (UUID, PK)
    *   `transfer_id` (FK)
    *   `product_id` (FK)
    *   `source_batch_id` (FK)
    *   `quantity_sent`
    *   `quantity_received`

### D. POS & Transaction Module
1.  **transactions**
    *   `id` (UUID, PK)
    *   `tenant_id` (FK)
    *   `branch_id` (FK -> branches)
    *   `cashier_id` (FK -> users)
    *   `customer_id` (FK -> customers, Nullable for Guest)
    *   `total_amount`
    *   `payment_method`
    *   `status`
    *   `created_at`
2.  **transaction_items**
    *   `id` (UUID, PK)
    *   `tenant_id` (FK)
    *   `transaction_id` (FK -> transactions)
    *   `product_id` (FK -> products)
    *   `batch_id` (FK -> product_batches, untuk FIFO deduction)
    *   `unit_id` (FK -> product_units, satuan yang dijual)
    *   `quantity`
    *   `price_at_purchase`
    *   `subtotal`

## 3. Rencana Implementasi Teknis

### Fase 1: Persiapan Backend & Database
1.  Setup proyek Neon DB baru.
2.  Desain schema SQL dengan `tenant_id` di semua tabel.
3.  Aktifkan RLS (Row Level Security) policies.
    *   Policy: `CREATE POLICY tenant_isolation ON table_name USING (tenant_id = current_setting('app.current_tenant_id')::uuid);`
4.  Buat API Layer (bisa menggunakan Next.js API Routes atau library backend terpisah, namun karena ini project Vite Client-Side, kita bisa menggunakan **Supabase** atau **Neon Serverless Driver** langsung di client dengan middleware keamanan, atau membuat backend service sederhana).

### Fase 2: Refactor Frontend (Current App)
1.  **Authentication:** Implementasi Login/Register (bisa pakai Clerk/Auth0 atau custom).
2.  **Mobile First UI:** Pastikan semua komponen menggunakan Tailwind Responsive classes (`md:`, `lg:`) dan Touch-friendly controls.
3.  **Context Management:** Buat `TenantProvider` dan `BranchProvider` di React Context untuk menyimpan state "Sedang login sebagai tenant apa" dan "Sedang aktif di cabang mana".
4.  **Data Fetching:** Ganti semua mock data di komponen (Inventory, POS, Dashboard) dengan `useQuery` (TanStack Query) yang memanggil API database.
5.  **Multi-Branch Logic:** Update UI Inventory untuk menampilkan stok berdasarkan cabang yang dipilih di dropdown header.

### Fase 3: Fitur Manajemen Tenant & Advanced Features
1.  **Settings Module:** Implementasi form pengaturan perusahaan, pajak, dan notifikasi.
2.  **CRM Module:** CRUD Supplier & Customer, History Transaksi per Customer.
3.  **Advanced Inventory:**
    *   UI untuk setting konversi satuan (1 Box = X Pcs).
    *   Logika FIFO saat pengurangan stok (kurangi dari `product_batches` dengan `expiry_date` terdekat).
    *   Low Stock Alert System (Email/In-App Notification).
    *   **Stock Transfer:** Fitur request dan approve mutasi stok antar cabang dengan traceability HPP.

## 6. Persyaratan Umum (Non-Functional Requirements)

1.  **Security & Privacy**
    *   **Data Encryption:** Semua data sensitif (password, PII) harus dienkripsi. Komunikasi wajib menggunakan HTTPS/TLS 1.2+.
    *   **Data Isolation:** Strict RLS enforcement. Tidak boleh ada kebocoran data antar tenant.
    *   **Audit Trails:** Setiap aksi kritis (Create/Update/Delete) pada data master dan transaksi harus tercatat di `audit_logs`.

2.  **Reliability & Performance**
    *   **High Availability:** Target uptime 99.9%.
    *   **Scalability:** Mendukung auto-scaling untuk menghandle lonjakan transaksi.

3.  **User Experience**
    *   **Responsive Design:** Layout adaptif untuk Desktop, Tablet, dan HP.
    *   **Notifications:** Sistem notifikasi real-time untuk stok menipis, approval transfer, dll.

4.  **Documentation**
    *   **API Docs:** Tersedia dokumentasi API (OpenAPI/Swagger) untuk integrasi pihak ketiga.
    *   **User Guide:** Panduan penggunaan fitur untuk onboarding tenant baru.

## 7. Requirement Checklist
- [ ] Database Schema (PostgreSQL) siap dengan RLS.
- [ ] Koneksi Database terintegrasi di aplikasi.
- [ ] Sistem Autentikasi User (Multi-Tenant Login).
- [ ] CRUD Master Data (Produk, Karyawan, Cabang) terhubung DB.
- [ ] Transaksi POS menyimpan data ke DB dan mengurangi stok secara atomik (FIFO).
- [ ] Fitur Multi-Satuan (Unit Conversion) berfungsi di POS dan Inventory.
- [ ] Fitur Stock Transfer (Mutasi Stok) berfungsi dengan Approval Workflow.
- [ ] Dashboard mengambil data real-time via Aggregation Query.
- [ ] UI Mobile Responsive terverifikasi di viewport kecil.
- [ ] Audit Logging system terimplementasi.
- [ ] Notifikasi system berjalan.
