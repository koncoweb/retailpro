export const ROLES = [
  { value: "platform_owner", label: "Platform Owner", description: "Akses penuh ke seluruh sistem" },
  { value: "tenant_owner", label: "Owner", description: "Pemilik usaha, akses penuh ke tenant" },
  { value: "tenant_admin", label: "Admin", description: "Administrator tenant" },
  { value: "store_manager", label: "Store Manager", description: "Kepala cabang/toko" },
  { value: "cashier", label: "Cashier", description: "Kasir, akses POS" },
  { value: "warehouse", label: "Warehouse Staff", description: "Staff gudang" },
  { value: "staff", label: "Staff", description: "Karyawan biasa" },
] as const;

export type RoleValue = typeof ROLES[number]["value"];

export const PERMISSION_GROUPS = {
  dashboard: ["view_dashboard", "view_analytics"],
  pos: ["access_pos", "apply_discount", "void_transaction"],
  inventory: ["view_inventory", "add_stock", "transfer_stock", "stock_opname"],
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
    // ...others false
  },
  staff: {
    // minimal access
  },
};
