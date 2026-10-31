import type { UserRole } from "@/types";

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

/**
 * Route guards, in one place.
 *
 * `App.tsx` hands these lists to `RoleBasedRoute`, and every screen that offers
 * a link to a guarded page must use the same list. Two copies of "who may open
 * the vendor directory" is how the mode chooser ended up sending gudang staff
 * to a page that bounced them straight back.
 */
export const ALL_ROLE_VALUES: UserRole[] = [
  "platform_owner",
  "tenant_owner",
  "tenant_admin",
  "store_manager",
  "cashier",
  "warehouse",
  "purchasing",
  "staff",
  "admin",
];

export const MANAGER_ROLES: UserRole[] = [
  "platform_owner",
  "tenant_owner",
  "tenant_admin",
  "store_manager",
  "admin",
];

/** The till: cashiers and whoever else rings up a sale. */
export const FRONT_OFFICE_ROLES: UserRole[] = [
  "platform_owner",
  "tenant_owner",
  "tenant_admin",
  "store_manager",
  "cashier",
  "admin",
];

export const BACK_OFFICE_ROLES: UserRole[] = MANAGER_ROLES;

/**
 * Stock documents only: the manager roles plus warehouse staff.
 *
 * The `warehouse` role runs the gudang side of a replenishment order (approve,
 * ship) and counts stock, so it needs a narrow slice of the back office and
 * nothing else — no finance, no HR, no settings. `BACK_OFFICE_ROLES` stays
 * untouched so no other screen widens with it.
 */
export const STOCK_DOC_ROLES: UserRole[] = [...MANAGER_ROLES, "warehouse"];

/**
 * Procurement screens: the managers, the gudang that receives the delivery,
 * and the purchasing desk that raises the order. Approval itself is gated by
 * the `approve_po` permission, not by this list — a store manager may open the
 * screen and still must not sign off their own order.
 */
export const PROCUREMENT_ROLES: UserRole[] = [...MANAGER_ROLES, "warehouse", "purchasing"];

export const HR_ROLES: UserRole[] = ["platform_owner", "tenant_owner", "tenant_admin", "admin"];

export const PERMISSION_GROUPS = {
  dashboard: ["view_dashboard", "view_analytics"],
  pos: ["access_pos", "apply_discount", "void_transaction"],
  inventory: [
    "view_inventory",
    "add_stock",
    "transfer_stock",
    "stock_opname",
    "request_stock",
    "approve_stock_request",
    "dispatch_stock",
    // Procurement. Creating and approving an order are separate permissions on
    // purpose: one person may commit money, another must agree to it.
    "create_po",
    "approve_po",
    "receive_po",
    "cancel_po",
  ],
  employees: ["view_employees", "add_employee", "edit_employee", "delete_employee"],
  reports: ["view_reports", "export_reports"],
  settings: ["view_settings", "edit_settings", "manage_roles"],
};

export const PERMISSION_LABELS: Record<string, string> = {
  view_dashboard: "Lihat Dashboard",
  view_analytics: "Lihat Analitik",
  access_pos: "Akses POS",
  apply_discount: "Berikan Diskon",
  void_transaction: "Void Transaksi",
  view_inventory: "Lihat Inventory",
  add_stock: "Tambah Stok",
  transfer_stock: "Transfer Stok",
  stock_opname: "Stock Opname",
  request_stock: "Pesan Stok ke Gudang",
  approve_stock_request: "Setujui Pesanan Cabang",
  dispatch_stock: "Kirim Barang dari Gudang",
  create_po: "Buat & Ajukan Purchase Order",
  approve_po: "Setujui Purchase Order",
  receive_po: "Terima Barang Datang",
  cancel_po: "Batalkan Purchase Order",
  view_employees: "Lihat Karyawan",
  add_employee: "Tambah Karyawan",
  edit_employee: "Edit Karyawan",
  delete_employee: "Hapus Karyawan",
  view_reports: "Lihat Laporan",
  export_reports: "Export Laporan",
  view_settings: "Lihat Pengaturan",
  edit_settings: "Edit Pengaturan",
  manage_roles: "Kelola Role",
};

export const DEFAULT_ROLE_PERMISSIONS: Record<RoleValue, Record<string, boolean>> = {
  platform_owner: Object.fromEntries(Object.values(PERMISSION_GROUPS).flat().map((p) => [p, true])),
  tenant_owner: Object.fromEntries(Object.values(PERMISSION_GROUPS).flat().map((p) => [p, true])),
  tenant_admin: Object.fromEntries(Object.values(PERMISSION_GROUPS).flat().map((p) => [p, true])),
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
    // ...others false
  },
  cashier: {
    view_dashboard: true,
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
