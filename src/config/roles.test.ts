import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSION_KEYS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_CATALOG,
  PERMISSION_GROUPS,
  PERMISSION_HINTS,
  PERMISSION_LABELS,
  ROLES,
  resolveRolePermissions,
  type RoleValue,
} from './roles';
import { buildGrants, effectivePermissions, grantForRole } from '@/lib/permission-matrix';

const ALL_PERMISSIONS = Object.values(PERMISSION_GROUPS).flat();

describe('permission catalog', () => {
  it('gives every key a label and a hint, and nothing more', () => {
    const keys = Object.values(PERMISSION_CATALOG)
      .flat()
      .map((entry) => entry.key);

    // One declaration, so the derived lists cannot have drifted from it.
    expect(new Set(keys).size, 'duplicate key in the catalog').toBe(keys.length);
    expect(ALL_PERMISSION_KEYS).toEqual(keys);

    for (const key of keys) {
      expect(PERMISSION_LABELS[key], key).toBeTruthy();
      // The hint is the sentence a novice reads under the switch.
      expect(PERMISSION_HINTS[key], key).toBeTruthy();
      expect(PERMISSION_HINTS[key].length, key).toBeGreaterThan(15);
    }

    // No key exists in a derived map that the catalog does not declare.
    expect(Object.keys(PERMISSION_LABELS).sort()).toEqual([...keys].sort());
    expect(Object.keys(PERMISSION_HINTS).sort()).toEqual([...keys].sort());
  });

  it('declares no permission a role cannot be given', () => {
    for (const role of ROLES) {
      const defaults = DEFAULT_ROLE_PERMISSIONS[role.value as RoleValue] ?? {};
      for (const key of Object.keys(defaults)) {
        expect(ALL_PERMISSION_KEYS, `${role.value}.${key}`).toContain(key);
      }
    }
  });

  it('is grouped in the order the Role screen renders', () => {
    expect(Object.keys(PERMISSION_GROUPS)).toEqual([
      'dashboard',
      'pos',
      'inventory',
      'employees',
      'reports',
      'settings',
    ]);
  });
});

describe('the matrix of a custom role', () => {
  // The owner cloned `store_manager`, pressed Simpan, and this is the document
  // that got written. Keys the base role already held are stored as deviations,
  // so the resolution has to fall back to the shipped defaults for the rest.
  const settings = {
    custom_roles: {
      cust_supervisor: {
        label: 'Supervisor Toko',
        clone_of: 'store_manager',
        auth_tier: 'staff',
        permissions: { access_pos: true, approve_stock_request: true, add_stock: false },
      },
    },
  };

  it('starts from the role it was cloned from', () => {
    const grant = grantForRole(buildGrants(settings), 'cust_supervisor');
    const effective = effectivePermissions(grant);

    expect(grant?.builtin).toBe(false);
    expect(grant?.label).toBe('Supervisor Toko');
    // Explicitly switched off, even though the base role has it.
    expect(effective.add_stock).toBe(false);
    // Explicitly switched on, even though the base role does not.
    expect(effective.approve_stock_request).toBe(true);
    // Silent: keeps the base role's default.
    expect(effective.view_inventory).toBe(true);
    expect(effective.approve_po).toBeUndefined();
  });

  it('still shows a permission that shipped after the role was made', () => {
    // The document above was written before `void_transaction` existed for anyone.
    const effective = effectivePermissions(grantForRole(buildGrants(settings), 'cust_supervisor'));

    expect(ALL_PERMISSION_KEYS).toContain('void_transaction');
    // Absent from both the clone and the base, so it reads as off rather than
    // vanishing from the editor — the owner can now switch it on.
    expect(effective.void_transaction).toBeUndefined();
    const owner = effectivePermissions(grantForRole(buildGrants(null), 'tenant_owner'));
    expect(owner.void_transaction).toBe(true);
  });

  it('resolves a role whose base no longer exists without throwing', () => {
    const grant = grantForRole(
      buildGrants({ custom_roles: { cust_x: { label: 'X', clone_of: 'regional_manager', permissions: { access_pos: true } } } }),
      'cust_x'
    );

    expect(effectivePermissions(grant)).toEqual({ access_pos: true });
  });

  it('fails closed when the role a user holds has been deleted', () => {
    const grants = buildGrants(settings);
    expect(grants['cust_supervisor']).toBeTruthy();

    const afterDelete = buildGrants({
      custom_roles: { ...settings.custom_roles, cust_supervisor: undefined },
    });
    // The session still says `cust_supervisor`; nobody may infer a default here.
    expect(grantForRole(afterDelete, 'cust_supervisor')).toBeUndefined();
    expect(effectivePermissions(grantForRole(afterDelete, 'cust_supervisor'))).toEqual({});
    expect(grantForRole(afterDelete, null)).toBeUndefined();
  });
});

describe('resolveRolePermissions', () => {
  it('returns the shipped defaults when a role has no override', () => {
    expect(resolveRolePermissions('purchasing')).toEqual(DEFAULT_ROLE_PERMISSIONS.purchasing);
    expect(resolveRolePermissions('purchasing', null)).toEqual(DEFAULT_ROLE_PERMISSIONS.purchasing);
    expect(resolveRolePermissions('purchasing', {})).toEqual(DEFAULT_ROLE_PERMISSIONS.purchasing);
  });

  it('keeps a permission that an older saved matrix never knew about', () => {
    // The shape a tenant has after pressing Simpan on the Role screen before
    // procurement shipped: every key of the time, none of the new ones.
    const stale = {
      view_dashboard: true,
      view_inventory: true,
      add_stock: true,
      view_settings: true,
    };

    const effective = resolveRolePermissions('tenant_owner', stale);

    expect(effective.create_po).toBe(true);
    expect(effective.approve_po).toBe(true);
    expect(effective.receive_po).toBe(true);
    expect(effective.cancel_po).toBe(true);
  });

  it('lets an explicit false in the override win over the default', () => {
    const effective = resolveRolePermissions('tenant_owner', { approve_po: false });

    expect(effective.approve_po).toBe(false);
    // Everything the override is silent about is unaffected.
    expect(effective.create_po).toBe(true);
  });

  it('does not grant a permission the role never had', () => {
    const effective = resolveRolePermissions('cashier', { view_inventory: true });

    expect(effective.view_inventory).toBe(true);
    expect(effective.create_po).toBeUndefined();
    expect(effective.approve_po).toBeUndefined();
  });

  it('separates raising an order from approving it', () => {
    // §4: one person may commit money, another must agree to it.
    for (const role of ['purchasing', 'store_manager', 'warehouse'] as const) {
      const effective = resolveRolePermissions(role);
      expect(effective.create_po || effective.receive_po, role).toBe(true);
      expect(effective.approve_po, role).toBeFalsy();
    }

    for (const role of ['tenant_owner', 'tenant_admin'] as const) {
      const effective = resolveRolePermissions(role);
      expect(effective.approve_po, role).toBe(true);
    }
  });

  it('keeps variant and price control with the owner, not the operator', () => {
    // §8: the person who raises an order must not also set the agreed price,
    // and the person receiving goods must not set the shelf price.
    for (const role of ['store_manager', 'warehouse', 'purchasing', 'cashier'] as const) {
      const effective = resolveRolePermissions(role);
      for (const permission of ['manage_variants', 'manage_vendor_prices', 'manage_sell_prices']) {
        expect(effective[permission], `${role}.${permission}`).toBeFalsy();
      }
    }

    for (const role of ['tenant_owner', 'tenant_admin', 'platform_owner'] as const) {
      const effective = resolveRolePermissions(role);
      for (const permission of ['manage_variants', 'manage_vendor_prices', 'manage_sell_prices']) {
        expect(effective[permission], `${role}.${permission}`).toBe(true);
      }
    }
  });

  it('gives every role a complete matrix for the permissions it holds', () => {
    const effective = resolveRolePermissions('tenant_owner');
    for (const permission of ALL_PERMISSIONS) {
      expect(effective[permission], permission).toBe(true);
    }
  });
});
