import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Calendar,
  Clock,
  Users,
  DollarSign,
  Download,
  Search,
  CalendarDays,
  Briefcase,
  CheckCircle,
  XCircle,
  Plane,
  Coffee,
} from "lucide-react";

const employees = [
  { id: "1", name: "Ahmad Fauzi", position: "Kasir", branch: "Jakarta", baseSalary: 4500000 },
  { id: "2", name: "Siti Rahayu", position: "Store Manager", branch: "Surabaya", baseSalary: 8000000 },
  { id: "3", name: "Budi Santoso", position: "Kasir", branch: "Bandung", baseSalary: 4500000 },
  { id: "4", name: "Dewi Lestari", position: "Admin", branch: "Jakarta", baseSalary: 5500000 },
  { id: "5", name: "Eko Prasetyo", position: "Warehouse", branch: "Medan", baseSalary: 4800000 },
];

const attendanceData = [
  { id: "1", employeeId: "1", date: "2024-01-15", checkIn: "08:02", checkOut: "17:05", status: "present", overtime: 0 },
  { id: "2", employeeId: "1", date: "2024-01-16", checkIn: "08:10", checkOut: "18:30", status: "present", overtime: 1.5 },
  { id: "3", employeeId: "1", date: "2024-01-17", checkIn: null, checkOut: null, status: "leave", overtime: 0 },
  { id: "4", employeeId: "2", date: "2024-01-15", checkIn: "07:55", checkOut: "17:00", status: "present", overtime: 0 },
  { id: "5", employeeId: "2", date: "2024-01-16", checkIn: "08:00", checkOut: "17:00", status: "present", overtime: 0 },
  { id: "6", employeeId: "3", date: "2024-01-15", checkIn: null, checkOut: null, status: "absent", overtime: 0 },
];

const leaveData = [
  { id: "1", employeeId: "1", type: "annual", startDate: "2024-01-17", endDate: "2024-01-19", days: 3, status: "approved", reason: "Liburan keluarga" },
  { id: "2", employeeId: "2", type: "sick", startDate: "2024-01-20", endDate: "2024-01-20", days: 1, status: "approved", reason: "Sakit demam" },
  { id: "3", employeeId: "3", type: "annual", startDate: "2024-02-01", endDate: "2024-02-05", days: 5, status: "pending", reason: "Cuti menikah" },
  { id: "4", employeeId: "4", type: "annual", startDate: "2024-01-25", endDate: "2024-01-26", days: 2, status: "rejected", reason: "Keperluan pribadi" },
];

const publicHolidays = [
  { date: "2024-01-01", name: "Tahun Baru" },
  { date: "2024-02-08", name: "Tahun Baru Imlek" },
  { date: "2024-03-11", name: "Isra Mi'raj" },
  { date: "2024-03-29", name: "Jumat Agung" },
  { date: "2024-04-10", name: "Idul Fitri" },
  { date: "2024-04-11", name: "Idul Fitri" },
  { date: "2024-05-01", name: "Hari Buruh" },
  { date: "2024-05-23", name: "Waisak" },
  { date: "2024-06-01", name: "Hari Lahir Pancasila" },
  { date: "2024-06-17", name: "Idul Adha" },
  { date: "2024-07-07", name: "Tahun Baru Islam" },
  { date: "2024-08-17", name: "Hari Kemerdekaan" },
  { date: "2024-09-16", name: "Maulid Nabi" },
  { date: "2024-12-25", name: "Natal" },
];

function formatCurrency(value: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(value);
}

export default function EmployeeReports() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedBranch, setSelectedBranch] = useState("all");
  const [selectedMonth, setSelectedMonth] = useState("01");

  const getEmployee = (id: string) => employees.find((e) => e.id === id);

  const calculatePayroll = (employee: typeof employees[0]) => {
    const workDays = 22;
    const dailyRate = employee.baseSalary / workDays;
    const presentDays = attendanceData.filter(
      (a) => a.employeeId === employee.id && a.status === "present"
    ).length || workDays;
    const totalOvertime = attendanceData
      .filter((a) => a.employeeId === employee.id)
      .reduce((sum, a) => sum + a.overtime, 0);
    const overtimePay = totalOvertime * (dailyRate / 8) * 1.5;
    const transportAllowance = 500000;
    const mealAllowance = 750000;
    const bpjsKesehatan = employee.baseSalary * 0.01;
    const bpjsTK = employee.baseSalary * 0.02;
    const totalDeductions = bpjsKesehatan + bpjsTK;
    const grossPay = (dailyRate * presentDays) + overtimePay + transportAllowance + mealAllowance;
    const netPay = grossPay - totalDeductions;

    return {
      baseSalary: employee.baseSalary,
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

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold">Laporan Karyawan</h1>
            <p className="text-muted-foreground mt-1">Absensi, cuti, dan payroll karyawan</p>
          </div>
          <Button className="gap-2">
            <Download className="w-4 h-4" />
            Export Laporan
          </Button>
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
                <CheckCircle className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Hadir Hari Ini</p>
                <p className="text-2xl font-bold text-success">4</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border p-4 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-warning/10">
                <Plane className="w-5 h-5 text-warning" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Cuti Pending</p>
                <p className="text-2xl font-bold text-warning">1</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border p-4 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-info/10">
                <DollarSign className="w-5 h-5 text-info" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Payroll</p>
                <p className="text-xl font-bold">{formatCurrency(employees.reduce((sum, e) => sum + calculatePayroll(e).netPay, 0))}</p>
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
              <SelectItem value="Jakarta">Jakarta</SelectItem>
              <SelectItem value="Surabaya">Surabaya</SelectItem>
              <SelectItem value="Bandung">Bandung</SelectItem>
              <SelectItem value="Medan">Medan</SelectItem>
            </SelectContent>
          </Select>
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Bulan" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="01">Januari 2024</SelectItem>
              <SelectItem value="02">Februari 2024</SelectItem>
              <SelectItem value="03">Maret 2024</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Tabs defaultValue="attendance" className="space-y-4">
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attendanceData.map((att) => {
                    const emp = getEmployee(att.employeeId);
                    const workHours = att.checkIn && att.checkOut 
                      ? Math.abs(parseInt(att.checkOut.split(":")[0]) - parseInt(att.checkIn.split(":")[0])) + (parseInt(att.checkOut.split(":")[1]) - parseInt(att.checkIn.split(":")[1])) / 60
                      : 0;
                    return (
                      <TableRow key={att.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{emp?.name}</p>
                            <p className="text-sm text-muted-foreground">{emp?.position}</p>
                          </div>
                        </TableCell>
                        <TableCell>{att.date}</TableCell>
                        <TableCell>{att.checkIn || "-"}</TableCell>
                        <TableCell>{att.checkOut || "-"}</TableCell>
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
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leaveData.map((leave) => {
                    const emp = getEmployee(leave.employeeId);
                    return (
                      <TableRow key={leave.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{emp?.name}</p>
                            <p className="text-sm text-muted-foreground">{emp?.branch}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {leave.type === "annual" ? "Cuti Tahunan" : leave.type === "sick" ? "Sakit" : "Lainnya"}
                          </Badge>
                        </TableCell>
                        <TableCell>{leave.startDate}</TableCell>
                        <TableCell>{leave.endDate}</TableCell>
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
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
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
                    const payroll = calculatePayroll(emp);
                    return (
                      <TableRow key={emp.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{emp.name}</p>
                            <p className="text-sm text-muted-foreground">{emp.position} - {emp.branch}</p>
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

            {/* Payroll Summary */}
            <div className="grid md:grid-cols-3 gap-4">
              <div className="bg-card rounded-xl border p-4">
                <p className="text-sm text-muted-foreground mb-1">Total Gaji Pokok</p>
                <p className="text-xl font-bold">{formatCurrency(employees.reduce((sum, e) => sum + e.baseSalary, 0))}</p>
              </div>
              <div className="bg-card rounded-xl border p-4">
                <p className="text-sm text-muted-foreground mb-1">Total Tunjangan</p>
                <p className="text-xl font-bold text-success">{formatCurrency(employees.length * 1250000)}</p>
              </div>
              <div className="bg-card rounded-xl border p-4">
                <p className="text-sm text-muted-foreground mb-1">Total BPJS</p>
                <p className="text-xl font-bold text-destructive">{formatCurrency(employees.reduce((sum, e) => sum + (e.baseSalary * 0.03), 0))}</p>
              </div>
            </div>
          </TabsContent>

          {/* Public Holidays Tab */}
          <TabsContent value="holidays" className="space-y-4">
            <div className="bg-card rounded-xl border overflow-hidden animate-fade-in">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Hari Libur Nasional</TableHead>
                    <TableHead>Hari</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {publicHolidays.map((holiday, index) => {
                    const date = new Date(holiday.date);
                    const dayName = date.toLocaleDateString("id-ID", { weekday: "long" });
                    return (
                      <TableRow key={index}>
                        <TableCell className="font-mono">{holiday.date}</TableCell>
                        <TableCell className="font-medium">{holiday.name}</TableCell>
                        <TableCell>{dayName}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
