import { BackOfficeLayout } from "@/components/layout/BackOfficeLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BankSettings } from "@/components/settings/BankSettings";
import { ReceiptSettings } from "@/components/settings/ReceiptSettings";
import { EmployeeRoleSettings } from "@/components/settings/EmployeeRoleSettings";
import { TaxDiscountSettings } from "@/components/settings/TaxDiscountSettings";
import { useTheme } from "@/hooks/use-theme";
import { Settings as SettingsIcon, Building2, Bell, Shield, Database, Globe, Palette, Save, Users } from "lucide-react";

export default function Settings() {
  const { theme, toggleTheme } = useTheme();
  return (
    <BackOfficeLayout>
      <div className="space-y-4 md:space-y-6">
        <div><h1 className="text-xl md:text-2xl lg:text-3xl font-bold">Pengaturan</h1><p className="text-muted-foreground text-sm md:text-base mt-1">Konfigurasi sistem dan preferensi aplikasi</p></div>

        <Tabs defaultValue="general" className="space-y-4 md:space-y-6">
          <TabsList className="bg-muted/50 p-1 flex-wrap h-auto">
            <TabsTrigger value="general" className="gap-2 text-xs md:text-sm"><SettingsIcon className="w-4 h-4" /><span className="hidden sm:inline">Umum</span></TabsTrigger>
            <TabsTrigger value="company" className="gap-2 text-xs md:text-sm"><Building2 className="w-4 h-4" /><span className="hidden sm:inline">Perusahaan</span></TabsTrigger>
            <TabsTrigger value="employees" className="gap-2 text-xs md:text-sm"><Users className="w-4 h-4" /><span className="hidden sm:inline">Karyawan & Role</span></TabsTrigger>
            <TabsTrigger value="notifications" className="gap-2 text-xs md:text-sm"><Bell className="w-4 h-4" /><span className="hidden sm:inline">Notifikasi</span></TabsTrigger>
            <TabsTrigger value="security" className="gap-2 text-xs md:text-sm"><Shield className="w-4 h-4" /><span className="hidden sm:inline">Keamanan</span></TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-4 md:space-y-6">
            <div className="bg-card rounded-xl border p-4 md:p-6 space-y-4 md:space-y-6 animate-fade-in">
              <div className="flex items-center gap-3 pb-4 border-b"><div className="p-2.5 rounded-lg bg-primary/10"><Globe className="w-5 h-5 text-primary" /></div><div><h3 className="font-semibold">Pengaturan Regional</h3><p className="text-sm text-muted-foreground">Bahasa dan format mata uang</p></div></div>
              <div className="grid gap-4 md:gap-6 md:grid-cols-2">
                <div className="space-y-2"><Label>Bahasa</Label><Select defaultValue="id"><SelectTrigger><SelectValue placeholder="Pilih bahasa" /></SelectTrigger><SelectContent><SelectItem value="id">Bahasa Indonesia</SelectItem><SelectItem value="en">English</SelectItem></SelectContent></Select></div>
                <div className="space-y-2"><Label>Zona Waktu</Label><Select defaultValue="wib"><SelectTrigger><SelectValue placeholder="Pilih zona waktu" /></SelectTrigger><SelectContent><SelectItem value="wib">WIB (UTC+7)</SelectItem><SelectItem value="wita">WITA (UTC+8)</SelectItem><SelectItem value="wit">WIT (UTC+9)</SelectItem></SelectContent></Select></div>
                <div className="space-y-2"><Label>Format Tanggal</Label><Select defaultValue="dd-mm-yyyy"><SelectTrigger><SelectValue placeholder="Pilih format" /></SelectTrigger><SelectContent><SelectItem value="dd-mm-yyyy">DD-MM-YYYY</SelectItem><SelectItem value="mm-dd-yyyy">MM-DD-YYYY</SelectItem><SelectItem value="yyyy-mm-dd">YYYY-MM-DD</SelectItem></SelectContent></Select></div>
                <div className="space-y-2"><Label>Mata Uang</Label><Select defaultValue="idr"><SelectTrigger><SelectValue placeholder="Pilih mata uang" /></SelectTrigger><SelectContent><SelectItem value="idr">IDR - Rupiah</SelectItem><SelectItem value="usd">USD - Dollar</SelectItem></SelectContent></Select></div>
              </div>
            </div>
            <div className="bg-card rounded-xl border p-4 md:p-6 space-y-4 md:space-y-6 animate-fade-in">
              <div className="flex items-center gap-3 pb-4 border-b"><div className="p-2.5 rounded-lg bg-info/10"><Palette className="w-5 h-5 text-info" /></div><div><h3 className="font-semibold">Tampilan</h3><p className="text-sm text-muted-foreground">Kustomisasi tema dan tampilan</p></div></div>
              <div className="space-y-4">
                <div className="flex items-center justify-between"><div><p className="font-medium">Mode Gelap</p><p className="text-sm text-muted-foreground">Gunakan tema gelap</p></div><Switch checked={theme === "dark"} onCheckedChange={toggleTheme} /></div>
                <div className="flex items-center justify-between"><div><p className="font-medium">Sidebar Compact</p><p className="text-sm text-muted-foreground">Sidebar dalam mode kecil</p></div><Switch /></div>
                <div className="flex items-center justify-between"><div><p className="font-medium">Animasi</p><p className="text-sm text-muted-foreground">Aktifkan animasi transisi</p></div><Switch defaultChecked /></div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="company" className="space-y-4 md:space-y-6">
            <div className="bg-card rounded-xl border p-4 md:p-6 space-y-4 md:space-y-6 animate-fade-in">
              <div className="flex items-center gap-3 pb-4 border-b"><div className="p-2.5 rounded-lg bg-primary/10"><Building2 className="w-5 h-5 text-primary" /></div><div><h3 className="font-semibold">Informasi Perusahaan</h3><p className="text-sm text-muted-foreground">Data profil perusahaan</p></div></div>
              <div className="grid gap-4 md:gap-6 md:grid-cols-2">
                <div className="space-y-2"><Label>Nama Perusahaan</Label><Input placeholder="PT. RetailPro Indonesia" defaultValue="PT. RetailPro Indonesia" /></div>
                <div className="space-y-2"><Label>NPWP</Label><Input placeholder="00.000.000.0-000.000" /></div>
                <div className="space-y-2 md:col-span-2"><Label>Alamat</Label><Input placeholder="Jl. Sudirman No. 123, Jakarta" /></div>
                <div className="space-y-2"><Label>Telepon</Label><Input placeholder="+62 21 1234 5678" /></div>
                <div className="space-y-2"><Label>Email</Label><Input type="email" placeholder="info@retailpro.id" /></div>
              </div>
            </div>
            <ReceiptSettings />
            <TaxDiscountSettings />
            <BankSettings />
          </TabsContent>

          <TabsContent value="employees" className="space-y-4 md:space-y-6"><EmployeeRoleSettings /></TabsContent>

          <TabsContent value="notifications" className="space-y-4 md:space-y-6">
            <div className="bg-card rounded-xl border p-4 md:p-6 space-y-4 md:space-y-6 animate-fade-in">
              <div className="flex items-center gap-3 pb-4 border-b"><div className="p-2.5 rounded-lg bg-primary/10"><Bell className="w-5 h-5 text-primary" /></div><div><h3 className="font-semibold">Notifikasi</h3><p className="text-sm text-muted-foreground">Kelola preferensi notifikasi</p></div></div>
              <div className="space-y-4">
                <div className="flex items-center justify-between"><div><p className="font-medium">Stok Minimum</p><p className="text-sm text-muted-foreground">Notifikasi saat stok rendah</p></div><Switch defaultChecked /></div>
                <div className="flex items-center justify-between"><div><p className="font-medium">Transaksi Baru</p><p className="text-sm text-muted-foreground">Notifikasi transaksi real-time</p></div><Switch defaultChecked /></div>
                <div className="flex items-center justify-between"><div><p className="font-medium">Laporan Harian</p><p className="text-sm text-muted-foreground">Ringkasan via email</p></div><Switch /></div>
                <div className="flex items-center justify-between"><div><p className="font-medium">Update Sistem</p><p className="text-sm text-muted-foreground">Info pembaruan aplikasi</p></div><Switch defaultChecked /></div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="security" className="space-y-4 md:space-y-6">
            <div className="bg-card rounded-xl border p-4 md:p-6 space-y-4 md:space-y-6 animate-fade-in">
              <div className="flex items-center gap-3 pb-4 border-b"><div className="p-2.5 rounded-lg bg-primary/10"><Shield className="w-5 h-5 text-primary" /></div><div><h3 className="font-semibold">Keamanan Akun</h3><p className="text-sm text-muted-foreground">Pengaturan keamanan</p></div></div>
              <div className="space-y-4">
                <div className="flex items-center justify-between"><div><p className="font-medium">Two-Factor Authentication</p><p className="text-sm text-muted-foreground">Verifikasi 2 langkah</p></div><Switch /></div>
                <div className="flex items-center justify-between"><div><p className="font-medium">Session Timeout</p><p className="text-sm text-muted-foreground">Logout otomatis saat idle</p></div><Switch defaultChecked /></div>
                <div className="space-y-2"><Label>Durasi Session (menit)</Label><Select defaultValue="30"><SelectTrigger className="w-32"><SelectValue placeholder="Pilih durasi" /></SelectTrigger><SelectContent><SelectItem value="15">15 menit</SelectItem><SelectItem value="30">30 menit</SelectItem><SelectItem value="60">60 menit</SelectItem><SelectItem value="120">120 menit</SelectItem></SelectContent></Select></div>
              </div>
            </div>
            <div className="bg-card rounded-xl border p-4 md:p-6 space-y-4 md:space-y-6 animate-fade-in">
              <div className="flex items-center gap-3 pb-4 border-b"><div className="p-2.5 rounded-lg bg-info/10"><Database className="w-5 h-5 text-info" /></div><div><h3 className="font-semibold">Backup & Data</h3><p className="text-sm text-muted-foreground">Kelola backup data</p></div></div>
              <div className="space-y-4">
                <div className="flex items-center justify-between"><div><p className="font-medium">Backup Otomatis</p><p className="text-sm text-muted-foreground">Backup harian otomatis</p></div><Switch defaultChecked /></div>
                <div className="flex flex-wrap gap-2"><Button variant="outline">Download Backup</Button><Button variant="outline">Restore Data</Button></div>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end"><Button className="gap-2"><Save className="w-4 h-4" />Simpan Pengaturan</Button></div>
      </div>
    </BackOfficeLayout>
  );
}
