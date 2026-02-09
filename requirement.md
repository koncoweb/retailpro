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
*   **Standard Kolom**: Menggunakan `tenant_id` (UUID) di seluruh tabel. TIDAK BOLEH menggunakan nama kolom lain seperti `tenant` atau `organization_id`.
*   **Indexing**: Kolom `tenant_id` wajib di-index di setiap tabel untuk performa RLS yang optimal.
*   **RLS**: Menggunakan fitur **Row Level Security (RLS)** di PostgreSQL (Neon DB) untuk menjamin keamanan data antar tenant.
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
    *   Bisa menambah user baru (Admin, Store Manager, Cashier).
3.  **Tenant Admin**
    *   Membantu Owner mengelola operasional pusat.
    *   Akses read/write data tenant, tapi **TIDAK BISA** menambah user baru.
4.  **Store Manager (Kepala Cabang)**
    *   Mengelola data spesifik satu cabang (`branch_id` tertentu).
5.  **Cashier / Staff**
    *   Akses operasional terbatas (POS, Stock Opname) di satu cabang.

### B. Schema Integrasi Neon Auth
Tabel `user` bawaan Neon Auth akan diextend atau direlasikan dengan tabel profile custom:

1.  **users** (Neon Auth Table + Custom Columns)
    *   `id` (UUID, PK) - Bawaan Neon Auth
    *   `email` - Bawaan Neon Auth
    *   `tenant_id` (FK -> tenants) - Custom
    *   `role` (enum: 'platform_owner', 'tenant_owner', 'tenant_admin', 'store_manager', 'cashier') - Custom
    *   `assigned_branch_id` (FK -> branches, Nullable) - Custom
    *   `is_active` (boolean, default false for new tenants) - Custom
    *   `base_salary` (Numeric, Default 0) - Custom

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
    *   `store_manager` -> `/backoffice` (Dashboard Cabang)
    *   `cashier` -> `/pos` (Halaman Kasir)

### C. Manajemen Karyawan (Backoffice)
*   **Daftar Karyawan**: Menampilkan daftar karyawan berdasarkan cabang.
*   **Tambah Karyawan**: Integrasi dengan Neon Auth untuk pembuatan akun dan assignment role/cabang.
*   **Edit Karyawan**: Fitur untuk mengubah Role (promosi/demosi), Status Aktif, dan Gaji Pokok.
*   **Absensi (Attendance)**: Pencatatan Check-in/Check-out harian, status kehadiran (Hadir, Sakit, Alpa), dan perhitungan Overtime.
*   **Cuti (Leave)**: Pengajuan dan approval cuti (Tahunan, Sakit, Unpaid).
*   **Payroll**: Perhitungan gaji otomatis berdasarkan Gaji Pokok, Kehadiran, Overtime, dan Tunjangan/Potongan.
*   **Konfigurasi Payroll Dinamis**: User dapat mengatur variabel penggajian (Hari Kerja, Tunjangan Transport, Uang Makan) secara real-time.
*   **Role Permission Settings**: Pengaturan hak akses granular per role yang disimpan di database tenant.

## 5. Struktur Database (Schema Design)

Berikut adalah rancangan tabel utama yang dibutuhkan:

### A. Core / Identity & Settings
1.  **tenants**
    *   `id` (UUID, PK)
    *   `name` (Nama Usaha)
    *   `slug` (Subdomain/Identifier unik)
    *   `settings` (JSONB) - Menyimpan konfigurasi global seperti Role Permissions.

## 6. Deployment & Infrastructure (Vercel + Neon)

### A. Hosting (Vercel)
*   **Platform**: Vercel (Frontend Frameworks).
*   **Type**: Single Page Application (SPA) with Client-Side Rendering.
*   **Routing**: Rewrite rule pada `vercel.json` untuk mengarahkan semua request ke `index.html`.
*   **Build**: `vite build` (Output directory: `dist`).

### B. Database (Neon Serverless)
*   **Connection**: Direct Client-to-Database via `@neondatabase/serverless` (WebSocket/HTTP).
*   **Security**:
    *   **Row Level Security (RLS)**: Wajib aktif pada seluruh tabel untuk isolasi data antar tenant.
    *   **Authentication**: Neon Auth mengelola session dan identitas user.
    *   **Credentials**: `VITE_DATABASE_URL` menggunakan role aplikasi dengan hak akses terbatas (bukan owner), yang bergantung pada RLS policies.
*   **Optimization**: Menggunakan Neon Serverless Driver untuk connection pooling yang efisien di lingkungan stateless/browser.

### C. Environment Variables
Variable berikut wajib dikonfigurasi di Vercel Project Settings:
1.  `VITE_NEON_AUTH_URL`: URL Endpoint untuk Neon Auth.
2.  `VITE_DATABASE_URL`: Connection string PostgreSQL (harus support SSL & Pooling).

### D. Monitoring & Logging
*   **Error Handling**: Global Error Boundary pada React dan try-catch blocks pada operasi database.
*   **Logging**: Centralized logger utility untuk mencatat error kritis dan aktivitas penting (audit trail).
    *   `company_details` (JSONB: NPWP, SIUP, Alamat Legal, Bentuk Badan Usaha)
    *   `settings` (JSONB: Tax Rules, Currency, Timezone, **Role Permissions**)

2.  **branches**
    *   `id` (UUID, PK)
    *   `tenant_id` (FK)
    *   `name` (Nama Cabang)
    *   `address`
    *   `phone`
    *   `is_active` (boolean)

### B. HR & Employee Management
1.  **attendance**
    *   `id` (UUID, PK)
    *   `tenant_id` (FK)
    *   `employee_id` (FK -> users.id)
    *   `date` (Date)
    *   `check_in` (Time, Nullable)
    *   `check_out` (Time, Nullable)
    *   `status` (enum: 'present', 'sick', 'permission', 'alpha')
    *   `overtime` (Numeric, hours)
    *   `location_coordinates` (Point, Optional)

2.  **leaves**
    *   `id` (UUID, PK)
    *   `tenant_id` (FK)
    *   `employee_id` (FK -> users.id)
    *   `type` (enum: 'annual', 'sick', 'unpaid')
    *   `start_date` (Date)
    *   `end_date` (Date)
    *   `reason` (Text)
    *   `status` (enum: 'pending', 'approved', 'rejected')
    *   `approved_by` (FK -> users.id, Nullable)

## 6. Implementation Updates (UI/UX & Features)

### A. User Experience (UX)
*   **Safety Deletion**: Implementasi `AlertDialog` component untuk konfirmasi penghapusan data penting (Karyawan, Absensi, Cuti) menggantikan browser alert standar.
*   **Feedback System**: Penggunaan `sonner` toast notification yang konsisten untuk feedback sukses/gagal operasi.

### B. Functional Improvements
*   **Dynamic Payroll**: Menambahkan fitur pengaturan variabel gaji (hari kerja, tunjangan) di halaman laporan karyawan tanpa hardcoding.
*   **Role Persistence**: Implementasi penyimpanan konfigurasi permission role kustom ke kolom `tenants.settings` sehingga perubahan hak akses bersifat permanen.
*   **Data Correction**: Menambahkan kemampuan menghapus record absensi dan cuti yang salah input langsung dari dashboard laporan.

## Checklist Implementasi (MVP Phase 1)

- [x] Setup Project (Vite + React + TS + Tailwind)
- [x] Setup Neon Database & Auth
- [x] CRUD Master Data (Karyawan, Cabang) terhubung DB
- [x] Fitur Absensi Sederhana (Input Manual)
- [x] Laporan Gaji Dasar (Estimasi)
- [x] Role Permission Management (Persisted in DB)
- [ ] Integrasi POS (Point of Sale) Basic
- [x] Manajemen Shift (POS)
- [ ] Manajemen Stok Sederhana

## 7. Manajemen Shift (POS)

Fitur untuk mengatur shift kasir, memastikan akurasi uang kas, dan pelaporan harian.

### A. Konsep Shift
*   **Satu Shift per User**: Shift terikat pada satu user (kasir) di satu cabang.
*   **Status Shift**: `open` (sedang berjalan) atau `closed` (sudah selesai).
*   **Validasi**: User tidak bisa melakukan transaksi POS jika belum membuka shift.
*   **Single Active Shift**: Satu user hanya boleh memiliki satu shift aktif dalam satu waktu.

### B. Alur Kerja
1.  **Buka Shift (Open Shift)**:
    *   Input modal awal (Petty Cash).
    *   Sistem mencatat waktu mulai (`start_time`).
2.  **Operasional**:
    *   Semua transaksi penjualan tercatat dalam shift aktif.
3.  **Tutup Shift (Close Shift)**:
    *   Sistem menghitung total uang tunai yang seharusnya ada (`expected_cash` = modal awal + total penjualan tunai).
    *   Kasir menginput jumlah uang tunai fisik (`final_cash`).
    *   Sistem menghitung selisih (`difference`).
    *   Laporan ringkasan metode pembayaran (Tunai, Kartu, QRIS).

### C. Database Schema (shifts)
*   `id` (UUID, PK)
*   `tenant_id` (FK)
*   `branch_id` (FK)
*   `user_id` (FK)
*   `start_time` (Timestamp)
*   `end_time` (Timestamp, Nullable)
*   `initial_cash` (Numeric)
*   `final_cash` (Numeric, Nullable)
*   `expected_cash` (Numeric, Nullable)
*   `difference` (Numeric, Nullable)
*   `status` (enum: 'open', 'closed')

