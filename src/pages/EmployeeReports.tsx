import { useState, useMemo, useEffect } from "react";
import { PermissionGate } from "@/components/auth/PermissionGate";
import { useLocation, useNavigate } from "react-router-dom";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isWeekend, getDay } from "date-fns";
import { id } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PaginationBar } from "@/components/ui/pagination-bar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { 
    Download, 
    Filter, 
    Search, 
    Calendar as CalendarIcon, 
    Clock, 
    Briefcase, 
    Banknote, 
    CheckCircle2, 
    XCircle, 
    AlertCircle,
    Plus,
    Trash2,
    Settings,
    Loader2,
    Users,
    Plane,
    DollarSign,
    CalendarDays,
    MapPin,
    ScanFace,
    ShieldCheck
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { query, batchQuery } from "@/lib/db";
import {
  fetchLocationNames,
  fetchWorkplaceLocations,
  locationKey,
  type WorkplaceLocation,
} from "@/lib/workplace";
import {
  getCurrentCoords,
  haversineMeters,
  formatDistance,
  type GeoFix,
} from "@/lib/geolocation";
import { getPeriodRange } from "@/lib/date-range";
import { fetchAvailableYears, fetchHolidaysForYear, type HolidayEntry } from "@/lib/holidays";
import { readTenantSettings, setTenantSetting } from "@/lib/tenant-settings";
import { toast } from "sonner";
import { BackOfficeLayout } from "@/components/layout/BackOfficeLayout";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import * as XLSX from 'xlsx';

// Interfaces
interface Employee {
  id: string;
  name: string;
  role: string;
  branch_name: string | null;
  base_salary: number;
}

interface Attendance {
  id: string;
  employee_id: string;
  date: string;
  check_in: string | null;
  check_out: string | null;
  status: string;
  overtime: number;
  // Geofence + face audit columns (schema v8). Present on every row now that
  // the report reads `SELECT *`; nullable because owner overrides may omit them.
  source?: string | null;
  location_type?: string | null;
  location_id?: string | null;
  check_in_dist?: number | null;
  check_out_dist?: number | null;
  face_score?: number | null;
  face_verified?: number | null;
}

interface Leave {
  id: string;
  employee_id: string;
  type: string;
  start_date: string;
  end_date: string;
  days: number;
  status: string;
  reason: string;
}

/**
 * The standard check-in/check-out day, formatted like every other attendance
 * date in this screen. WIB (UTC+7) is the operative timezone — the same clock
 * the schema's today-only trigger (`trg_attendance_today_only`) compares
 * against — so a browser elsewhere in the world still books the Indonesian
 * "hari ini" instead of its own calendar day.
 */
function attendanceToday(): string {
  return format(new Date(Date.now() + 7 * 3_600_000), "yyyy-MM-dd");
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(value);
}

/** Rows per page for the attendance and leave tables. */
const PAGE_SIZE = 25;

/**
 * The sidebar opens this screen twice — Absensi and Payroll — and both links
 * land on the same component. The tabs that own a route keep the URL and the
 * panel in step; Cuti and Libur only exist inside the page.
 */
const TAB_PATHS: Record<string, string> = {
  attendance: "/backoffice/hr/attendance",
  payroll: "/backoffice/hr/payroll",
};

/** Returns the tab the current URL asks for, or null for an in-page-only tab. */
function tabFromPath(pathname: string): string | null {
  const segment = pathname.split("/").filter(Boolean).pop() ?? "";
  return segment in TAB_PATHS || segment === "leave" || segment === "holidays" ? segment : null;
}

export default function EmployeeReports() {
  const location = useLocation();
  const navigate = useNavigate();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendanceData, setAttendanceData] = useState<Attendance[]>([]);
  const [leaveData, setLeaveData] = useState<Leave[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedBranch, setSelectedBranch] = useState("all");
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [activeTab, setActiveTab] = useState(tabFromPath(location.pathname) ?? "attendance");

  // Seeded state is not enough here: this component survives the sidebar moving
  // from Absensi to Payroll, because both routes render it.
  useEffect(() => {
    const next = tabFromPath(location.pathname);
    if (next) setActiveTab(next);
  }, [location.pathname]);

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    const path = TAB_PATHS[value];
    if (path && path !== location.pathname) navigate(path, { replace: true });
  };

  // Config State
  const [config, setConfig] = useState({
    workDays: 22,
    transportAllowance: 25000,
    mealAllowance: 35000
  });

  // Holidays state: the Libur tab follows the selected year, defaulting to the
  // running one so the list refreshes itself every 1 January.
  const [holidayYear, setHolidayYear] = useState(new Date().getFullYear());
  const holidaysQuery = useQuery({
    queryKey: ["holidays", holidayYear],
    queryFn: () => fetchHolidaysForYear(holidayYear),
  });
  const yearsQuery = useQuery({
    queryKey: ["holiday-years"],
    queryFn: fetchAvailableYears,
    staleTime: 60 * 60 * 1000,
  });
  const holidayYears = useMemo(() => {
    const list = new Set(yearsQuery.data ?? []);
    // The selected and running years must always be offered, even when the
    // API's coverage or an offline fallback narrows the list.
    list.add(holidayYear);
    list.add(new Date().getFullYear());
    return [...list].sort((a, b) => a - b);
  }, [yearsQuery.data, holidayYear]);

  // Delete State
  const [deleteItem, setDeleteItem] = useState<{id: string, type: 'attendance' | 'leave'} | null>(null);

  // Add Attendance State
  const [isAddAttendanceOpen, setIsAddAttendanceOpen] = useState(false);
  const [newAttEmployeeId, setNewAttEmployeeId] = useState("");
  const [newAttDate, setNewAttDate] = useState("");
  const [newAttCheckIn, setNewAttCheckIn] = useState("");
  const [newAttCheckOut, setNewAttCheckOut] = useState("");
  const [newAttStatus, setNewAttStatus] = useState("present");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Owner override may record where the check-in happened for audit. Optional:
  // the owner is the authoritative source, so geo/face is never a gate here.
  const [workplaceLocations, setWorkplaceLocations] = useState<WorkplaceLocation[]>([]);
  const [locationNames, setLocationNames] = useState<Record<string, string>>({});
  const [newAttLocationKey, setNewAttLocationKey] = useState("");
  const [newAttCoords, setNewAttCoords] = useState<GeoFix | null>(null);
  const [ownerGeoBusy, setOwnerGeoBusy] = useState(false);

  // Add Leave State
  const [isAddLeaveOpen, setIsAddLeaveOpen] = useState(false);
  const [newLeaveEmployeeId, setNewLeaveEmployeeId] = useState("");
  const [newLeaveType, setNewLeaveType] = useState("annual");
  const [newLeaveStartDate, setNewLeaveStartDate] = useState("");
  const [newLeaveEndDate, setNewLeaveEndDate] = useState("");
  const [newLeaveReason, setNewLeaveReason] = useState("");

  // Pagination: attendance and leave histories grow without bound, so both
  // lists are paged in SQL instead of being capped at a magic LIMIT.
  const [attendancePage, setAttendancePage] = useState(0);
  const [leavePage, setLeavePage] = useState(0);
  const [attendanceTotal, setAttendanceTotal] = useState(0);
  const [leaveTotal, setLeaveTotal] = useState(0);

  useEffect(() => {
    setAttendancePage(0);
  }, [selectedMonth]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
        // Attendance is scoped to the selected month: a calendar month is the
        // only useful window for payroll, and the bound range keeps the scan on
        // idx_attendance_emp_date instead of reading the whole table.
        const [monthStart, monthEnd] = getPeriodRange(
          "thismonth",
          new Date(`${selectedMonth}-01T00:00:00`)
        );

        const [empRes, attRes, attCountRes, leaveRes, leaveCountRes] = await batchQuery([
          {
            sql: `
                SELECT u.id, u.name, u.role, u.base_salary, b.name as branch_name
                FROM users u
                LEFT JOIN branches b ON u.assigned_branch_id = b.id
                WHERE u.is_active = 1
            `,
          },
          {
            sql: `
                SELECT * FROM attendance
                WHERE date >= $1 AND date < $2
                ORDER BY date DESC, id DESC
                LIMIT $3 OFFSET $4
            `,
            params: [monthStart, monthEnd, PAGE_SIZE, attendancePage * PAGE_SIZE],
          },
          {
            sql: `SELECT COUNT(*) as total FROM attendance WHERE date >= $1 AND date < $2`,
            params: [monthStart, monthEnd],
          },
          {
            sql: `
                SELECT * FROM leaves
                ORDER BY start_date DESC, id DESC
                LIMIT $1 OFFSET $2
            `,
            params: [PAGE_SIZE, leavePage * PAGE_SIZE],
          },
          { sql: `SELECT COUNT(*) as total FROM leaves` },
        ]);

        // Tenant settings: one JSON document, read through the shared helper.
        const settings = await readTenantSettings();
        if (settings.payroll_config) {
            setConfig(settings.payroll_config as typeof config);
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setEmployees((empRes.rows as any[]).map((r) => ({
            ...r,
            base_salary: Number(r.base_salary) || 0
        })));

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setAttendanceData((attRes.rows as any[]).map((r) => ({
            ...r,
            overtime: Number(r.overtime) || 0,
            date: format(new Date(r.date), 'yyyy-MM-dd')
        })));
        setAttendanceTotal(Number((attCountRes.rows[0] as { total: number })?.total ?? 0));

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setLeaveData((leaveRes.rows as any[]).map((r) => ({
            ...r,
            start_date: format(new Date(r.start_date), 'yyyy-MM-dd'),
            end_date: format(new Date(r.end_date), 'yyyy-MM-dd'),
            days: Math.ceil((new Date(r.end_date).getTime() - new Date(r.start_date).getTime()) / (1000 * 3600 * 24)) + 1
        })));
        setLeaveTotal(Number((leaveCountRes.rows[0] as { total: number })?.total ?? 0));

    } catch (error) {
        console.error("Failed to fetch data", error);
        toast.error("Gagal memuat data");
    } finally {
        setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendancePage, leavePage, selectedMonth]);

  // Load workplace locations + id→name map once for the report columns and the
  // owner override picker. Cheap, and rarely changes while the screen is open.
  useEffect(() => {
    let alive = true;
    Promise.all([fetchLocationNames(), fetchWorkplaceLocations()])
      .then(([names, locs]) => {
        if (!alive) return;
        setLocationNames(names);
        setWorkplaceLocations(locs);
      })
      .catch((e) => console.error("Failed to load workplace locations", e));
    return () => {
      alive = false;
    };
  }, []);

  const selectedAttLocation = useMemo(
    () => workplaceLocations.find((l) => locationKey(l.type, l.id) === newAttLocationKey) ?? null,
    [workplaceLocations, newAttLocationKey]
  );

  const ownerDistance = useMemo(() => {
    if (!newAttCoords || !selectedAttLocation?.latitude || !selectedAttLocation?.longitude) return null;
    return haversineMeters(newAttCoords, {
      lat: selectedAttLocation.latitude,
      lng: selectedAttLocation.longitude,
    });
  }, [newAttCoords, selectedAttLocation]);

  const captureOwnerGps = async () => {
    setOwnerGeoBusy(true);
    try {
      setNewAttCoords(await getCurrentCoords());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal mengambil lokasi");
    } finally {
      setOwnerGeoBusy(false);
    }
  };

  /** Human label for where a stored attendance row happened. */
  const locationLabel = (att: Attendance): string => {
    if (!att.location_type || !att.location_id) return "-";
    return locationNames[locationKey(att.location_type, att.location_id)] ?? "(lokasi dihapus)";
  };

  /** Distance + within/outside verdict against the location's current radius. */
  const geoLabel = (att: Attendance): string => {
    if (att.check_in_dist == null) return "-";
    const dist = formatDistance(att.check_in_dist);
    if (!att.location_type || !att.location_id) return dist;
    const loc = workplaceLocations.find(
      (l) => locationKey(l.type, l.id) === locationKey(att.location_type!, att.location_id!)
    );
    if (!loc) return dist;
    return `${att.check_in_dist <= loc.geo_radius_m ? "Dalam" : "Luar"} · ${dist}`;
  };

  /** Face verification state for the row. */
  const faceLabel = (att: Attendance): string => {
    if (att.source === "owner") return "Override owner";
    if (Number(att.face_verified) === 1) {
      return att.face_score != null ? `Terverifikasi (${Number(att.face_score).toFixed(3)})` : "Terverifikasi";
    }
    return att.face_score != null ? `Tidak cocok (${Number(att.face_score).toFixed(3)})` : "Belum diverifikasi";
  };

  const handleAddAttendance = async () => {
    if(!newAttEmployeeId || !newAttDate) {
        toast.error("Pilih karyawan dan tanggal");
        return;
    }
    // Front half of the guard; the tenant database enforces the same rule, so
    // a hand-edited payload cannot book attendance for another day.
    if (newAttDate !== attendanceToday()) {
        toast.error("Absensi standar hanya untuk tanggal hari ini");
        return;
    }
    setIsSubmitting(true);
    try {
        await query(`
            INSERT INTO attendance (employee_id, date, check_in, check_out, status, overtime,
                                    source, location_type, location_id,
                                    check_in_lat, check_in_lng, check_in_dist, face_verified)
            VALUES ($1, $2, $3, $4, $5, 0, 'owner', $6, $7, $8, $9, $10, 0)
        `, [
            newAttEmployeeId,
            newAttDate,
            newAttCheckIn || null,
            newAttCheckOut || null,
            newAttStatus,
            selectedAttLocation?.type ?? null,
            selectedAttLocation?.id ?? null,
            newAttCoords?.lat ?? null,
            newAttCoords?.lng ?? null,
            ownerDistance != null ? Math.round(ownerDistance) : null,
        ]);
        toast.success("Absensi berhasil ditambahkan");
        setIsAddAttendanceOpen(false);
        setNewAttDate("");
        setNewAttCheckIn("");
        setNewAttCheckOut("");
        setNewAttEmployeeId("");
        setNewAttStatus("present");
        setNewAttLocationKey("");
        setNewAttCoords(null);
        fetchData();
    } catch(e) {
        console.error(e);
        toast.error("Gagal menambah absensi");
    } finally {
        setIsSubmitting(false);
    }
  };

   const handleAddLeave = async () => {
    if(!newLeaveEmployeeId || !newLeaveStartDate || !newLeaveEndDate) {
        toast.error("Data tidak lengkap");
        return;
    }
    setIsSubmitting(true);
    try {
        await query(`
            INSERT INTO leaves (employee_id, type, start_date, end_date, reason, status)
            VALUES ($1, $2, $3, $4, $5, 'approved')
        `, [newLeaveEmployeeId, newLeaveType, newLeaveStartDate, newLeaveEndDate, newLeaveReason]);
        toast.success("Cuti berhasil ditambahkan");
        setIsAddLeaveOpen(false);
        setNewLeaveStartDate("");
        setNewLeaveEndDate("");
        setNewLeaveReason("");
        fetchData();
    } catch(e) {
        console.error(e);
        toast.error("Gagal menambah cuti");
    } finally {
        setIsSubmitting(false);
    }
  };


  const confirmDelete = async () => {
    if (!deleteItem) return;
    
    try {
        if (deleteItem.type === 'attendance') {
            await query("DELETE FROM attendance WHERE id = $1", [deleteItem.id]);
            toast.success("Data absensi dihapus");
        } else {
            await query("DELETE FROM leaves WHERE id = $1", [deleteItem.id]);
            toast.success("Data cuti dihapus");
        }
        fetchData();
    } catch (error) {
        console.error("Failed to delete:", error);
        toast.error("Gagal menghapus data");
    } finally {
        setDeleteItem(null);
    }
  };

  const getEmployee = (id: string) => employees.find((e) => e.id === id);

  const calculatePayroll = (employee: Employee) => {
    const { workDays, transportAllowance: transAllowRate, mealAllowance: mealAllowRate } = config;
    const dailyRate = employee.base_salary / workDays;
    
    const empAtt = attendanceData.filter(a => a.employee_id === employee.id && a.date.startsWith(selectedMonth));
    const presentDays = empAtt.filter(a => a.status === 'present').length;
    
    const totalOvertime = empAtt.reduce((sum, a) => sum + a.overtime, 0);
    const overtimePay = totalOvertime * (dailyRate / 8) * 1.5;
    
    const transportAllowance = presentDays * transAllowRate; 
    const mealAllowance = presentDays * mealAllowRate; 
    
    const bpjsKesehatan = employee.base_salary * 0.01;
    const bpjsTK = employee.base_salary * 0.02;
    const totalDeductions = bpjsKesehatan + bpjsTK;
    
    const grossPay = employee.base_salary + overtimePay + transportAllowance + mealAllowance;
    const netPay = grossPay - totalDeductions;

    return {
      baseSalary: employee.base_salary,
      workDays,
      presentDays,
      dailyRate,
      overtime: totalOvertime,
      overtimePay,
      transportAllowance,
      mealAllowance,
      bpjsKesehatan,
      bpjsTK,
      totalDeductions,
      grossPay,
      netPay,
    };
  };

  const saveConfig = async () => {
    try {
        // libSQL has no jsonb_set: read → merge → write in one transaction.
        await setTenantSetting("payroll_config", config);
        toast.success("Konfigurasi payroll disimpan");
    } catch (error) {
        console.error("Failed to save config:", error);
        toast.error("Gagal menyimpan konfigurasi");
    }
  };

  const handleExport = () => {
    let data: Record<string, unknown>[] = [];
    let filename = "";
    let sheetName = "";

    if (activeTab === "attendance") {
        sheetName = "Absensi";
        data = attendanceData
            .map(att => {
                const emp = getEmployee(att.employee_id);
                if (emp && (!searchQuery || emp.name.toLowerCase().includes(searchQuery.toLowerCase()))) {
                    return {
                        "Nama": emp.name,
                        "Role": emp.role,
                        "Tanggal": att.date,
                        "Check In": att.check_in || "-",
                        "Check Out": att.check_out || "-",
                        "Status": att.status,
                        "Overtime (Jam)": att.overtime,
                        "Sumber": att.source === "self" ? "Karyawan" : att.source === "owner" ? "Owner" : "-",
                        "Lokasi": locationLabel(att),
                        "Geo": geoLabel(att),
                        "Wajah": faceLabel(att)
                    };
                }
                return null;
            })
            .filter(Boolean);
        filename = `attendance_report_${selectedMonth}.xlsx`;
    } else if (activeTab === "leave") {
        sheetName = "Cuti";
        data = leaveData
            .map(l => {
                const emp = getEmployee(l.employee_id);
                if (emp && (!searchQuery || emp.name.toLowerCase().includes(searchQuery.toLowerCase()))) {
                    return {
                        "Nama": emp.name,
                        "Jenis Cuti": l.type,
                        "Mulai": l.start_date,
                        "Selesai": l.end_date,
                        "Durasi (Hari)": l.days,
                        "Alasan": l.reason,
                        "Status": l.status
                    };
                }
                return null;
            })
            .filter(Boolean);
        filename = `leave_report_${selectedMonth}.xlsx`;
    } else if (activeTab === "payroll") {
        sheetName = "Penggajian";
        data = employees
            .map(emp => {
                 if (searchQuery && !emp.name.toLowerCase().includes(searchQuery.toLowerCase())) return null;
                const p = calculatePayroll(emp);
                return {
                    "Nama": emp.name,
                    "Role": emp.role,
                    "Gaji Pokok": p.baseSalary,
                    "Kehadiran": `${p.presentDays}/${p.workDays}`,
                    "Overtime Pay": p.overtimePay,
                    "Tunjangan": p.transportAllowance + p.mealAllowance,
                    "Potongan": p.totalDeductions,
                    "Total Gaji": p.netPay
                };
            })
            .filter(Boolean);
        filename = `payroll_report_${selectedMonth}.xlsx`;
    } else {
        toast.error("Tab ini tidak dapat diexport");
        return;
    }

    if (data.length === 0) {
        toast.error("Tidak ada data untuk diexport");
        return;
    }

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, filename);
    toast.success(`Berhasil export ${filename}`);
  };

  if (isLoading) {
    return (
      <BackOfficeLayout>
        <div className="flex items-center justify-center h-screen">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      </BackOfficeLayout>
    );
  }

  return (
    <BackOfficeLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold">Laporan Karyawan</h1>
            <p className="text-muted-foreground mt-1">Absensi, cuti, dan payroll karyawan</p>
          </div>
          <div className="flex gap-2">
            <Popover>
                <PopoverTrigger asChild>
                    <Button variant="outline" size="icon">
                        <Settings className="w-4 h-4" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80">
                    <div className="grid gap-4">
                        <div className="space-y-2">
                            <h4 className="font-medium leading-none">Konfigurasi Payroll</h4>
                            <p className="text-sm text-muted-foreground">
                                Atur variabel perhitungan gaji.
                            </p>
                        </div>
                        <div className="grid gap-2">
                            <div className="grid grid-cols-3 items-center gap-4">
                                <Label htmlFor="workDays">Hari Kerja</Label>
                                <Input
                                    id="workDays"
                                    type="number"
                                    className="col-span-2 h-8"
                                    value={config.workDays}
                                    onChange={(e) => setConfig({...config, workDays: Number(e.target.value)})}
                                />
                            </div>
                            <div className="grid grid-cols-3 items-center gap-4">
                                <Label htmlFor="transport">Transport</Label>
                                <Input
                                    id="transport"
                                    type="number"
                                    className="col-span-2 h-8"
                                    value={config.transportAllowance}
                                    onChange={(e) => setConfig({...config, transportAllowance: Number(e.target.value)})}
                                />
                            </div>
                            <div className="grid grid-cols-3 items-center gap-4">
                                <Label htmlFor="meal">Uang Makan</Label>
                                <Input
                                    id="meal"
                                    type="number"
                                    className="col-span-2 h-8"
                                    value={config.mealAllowance}
                                    onChange={(e) => setConfig({...config, mealAllowance: Number(e.target.value)})}
                                />
                            </div>
                            <Button size="sm" className="mt-2 w-full" onClick={saveConfig}>
                                Simpan Konfigurasi
                            </Button>
                        </div>
                    </div>
                </PopoverContent>
            </Popover>
            <Button variant="outline" className="gap-2" onClick={() => {
                // The modal always opens on the running day and the date field
                // is locked: standard check-in/out cannot be back- or
                // forward-dated (the DB trigger rejects anything else anyway).
                setNewAttDate(attendanceToday());
                setIsAddAttendanceOpen(true);
            }}>
                <Plus className="w-4 h-4" /> Absensi
            </Button>
            <Button variant="outline" className="gap-2" onClick={() => setIsAddLeaveOpen(true)}>
                <Plus className="w-4 h-4" /> Cuti
            </Button>
            <PermissionGate permission="export_reports">
              <Button className="gap-2" onClick={handleExport}>
                  <Download className="w-4 h-4" /> Export
              </Button>
            </PermissionGate>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-card rounded-xl border p-4 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-primary/10">
                <Users className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Karyawan</p>
                <p className="text-2xl font-bold">{employees.length}</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border p-4 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-success/10">
                <CheckCircle2 className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Hadir Hari Ini</p>
                <p className="text-2xl font-bold text-success">
                    {attendanceData.filter(a => a.date === format(new Date(), 'yyyy-MM-dd') && a.status === 'present').length}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border p-4 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-warning/10">
                <Plane className="w-5 h-5 text-warning" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Cuti Aktif</p>
                <p className="text-2xl font-bold text-warning">
                    {leaveData.filter(l => l.status === 'approved' && new Date(l.end_date) >= new Date()).length}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border p-4 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-info/10">
                <DollarSign className="w-5 h-5 text-info" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Estimasi Payroll</p>
                <p className="text-xl font-bold">
                    {formatCurrency(employees.reduce((sum, e) => sum + calculatePayroll(e).netPay, 0))}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Cari karyawan..." className="pl-10" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          </div>
          <Select value={selectedBranch} onValueChange={setSelectedBranch}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Cabang" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Cabang</SelectItem>
              {Array.from(new Set(employees.map(e => e.branch_name).filter(Boolean))).map(b => (
                 <SelectItem key={b} value={b as string}>{b}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input 
            type="month" 
            className="w-40" 
            value={selectedMonth} 
            onChange={(e) => setSelectedMonth(e.target.value)} 
          />
        </div>

        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
          <TabsList className="bg-muted/50 p-1">
            <TabsTrigger value="attendance" className="gap-2"><Clock className="w-4 h-4" />Absensi</TabsTrigger>
            <TabsTrigger value="leave" className="gap-2"><Plane className="w-4 h-4" />Cuti</TabsTrigger>
            <TabsTrigger value="payroll" className="gap-2"><DollarSign className="w-4 h-4" />Payroll</TabsTrigger>
            <TabsTrigger value="holidays" className="gap-2"><CalendarDays className="w-4 h-4" />Libur</TabsTrigger>
          </TabsList>

          {/* Attendance Tab */}
          <TabsContent value="attendance" className="space-y-4">
            <div className="bg-card rounded-xl border overflow-hidden animate-fade-in">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Karyawan</TableHead>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Check In</TableHead>
                    <TableHead>Check Out</TableHead>
                    <TableHead>Jam Kerja</TableHead>
                    <TableHead>Overtime</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="hidden lg:table-cell">Sumber</TableHead>
                    <TableHead className="hidden lg:table-cell">Lokasi</TableHead>
                    <TableHead className="hidden lg:table-cell">Geo</TableHead>
                    <TableHead className="hidden lg:table-cell">Wajah</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attendanceData.map((att) => {
                    const emp = getEmployee(att.employee_id);
                    if (!emp) return null;
                    if (searchQuery && !emp.name.toLowerCase().includes(searchQuery.toLowerCase())) return null;

                    const workHours = att.check_in && att.check_out 
                      ? Math.abs(parseInt(att.check_out.split(":")[0]) - parseInt(att.check_in.split(":")[0])) + (parseInt(att.check_out.split(":")[1]) - parseInt(att.check_in.split(":")[1])) / 60
                      : 0;
                    return (
                      <TableRow key={att.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{emp.name}</p>
                            <p className="text-sm text-muted-foreground">{emp.role}</p>
                          </div>
                        </TableCell>
                        <TableCell>{att.date}</TableCell>
                        <TableCell>{att.check_in || "-"}</TableCell>
                        <TableCell>{att.check_out || "-"}</TableCell>
                        <TableCell>{workHours > 0 ? `${workHours.toFixed(1)} jam` : "-"}</TableCell>
                        <TableCell>{att.overtime > 0 ? `${att.overtime} jam` : "-"}</TableCell>
                        <TableCell className="text-center">
                          <Badge
                            className={
                              att.status === "present" ? "bg-success/20 text-success" :
                              att.status === "leave" ? "bg-warning/20 text-warning" :
                              "bg-destructive/20 text-destructive"
                            }
                          >
                            {att.status === "present" ? "Hadir" : att.status === "leave" ? "Cuti" : "Absen"}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <Badge variant={att.source === "self" ? "secondary" : "outline"}>
                            {att.source === "self" ? "Karyawan" : att.source === "owner" ? "Owner" : "-"}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-sm">{locationLabel(att)}</TableCell>
                        <TableCell className="hidden lg:table-cell text-sm">{geoLabel(att)}</TableCell>
                        <TableCell className="hidden lg:table-cell text-sm">
                          <span className="inline-flex items-center gap-1">
                            {Number(att.face_verified) === 1 ? (
                              <ShieldCheck className="w-3.5 h-3.5 text-success" />
                            ) : att.source === "owner" ? (
                              <ScanFace className="w-3.5 h-3.5 text-muted-foreground" />
                            ) : (
                              <ScanFace className="w-3.5 h-3.5 text-warning" />
                            )}
                            {faceLabel(att)}
                          </span>
                        </TableCell>
                        <TableCell>
                            <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => setDeleteItem({id: att.id, type: 'attendance'})}
                            >
                                <Trash2 className="w-4 h-4" />
                            </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <PaginationBar
                page={attendancePage}
                pageSize={PAGE_SIZE}
                total={attendanceTotal}
                onPageChange={setAttendancePage}
                label="absensi"
              />
            </div>
          </TabsContent>

          {/* Leave Tab */}
          <TabsContent value="leave" className="space-y-4">
            <div className="bg-card rounded-xl border overflow-hidden animate-fade-in">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Karyawan</TableHead>
                    <TableHead>Jenis Cuti</TableHead>
                    <TableHead>Tanggal Mulai</TableHead>
                    <TableHead>Tanggal Selesai</TableHead>
                    <TableHead>Jumlah Hari</TableHead>
                    <TableHead>Alasan</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leaveData.map((leave) => {
                    const emp = getEmployee(leave.employee_id);
                    if (!emp) return null;
                     if (searchQuery && !emp.name.toLowerCase().includes(searchQuery.toLowerCase())) return null;

                    return (
                      <TableRow key={leave.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{emp.name}</p>
                            <p className="text-sm text-muted-foreground">{emp.branch_name}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {leave.type === "annual" ? "Cuti Tahunan" : leave.type === "sick" ? "Sakit" : "Lainnya"}
                          </Badge>
                        </TableCell>
                        <TableCell>{leave.start_date}</TableCell>
                        <TableCell>{leave.end_date}</TableCell>
                        <TableCell>{leave.days} hari</TableCell>
                        <TableCell className="max-w-48 truncate">{leave.reason}</TableCell>
                        <TableCell className="text-center">
                          <Badge
                            className={
                              leave.status === "approved" ? "bg-success/20 text-success" :
                              leave.status === "pending" ? "bg-warning/20 text-warning" :
                              "bg-destructive/20 text-destructive"
                            }
                          >
                            {leave.status === "approved" ? "Disetujui" : leave.status === "pending" ? "Pending" : "Ditolak"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                            <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => setDeleteItem({id: leave.id, type: 'leave'})}
                            >
                                <Trash2 className="w-4 h-4" />
                            </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <PaginationBar
                page={leavePage}
                pageSize={PAGE_SIZE}
                total={leaveTotal}
                onPageChange={setLeavePage}
                label="cuti"
              />
            </div>
          </TabsContent>

          {/* Payroll Tab */}
          <TabsContent value="payroll" className="space-y-4">
            <div className="bg-card rounded-xl border overflow-hidden animate-fade-in">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Karyawan</TableHead>
                    <TableHead className="text-right">Gaji Pokok</TableHead>
                    <TableHead className="text-right">Hari Kerja</TableHead>
                    <TableHead className="text-right">Overtime</TableHead>
                    <TableHead className="text-right">Tunjangan</TableHead>
                    <TableHead className="text-right">Potongan</TableHead>
                    <TableHead className="text-right">Total Gaji</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employees.map((emp) => {
                    if (searchQuery && !emp.name.toLowerCase().includes(searchQuery.toLowerCase())) return null;
                    const payroll = calculatePayroll(emp);
                    return (
                      <TableRow key={emp.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{emp.name}</p>
                            <p className="text-sm text-muted-foreground">{emp.role} - {emp.branch_name}</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(payroll.baseSalary)}</TableCell>
                        <TableCell className="text-right">{payroll.presentDays}/{payroll.workDays}</TableCell>
                        <TableCell className="text-right">
                          {payroll.overtime > 0 && <span className="text-success">+{formatCurrency(payroll.overtimePay)}</span>}
                          {payroll.overtime === 0 && "-"}
                        </TableCell>
                        <TableCell className="text-right text-success">
                          +{formatCurrency(payroll.transportAllowance + payroll.mealAllowance)}
                        </TableCell>
                        <TableCell className="text-right text-destructive">
                          -{formatCurrency(payroll.totalDeductions)}
                        </TableCell>
                        <TableCell className="text-right font-bold text-primary">
                          {formatCurrency(payroll.netPay)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

           {/* Public Holidays Tab */}
          <TabsContent value="holidays" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Hari Libur Nasional &amp; Cuti Bersama tahun {holidayYear}, dimuat otomatis dari
                kalender libur pemerintah.
              </p>
              <Select value={String(holidayYear)} onValueChange={(v) => setHolidayYear(Number(v))}>
                <SelectTrigger className="w-32"><SelectValue placeholder="Tahun" /></SelectTrigger>
                <SelectContent>
                  {holidayYears.map((year) => (
                    <SelectItem key={year} value={String(year)}>{year}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="bg-card rounded-xl border overflow-hidden animate-fade-in">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Hari</TableHead>
                    <TableHead>Nama Libur</TableHead>
                    <TableHead className="text-center">Jenis</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {holidaysQuery.isLoading ? (
                    <TableRow>
                      <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                        Memuat hari libur {holidayYear}...
                      </TableCell>
                    </TableRow>
                  ) : (holidaysQuery.data?.holidays.length ?? 0) === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                        Belum ada data libur untuk tahun {holidayYear}.
                      </TableCell>
                    </TableRow>
                  ) : (
                    holidaysQuery.data!.holidays.map((holiday: HolidayEntry) => {
                      const dayName = format(new Date(`${holiday.date}T00:00:00`), "EEEE", { locale: id });
                      return (
                        <TableRow key={`${holiday.date}-${holiday.name}`}>
                          <TableCell className="font-mono">{holiday.date}</TableCell>
                          <TableCell>{dayName}</TableCell>
                          <TableCell className="font-medium">{holiday.name}</TableCell>
                          <TableCell className="text-center">
                            <Badge
                              className={
                                holiday.type === "holiday"
                                  ? "bg-primary/10 text-primary"
                                  : "bg-warning/20 text-warning"
                              }
                            >
                              {holiday.type === "holiday" ? "Libur Nasional" : "Cuti Bersama"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
              {holidaysQuery.data?.fallback ? (
                <div className="px-4 py-3 text-sm text-muted-foreground border-t bg-muted/30">
                  <AlertCircle className="w-4 h-4 inline mr-1" />
                  Kalender online tidak dapat dijangkau — menampilkan daftar bawaan aplikasi untuk{" "}
                  {holidayYear}. Data tahun lain akan dimuat begitu koneksi tersedia.
                </div>
              ) : null}
            </div>
          </TabsContent>
        </Tabs>

        {/* Add Attendance Dialog */}
        <Dialog open={isAddAttendanceOpen} onOpenChange={setIsAddAttendanceOpen}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Tambah Absensi</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label>Karyawan</Label>
                        <Select value={newAttEmployeeId} onValueChange={setNewAttEmployeeId}>
                            <SelectTrigger>
                                <SelectValue placeholder="Pilih Karyawan" />
                            </SelectTrigger>
                            <SelectContent>
                                {employees.map(e => (
                                    <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="attendance-date">Tanggal</Label>
                        {/* Locked to the running day: standard check-in/out is a
                            live event, and the tenant DB rejects inserts dated
                            any other day. */}
                        <Input
                            id="attendance-date"
                            type="date"
                            value={newAttDate || attendanceToday()}
                            readOnly
                            disabled
                            className="bg-muted text-muted-foreground"
                        />
                        <p className="text-xs text-muted-foreground">
                            Tanggal terkunci pada hari berjalan ({attendanceToday()}).
                        </p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                         <div className="grid gap-2">
                            <Label>Check In</Label>
                            <Input type="time" value={newAttCheckIn} onChange={e => setNewAttCheckIn(e.target.value)} />
                        </div>
                         <div className="grid gap-2">
                            <Label>Check Out</Label>
                            <Input type="time" value={newAttCheckOut} onChange={e => setNewAttCheckOut(e.target.value)} />
                        </div>
                    </div>
                     <div className="grid gap-2">
                        <Label>Status</Label>
                        <Select value={newAttStatus} onValueChange={setNewAttStatus}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="present">Hadir</SelectItem>
                                <SelectItem value="late">Terlambat</SelectItem>
                                <SelectItem value="absent">Absen</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="border rounded-md p-3 space-y-3 bg-muted/20">
                        <div className="flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-muted-foreground" />
                            <Label className="font-medium">Lokasi &amp; GPS (opsional)</Label>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Override owner tidak diblokir geofence. Pilih lokasi untuk mencatat tempat
                            absensi ini demi audit.
                        </p>
                        <Select value={newAttLocationKey} onValueChange={setNewAttLocationKey}>
                            <SelectTrigger>
                                <SelectValue placeholder="Pilih lokasi kerja" />
                            </SelectTrigger>
                            <SelectContent>
                                {workplaceLocations.map((l) => (
                                    <SelectItem key={locationKey(l.type, l.id)} value={locationKey(l.type, l.id)}>
                                        {l.name ?? l.id} ({l.type === "branch" ? "Cabang" : "Gudang"})
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <div className="flex items-center gap-2">
                            <Button type="button" size="sm" variant="outline" className="gap-2" onClick={captureOwnerGps} disabled={ownerGeoBusy}>
                                {ownerGeoBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
                                Ambil GPS sekarang
                            </Button>
                            {newAttCoords && ownerDistance != null ? (
                                <span className="text-xs text-muted-foreground">
                                    {selectedAttLocation
                                        ? `${ownerDistance <= selectedAttLocation.geo_radius_m ? "Dalam" : "Luar"} · ${formatDistance(ownerDistance)}`
                                        : formatDistance(ownerDistance)}
                                </span>
                            ) : newAttCoords ? (
                                <span className="text-xs text-muted-foreground">Lokasi tercatat (pilih lokasi untuk jarak)</span>
                            ) : null}
                        </div>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setIsAddAttendanceOpen(false)}>Batal</Button>
                    <Button onClick={handleAddAttendance} disabled={isSubmitting}>
                        {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        Simpan
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        {/* Add Leave Dialog */}
        <Dialog open={isAddLeaveOpen} onOpenChange={setIsAddLeaveOpen}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Ajukan Cuti</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label>Karyawan</Label>
                        <Select value={newLeaveEmployeeId} onValueChange={setNewLeaveEmployeeId}>
                            <SelectTrigger>
                                <SelectValue placeholder="Pilih Karyawan" />
                            </SelectTrigger>
                            <SelectContent>
                                {employees.map(e => (
                                    <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                     <div className="grid gap-2">
                        <Label>Jenis Cuti</Label>
                        <Select value={newLeaveType} onValueChange={setNewLeaveType}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="annual">Cuti Tahunan</SelectItem>
                                <SelectItem value="sick">Sakit</SelectItem>
                                <SelectItem value="unpaid">Unpaid Leave</SelectItem>
                                <SelectItem value="other">Lainnya</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                         <div className="grid gap-2">
                            <Label>Mulai</Label>
                            <Input type="date" value={newLeaveStartDate} onChange={e => setNewLeaveStartDate(e.target.value)} />
                        </div>
                         <div className="grid gap-2">
                            <Label>Selesai</Label>
                            <Input type="date" value={newLeaveEndDate} onChange={e => setNewLeaveEndDate(e.target.value)} />
                        </div>
                    </div>
                     <div className="grid gap-2">
                        <Label>Alasan</Label>
                        <Input value={newLeaveReason} onChange={e => setNewLeaveReason(e.target.value)} />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setIsAddLeaveOpen(false)}>Batal</Button>
                    <Button onClick={handleAddLeave} disabled={isSubmitting}>
                        {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        Simpan
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        <AlertDialog open={!!deleteItem} onOpenChange={(open) => !open && setDeleteItem(null)}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Hapus Data?</AlertDialogTitle>
                    <AlertDialogDescription>
                        Tindakan ini tidak dapat dibatalkan.
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

      </div>
    </BackOfficeLayout>
  );
}
