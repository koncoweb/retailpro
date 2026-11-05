/**
 * The resolver that answers "what may this person do, and where".
 *
 * These cases are the contract every screen depends on, so they are written
 * against the settings documents a tenant can actually contain: none at all
 * (a fresh tenant), one an owner edited on the Role screen, and one with a
 * custom role in it. Nothing here touches React or SQL — the point of
 * `permission-matrix.ts` is that it can be tested like this.
 */
import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSION_KEYS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_GROUPS,
  ROLES,
  type RoleValue,
} from '@/config/roles';
import {
  FULL_SCOPE,
  allPermissionKeys,
  branchInScope,
  buildGrants,
  effectiveBranchScope,
  effectivePermissions,
  effectiveWarehouseScope,
  grantForRole,
  inScope,
  isBuiltinRole,
  isCustomRoleKey,
  makeChecker,
  permissionLabel,
  permissionRole,
  scopeIds,
  warehouseInScope,
  type RoleScope,
  type RoleSettings,
} from './permission-matrix';

const B1 = 'branch-central';
const B2 = 'branch-north';
const W1 = 'wh-gudang';
const W2 = 'wh-toko';

describe('buildGrants: shipped state', () => {
  it('resolves every builtin role when the tenant has no settings at all', () => {
    const grants = buildGrants(null);

    for (const role of ROLES) {
      const grant = grants[role.value];
      expect(grant, role.value).toBeTruthy();
      expect(grant.key).toBe(role.value);
      expect(grant.builtin).toBe(true);
      expect(grant.label).toBe(role.label);
      expect(grant.permissions).toEqual(DEFAULT_ROLE_PERMISSIONS[role.value as RoleValue]);
      expect(grant.scope).toEqual(FULL_SCOPE);
    }
  });

  it('gives the owner tier the whole catalog and the staff role nothing', () => {
    const grants = buildGrants(undefined);

    for (const role of ['platform_owner', 'tenant_owner', 'tenant_admin'] as const) {
      const permissions = grants[role].permissions;
      for (const key of ALL_PERMISSION_KEYS) {
        expect(permissions[key], `${role}.${key}`).toBe(true);
      }
    }
    expect(grants.staff.permissions).toEqual({});
    // A role nobody assigns is still resolved, not dropped.
    expect(Object.keys(grants).length).toBe(ROLES.length + 1);
  });

  it('puts every catalog key in exactly one group', () => {
    const grouped = Object.values(PERMISSION_GROUPS).flat();
    expect(grouped.length).toBe(ALL_PERMISSION_KEYS.length);
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it('declares no permission a role cannot be given', () => {
    for (const role of ROLES) {
      const defaults = DEFAULT_ROLE_PERMISSIONS[role.value] ?? {};
      for (const key of Object.keys(defaults)) {
        expect(ALL_PERMISSION_KEYS, `${role.value}.${key}`).toContain(key);
      }
    }
  });
});

describe('buildGrants: merge order', () => {
  const settings: RoleSettings = {
    role_permissions: {
      store_manager: { approve_po: true, view_reports: false },
      warehouse: { dispatch_stock: false },
      cust_supervisor: { stock_opname: true, view_reports: false },
    },
    custom_roles: {
      cust_supervisor: {
        label: 'Supervisor',
        clone_of: 'store_manager',
        permissions: { view_reports: true },
      },
    },
  };

  it('lets the tenant override beat the shipped default', () => {
    const grants = buildGrants(settings);

    // store_manager never ships approve_po; the owner switched it on.
    expect(grants.store_manager.permissions.approve_po).toBe(true);
    expect(DEFAULT_ROLE_PERMISSIONS.store_manager.approve_po).toBeUndefined();
    // ...and switched a granted one off again.
    expect(grants.store_manager.permissions.view_reports).toBe(false);
    // Silent keys keep their default.
    expect(grants.store_manager.permissions.access_pos).toBe(true);
    expect(grants.warehouse.permissions.dispatch_stock).toBe(false);
  });

  it('does not leak one role override into another role', () => {
    const grants = buildGrants(settings);

    expect(grants.warehouse.permissions.view_reports).toBeUndefined();
    expect(buildGrants(null).tenant_admin.permissions.view_reports).toBe(true);
  });

  it('orders the defaults, the override map and the custom role definition', () => {
    const grants = buildGrants(settings);
    const supervisor = grants.cust_supervisor.permissions;

    // layer 1: clone_of defaults      -> store_manager holds view_inventory
    expect(supervisor.view_inventory).toBe(true);
    // layer 2: role_permissions[key]   -> stock_opname came from the override map
    expect(supervisor.stock_opname).toBe(true);
    // layer 3: the custom role's own set wins over both
    expect(supervisor.view_reports).toBe(true);
    expect(grants.cust_supervisor.builtin).toBe(false);
  });

  it('ignores values that are not booleans', () => {
    // A settings document survives anything an older build wrote into it.
    const grants = buildGrants({
      role_permissions: {
        cashier: {
          access_pos: 'yes',
          apply_discount: false,
          nothing: null,
        } as unknown as Record<string, boolean>,
      },
    });

    expect(grants.cashier.permissions.access_pos).toBe(true);
    expect(grants.cashier.permissions.apply_discount).toBe(false);
    expect(grants.cashier.permissions.nothing).toBeUndefined();
  });
});

describe('buildGrants: the legacy `admin` alias', () => {
  it('resolves as tenant_admin, permissions and all', () => {
    expect(permissionRole('admin')).toBe('tenant_admin');
    expect(permissionRole(' Admin ')).not.toBe('tenant_admin');
    expect(permissionRole(null)).toBeNull();

    const grants = buildGrants({ role_permissions: { tenant_admin: { export_reports: false } } });

    expect(grants.admin).toBeTruthy();
    expect(grants.admin.key).toBe('admin');
    expect(grants.admin.permissions).toEqual(grants.tenant_admin.permissions);
    expect(grants.admin.permissions.export_reports).toBe(false);
    // Looked up through a session that still carries the old string.
    expect(grantForRole(grants, 'admin')?.label).toBe(grants.tenant_admin.label);
  });
});

describe('makeChecker', () => {
  it('grants only an explicit true', () => {
    const can = makeChecker({
      key: 'k',
      label: 'K',
      description: '',
      builtin: true,
      permissions: { on: true, off: false, missing: undefined } as Record<string, boolean>,
      scope: FULL_SCOPE,
    });

    expect(can('on')).toBe(true);
    expect(can('off')).toBe(false);
    expect(can('missing')).toBe(false);
    expect(can('never_mentioned')).toBe(false);
  });

  it('fails closed for a role the matrix does not know', () => {
    const can = makeChecker(grantForRole(buildGrants(null), 'cust_deleted_yesterday'));

    for (const key of ALL_PERMISSION_KEYS) {
      expect(can(key), key).toBe(false);
    }
    expect(effectivePermissions(undefined)).toEqual({});
    expect(makeChecker(null)('view_dashboard')).toBe(false);
  });
});

describe('scope', () => {
  it('defaults to everywhere for both builtins and custom roles', () => {
    const grants = buildGrants({ custom_roles: { cust_x: { label: 'X' } } });

    expect(grants.cashier.scope).toEqual({ branches: 'all', warehouses: 'all' });
    expect(grants.cust_x.scope).toEqual({ branches: 'all', warehouses: 'all' });
    expect(effectiveBranchScope({ scope: grants.cashier.scope })).toBeNull();
    expect(effectiveWarehouseScope(grants.cashier.scope)).toBeNull();
  });

  it('narrows a builtin through role_scopes and a custom role through its own', () => {
    const grants = buildGrants({
      role_scopes: { warehouse: { branches: [B1, B2], warehouses: [W1] } },
      custom_roles: {
        cust_x: { label: 'X', scope: { branches: [B1] } },
      },
    });

    expect(grants.warehouse.scope).toEqual({ branches: [B1, B2], warehouses: [W1] });
    // A half-written scope must not silently become "nowhere".
    expect(grants.cust_x.scope).toEqual({ branches: [B1], warehouses: 'all' });
    expect(effectiveWarehouseScope(grants.cust_x.scope)).toBeNull();
  });

  it('treats a partial custom scope as the whole answer for that role', () => {
    const grants = buildGrants({
      role_scopes: { cust_x: { warehouses: [W2] } },
      custom_roles: { cust_x: { label: 'X', scope: { branches: [B1] } } },
    });

    // The role definition wins; the legacy map is only a fallback.
    expect(grants.cust_x.scope).toEqual({ branches: [B1], warehouses: 'all' });
  });

  it('accepts numbers stored as ids and keeps them comparable', () => {
    const grants = buildGrants({ role_scopes: { cashier: { branches: [7, 8] as unknown as string[] } } });

    expect(grants.cashier.scope.branches).toEqual(['7', '8']);
    expect(branchInScope(grants.cashier.scope, '7')).toBe(true);
  });

  it('hides rows that belong to no location from a scoped role', () => {
    const scoped: RoleScope = { branches: [B1], warehouses: 'all' };

    expect(inScope('all', null)).toBe(true);
    expect(inScope([B1], null)).toBe(false);
    expect(inScope([B1], undefined)).toBe(false);
    expect(inScope([B1], B1)).toBe(true);
    expect(inScope([B1], B2)).toBe(false);
    expect(branchInScope(undefined, B2)).toBe(true);
    expect(warehouseInScope({ branches: 'all', warehouses: [W1] }, W2)).toBe(false);
    expect(scopeIds('all')).toBeNull();
    expect(scopeIds([W1])).toEqual([W1]);
  });

  it('follows the owner answer, then the company-wide role, then the assignment', () => {
    const scoped: RoleScope = { branches: [B1, B2], warehouses: 'all' };

    expect(
      effectiveBranchScope({ scope: scoped, assignedBranchId: B2, companyWide: true })
    ).toEqual([B1, B2]);
    expect(effectiveBranchScope({ scope: FULL_SCOPE, companyWide: true })).toBeNull();
    expect(effectiveBranchScope({ scope: FULL_SCOPE, assignedBranchId: B2 })).toEqual([B2]);
    // A scoped person with no branch of their own is not silently shown the world.
    expect(effectiveBranchScope({ scope: FULL_SCOPE })).toBeNull();
  });
});

describe('role key helpers', () => {
  it('keeps custom keys namespaced', () => {
    expect(isCustomRoleKey('cust_7k2m9q')).toBe(true);
    expect(isCustomRoleKey('purchasing')).toBe(false);
    expect(isBuiltinRole('purchasing')).toBe(true);
    expect(isBuiltinRole('cust_purchasing')).toBe(false);
  });

  it('labels a known permission and repeats an unknown one', () => {
    expect(permissionLabel('approve_po')).toBe('Setujui Purchase Order');
    expect(permissionLabel('cust_invented')).toBe('cust_invented');
  });

  it('hands the whole catalog to a UI that iterates it', () => {
    expect(allPermissionKeys()).toEqual(ALL_PERMISSION_KEYS);
    expect(allPermissionKeys()).toEqual(Object.values(PERMISSION_GROUPS).flat());
  });
});
