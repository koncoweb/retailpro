import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Camera,
  CameraOff,
  CheckCircle2,
  LogOut,
  MapPin,
  Loader2,
  RefreshCw,
  ShieldAlert,
  UserCheck,
} from "lucide-react";
import { id as idLocale } from "date-fns/locale";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { query } from "@/lib/db";
import {
  getCurrentCoords,
  haversineMeters,
  withinRadius,
  formatDistance,
  type GeoFix,
} from "@/lib/geolocation";
import { bestMatch } from "@/lib/face";
import {
  fetchFaceEnrollment,
  fetchWorkplaceLocations,
  locationKey,
} from "@/lib/workplace";
import {
  FaceScanner,
  type FaceScannerHandle,
} from "@/components/attendance/FaceScanner";

/**
 * Self-service check-in for the employee on their own device.
 *
 * The flow is deliberately short — pick your workplace, capture GPS, scan your
 * face, tap Check In / Check Out — because it runs on a phone at the shop door,
 * not on an office desktop. Both verifications hard-block the write when the
 * workplace requires them (see the geofence/face columns on branches and
 * warehouses).
 *
 * Two rules inherited from the architecture:
 *   * the row is always written for the running WIB day (`toISOString` of the
 *     +7h-shifted instant, exactly what the today-only DB trigger compares
 *     against), so an off-site clock can never back- or forward-date itself;
 *   * GPS and the face match are computed on this device. They are audit +
 *     friction, not an unbreakable boundary — a determined client could forge
 *     them — so the owner keeps an override in the back office and reviews the
 *     recorded distance/score. That limitation is documented, not hidden here.
 */

/** One attendance row as the check-in screen needs it. */
interface AttendanceRow {
  id: string;
  date: string;
  check_in: string | null;
  check_out: string | null;
  status: string;
  source: string | null;
  /** Why the row exists — e.g. `Otomatis dari buka shift` from the POS. */
  notes?: string | null;
}

/** The running WIB date + clock, matching the DB trigger's day. */
function wibParts(): { date: string; time: string } {
  const shifted = new Date(Date.now() + 7 * 3_600_000);
  const iso = shifted.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

const HISTORY_MONTH = () => wibParts().date.slice(0, 7);

export default function AttendanceCheckIn() {
  const { user, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const scannerRef = useRef<FaceScannerHandle>(null);

  const [selectedKey, setSelectedKey] = useState<string>("");
  const [coords, setCoords] = useState<GeoFix | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [faceEnabled, setFaceEnabled] = useState(false);
  const [faceStatus, setFaceStatus] = useState<
    { state: "idle" | "checking" | "ok" | "fail" | "noface"; message: string } | null
  >(null);
  const [submitting, setSubmitting] = useState(false);

  const locationsQuery = useQuery({
    queryKey: ["workplace-locations"],
    queryFn: fetchWorkplaceLocations,
    enabled: Boolean(user),
  });

  const enrollmentQuery = useQuery({
    queryKey: ["face-enrollment", user?.id],
    queryFn: () => (user ? fetchFaceEnrollment(user.id) : Promise.resolve(null)),
    enabled: Boolean(user),
  });

  const todayQuery = useQuery({
    queryKey: ["my-attendance-today", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { date } = wibParts();
      const res = await query<Record<string, unknown>>(
        `SELECT id, date, check_in, check_out, status, source, notes
         FROM attendance WHERE employee_id = $1 AND date = $2 LIMIT 1`,
        [user.id, date]
      );
      const r = res.rows[0];
      return r
        ? ({
            id: String(r.id),
            date: String(r.date),
            check_in: r.check_in ? String(r.check_in) : null,
            check_out: r.check_out ? String(r.check_out) : null,
            status: String(r.status),
            source: r.source ? String(r.source) : null,
            notes: r.notes ? String(r.notes) : null,
          } as AttendanceRow)
        : null;
    },
    enabled: Boolean(user),
  });

  const historyQuery = useQuery({
    queryKey: ["my-attendance-month", user?.id, HISTORY_MONTH()],
    queryFn: async () => {
      if (!user) return [] as AttendanceRow[];
      const month = HISTORY_MONTH();
      const res = await query<Record<string, unknown>>(
        `SELECT id, date, check_in, check_out, status, source
         FROM attendance
         WHERE employee_id = $1 AND date >= $2 AND date < $3
         ORDER BY date DESC, id DESC`,
        [user.id, `${month}-01`, `${month}-32`]
      );
      return res.rows.map((r) => ({
        id: String(r.id),
        date: String(r.date),
        check_in: r.check_in ? String(r.check_in) : null,
        check_out: r.check_out ? String(r.check_out) : null,
        status: String(r.status),
        source: r.source ? String(r.source) : null,
      })) as AttendanceRow[];
    },
    enabled: Boolean(user),
  });

  const locations = useMemo(() => locationsQuery.data ?? [], [locationsQuery.data]);

  // Default the picker to the employee's own branch when it is a configured
  // location, else the first location. Runs once the list lands.
  useEffect(() => {
    if (selectedKey || locations.length === 0) return;
    const own = user?.assigned_branch_id
      ? locations.find((l) => l.type === "branch" && l.id === user.assigned_branch_id)
      : undefined;
    setSelectedKey(locationKey(own?.type ?? locations[0].type, own?.id ?? locations[0].id));
  }, [locations, user?.assigned_branch_id, selectedKey]);

  const selectedLocation = useMemo(
    () => locations.find((l) => locationKey(l.type, l.id) === selectedKey) ?? null,
    [locations, selectedKey]
  );

  const distance = useMemo(() => {
    if (!coords || !selectedLocation || selectedLocation.latitude == null || selectedLocation.longitude == null) {
      return null;
    }
    return haversineMeters(coords, {
      lat: selectedLocation.latitude,
      lng: selectedLocation.longitude,
    });
  }, [coords, selectedLocation]);

  const withinGeofence = useMemo(() => {
    if (distance == null || !selectedLocation) return false;
    return withinRadius(coords!, { lat: selectedLocation.latitude!, lng: selectedLocation.longitude! }, selectedLocation.geo_radius_m);
  }, [coords, distance, selectedLocation]);

  const requireGeo = selectedLocation?.require_geo === 1;
  const requireFace =
    selectedLocation?.require_face === 1 && enrollmentQuery.data != null && enrollmentQuery.data.samples.length > 0;

  const captureCoords = useCallback(async () => {
    setGeoLoading(true);
    setGeoError(null);
    try {
      const fix = await getCurrentCoords();
      setCoords(fix);
      toast.success(`Lokasi diperoleh (akurasi ±${Math.round(fix.accuracy)} m)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Gagal mengambil lokasi";
      setGeoError(message);
      setCoords(null);
      toast.error(message);
    } finally {
      setGeoLoading(false);
    }
  }, []);

  /** Captures a fresh face vector and compares it to this employee's enrollment. */
  const verifyFace = useCallback(async (): Promise<{ ok: boolean; score: number | null }> => {
    if (!enrollmentQuery.data || enrollmentQuery.data.samples.length === 0) {
      setFaceStatus({ state: "noface", message: "Wajah Anda belum didaftarkan. Hubungi owner." });
      return { ok: false, score: null };
    }
    setFaceStatus({ state: "checking", message: "Memindai wajah…" });
    const capture = await scannerRef.current?.snapshot();
    if (!capture) {
      setFaceStatus({ state: "noface", message: "Wajah tidak terdeteksi. Hadap ke kamera." });
      return { ok: false, score: null };
    }
    const match = bestMatch(
      enrollmentQuery.data.samples,
      capture.descriptor,
      enrollmentQuery.data.matchThreshold
    );
    const score = Number.isFinite(match.score) ? match.score : null;
    if (match.matched) {
      setFaceStatus({ state: "ok", message: "Wajah terverifikasi" });
      return { ok: true, score };
    }
    setFaceStatus({ state: "fail", message: `Wajah tidak cocok (jarak ${match.score.toFixed(3)})` });
    return { ok: false, score };
  }, [enrollmentQuery.data]);

  const submit = useCallback(async (kind: "in" | "out") => {
    if (!user || !selectedLocation) {
      toast.error("Pilih lokasi kerja Anda");
      return;
    }
    const { date, time } = wibParts();

    // Geofence gate.
    if (requireGeo) {
      if (!coords) {
        toast.error("Ambil lokasi Anda terlebih dahulu");
        return;
      }
      if (!withinGeofence || distance == null) {
        toast.error(`Di luar area (${distance != null ? formatDistance(distance) : "?"}). Harus dalam ${selectedLocation.geo_radius_m} m dari ${selectedLocation.name}.`);
        return;
      }
    }

    // Face gate — always re-verified at submit time, never trusted from state.
    let faceScore: number | null = null;
    let faceVerified = 0;
    const enrolled = !!enrollmentQuery.data && enrollmentQuery.data.samples.length > 0;
    if (selectedLocation.require_face === 1) {
      if (!enrolled) {
        setFaceStatus({ state: "noface", message: "Wajah Anda belum didaftarkan. Hubungi owner untuk pendaftaran." });
        toast.error("Wajah belum terdaftar. Hubungi owner.");
        return;
      }
      const { ok, score } = await verifyFace();
      faceScore = score;
      faceVerified = ok ? 1 : 0;
      if (!ok) return; // verifyFace already set the on-screen reason
    }

    setSubmitting(true);
    try {
      if (kind === "in") {
        await query(
          `INSERT INTO attendance
             (employee_id, date, check_in, status,
              location_type, location_id,
              check_in_lat, check_in_lng, check_in_acc, check_in_dist,
              face_score, face_verified, source)
           VALUES ($1, $2, $3, 'present',
              $4, $5,
              $6, $7, $8, $9,
              $10, $11, 'self')`,
          [
            user.id,
            date,
            time,
            selectedLocation.type,
            selectedLocation.id,
            coords?.lat ?? null,
            coords?.lng ?? null,
            coords?.accuracy ?? null,
            distance != null ? Math.round(distance) : null,
            faceScore,
            faceVerified,
          ]
        );
        toast.success("Check-in berhasil");
      } else {
        const today = todayQuery.data;
        if (!today) {
          toast.error("Tidak ada check-in untuk hari ini");
          return;
        }
        await query(
          `UPDATE attendance
           SET check_out = $1,
               check_out_lat = $2, check_out_lng = $3, check_out_dist = $4,
               location_type = $5, location_id = $6
           WHERE id = $7`,
          [
            time,
            coords?.lat ?? null,
            coords?.lng ?? null,
            distance != null ? Math.round(distance) : null,
            selectedLocation.type,
            selectedLocation.id,
            today.id,
          ]
        );
        toast.success("Check-out berhasil");
      }
      queryClient.invalidateQueries({ queryKey: ["my-attendance-today", user.id] });
      queryClient.invalidateQueries({ queryKey: ["my-attendance-month", user.id] });
      setCoords(null);
      setFaceStatus(null);
      setFaceEnabled(false);
    } catch (error) {
      console.error("attendance submit failed", error);
      toast.error("Gagal menyimpan absensi. Coba lagi.");
    } finally {
      setSubmitting(false);
    }
  }, [
    user,
    selectedLocation,
    requireGeo,
    coords,
    withinGeofence,
    distance,
    enrollmentQuery.data,
    verifyFace,
    todayQuery.data,
    queryClient,
  ]);

  const today = todayQuery.data ?? null;
  const canCheckIn = !today;
  const canCheckOut = today != null && today.check_in && !today.check_out;
  const doneForDay = today != null && !!today.check_out;

  // Face box coordinates come from the source video's intrinsic resolution.
  const locationOptions = locations;

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-primary">
              <UserCheck className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-bold">Absensi</span>
          </div>
          <Link to="/mode-select" className="inline-flex items-center gap-1 text-sm text-muted-foreground">
            <ArrowLeft className="h-4 w-4" /> Keluar
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-lg space-y-4 p-4 pb-16">
        <div>
          <h1 className="text-xl font-bold">{user?.name ?? "Karyawan"}</h1>
          <p className="text-sm text-muted-foreground">
            {format(new Date(`${wibParts().date}T00:00:00`), "EEEE, d MMMM yyyy", { locale: idLocale })}
          </p>
        </div>

        {/* Status strip */}
        <Card>
          <CardContent className="flex items-center justify-between gap-3 pt-6">
            <div>
              <p className="text-sm text-muted-foreground">Status hari ini</p>
              {today ? (
                <div className="mt-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-success/20 text-success">
                      Masuk {today.check_in ?? "-"}
                    </Badge>
                    {today.check_out ? (
                      <Badge className="bg-info/20 text-info">Pulang {today.check_out}</Badge>
                    ) : null}
                  </div>
                  {/* Say where the day came from: a shift-written check-in is
                      not a forgotten /absen punch, and the person should be
                      able to see that without asking the owner. */}
                  {today.notes ? (
                    <p className="text-xs text-muted-foreground">{today.notes}</p>
                  ) : null}
                </div>
              ) : (
                <p className="mt-1 text-sm">Belum check-in</p>
              )}
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ["my-attendance-today", user?.id] });
                queryClient.invalidateQueries({ queryKey: ["my-attendance-month", user?.id] });
              }}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>

        {/* Location */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="h-4 w-4" /> Lokasi Kerja
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {locationsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Memuat lokasi…</p>
            ) : locationOptions.length === 0 ? (
              <p className="text-sm text-warning">
                Belum ada lokasi dengan koordinat. Minta owner mengatur lokasi
                toko/gudang Anda (Pengaturan lokasi).
              </p>
            ) : (
              <Select value={selectedKey} onValueChange={setSelectedKey}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih lokasi" />
                </SelectTrigger>
                <SelectContent>
                  {locationOptions.map((l) => (
                    <SelectItem key={locationKey(l.type, l.id)} value={locationKey(l.type, l.id)}>
                      {l.name} {l.type === "warehouse" ? "(Gudang)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void captureCoords()}
                disabled={geoLoading || !selectedLocation}
              >
                {geoLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                <span className="ml-1">Ambil Lokasi</span>
              </Button>
              {coords ? (
                <span className="text-xs text-muted-foreground">
                  ±{Math.round(coords.accuracy)} m
                </span>
              ) : null}
            </div>

            {geoError ? (
              <p className="flex items-center gap-1 text-sm text-destructive">
                <ShieldAlert className="h-4 w-4" /> {geoError}
              </p>
            ) : null}

            {selectedLocation && distance != null ? (
              <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
                <span>Jarak ke {selectedLocation.name}</span>
                {requireGeo ? (
                  withinGeofence ? (
                    <Badge className="bg-success/20 text-success">{formatDistance(distance)} · dalam area</Badge>
                  ) : (
                    <Badge className="bg-destructive/20 text-destructive">{formatDistance(distance)} · di luar area</Badge>
                  )
                ) : (
                  <span className="text-muted-foreground">{formatDistance(distance)}</span>
                )}
              </div>
            ) : null}
            {requireGeo && selectedLocation && coords && !withinGeofence ? (
              <p className="text-xs text-destructive">
                Check-in diblokir: Anda harus berada dalam {selectedLocation.geo_radius_m} m dari lokasi.
              </p>
            ) : null}
          </CardContent>
        </Card>

        {/* Face */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Camera className="h-4 w-4" /> Verifikasi Wajah
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {enrollmentQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Memuat data wajah…</p>
            ) : !enrollmentQuery.data || enrollmentQuery.data.samples.length === 0 ? (
              <p className="text-sm text-warning">
                Wajah Anda belum didaftarkan.
                {selectedLocation?.require_face === 1
                  ? " Absen diblokir sampai owner mendaftarkan wajah Anda."
                  : " Anda tetap bisa absen tanpa verifikasi wajah di lokasi ini."}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Terdaftar {enrollmentQuery.data.sampleCount} sampel wajah.
              </p>
            )}

            {faceEnabled ? (
              <>
                <FaceScanner
                  ref={scannerRef}
                  hint="Tepatkan wajah dalam bingkai hijau lalu tekan Scan Wajah."
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void verifyFace()}
                    disabled={faceStatus?.state === "checking"}
                  >
                    {faceStatus?.state === "checking" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <UserCheck className="h-4 w-4" />
                    )}
                    <span className="ml-1">Scan Wajah</span>
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setFaceEnabled(false); setFaceStatus(null); }}>
                    <CameraOff className="h-4 w-4" /> <span className="ml-1">Tutup</span>
                  </Button>
                </div>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setFaceEnabled(true)}>
                <Camera className="h-4 w-4" /> <span className="ml-1">Nyalakan Kamera</span>
              </Button>
            )}

            {faceStatus ? (
              <p
                className={
                  faceStatus.state === "ok"
                    ? "flex items-center gap-1 text-sm text-success"
                    : faceStatus.state === "checking"
                      ? "text-sm text-muted-foreground"
                      : "flex items-center gap-1 text-sm text-destructive"
                }
              >
                {faceStatus.state === "ok" ? <CheckCircle2 className="h-4 w-4" /> : null}
                {faceStatus.message}
              </p>
            ) : null}
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="grid grid-cols-2 gap-3">
          <Button
            size="lg"
            className="col-span-2 sm:col-span-1"
            onClick={() => void submit("in")}
            disabled={!canCheckIn || submitting || submittingFace(faceEnabled, requireFace) || (requireGeo && (!coords || !withinGeofence))}
          >
            {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <UserCheck className="h-5 w-5" />}
            <span className="ml-2">Check In</span>
          </Button>
          <Button
            size="lg"
            variant="secondary"
            className="col-span-2 sm:col-span-1"
            onClick={() => void submit("out")}
            disabled={!canCheckOut || submitting || submittingFace(faceEnabled, requireFace) || (requireGeo && (!coords || !withinGeofence))}
          >
            <LogOut className="h-5 w-5" /> <span className="ml-2">Check Out</span>
          </Button>
        </div>
        {doneForDay ? (
          <p className="text-center text-sm text-muted-foreground">
            Absensi hari ini lengkap. Sampai jumpa besok.
          </p>
        ) : null}

        {/* My history */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Absensi Saya (bulan ini)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Tanggal</TableHead>
                  <TableHead>Masuk</TableHead>
                  <TableHead>Pulang</TableHead>
                  <TableHead className="pr-4 text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historyQuery.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-20 text-center text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin inline" />
                    </TableCell>
                  </TableRow>
                ) : (historyQuery.data?.length ?? 0) === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-20 text-center text-muted-foreground">
                      Belum ada absensi bulan ini.
                    </TableCell>
                  </TableRow>
                ) : (
                  historyQuery.data!.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="pl-4 font-mono text-sm">{row.date}</TableCell>
                      <TableCell className="text-sm">{row.check_in ?? "-"}</TableCell>
                      <TableCell className="text-sm">{row.check_out ?? "-"}</TableCell>
                      <TableCell className="pr-4 text-center">
                        <Badge
                          className={
                            row.status === "present"
                              ? "bg-success/20 text-success"
                              : row.status === "leave"
                                ? "bg-warning/20 text-warning"
                                : "bg-destructive/20 text-destructive"
                          }
                        >
                          {row.status === "present" ? "Hadir" : row.status === "leave" ? "Cuti" : "Absen"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

/**
 * The Check In button waits for a camera-verified face only when the location
 * requires it and the employee is enrolled; otherwise it should not be blocked
 * on a camera the user never opened.
 */
function submittingFace(faceEnabled: boolean, requireFace: boolean): boolean {
  // While the face requirement is active but the camera is off, the button stays
  // enabled so the user gets a clear toast telling them to scan; enabling the
  // camera is the path to green.
  return requireFace && !faceEnabled;
}
