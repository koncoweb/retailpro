import { useEffect, useMemo, useState } from "react";
import { Loader2, RotateCcw, Shield, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PermissionRow } from "@/components/ui/permission-row";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { PERMISSION_GROUPS, type PermissionGroupName } from "@/config/roles";
import { roleGrantedKeys, type RoleGrant } from "@/lib/permission-matrix";

/**
 * Per-employee permission exceptions.
 *
 * The Role screen at `/backoffice/settings` answers "what may this role do".
 * This answers the narrower question an owner also asks: "this one person
 * should not have everything their role allows". It can only take permissions
 * *back* — every switch here starts on, inherited from the role, and turning
 * one off is the only change it can make. A permission the role does not grant
 * is shown disabled with a pointer to the Role screen, so the general system
 * stays the single place rights are ever added. The rule lives in
 * `effectiveUserPermissions()` on both the client and the server, not here, so
 * this UI cannot be the thing that lets someone escalate.
 */

/** The person whose exceptions are being edited (identity fields only). */
export interface EmployeeRef {
  id: string;
  name: string;
  email: string;
  role: string;
}

/** Group names are English keys; the same plain Indonesian titles the Role screen uses. */
const GROUP_TITLES: Record<PermissionGroupName, string> = {
  dashboard: "Dashboard & Laporan Awal",
  pos: "Kasir (POS)",
  inventory: "Gudang & Pembelian",
  employees: "Karyawan",
  reports: "Laporan & Keuangan",
  settings: "Pengaturan & Akses",
};

/** Below the `md` breakpoint the editor is a full-height sheet, not a dialog. */
function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const sync = () => setMobile(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return mobile;
}

interface IndividualPermissionEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: EmployeeRef | null;
  /** The resolved grant for the employee's current role. */
  grant: RoleGrant | undefined;
  roleLabel: string;
  /** The employee's stored exceptions (keys set to `false`). */
  restrictions: Record<string, boolean>;
  canEdit: boolean;
  saving: boolean;
  onSave: (restrictions: Record<string, boolean>) => void;
}

export function IndividualPermissionEditor({
  open,
  onOpenChange,
  employee,
  grant,
  roleLabel,
  restrictions,
  canEdit,
  saving,
  onSave,
}: IndividualPermissionEditorProps) {
  const isMobile = useIsMobile();
  // The keys this person has had taken back. Seeded from the stored map, then
  // edited locally; the save only ever writes `false` values.
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setRemoved(
      new Set(
        Object.entries(restrictions ?? {})
          .filter(([, value]) => value === false)
          .map(([key]) => key)
      )
    );
  }, [open, employee?.id, restrictions]);

  const grantedKeys = useMemo(() => new Set(roleGrantedKeys(grant)), [grant]);
  const totalRole = grantedKeys.size;
  const exceptionCount = [...removed].filter((key) => grantedKeys.has(key)).length;
  const activeForPerson = totalRole - exceptionCount;

  const dirty = useMemo(() => {
    const stored = new Set(
      Object.entries(restrictions ?? {})
        .filter(([, value]) => value === false)
        .map(([key]) => key)
    );
    if (stored.size !== removed.size) return true;
    for (const key of removed) if (!stored.has(key)) return true;
    return false;
  }, [removed, restrictions]);

  const toggle = (permission: string, value?: boolean) => {
    if (!canEdit || !grantedKeys.has(permission)) return;
    setRemoved((prev) => {
      const next = new Set(prev);
      // `value === true` means the switch was turned back on -> no exception.
      const shouldRemove = value === undefined ? !next.has(permission) : value === false;
      if (shouldRemove) next.add(permission);
      else next.delete(permission);
      return next;
    });
  };

  const resetToRole = () => setRemoved(new Set());

  const commit = () => {
    const payload: Record<string, boolean> = {};
    for (const key of removed) {
      if (grantedKeys.has(key)) payload[key] = false;
    }
    onSave(payload);
  };

  if (!employee) return null;

  const body = (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="border-b p-4">
        <p className="text-sm text-muted-foreground">
          Karyawan ini memiliki role{" "}
          <Badge variant="outline" className="mx-1 align-middle">
            {roleLabel}
          </Badge>
          . Di bawah ini hanya izin yang <span className="font-medium">role</span> berikan —
          Anda bisa mencabut sebagian untuk orang ini, tetapi tidak bisa menambah di luar role.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          {activeForPerson} dari {totalRole} izin role aktif untuk karyawan ini
          {exceptionCount > 0 ? ` · ${exceptionCount} dikecualikan` : ""}.
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {totalRole === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Role ini belum punya izin apa pun. Atur dulu di Pengaturan &gt; Role.
          </p>
        )}

        {(Object.keys(PERMISSION_GROUPS) as PermissionGroupName[]).map((group) => {
          const keys = PERMISSION_GROUPS[group];
          const groupGranted = keys.filter((k) => grantedKeys.has(k));
          if (groupGranted.length === 0) return null;
          const groupOff = groupGranted.filter((k) => removed.has(k)).length;
          return (
            <section key={group} className="space-y-1">
              <h5 className="flex items-center justify-between gap-2 pb-1 text-sm font-semibold">
                <span>{GROUP_TITLES[group]}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {groupGranted.length - groupOff}/{groupGranted.length} aktif
                </span>
              </h5>
              <div className="divide-y rounded-lg border">
                {groupGranted.map((key) => (
                  <PermissionRow
                    key={key}
                    permission={key}
                    checked={!removed.has(key)}
                    disabled={!canEdit}
                    onCheckedChange={(value) => toggle(key, value)}
                  />
                ))}
              </div>
            </section>
          );
        })}

        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <UserX className="h-4 w-4 shrink-0" />
            Izin yang tidak dicentang di atas tidak diberikan oleh role ini. Untuk menambahkannya,
            ubah role di <span className="font-medium">Pengaturan &gt; Role</span> — bukan di
            karyawan perorangan.
          </p>
        </div>
      </div>

      <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t bg-card/95 px-4 py-3 backdrop-blur">
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {dirty ? (
            <>
              <span className="h-2 w-2 rounded-full bg-warning" />
              Belum disimpan
            </>
          ) : (
            "Sesuai data tersimpan"
          )}
        </span>
        <div className="flex gap-2">
          <Button size="touch" variant="ghost" disabled={!canEdit || !dirty} onClick={resetToRole}>
            <RotateCcw className="h-4 w-4" />
            Kembalikan ke role
          </Button>
          <Button size="touch" disabled={!canEdit || !dirty || saving} onClick={commit}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
            Simpan
          </Button>
        </div>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[92vh] flex flex-col gap-0 p-0">
          <SheetHeader className="border-b px-4 py-3 text-left">
            <SheetTitle className="text-base">
              Izin khusus — {employee.name || employee.email}
            </SheetTitle>
            <SheetDescription className="sr-only">
              Cabut sebagian izin role untuk karyawan ini
            </SheetDescription>
          </SheetHeader>
          {body}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="border-b px-4 py-3 text-left">
          <DialogTitle className="text-base">
            Izin khusus — {employee.name || employee.email}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Cabut sebagian izin role untuk karyawan ini
          </DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
