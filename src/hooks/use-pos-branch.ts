/**
 * One branch answer for the whole POS.
 *
 * The till (POS.tsx), the shift desk (POSShifts.tsx) and the header
 * (POSLayout.tsx) used to resolve "which branch am I at" independently:
 * POSShifts read `user.assigned_branch_id` straight and hard-failed when it
 * was null, while POS.tsx preferred the tenant session's branch. A shift
 * opened under one branch was then invisible to the till's lookup — the
 * cashier saw "shift belum dibuka" even though they had just opened one.
 * That is the bug this hook exists to kill: every POS surface reads its
 * branch from here, so open/close and the transaction-time shift lookup
 * can never disagree.
 *
 * Resolution precedence (unchanged from POS.tsx, which had it right):
 *   1. the branch on the tenant session, resolved at sign-in,
 *   2. this person's assigned branch,
 *   3. the first branch their role scope allows them to see,
 *   4. the first row at all — but only for a company-wide scope, so a role
 *      that was just emptied out can never land on a forbidden branch.
 *
 * A manual switch (the picker owners/multi-branch staff get) is remembered
 * per user for the tab's lifetime, so navigating till → shifts → till keeps
 * selling and reconciling in the same place.
 */
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useBranchScope } from "@/hooks/use-permissions";
import { useTenant } from "@/contexts/TenantContext";
import { query } from "@/lib/db";

const POS_BRANCHES_QUERY_KEY = ["pos-branches"] as const;

/** The till only ever needs these two columns to place a sale. */
export interface PosBranchRow {
  id: string;
  name: string;
}

/**
 * Pure branch pick — the exact precedence from above, extracted so the unit
 * test can drive it without React or a database. `scope` is the role's branch
 * list (`null` = all branches), matching `useBranchScope`'s shape.
 */
export function pickPosBranch(
  rows: PosBranchRow[],
  options: {
    sessionBranchId?: string | null;
    assignedBranchId?: string | null;
    scope?: string[] | null;
  }
): string | null {
  const inScope = (id: string | null | undefined) =>
    !!id && (options.scope == null || options.scope.includes(id));
  const preferred =
    rows.find((b) => b.id === options.sessionBranchId && inScope(b.id)) ??
    rows.find((b) => b.id === options.assignedBranchId && inScope(b.id)) ??
    rows.find((b) => inScope(b.id)) ??
    // No scope restriction at all means every row is fair game; an empty
    // scope means none is, and the caller says so instead of selling.
    (options.scope == null ? rows[0] : undefined);
  return preferred?.id ?? null;
}

export interface PosBranchApi {
  /** The branch every POS surface must use right now. */
  branchId: string | null;
  setBranchId: (id: string) => void;
  /** Branches this role may transact in, in name order. */
  branches: PosBranchRow[];
  branchName: string | null;
  /** More than one in-scope branch (or company-wide scope) → show picker. */
  canSwitch: boolean;
  loading: boolean;
  error: unknown;
  reload: () => void;
}

/**
 * The manually-picked branch, shared by every mounted POS surface.
 *
 * Module scope, not localStorage: a reload re-bootstraps the session and the
 * default precedence applies again. Keyed by user so a different cashier on
 * the same tablet never inherits the previous person's branch. A listener
 * set makes the pick visible to sibling components (till + layout header)
 * in the same render pass, not just the one that owns the picker.
 */
let selection: { userId: string; branchId: string } | null = null;
let selectionVersion = 0;
const selectionListeners = new Set<() => void>();

function setSharedSelection(next: { userId: string; branchId: string } | null) {
  selection = next;
  selectionVersion += 1;
  for (const listener of selectionListeners) listener();
}

function subscribeSelection(listener: () => void) {
  selectionListeners.add(listener);
  return () => {
    selectionListeners.delete(listener);
  };
}

export function usePosBranch(): PosBranchApi {
  const { user } = useAuth();
  const { session } = useTenant();
  const { branchIds } = useBranchScope();

  // Re-render when any POS surface changes the shared branch pick.
  const selectionTick = useSyncExternalStore(
    subscribeSelection,
    () => selectionVersion
  );

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: POS_BRANCHES_QUERY_KEY,
    queryFn: async () => {
      const res = await query(`SELECT id, name FROM branches ORDER BY name`);
      return res.rows as PosBranchRow[];
    },
    staleTime: 60_000,
  });

  const rows = useMemo(() => data ?? [], [data]);

  const visibleBranches = useMemo(
    () => (branchIds ? rows.filter((b) => branchIds.includes(b.id)) : rows),
    [rows, branchIds]
  );

  // A remembered switch only counts while it belongs to the same person and
  // that branch is still allowed; if the owner narrowed the scope underneath
  // us, fall back to the precedence chain.
  void selectionTick; // the tick is what forces this recompute after a pick
  const rememberedBranchId =
    selection && selection.userId === user?.id &&
    visibleBranches.some((b) => b.id === selection.branchId)
      ? selection.branchId
      : null;

  const branchId = useMemo(
    () =>
      rememberedBranchId ??
      pickPosBranch(rows, {
        sessionBranchId: session?.branchId,
        assignedBranchId: user?.assigned_branch_id ?? null,
        scope: branchIds,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rememberedBranchId, rows, session?.branchId, user?.assigned_branch_id, branchIds, selectionTick]
  );

  const setBranchId = useCallback(
    (id: string) => {
      if (user?.id) setSharedSelection({ userId: user.id, branchId: id });
    },
    [user?.id]
  );

  const branchName = useMemo(
    () => visibleBranches.find((b) => b.id === branchId)?.name ?? null,
    [visibleBranches, branchId]
  );

  const canSwitch = branchIds === null || branchIds.length > 1;

  const reload = useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    branchId,
    setBranchId,
    branches: visibleBranches,
    branchName,
    canSwitch,
    loading: isLoading,
    error,
    reload,
  };
}
