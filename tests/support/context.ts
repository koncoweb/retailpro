/**
 * Vocabulary the agent needs to phrase goals the way RetailPro phrases them.
 *
 * Agents do not inherit `context` from each other, and the config's agent is
 * shared, so every suite passes this as `agentContext` on its `describe`.
 */
export const APP_CONTEXT =
  'RetailPro is an Indonesian retail POS and back-office app; every screen is in Indonesian. ' +
  'Modes: POS & Kasir, Back Office, Vendor & Supplier. ' +
  'Roles: tenant owner, tenant admin, store manager, kasir (cashier), gudang (warehouse). ' +
  'Back office sections: Dasbor, Cabang, Inventori, Keuangan, Laporan, Pengaturan. ' +
  'Money is shown in rupiah: Rp followed by digits with dots as thousand separators.';
