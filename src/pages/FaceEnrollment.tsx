import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  ScanFace,
  Trash2,
  UserPlus,
  Camera,
  CheckCircle2,
  Users as UsersIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { toast } from "sonner";
import { BackOfficeLayout } from "@/components/layout/BackOfficeLayout";
import { useAuth } from "@/hooks/use-auth";
import { query } from "@/lib/db";
import {
  deleteFaceEnrollment,
  fetchEnrollmentStatuses,
  saveFaceEnrollment,
} from "@/lib/workplace";
import { FaceScanner, type FaceScannerHandle } from "@/components/attendance/FaceScanner";

/** A face-ready employee row for the enrollment list. */
interface Person {
  id: string;
  name: string;
  role: string;
  branch_name: string | null;
}

/** How many angled samples to collect per enrollment. More angles = a more
 *  robust match under varied lighting/pose; four is a practical floor. */
const TARGET_SAMPLES = 4;

export default function FaceEnrollment() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const scannerRef = useRef<FaceScannerHandle>(null);

  const [search, setSearch] = useState("");
  const [enrollFor, setEnrollFor] = useState<Person | null>(null);
  const [samples, setSamples] = useState<Float32Array[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [threshold, setThreshold] = useState(0.5);
  const [deleteFor, setDeleteFor] = useState<Person | null>(null);

  const peopleQuery = useQuery({
    queryKey: ["face-people"],
    queryFn: async () => {
      const res = await query<Record<string, unknown>>(
        `SELECT u.id, u.name, u.role, b.name AS branch_name
         FROM users u
         LEFT JOIN branches b ON u.assigned_branch_id = b.id
         WHERE u.is_active = 1
         ORDER BY u.name`
      );
      return res.rows.map((r) => ({
        id: String(r.id),
        name: r.name ? String(r.name) : "(tanpa nama)",
        role: r.role ? String(r.role) : "-",
        branch_name: r.branch_name ? String(r.branch_name) : null,
      })) as Person[];
    },
  });

  const statusesQuery = useQuery({
    queryKey: ["face-statuses"],
    queryFn: fetchEnrollmentStatuses,
  });

  const people = useMemo(() => peopleQuery.data ?? [], [peopleQuery.data]);
  const statuses = useMemo(() => statusesQuery.data ?? {}, [statusesQuery.data]);

  const filtered = useMemo(
    () =>
      people.filter(
        (p) =>
          !search ||
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          (p.branch_name ?? "").toLowerCase().includes(search.toLowerCase())
      ),
    [people, search]
  );

  const enrolledCount = people.filter((p) => (statuses[p.id]?.sampleCount ?? 0) > 0).length;

  const openEnroll = useCallback((person: Person) => {
    setEnrollFor(person);
    setSamples([]);
    // Keep the employee's tuned threshold on re-enrollment; default for new ones.
    setThreshold(statuses[person.id]?.matchThreshold ?? 0.5);
  }, [statuses]);

  const closeEnroll = useCallback(() => {
    setEnrollFor(null);
    setSamples([]);
    setCapturing(false);
  }, []);

  const captureSample = useCallback(async () => {
    const capture = await scannerRef.current?.snapshot();
    if (!capture) {
      toast.error("Wajah tidak terdeteksi. Hadap ke kamera dalam bingkai.");
      return;
    }
    setSamples((prev) => {
      if (prev.length >= TARGET_SAMPLES) return prev;
      // Skip a near-duplicate of the last sample so the four vectors really
      // represent different angles rather than the same frozen frame.
      const last = prev[prev.length - 1];
      if (last && distanceSquaredish(last, capture.descriptor) < 1e-4) {
        return prev;
      }
      return [...prev, capture.descriptor];
    });
  }, []);

  const save = useCallback(async () => {
    if (!enrollFor) return;
    if (samples.length === 0) {
      toast.error("Ambil minimal satu sampel wajah");
      return;
    }
    setSaving(true);
    try {
      await saveFaceEnrollment(enrollFor.id, samples, user?.id ?? null, threshold);
      toast.success(`Wajah ${enrollFor.name} tersimpan`);
      queryClient.invalidateQueries({ queryKey: ["face-statuses"] });
      closeEnroll();
    } catch (error) {
      console.error("enrollment save failed", error);
      toast.error("Gagal menyimpan data wajah");
    } finally {
      setSaving(false);
    }
  }, [enrollFor, samples, threshold, user?.id, queryClient, closeEnroll]);

  const confirmDelete = useCallback(async () => {
    if (!deleteFor) return;
    try {
      await deleteFaceEnrollment(deleteFor.id);
      toast.success(`Data wajah ${deleteFor.name} dihapus`);
      queryClient.invalidateQueries({ queryKey: ["face-statuses"] });
    } catch (error) {
      console.error("enrollment delete failed", error);
      toast.error("Gagal menghapus data wajah");
    } finally {
      setDeleteFor(null);
    }
  }, [deleteFor, queryClient]);

  return (
    <BackOfficeLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold">Wajah & Lokasi Absensi</h1>
            <p className="text-muted-foreground mt-1">
              Daftarkan wajah karyawan untuk verifikasi absensi mandiri.
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ScanFace className="h-4 w-4" />
            {enrolledCount} / {people.length} karyawan terdaftar
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Cara kerja</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-1">
            <p>
              Kamera memproses wajah langsung di perangkat ini. Yang disimpan hanya
              <span className="font-medium text-foreground"> 128 angka (deskriptor)</span>, bukan foto.
            </p>
            <p>
              Ambil {TARGET_SAMPLES} sampel dengan sudut sedikit berbeda agar pencocokan tahan
              perubahan cahaya dan posisi.
            </p>
          </CardContent>
        </Card>

        <div className="relative max-w-md">
          <UsersIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Cari karyawan…"
            className="pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="bg-card rounded-xl border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Karyawan</TableHead>
                <TableHead>Cabang</TableHead>
                <TableHead className="text-center">Status Wajah</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {peopleQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin inline" />
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                    Tidak ada karyawan.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((p) => {
                  const status = statuses[p.id];
                  const enrolled = (status?.sampleCount ?? 0) > 0;
                  return (
                    <TableRow key={p.id}>
                      <TableCell>
                        <p className="font-medium">{p.name}</p>
                        <p className="text-sm text-muted-foreground">{p.role}</p>
                      </TableCell>
                      <TableCell>{p.branch_name ?? "-"}</TableCell>
                      <TableCell className="text-center">
                        {enrolled ? (
                          <Badge className="bg-success/20 text-success">
                            {status!.sampleCount} sampel
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Belum terdaftar</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => openEnroll(p)}>
                            <UserPlus className="h-4 w-4" />
                            <span className="ml-1">{enrolled ? "Daftar Ulang" : "Daftarkan"}</span>
                          </Button>
                          {enrolled ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              onClick={() => setDeleteFor(p)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Enrollment dialog */}
      <Dialog open={!!enrollFor} onOpenChange={(open) => !open && closeEnroll()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Daftarkan Wajah — {enrollFor?.name}</DialogTitle>
            <DialogDescription>
              Nyalakan kamera, lalu ambil {TARGET_SAMPLES} sampel wajah dari sudut berbeda.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <FaceScanner ref={scannerRef} hint="Posisikan wajah rata dengan kamera." />

            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => void captureSample()}
                disabled={samples.length >= TARGET_SAMPLES || capturing}
              >
                <Camera className="h-4 w-4" />
                <span className="ml-1">Ambil Sampel ({samples.length}/{TARGET_SAMPLES})</span>
              </Button>
              {samples.length >= TARGET_SAMPLES ? (
                <span className="inline-flex items-center gap-1 text-sm text-success">
                  <CheckCircle2 className="h-4 w-4" /> Cukup
                </span>
              ) : null}
            </div>

            {/* Sample progress */}
            <div className="flex gap-1.5">
              {Array.from({ length: TARGET_SAMPLES }).map((_, i) => (
                <div
                  key={i}
                  className={
                    i < samples.length
                      ? "h-2 flex-1 rounded-full bg-success"
                      : "h-2 flex-1 rounded-full bg-muted"
                  }
                />
              ))}
            </div>

            <div className="grid grid-cols-3 items-center gap-3">
              <Label htmlFor="threshold" className="col-span-1">
                Ambang
              </Label>
              <Input
                id="threshold"
                type="number"
                step="0.05"
                min="0.3"
                max="0.7"
                className="col-span-2"
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Semakin kecil, semakin ketat. 0,5 adalah titik umum face-api.js.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeEnroll}>
              Batal
            </Button>
            <Button onClick={() => void save()} disabled={saving || samples.length === 0}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              <span className="ml-1">Simpan</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteFor} onOpenChange={(open) => !open && setDeleteFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus data wajah {deleteFor?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Karyawan tidak bisa absen dengan verifikasi wajah sampai didaftarkan lagi.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </BackOfficeLayout>
  );
}

/** Cheap near-duplicate guard on two same-length descriptors (squared L2). */
function distanceSquaredish(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return sum;
}
