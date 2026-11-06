/**
 * The role vocabulary of the app.
 *
 * A custom role created by an owner (`cust_*`, see `src/lib/permission-matrix.ts`)
 * is *not* listed here: it lives in the tenant's settings document and never
 * needs a code change. That absence is the point — adding a role used to mean
 * four coordinated edits across `types`, the admin API and the access-control
 * plugin, which is how `purchasing` ended up declared but un-creatable.
 */
export const ROLES = [
  { value: "platform_owner", label: "Platform Owner", description: "Akses penuh ke seluruh sistem" },
  { value: "tenant_owner", label: "Owner", description: "Pemilik usaha, akses penuh ke tenant" },
  { value: "tenant_admin", label: "Admin", description: "Administrator tenant" },
  { value: "store_manager", label: "Store Manager", description: "Kepala cabang/toko" },
  { value: "cashier", label: "Cashier", description: "Kasir, akses POS" },
  { value: "warehouse", label: "Warehouse Staff", description: "Staff gudang" },
  { value: "purchasing", label: "Purchasing", description: "Bagian pembelian" },
  { value: "staff", label: "Staff", description: "Karyawan biasa" },
] as const;

export type RoleValue = typeof ROLES[number]["value"];

/** Builtin roles an owner may hand out from the Employees screen. */
export const BUILTIN_ASSIGNABLE_ROLES: RoleValue[] = [
  "tenant_admin",
  "store_manager",
  "cashier",
  "warehouse",
  "purchasing",
  "staff",
];

/**
 * Every permission, declared exactly once.
 *
 * A key, the Indonesian label a novice reads, and the sentence explaining what
 * it actually unlocks used to live in three separate objects, so a key added to
 * one list could sit invisible in the other two. `PERMISSION_GROUPS`,
 * `PERMISSION_LABELS` and `PERMISSION_HINTS` below are all *derived* from this
 * catalog; nothing may be hand-written there again.
 */
export interface PermissionEntry {
  key: string;
  label: string;
  hint: string;
}

export const PERMISSION_CATALOG = {
  dashboard: [
    {
      key: "view_dashboard",
      label: "Lihat Dashboard",
      hint: "Membuka halaman depan berisi ringkasan penjualan dan stok hari ini.",
    },
    {
      key: "view_analytics",
      label: "Lihat Analitik",
      hint: "Melihat grafik tren penjualan dan laporan analitik. Tanpa izin ini, menu Back Office tidak terbuka.",
    },
  ],
  pos: [
    {
      key: "access_pos",
      label: "Akses POS",
      hint: "Membuka layar kasir untuk melayani penjualan.",
    },
    {
      key: "apply_discount",
      label: "Berikan Diskon",
      hint: "Mengurangi harga pada keranjang saat transaksi. Kasir biasa tidak boleh.",
    },
    {
      key: "void_transaction",
      label: "Void Transaksi",
      hint: "Membatalkan transaksi yang sudah dibayar. Stok kembali dan jejaknya tercatat.",
    },
  ],
  inventory: [
    {
      key: "view_inventory",
      label: "Lihat Inventory",
      hint: "Membuka daftar produk dan stok. Membuka juga halaman gudang, pesanan cabang, dan transfer.",
    },
    {
      key: "add_stock",
      label: "Tambah Stok",
      hint: "Mencatat barang masuk ke gudang.",
    },
    {
      key: "transfer_stock",
      label: "Transfer Stok",
      hint: "Memindahkan stok antar gudang atau antar cabang.",
    },
    {
      key: "stock_opname",
      label: "Stock Opname",
      hint: "Menghitung stok fisik dan menyesuaikan selisihnya.",
    },
    {
      key: "request_stock",
      label: "Pesan Stok ke Gudang",
      hint: "Membuat permintaan barang ke gudang pusat. Tidak termasuk menyetujuinya.",
    },
    {
      key: "approve_stock_request",
      label: "Setujui Pesanan Cabang",
      hint: "Menyetujui atau menolak permintaan barang yang dibuat cabang.",
    },
    {
      key: "dispatch_stock",
      label: "Kirim Barang dari Gudang",
      hint: "Melepas stok gudang untuk pesanan yang sudah disetujui.",
    },
    {
      key: "create_po",
      label: "Buat & Ajukan Purchase Order",
      hint: "Membuat order pembelian ke vendor. Order belum sah sampai disetujui pemegang izin Setujui PO.",
    },
    {
      key: "approve_po",
      label: "Setujui Purchase Order",
      hint: "Menyetujui order yang dibuat orang lain. Owner boleh menyetujui order buatannya sendiri.",
    },
    {
      key: "receive_po",
      label: "Terima Barang Datang",
      hint: "Mencatat barang dari vendor yang benar-benar tiba, dan memasukkannya ke gudang.",
    },
    {
      key: "cancel_po",
      label: "Batalkan Purchase Order",
      hint: "Menghentikan order yang belum diterima seluruhnya.",
    },
    {
      key: "manage_variants",
      label: "Kelola Varian Produk",
      hint: "Menambah atau mengubah varian (ukuran, rasa) beserta satuannya.",
    },
    {
      key: "manage_vendor_prices",
      label: "Kelola Harga Beli Vendor",
      hint: "Menentukan harga modal dari vendor. Pisahkan dari izin pembuat order.",
    },
    {
      key: "manage_sell_prices",
      label: "Kelola Harga Jual",
      hint: "Menentukan harga jual di rak dan di kasir.",
    },
  ],
  employees: [
    {
      key: "view_employees",
      label: "Lihat Karyawan",
      hint: "Membuka daftar karyawan, termasuk gaji dan cabang tempat bekerja.",
    },
    {
      key: "add_employee",
      label: "Tambah Karyawan",
      hint: "Membuat akun karyawan baru beserta kata sandi awalnya.",
    },
    {
      key: "edit_employee",
      label: "Edit Karyawan",
      hint: "Mengubah nama, cabang, role, dan status aktif karyawan.",
    },
    {
      key: "delete_employee",
      label: "Hapus Karyawan",
      hint: "Menghapus akun karyawan. Yang sudah dihapus tidak bisa masuk lagi.",
    },
    {
      key: "manage_attendance",
      label: "Kelola Absensi & Wajah",
      hint: "Mendaftarkan wajah karyawan, mengatur lokasi/geofence tempat kerja, dan koreksi absensi manual. Absen harian oleh karyawan sendiri tidak butuh izin ini.",
    },
  ],
  reports: [
    {
      key: "view_reports",
      label: "Lihat Laporan",
      hint: "Membuka halaman Laporan & Analitik beserta seluruh laporan per modul.",
    },
    {
      key: "export_reports",
      label: "Export Laporan",
      hint: "Mengunduh data ke Excel atau PDF, termasuk daftar produk dan karyawan.",
    },
    {
      key: "view_finance",
      label: "Lihat Keuangan & Vendor",
      hint: "Membuka jurnal, hutang piutang, arus kas, pengeluaran, data vendor, dan pelanggan.",
    },
  ],
  settings: [
    {
      key: "view_settings",
      label: "Lihat Pengaturan",
      hint: "Membuka halaman Pengaturan perusahaan.",
    },
    {
      key: "edit_settings",
      label: "Edit Pengaturan",
      hint: "Menyimpan perubahan pengaturan, termasuk pajak, receipt, dan gaji.",
    },
    {
      key: "manage_roles",
      label: "Kelola Role",
      hint: "Mengatur hak akses tiap role dan membuat role kustom sendiri.",
    },
    {
      key: "manage_branches",
      label: "Kelola Cabang",
      hint: "Menambah cabang, mengatur gudang miliknya, dan menentukan kepala cabang.",
    },
  ],
} as const satisfies Record<string, readonly PermissionEntry[]>;

export type PermissionGroupName = keyof typeof PERMISSION_CATALOG;

/** Group -> key list, the shape the Role screen accordion and older importers use. */
export const PERMISSION_GROUPS: Record<PermissionGroupName, string[]> = Object.fromEntries(
  Object.entries(PERMISSION_CATALOG).map(([group, entries]) => [group, entries.map((e) => e.key)])
) as Record<PermissionGroupName, string[]>;

export const PERMISSION_LABELS: Record<string, string> = Object.fromEntries(
  Object.values(PERMISSION_CATALOG)
    .flat()
    .map((entry) => [entry.key, entry.label])
);

/** Plain-language explanation rendered under every switch in the matrix. */
export const PERMISSION_HINTS: Record<string, string> = Object.fromEntries(
  Object.values(PERMISSION_CATALOG)
    .flat()
    .map((entry) => [entry.key, entry.hint])
);

/** Flattened key list — used by the route guards, the resolver, and the tests. */
export const ALL_PERMISSION_KEYS: string[] = Object.values(PERMISSION_GROUPS).flat();

/** Owner-tier roles: everything the catalog holds, by definition. */
const grantedToOwners = ALL_PERMISSION_KEYS;

function ownerPermissions(): Record<string, boolean> {
  return Object.fromEntries(grantedToOwners.map((p) => [p, true]));
}

export const DEFAULT_ROLE_PERMISSIONS: Record<RoleValue, Record<string, boolean>> = {
  platform_owner: ownerPermissions(),
  tenant_owner: ownerPermissions(),
  tenant_admin: ownerPermissions(),
  store_manager: {
    view_dashboard: true,
    view_analytics: true,
    access_pos: true,
    apply_discount: true,
    view_inventory: true,
    add_stock: true,
    transfer_stock: true,
    // A shop asks the gudang for stock, but never approves or dispatches its
    // own request — approval belongs to the warehouse side.
    request_stock: true,
    // A shop may raise its own purchase order (in a one-shop tenant the owner
    // *is* the store manager) and receive it, but never approve it.
    create_po: true,
    receive_po: true,
    cancel_po: true,
    view_employees: true,
    view_reports: true,
    export_reports: true,
    // A manager runs money screens and their own branch network; they still
    // cannot open Settings or decide roles.
    view_finance: true,
    manage_branches: true,
    // ...others false
  },
  cashier: {
    // Transact, nothing else. `view_dashboard` used to be on here, which
    // handed cashiers the whole back-office reading list; the till's own
    // transaction book stays reachable through `access_pos` (App.tsx guards
    // /pos/transactions with anyOf). An owner can still switch dashboard
    // viewing back on per role in the matrix.
    access_pos: true,
    apply_discount: false,
    // ...others false
  },
  warehouse: {
    view_inventory: true,
    add_stock: true,
    transfer_stock: true,
    stock_opname: true,
    request_stock: true,
    approve_stock_request: true,
    dispatch_stock: true,
    // The people who unload the truck are the ones who know what arrived.
    receive_po: true,
    // ...others false
  },
  purchasing: {
    view_inventory: true,
    add_stock: true,
    transfer_stock: true,
    create_po: true,
    receive_po: true,
    cancel_po: true,
    // ...others false — approval deliberately belongs to the owner/admin
  },
  staff: {
    // minimal access
  },
};

/**
 * The permission set a role actually holds: the shipped defaults, with the
 * tenant's saved override laid on top.
 *
 * The merge (rather than replace) matters. A saved override is a snapshot of
 * the matrix at the moment someone pressed Simpan, so it has no key for a
 * permission that shipped later — replacing defaults with it would silently
 * take every new permission away from every tenant that ever opened the Role
 * screen. Merging means an absent key keeps its default, while an explicit
 * `false` still wins.
 */
export function resolveRolePermissions(
  role: RoleValue,
  override?: Record<string, boolean> | null
): Record<string, boolean> {
  const base = DEFAULT_ROLE_PERMISSIONS[role] ?? {};
  if (!override) return base;
  const merged: Record<string, boolean> = { ...base };
  for (const [permission, granted] of Object.entries(override)) {
    if (typeof granted === "boolean") merged[permission] = granted;
  }
  return merged;
}

/* ------------------------------------------------------------------------- *
 * There used to be role lists here — `ALL_ROLE_VALUES`, `MANAGER_ROLES`,
 * `FRONT_OFFICE_ROLES`, `BACK_OFFICE_ROLES`, `STOCK_DOC_ROLES`,
 * `PROCUREMENT_ROLES`, `HR_ROLES` — one per screen family. They are gone: every
 * route guard, sidebar entry and mode card now asks a permission key of
 * `src/lib/permission-matrix.ts`, which is the only way an owner's edit (and a
 * custom role) can reach the navigation at all.
 * ------------------------------------------------------------------------- */

