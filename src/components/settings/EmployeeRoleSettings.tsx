import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  Copy,
  Eye,
  Layers,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Search,
  Shield,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { PermissionRow } from "@/components/ui/permission-row";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  ALL_PERMISSION_KEYS,
  BUILTIN_ASSIGNABLE_ROLES,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSION_HINTS,
  PERMISSION_LABELS,
  ROLES,
  type PermissionGroupName,
  type RoleValue,
} from "@/config/roles";
import {
  buildGrants,
  CUSTOM_ROLE_PREFIX,
  FULL_SCOPE,
  type CustomRoleDefinition,
  type RoleScope,
  type ScopeTarget,
} from "@/lib/permission-matrix";
import { readTenantRoleSettings, replaceTenantSetting } from "@/lib/tenant-settings";
import { query } from "@/lib/db";
import { useInvalidateTenantSettings, usePermissions } from "@/hooks/use-permissions";
import { navItems } from "@/components/layout/nav-items";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/**
 * The one screen where an owner answers "what may each role do, and where".
 *
 * It used to be a table of the eight shipped roles whose editor wrote a
 * snapshot of *every* role's matrix on each save: editing the cashier froze the
 * warehouse at whatever the defaults happened to be that day, and a permission
 * added in a later release could never be granted at all. Three rules replace
 * that:
 *
 *   1. a save patches only the role being edited, and only the keys that
 *      actually differ from the shipped default, so the document keeps
 *      growing forward instead of freezing;
 *   2. the switches read and write `DEFAULT_ROLE_PERMISSIONS` merged with the
 *      tenant override through the same resolver the guards use — what is on
 *      this screen is what the app enforces;
 *   3. roles are not fixed any more. `custom_roles` in the settings document
 *      holds the owner's own roles, with a location scope attached.
 *
 * Every row is 44px tall with the explanation under the label, and the whole
 * editor collapses into a sheet on a phone, because the owner reading it is
 * not a programmer.
 */

/** Group names are English keys; a novice must never have to guess them. */
const GROUP_TITLES: Record<PermissionGroupName, string> = {
  dashboard: "Dashboard & Laporan Awal",
  pos: "Kasir (POS)",
  inventory: "Gudang & Pembelian",
  employees: "Karyawan",
  reports: "Laporan & Keuangan",
  settings: "Pengaturan & Akses",
};

interface RoleDraft {
  key: string;
  label: string;
  description: string;
  builtin: boolean;
  /** Builtin role a custom role inherits its defaults from. */
  cloneOf: string | null;
  /** The builtin role Better Auth is handed when an account gets this role. */
  authTier: string;
  createdAt?: string;
  /** Full map: every catalog key present, so nothing is implicitly undecided. */
  permissions: Record<string, boolean>;
  scope: RoleScope;
}

interface LocationOption {
  id: string;
  name: string;
}

function samePermissions(a: Record<string, boolean>, b: Record<string, boolean>): boolean {
  for (const key of ALL_PERMISSION_KEYS) {
    if ((a[key] === true) !== (b[key] === true)) return false;
  }
  return true;
}

function sameScope(a: RoleScope, b: RoleScope): boolean {
  const eq = (x: ScopeTarget, y: ScopeTarget) =>
    x === "all" || y === "all" ? x === y : x.length === y.length && x.every((v) => y.includes(v));
  return eq(a.branches, b.branches) && eq(a.warehouses, b.warehouses);
}

function isDraftDirty(draft: RoleDraft, base: RoleDraft | undefined): boolean {
  if (!base) return true;
  return (
    draft.label !== base.label ||
    draft.description !== base.description ||
    !samePermissions(draft.permissions, base.permissions) ||
    !sameScope(draft.scope, base.scope)
  );
}

/** Every catalog key, resolved against a grant's merged map, with a real `false`. */
function fullPermissionMap(source: Record<string, boolean>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const key of ALL_PERMISSION_KEYS) out[key] = source[key] === true;
  return out;
}

/** Only the keys that disagree with the shipped defaults are worth storing. */
function deviationsFrom(base: Record<string, boolean>, desired: Record<string, boolean>) {
  const out: Record<string, boolean> = {};
  for (const key of ALL_PERMISSION_KEYS) {
    const b = base[key] === true;
    const d = desired[key] === true;
    if (b !== d) out[key] = d;
  }
  return out;
}

function newRoleKey(): string {
  // 6 chars of base36: collisions inside one tenant's handful of roles are
  // checked again before the write anyway.
  return `${CUSTOM_ROLE_PREFIX}${Math.random().toString(36).slice(2, 8)}`;
}

export function EmployeeRoleSettings() {
  const { can, grants, loading: permissionsLoading } = usePermissions();
  const invalidate = useInvalidateTenantSettings();

  /** `manage_roles` decides who may change access at all; the rest is read-only. */
  const canEdit = can("edit_settings");
  const canSave = can("manage_roles");

  const [bases, setBases] = useState<Record<string, RoleDraft>>({});
  const [drafts, setDrafts] = useState<Record<string, RoleDraft>>({});
  const [order, setOrder] = useState<string[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [branches, setBranches] = useState<LocationOption[]>([]);
  const [warehouses, setWarehouses] = useState<LocationOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [discardFor, setDiscardFor] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ label: "", description: "", cloneOf: "store_manager" });

  const fetchRoles = useCallback(async () => {
    setIsLoading(true);
    try {
      const [settingsRes, countRes, branchRes, warehouseRes] = await Promise.all([
        readTenantRoleSettings(),
        query<{ role: string | null; count: number | string }>(
          `SELECT role, COUNT(*) as count FROM users GROUP BY role`
        ),
        query<LocationOption>(
          `SELECT id, name FROM branches WHERE status = 'active' ORDER BY name ASC`
        ).catch(() => ({ rows: [] as LocationOption[] })),
        query<LocationOption>(
          `SELECT id, name FROM warehouses WHERE status = 'active' ORDER BY name ASC`
        ).catch(() => ({ rows: [] as LocationOption[] })),
      ]);

      const nextCounts: Record<string, number> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      countRes.rows.forEach((row: any) => {
        if (row.role) nextCounts[String(row.role).toLowerCase()] = Number(row.count) || 0;
      });

      // The resolver answers for every role at once, including custom ones, so
      // this screen cannot show a matrix that the guards disagree with.
      const resolved = buildGrants(settingsRes);
      const customKeys = Object.keys(settingsRes.custom_roles ?? {});
      const builtinKeys = ROLES.filter((r) => r.value !== "platform_owner").map((r) => r.value);
      const keys = [...builtinKeys, ...[...customKeys].sort((a, b) =>
        (resolved[a]?.label ?? a).localeCompare(resolved[b]?.label ?? b)
      )];

      const nextBases: Record<string, RoleDraft> = {};
      for (const key of keys) {
        const grant = resolved[key];
        if (!grant) continue;
        const custom = settingsRes.custom_roles?.[key];
        const cloneOf = custom ? custom.clone_of ?? null : null;
        nextBases[key] = {
          key,
          label: grant.label,
          description: grant.description,
          builtin: grant.builtin,
          cloneOf,
          authTier: custom?.auth_tier ?? (cloneOf && cloneOf !== "platform_owner" ? cloneOf : "staff"),
          createdAt: custom?.created_at,
          permissions: fullPermissionMap(grant.permissions),
          scope: grant.scope,
        };
      }

      setBases(nextBases);
      setDrafts(structuredClone(nextBases));
      setOrder(keys);
      setCounts(nextCounts);
      setBranches(branchRes.rows as LocationOption[]);
      setWarehouses(warehouseRes.rows as LocationOption[]);
      setSelected((current) => (current && nextBases[current] ? current : keys[0] ?? null));
    } catch (error) {
      console.error("Failed to fetch roles data:", error);
      toast.error("Gagal memuat data role");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRoles();
  }, [fetchRoles]);

  const selectedDraft = selected ? drafts[selected] ?? null : null;
  const selectedBase = selected ? bases[selected] : undefined;
  // A draft whose base is gone (a role deleted elsewhere) is not "dirty", it is
  // stale — and marking it dirty would trap the owner in a discard dialog.
  const dirty = useMemo(
    () => Object.values(drafts).some((draft) => bases[draft.key] && isDraftDirty(draft, bases[draft.key])),
    [drafts, bases]
  );
  const selectedDirty =
    !!selectedDraft && !!selectedBase && isDraftDirty(selectedDraft, selectedBase);

  const patchDraft = useCallback((key: string, patch: Partial<RoleDraft>) => {
    setDrafts((prev) => (prev[key] ? { ...prev, [key]: { ...prev[key], ...patch } } : prev));
  }, []);

  const togglePermission = (permission: string, value?: boolean) => {
    if (!selectedDraft || !canEdit) return;
    const next = value ?? selectedDraft.permissions[permission] !== true;
    patchDraft(selectedDraft.key, { permissions: { ...selectedDraft.permissions, [permission]: next } });
  };

  const setGroupAll = (group: PermissionGroupName, value: boolean) => {
    if (!selectedDraft) return;
    const permissions = { ...selectedDraft.permissions };
    for (const key of PERMISSION_GROUPS[group]) permissions[key] = value;
    patchDraft(selectedDraft.key, { permissions });
  };

  const clearEverything = () => {
    if (!selectedDraft) return;
    patchDraft(selectedDraft.key, {
      permissions: Object.fromEntries(ALL_PERMISSION_KEYS.map((key) => [key, false])),
    });
  };

  const resetSelected = () => {
    if (!selectedBase) return;
    patchDraft(selectedBase.key, structuredClone(selectedBase));
  };

  /**
   * Role switching is guarded because the editor is a form an owner can walk
   * away from half-edited; silently dropping it is how a permission ends up
   * not quite what they meant.
   */
  const selectRole = (key: string) => {
    if (key === selected) return;
    if (selected && selectedDirty && canEdit) {
      setDiscardFor(key);
      return;
    }
    setSelected(key);
    setSheetOpen(false);
  };

  const query_ = search.trim().toLowerCase();
  /**
   * Which keys the search matches, per group. The label, the plain-language
   * hint and the raw key all match, because an owner remembers the words on
   * this screen, not the identifier behind them.
   */
  const groupsWithKeys = useMemo((): [PermissionGroupName, string[]][] => {
    const groups = Object.keys(PERMISSION_GROUPS) as PermissionGroupName[];
    if (!query_) return groups.map((group) => [group, PERMISSION_GROUPS[group]]);
    return groups
      .map((group) => [
        group,
        PERMISSION_GROUPS[group].filter((key) => {
          const label = (PERMISSION_LABELS[key] ?? key).toLowerCase();
          const hint = (PERMISSION_HINTS[key] ?? "").toLowerCase();
          return label.includes(query_) || hint.includes(query_) || key.includes(query_);
        }),
      ] as [PermissionGroupName, string[]])
      .filter(([, keys]) => keys.length > 0);
  }, [query_]);

  // ---------------------------------------------------------------- persistence

  /** `id === null` puts the location type back to "Semua". */
  const applyScope = (target: "branches" | "warehouses", id: string | null, on: boolean) => {
    if (!selectedDraft) return;
    if (id === null) {
      patchDraft(selectedDraft.key, { scope: { ...selectedDraft.scope, [target]: "all" } });
      return;
    }
    const current = selectedDraft.scope[target];
    const list = current === "all" ? [] : [...current];
    const next = on ? [...new Set([...list, id])] : list.filter((v) => v !== id);
    // Emptying the list is not "no locations" — it is the owner asking for
    // "semua" again, so the scope goes back to unrestricted rather than
    // locking the role out of every screen by an accidental last click.
    patchDraft(selectedDraft.key, {
      scope: { ...selectedDraft.scope, [target]: next.length ? next : "all" },
    });
  };

  const saveSelected = async () => {
    const draft = selectedDraft;
    if (!draft || !canSave) return;
    setSaving(true);
    try {
      // Re-read before writing: two owners editing two roles at once must not
      // make the second save throw the first one's patch away.
      const fresh = await readTenantRoleSettings();
      const customRoles: Record<string, CustomRoleDefinition> = { ...(fresh.custom_roles ?? {}) };

      if (draft.builtin) {
        const overrides = { ...(fresh.role_permissions ?? {}) };
        const deviations = deviationsFrom(
          DEFAULT_ROLE_PERMISSIONS[draft.key as RoleValue] ?? {},
          draft.permissions
        );
        if (Object.keys(deviations).length) overrides[draft.key] = deviations;
        else delete overrides[draft.key];
        await replaceTenantSetting(
          "role_permissions",
          Object.keys(overrides).length ? overrides : undefined
        );

        const scopes = { ...(fresh.role_scopes ?? {}) };
        if (sameScope(draft.scope, FULL_SCOPE)) delete scopes[draft.key];
        else scopes[draft.key] = draft.scope;
        await replaceTenantSetting("role_scopes", Object.keys(scopes).length ? scopes : undefined);
      } else {
        const baseDefaults =
          DEFAULT_ROLE_PERMISSIONS[(draft.cloneOf ?? "") as RoleValue] ?? {};
        const deviations = deviationsFrom(baseDefaults, draft.permissions);
        customRoles[draft.key] = {
          label: draft.label,
          description: draft.description,
          clone_of: draft.cloneOf,
          auth_tier: draft.authTier,
          permissions: deviations,
          scope: draft.scope,
          created_at: draft.createdAt,
        };
        await replaceTenantSetting("custom_roles", customRoles);
      }

      const nextBase = structuredClone(draft);
      setBases((prev) => ({ ...prev, [draft.key]: nextBase }));
      invalidate();
      toast.success(`Hak akses ${draft.label} tersimpan`);
    } catch (error) {
      console.error("Failed to save permissions:", error);
      toast.error("Gagal menyimpan permission ke database");
    } finally {
      setSaving(false);
    }
  };

  const createCustomRole = async () => {
    const label = createForm.label.trim();
    if (!label) {
      toast.error("Nama role belum diisi");
      return;
    }
    const key = newRoleKey();
    if (drafts[key]) {
      toast.error("Role baru sudah dibuat, coba lagi");
      return;
    }
    const cloneOf = createForm.cloneOf;
    const grant = buildGrants({ custom_roles: { [key]: { label, clone_of: cloneOf } } })[key];
    const draft: RoleDraft = {
      key,
      label,
      description: createForm.description.trim(),
      builtin: false,
      cloneOf,
      authTier: BUILTIN_ASSIGNABLE_ROLES.includes(cloneOf as RoleValue) ? cloneOf : "staff",
      createdAt: new Date().toISOString(),
      permissions: fullPermissionMap(grant?.permissions ?? {}),
      scope: FULL_SCOPE,
    };
    setDrafts((prev) => ({ ...prev, [key]: draft }));
    setBases((prev) => ({ ...prev, [key]: draft }));
    setOrder((prev) => [...prev, key]);
    setSelected(key);
    setCreatorOpen(false);
    setCreateForm({ label: "", description: "", cloneOf: "store_manager" });
    // Saved immediately, then edited: a half-created role that exists only in
    // local state is indistinguishable from one that was lost.
    await saveDraft(draft);
  };

  /** Used by both create and duplicate, which write a whole new `custom_roles` key. */
  const saveDraft = async (draft: RoleDraft) => {
    setSaving(true);
    try {
      const fresh = await readTenantRoleSettings();
      const customRoles: Record<string, CustomRoleDefinition> = { ...(fresh.custom_roles ?? {}) };
      const baseDefaults = DEFAULT_ROLE_PERMISSIONS[(draft.cloneOf ?? "") as RoleValue] ?? {};
      customRoles[draft.key] = {
        label: draft.label,
        description: draft.description,
        clone_of: draft.cloneOf,
        auth_tier: draft.authTier,
        permissions: deviationsFrom(baseDefaults, draft.permissions),
        scope: draft.scope,
        created_at: draft.createdAt,
      };
      await replaceTenantSetting("custom_roles", customRoles);
      const nextBase = structuredClone(draft);
      setBases((prev) => ({ ...prev, [draft.key]: nextBase }));
      invalidate();
      toast.success(`Role ${draft.label} tersimpan`);
    } catch (error) {
      console.error("Failed to create role:", error);
      toast.error("Gagal menyimpan role baru");
    } finally {
      setSaving(false);
    }
  };

  const duplicateRole = async (key: string) => {
    const source = drafts[key] ?? bases[key];
    if (!source) return;
    const copyKey = newRoleKey();
    const draft: RoleDraft = {
      ...structuredClone(source),
      key: copyKey,
      label: `${source.label} (salinan)`,
      builtin: false,
      // A duplicate of a builtin starts as a custom role cloned from it, so it
      // keeps inheriting the same shipped defaults.
      cloneOf: source.builtin ? source.key : source.cloneOf,
      authTier: source.builtin
        ? BUILTIN_ASSIGNABLE_ROLES.includes(source.key as RoleValue)
          ? source.key
          : "staff"
        : source.authTier,
      createdAt: new Date().toISOString(),
    };
    setDrafts((prev) => ({ ...prev, [copyKey]: draft }));
    setOrder((prev) => [...prev, copyKey]);
    setSelected(copyKey);
    await saveDraft(draft);
  };

  const deleteCustomRole = async (key: string) => {
    const target = drafts[key] ?? bases[key];
    if (!target) return;
    const inUse = counts[key] ?? 0;
    if (inUse > 0) {
      // A role that is somebody's identity cannot disappear: the person would
      // resolve to no permissions at all and be locked out with no explanation.
      let names = "";
      try {
        const res = await query<{ name: string | null }>(
          `SELECT name FROM users WHERE role = $1 ORDER BY name ASC LIMIT 3`,
          [key]
        );
        names = res.rows.map((r) => r.name || "-").join(", ");
      } catch {
        /* the count alone is enough to refuse */
      }
      toast.error(
        `Role ini dipakai ${inUse} karyawan${names ? ` (${names}${inUse > 3 ? "…" : ""})` : ""}. ` +
          "Pindahkan mereka ke role lain sebelum menghapus."
      );
      setDeleteTarget(null);
      return;
    }
    try {
      const fresh = await readTenantRoleSettings();
      const customRoles = { ...(fresh.custom_roles ?? {}) };
      delete customRoles[key];
      await replaceTenantSetting(
        "custom_roles",
        Object.keys(customRoles).length ? customRoles : undefined
      );
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setBases((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setOrder((prev) => prev.filter((k) => k !== key));
      setSelected((prev) => (prev === key ? order.find((k) => k !== key) ?? null : prev));
      invalidate();
      toast.success(`Role ${target.label} dihapus`);
    } catch (error) {
      console.error("Failed to delete role:", error);
      toast.error("Gagal menghapus role");
    } finally {
      setDeleteTarget(null);
    }
  };

  // --------------------------------------------------------------------- render

  if (isLoading || permissionsLoading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border bg-card p-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Memuat role dan hak akses…</span>
      </div>
    );
  }

  const editor = selectedDraft ? (
    <RoleEditor
      draft={selectedDraft}
      branches={branches}
      warehouses={warehouses}
      userCount={counts[selectedDraft.key] ?? 0}
      canEdit={canEdit}
      canSave={canSave}
      dirty={selectedDirty}
      saving={saving}
      search={search}
      onSearch={setSearch}
      groups={groupsWithKeys}
      onToggle={togglePermission}
      onGroupAll={setGroupAll}
      onClearAll={clearEverything}
      onReset={resetSelected}
      onScope={applyScope}
      onSave={saveSelected}
      onDuplicate={() => void duplicateRole(selectedDraft.key)}
      onDelete={() => setDeleteTarget(selectedDraft.key)}
      onLabelChange={(label) => patchDraft(selectedDraft.key, { label })}
      onDescriptionChange={(description) => patchDraft(selectedDraft.key, { description })}
      preview={
        showPreview ? (
          <RolePreview
            permissions={selectedDraft.permissions}
            scope={selectedDraft.scope}
            branches={branches}
          />
        ) : null
      }
      onTogglePreview={() => setShowPreview((v) => !v)}
    />
  ) : (
    <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">
      Pilih role di daftar untuk mengatur hak aksesnya.
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4 md:p-6">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2.5">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold">Role & Permission</h3>
            <p className="text-xs text-muted-foreground md:text-sm">
              Atur apa yang boleh dilakukan tiap role dan di cabang/gudang mana
            </p>
          </div>
        </div>
        <Button
          size="touch"
          variant={canSave ? "default" : "outline"}
          disabled={!canSave}
          onClick={() => setCreatorOpen(true)}
        >
          <Plus className="h-4 w-4" />
          Buat role
        </Button>
      </div>

      {!canEdit && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Hanya baca</AlertTitle>
          <AlertDescription>
            Anda dapat melihat susunan hak akses, tetapi tidak dapat mengubahnya. Izin
            &ldquo;{PERMISSION_LABELS.edit_settings}&rdquo; belum diberikan ke role Anda.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(360px,420px)_1fr]">
        {/*
         * Role list: cards, never a table, so a phone does not scroll sideways.
         * On a short screen (tablet, small desktop) a vertical column of these
         * runs past the viewport and hides the lower roles, so at md/lg they
         * become a horizontal strip that scrolls sideways in one short band;
         * only on a large monitor (xl) does the side-by-side master/detail
         * return, where the tall column has room.
         */}
        <div className="space-y-2 md:flex md:gap-2 md:space-y-0 md:overflow-x-auto md:pb-2 xl:block xl:space-y-2 xl:overflow-visible xl:pb-0">
          {order.map((key) => {
            const draft = drafts[key];
            if (!draft) return null;
            const granted = ALL_PERMISSION_KEYS.filter((k) => draft.permissions[k]).length;
            const isActive = key === selected;
            return (
              <button
                key={key}
                type="button"
                onClick={() => selectRole(key)}
                aria-pressed={isActive}
                className={`flex min-h-11 w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors md:w-[220px] md:shrink-0 xl:w-full ${
                  isActive
                    ? "border-primary bg-primary/5"
                    : "bg-card hover:bg-muted/60"
                }`}
              >
                <div
                  className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    draft.builtin ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"
                  }`}
                >
                  {draft.builtin ? <Shield className="h-4 w-4" /> : <Layers className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">{draft.label}</span>
                    {isDraftDirty(draft, bases[key]) && (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-warning" title="Belum disimpan" />
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {draft.builtin ? "Role sistem" : "Role kustom"} · {granted} izin
                  </p>
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <Users className="h-3 w-3" />
                    {counts[key] ?? 0} karyawan
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {/* The same editor: a column here at md+, a sheet below it */}
        <div className="hidden md:block">{editor}</div>
        <button
          type="button"
          className="flex min-h-11 items-center justify-center gap-2 rounded-xl border bg-card text-sm font-medium md:hidden"
          onClick={() => setSheetOpen(true)}
        >
          <Shield className="h-4 w-4" />
          Atur hak akses {selectedDraft?.label ?? "role"}
        </button>
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="h-[92vh] flex flex-col gap-0 p-0">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="text-base">Role & Permission</SheetTitle>
            <SheetDescription className="sr-only">
              Daftar role dan hak akses yang dapat diatur
            </SheetDescription>
          </SheetHeader>
          <div className="flex gap-2 overflow-x-auto border-b px-4 py-3">
            {order.map((key) => (
              <Button
                key={key}
                type="button"
                size="touch"
                variant={key === selected ? "default" : "outline"}
                onClick={() => selectRole(key)}
              >
                {drafts[key]?.label ?? key}
              </Button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">{editor}</div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!discardFor} onOpenChange={(open) => !open && setDiscardFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Perubahan belum disimpan</AlertDialogTitle>
            <AlertDialogDescription>
              Hak akses {selectedDraft?.label} masih ada yang belum disimpan. Pindah ke role
              lain akan membuangnya.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Lanjutkan mengedit</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (selected && selectedBase) {
                  patchDraft(selectedBase.key, structuredClone(selectedBase));
                }
                if (discardFor) setSelected(discardFor);
                setDiscardFor(null);
              }}
            >
              Buang perubahan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus role {drafts[deleteTarget ?? ""]?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              {counts[deleteTarget ?? ""] ? (
                <>Role ini masih dipakai {counts[deleteTarget ?? ""]} karyawan.</>
              ) : (
                <>Role ini belum dipakai siapa pun. Karyawan yang memakai role kustom lain tidak terpengaruh.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && void deleteCustomRole(deleteTarget)}
            >
              Hapus role
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CreateRoleDialog
        open={creatorOpen}
        onOpenChange={setCreatorOpen}
        form={createForm}
        onChange={setCreateForm}
        onCreate={() => void createCustomRole()}
      />
    </div>
  );
}

/* -------------------------------------------------------------------- editor */

interface RoleEditorProps {
  draft: RoleDraft;
  branches: LocationOption[];
  warehouses: LocationOption[];
  userCount: number;
  canEdit: boolean;
  canSave: boolean;
  dirty: boolean;
  saving: boolean;
  search: string;
  onSearch: (value: string) => void;
  groups: [PermissionGroupName, string[]][];
  onToggle: (permission: string, value?: boolean) => void;
  onGroupAll: (group: PermissionGroupName, value: boolean) => void;
  onClearAll: () => void;
  onReset: () => void;
  onScope: (target: "branches" | "warehouses", id: string | null, on: boolean) => void;
  onSave: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onLabelChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  preview: React.ReactNode;
  onTogglePreview: () => void;
}

function RoleEditor(props: RoleEditorProps) {
  const {
    draft,
    branches,
    warehouses,
    userCount,
    canEdit,
    canSave,
    dirty,
    saving,
    search,
    onSearch,
    groups,
    onToggle,
    onGroupAll,
    onClearAll,
    onReset,
    onScope,
    onSave,
    onDuplicate,
    onDelete,
    onLabelChange,
    onDescriptionChange,
    preview,
    onTogglePreview,
  } = props;

  const grantedCount = ALL_PERMISSION_KEYS.filter((k) => draft.permissions[k]).length;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border bg-card">
      <div className="space-y-3 border-b p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            {draft.builtin ? (
              <h4 className="text-base font-semibold">{draft.label}</h4>
            ) : (
              <Input
                value={draft.label}
                onChange={(event) => onLabelChange(event.target.value)}
                disabled={!canEdit}
                aria-label="Nama role"
                className="h-9 w-56 font-semibold"
              />
            )}
            <p className="mt-0.5 text-xs text-muted-foreground">
              {draft.builtin ? draft.description || "Role bawaan sistem" : "Role kustom Anda"} ·{" "}
              {userCount} karyawan · {grantedCount} izin aktif
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Button
              size="iconTouch"
              variant="ghost"
              aria-label="Pratinjau menu yang terlihat oleh role ini"
              onClick={onTogglePreview}
              className={preview ? "bg-muted" : undefined}
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              size="iconTouch"
              variant="ghost"
              aria-label={`Duplikat role ${draft.label}`}
              disabled={!canSave}
              onClick={onDuplicate}
            >
              <Copy className="h-4 w-4" />
            </Button>
            {!draft.builtin && (
              <Button
                size="iconTouch"
                variant="ghost"
                aria-label={`Hapus role ${draft.label}`}
                disabled={!canSave}
                onClick={onDelete}
                className="text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {!draft.builtin && (
          <div className="space-y-1.5">
            <Label htmlFor={`desc-${draft.key}`} className="text-xs">
              Deskripsi
            </Label>
            <Textarea
              id={`desc-${draft.key}`}
              rows={2}
              value={draft.description}
              disabled={!canEdit}
              placeholder="Contoh: penanggung jawab shift malam"
              onChange={(event) => onDescriptionChange(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Role ini memulai dari defaults role{" "}
              <Badge variant="secondary" className="mx-1">
                {draft.cloneOf
                  ? ROLES.find((r) => r.value === draft.cloneOf)?.label ?? draft.cloneOf
                  : "tanpa basis"}
              </Badge>
              — izin baru dari pembaruan sistem mengikuti basis ini.
            </p>
          </div>
        )}

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Cari izin…"
            aria-label="Cari izin"
            className="min-h-11 pl-9"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {preview && <div className="space-y-3">{preview}</div>}

        {/* Where, not just what: the owner's answer to "di mana". */}
        <section className="space-y-3 rounded-lg border bg-muted/30 p-3">
          <div className="flex items-center justify-between">
            <h5 className="text-sm font-semibold">Terapkan di</h5>
            <span className="text-xs text-muted-foreground">
              Default-nya semua lokasi, supaya tidak ada yang tiba-tiba terbatas.
            </span>
          </div>
          <ScopeChips
            title="Cabang"
            options={branches}
            selected={draft.scope.branches}
            disabled={!canEdit}
            emptyHint="Belum ada cabang aktif."
            onToggle={(id, on) => onScope("branches", id, on)}
            onAll={() => onScope("branches", null, false)}
          />
          <ScopeChips
            title="Gudang"
            options={warehouses}
            selected={draft.scope.warehouses}
            disabled={!canEdit}
            emptyHint="Belum ada gudang aktif."
            onToggle={(id, on) => onScope("warehouses", id, on)}
            onAll={() => onScope("warehouses", null, false)}
          />
        </section>

        {groups.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Tidak ada izin yang cocok dengan &ldquo;{search}&rdquo;.
          </p>
        )}

        {groups.map(([group, keys]) => {
          const on = keys.filter((k) => draft.permissions[k]).length;
          return (
            <section key={group} className="space-y-1">
              <div className="flex items-center justify-between gap-2 pb-1">
                <h5 className="text-sm font-semibold capitalize">
                  {GROUP_TITLES[group]}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {on}/{keys.length}
                  </span>
                </h5>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!canEdit}
                    onClick={() => onGroupAll(group, true)}
                  >
                    Pilih semua
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!canEdit}
                    onClick={() => onGroupAll(group, false)}
                  >
                    Kosongkan
                  </Button>
                </div>
              </div>
              <div className="divide-y rounded-lg border">
                {keys.map((key) => (
                  <PermissionRow
                    key={key}
                    permission={key}
                    checked={draft.permissions[key] === true}
                    disabled={!canEdit}
                    onCheckedChange={(value) => onToggle(key, value)}
                  />
                ))}
              </div>
            </section>
          );
        })}

        <Button size="touch" variant="outline" disabled={!canEdit} onClick={onClearAll}>
          <X className="h-4 w-4" />
          Kosongkan semua izin role ini
        </Button>
      </div>

      {/* Sticky save bar: the matrix is long, and a button at the very bottom
          of a scroll is a button that gets missed. */}
      <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t bg-card/95 px-4 py-3 backdrop-blur">
        <span
          className={`flex items-center gap-2 text-xs ${dirty ? "text-warning-foreground" : "text-muted-foreground"}`}
        >
          {dirty ? (
            <>
              <span className="h-2 w-2 rounded-full bg-warning" />
              Belum disimpan
            </>
          ) : (
            <>
              <Check className="h-3.5 w-3.5" />
              Sesuai data tersimpan
            </>
          )}
        </span>
        <div className="flex gap-2">
          <Button size="touch" variant="ghost" disabled={!dirty} onClick={onReset}>
            <RotateCcw className="h-4 w-4" />
            Reset
          </Button>
          <Button size="touch" disabled={!canSave || !dirty || saving} onClick={onSave}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Simpan
          </Button>
        </div>
      </div>
    </div>
  );
}

function ScopeChips({
  title,
  options,
  selected,
  disabled,
  emptyHint,
  onToggle,
  onAll,
}: {
  title: string;
  options: LocationOption[];
  selected: ScopeTarget;
  disabled: boolean;
  emptyHint: string;
  onToggle: (id: string, on: boolean) => void;
  onAll: () => void;
}) {
  const all = selected === "all";
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">
        {title}: {all ? `Semua ${title.toLowerCase()}` : `${selected.length} dipilih`}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={all ? "default" : "outline"}
          disabled={disabled || all}
          onClick={onAll}
          className="min-h-11"
        >
          Semua
        </Button>
        {options.length === 0 && <span className="text-xs text-muted-foreground">{emptyHint}</span>}
        {options.map((option) => {
          const on = !all && selected.includes(option.id);
          return (
            <Button
              key={option.id}
              size="sm"
              variant={on ? "default" : "outline"}
              disabled={disabled}
              aria-pressed={on}
              onClick={() => {
                // "Semua" is exited by the first explicit pick; going back to
                // Semua happens through the chip above, never by emptying.
                if (all) onToggle(option.id, true);
                else onToggle(option.id, !on);
              }}
              className="min-h-11 max-w-[220px] truncate"
            >
              {option.name}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * "What will this person actually see" — computed from the same `navItems` the
 * sidebar renders and the same keys `App.tsx` guards with. A preview with its
 * own copy of the menu would be a second source of truth, which is the bug
 * class this whole screen exists to remove.
 */
function RolePreview({
  permissions,
  scope,
  branches,
}: {
  permissions: Record<string, boolean>;
  scope: RoleScope;
  branches: LocationOption[];
}) {
  const has = (key?: string) => !key || permissions[key] === true;
  const groups = navItems
    .filter((item) => has(item.permission))
    .map((item) => ({
      ...item,
      children: (item.children ?? []).filter((child) => has(child.permission)),
    }))
    .filter((item) => !item.children || item.children.length > 0);

  const scopeNames =
    scope.branches === "all"
      ? null
      : scope.branches
          .map((id) => branches.find((b) => b.id === id)?.name ?? id)
          .join(", ");

  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <h5 className="text-sm font-semibold">Pratinjau menu</h5>
      <p className="text-xs text-muted-foreground">
        Inilah yang akan terlihat di layar orang dengan role ini setelah menyimpan.
      </p>
      {scopeNames ? (
        <p className="text-xs">
          Hanya melihat cabang: <span className="font-medium">{scopeNames}</span>
        </p>
      ) : (
        <p className="text-xs">Melihat semua cabang dan gudang.</p>
      )}
      {permissions.access_pos && (
        <p className="text-xs">
          Mendapat kartu <span className="font-medium">POS &amp; Kasir</span> saat masuk.
        </p>
      )}
      {groups.length === 0 && !permissions.access_pos ? (
        <p className="py-2 text-sm text-muted-foreground">
          Orang ini tidak melihat menu apa pun. Layar masuknya akan menampilkan
          &ldquo;Belum ada layar untuk Anda&rdquo;.
        </p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {groups.map((item) => (
            <li key={item.title}>
              <span className="font-medium">{item.title}</span>
              {item.children && item.children.length > 0 && (
                <span className="text-muted-foreground">
                  {" "}
                  — {item.children.map((child) => child.title).join(", ")}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ creator */

function CreateRoleDialog({
  open,
  onOpenChange,
  form,
  onChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: { label: string; description: string; cloneOf: string };
  onChange: (form: { label: string; description: string; cloneOf: string }) => void;
  onCreate: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-h-[90vh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>Role kustom baru</AlertDialogTitle>
          <AlertDialogDescription>
            Role kustom dipakai seperti role biasa: pilih dari daftar role saat menambah atau
            mengubah karyawan. Mulai dari role mana pun, lalu matikan atau nyalakan izinnya.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="new-role-label">Nama role</Label>
            <Input
              id="new-role-label"
              value={form.label}
              placeholder="Contoh: Supervisor Toko"
              onChange={(event) => onChange({ ...form, label: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-role-desc">Deskripsi (opsional)</Label>
            <Input
              id="new-role-desc"
              value={form.description}
              placeholder="Tugas role ini dalam satu kalimat"
              onChange={(event) => onChange({ ...form, description: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-role-base">Menyalin dari</Label>
            <Select
              value={form.cloneOf}
              onValueChange={(value) => onChange({ ...form, cloneOf: value })}
            >
              <SelectTrigger id="new-role-base" className="min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.filter((r) => r.value !== "platform_owner").map((role) => (
                  <SelectItem key={role.value} value={role.value}>
                    {role.label} — {role.description}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Izin role ini menjadi titik awal. Anda bisa mengubahnya setelah role dibuat.
            </p>
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Batal</AlertDialogCancel>
          <AlertDialogAction
            // The default action closes the dialog; creation is async and can
            // fail, so it owns its own state instead.
            onClick={(event) => {
              event.preventDefault();
              onCreate();
            }}
          >
            Buat role
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
