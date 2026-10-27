/**
 * Access-control vocabulary shared by the control plane and the UI.
 *
 * Better Auth's `admin` plugin refuses custom role names unless they are
 * declared as roles it knows about, so RetailPro's own vocabulary
 * (`src/config/roles.ts` / `src/types`) is registered here instead of the
 * plugin defaults (`user` / `admin`).
 *
 * Only the *identity* plane is modelled: what a role may do to business data is
 * enforced by which tenant database the browser can reach, and by the route
 * guards in `src/App.tsx`. These statements exist so that admin-plugin checks
 * (`auth.api.createUser`, `setUserPassword`, `listUsers`) can authorise a
 * caller, and so `role` is a typed union rather than a free string.
 */
import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements } from 'better-auth/plugins/admin/access';

/** Every resource the back office exposes. */
export const statement = {
  ...defaultStatements, // user / session, required by the admin plugin
  product: ['create', 'read', 'update', 'delete'],
  inventory: ['read', 'adjust', 'transfer', 'opname', 'purchase'],
  transaction: ['create', 'read', 'refund', 'void'],
  shift: ['open', 'close', 'read'],
  customer: ['create', 'read', 'update', 'delete'],
  supplier: ['create', 'read', 'update', 'delete'],
  expense: ['create', 'read', 'update', 'delete', 'approve'],
  employee: ['create', 'read', 'update', 'delete', 'payroll'],
  branch: ['create', 'read', 'update', 'delete'],
  report: ['read', 'export'],
  settings: ['read', 'update'],
  audit: ['read'],
} as const;

export const ac = createAccessControl(statement);

const READ_ALL = {
  product: ['read'],
  inventory: ['read'],
  transaction: ['read'],
  customer: ['read'],
  supplier: ['read'],
  report: ['read'],
  settings: ['read'],
} as const;

/** Platform operator: everything. Not reachable from the tenant UI. */
const platformOwner = ac.newRole({
  user: ['create', 'list', 'set-role', 'ban', 'delete', 'set-password', 'get', 'update'],
  session: ['list', 'revoke', 'delete'],
  product: ['create', 'read', 'update', 'delete'],
  inventory: ['read', 'adjust', 'transfer', 'opname', 'purchase'],
  transaction: ['create', 'read', 'refund', 'void'],
  shift: ['open', 'close', 'read'],
  customer: ['create', 'read', 'update', 'delete'],
  supplier: ['create', 'read', 'update', 'delete'],
  expense: ['create', 'read', 'update', 'delete', 'approve'],
  employee: ['create', 'read', 'update', 'delete', 'payroll'],
  branch: ['create', 'read', 'update', 'delete'],
  report: ['read', 'export'],
  settings: ['read', 'update'],
  audit: ['read'],
});

/** Company owner: the same breadth inside one database. */
const tenantOwner = platformOwner;

/** Delegated administrator. */
const tenantAdmin = ac.newRole({
  user: ['create', 'list', 'set-role', 'set-password', 'get', 'update'],
  session: ['list', 'revoke'],
  product: ['create', 'read', 'update', 'delete'],
  inventory: ['read', 'adjust', 'transfer', 'opname', 'purchase'],
  transaction: ['read', 'refund', 'void'],
  shift: ['open', 'close', 'read'],
  customer: ['create', 'read', 'update', 'delete'],
  supplier: ['create', 'read', 'update', 'delete'],
  expense: ['create', 'read', 'update', 'delete', 'approve'],
  employee: ['create', 'read', 'update', 'payroll'],
  branch: ['read', 'update'],
  report: ['read', 'export'],
  settings: ['read', 'update'],
  audit: ['read'],
});

/** Store manager: runs one branch, cannot manage company administration. */
const storeManager = ac.newRole({
  user: ['create', 'list', 'get'],
  product: ['create', 'read', 'update'],
  inventory: ['read', 'adjust', 'transfer', 'opname', 'purchase'],
  transaction: ['create', 'read', 'refund', 'void'],
  shift: ['open', 'close', 'read'],
  customer: ['create', 'read', 'update'],
  supplier: ['read'],
  expense: ['create', 'read'],
  employee: ['read'],
  branch: ['read'],
  report: ['read', 'export'],
  settings: ['read'],
});

/** Cashier: point of sale only. */
const cashier = ac.newRole({
  product: ['read'],
  inventory: ['read'],
  transaction: ['create', 'read'],
  shift: ['open', 'close', 'read'],
  customer: ['create', 'read', 'update'],
  report: ['read'],
});

/** Warehouse: stock receiving, transfers and opname. */
const warehouse = ac.newRole({
  product: ['create', 'read', 'update'],
  inventory: ['read', 'adjust', 'transfer', 'opname', 'purchase'],
  transaction: ['read'],
  supplier: ['create', 'read', 'update'],
  report: ['read'],
});

/** Default role: read-only visibility, as before. */
const staff = ac.newRole(READ_ALL);

export const roles = {
  platform_owner: platformOwner,
  tenant_owner: tenantOwner,
  tenant_admin: tenantAdmin,
  store_manager: storeManager,
  cashier,
  warehouse,
  staff,
};

/** Union of the role names above — the type of `session.user.role`. */
export type AppRole = keyof typeof roles;
