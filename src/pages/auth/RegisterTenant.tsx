import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Link, useNavigate } from "react-router-dom";
import { Store, Loader2, CheckCircle2, Building2, MapPin, Phone, User, Mail, Globe, Lock, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

import { authClient } from "@/lib/auth-client";

const registerSchema = z.object({
  tenantName: z.string().min(3, "Nama tenant minimal 3 karakter"),
  address: z.string().min(10, "Alamat minimal 10 karakter"),
  phone: z.string().min(10, "Nomor telepon tidak valid"),
  email: z.string().email("Email tidak valid"),
  adminName: z.string().min(3, "Nama admin minimal 3 karakter"),
  password: z.string().min(8, "Password minimal 8 karakter"),
  domain: z.string().optional(),
  logo: z.any().optional(),
});

type RegisterFormValues = z.infer<typeof registerSchema>;

export default function RegisterTenant() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      tenantName: "",
      address: "",
      phone: "",
      email: "",
      adminName: "",
      password: "",
      domain: "",
      logo: undefined,
    },
  });

  async function onSubmit(data: RegisterFormValues) {
    setIsLoading(true);
    
    try {
        // 1. Create User via Neon Auth
        const { data: authData, error } = await authClient.signUp.email({
            email: data.email,
            password: data.password,
            name: data.adminName,
            // image: data.logo ? URL.createObjectURL(data.logo) : undefined, // Optional: if we want to set profile pic
        });

        if (error) {
            // Fallback for demo/dev mode if auth not configured
            if (import.meta.env.DEV && !import.meta.env.VITE_NEON_AUTH_URL) {
                 console.warn("Neon Auth not configured, simulating success");
                 setTimeout(() => {
                    setIsLoading(false);
                    setIsSuccess(true);
                    toast.success("Pendaftaran berhasil! (Simulasi Mode)");
                 }, 1500);
                 return;
            }
            
            toast.error(error.message || "Gagal mendaftar");
            setIsLoading(false);
            return;
        }

        // 2. TODO: Call Backend API to create 'tenants' record and link to this user
        // Since we are client-side only for now, we can't easily insert into 'tenants' table 
        // without a server function or RLS policy that allows authenticated user to create tenant.
        // For now, we assume the user is created and we show success.
        
        setIsSuccess(true);
        toast.success("Pendaftaran berhasil! Silakan cek email Anda.");

    } catch (err) {
        console.error("Registration error:", err);
        if (import.meta.env.DEV) {
             // Fallback
             setTimeout(() => {
                setIsLoading(false);
                setIsSuccess(true);
                toast.success("Pendaftaran berhasil! (Fallback Mode)");
             }, 1000);
        } else {
            toast.error("Terjadi kesalahan sistem");
            setIsLoading(false);
        }
    }
  }

  if (isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/50 p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-green-600" />
              </div>
            </div>
            <CardTitle className="text-2xl">Pendaftaran Berhasil!</CardTitle>
            <CardDescription>
              Terima kasih telah mendaftar di RetailPro.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">
              Kami telah mengirimkan email verifikasi ke <strong>{form.getValues().email}</strong>.
              Silakan cek inbox Anda untuk mengaktifkan akun.
            </p>
            <div className="p-4 bg-muted rounded-lg text-sm text-left">
              <p className="font-medium mb-2">Langkah selanjutnya:</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Verifikasi email Anda</li>
                <li>Tunggu persetujuan admin (1x24 jam)</li>
                <li>Login dan setup toko Anda</li>
              </ul>
            </div>
          </CardContent>
          <CardFooter>
            <Button className="w-full" onClick={() => navigate("/login")}>
              Kembali ke Halaman Login
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/50 p-4 py-8">
      <Card className="w-full max-w-2xl">
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-center mb-4">
            <div className="w-12 h-12 rounded-xl gradient-primary flex items-center justify-center">
              <Store className="w-6 h-6 text-primary-foreground" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold">Daftarkan Tenant Baru</CardTitle>
          <CardDescription>
            Mulai kelola bisnis retail Anda dengan RetailPro
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              
              {/* Company Details */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium flex items-center gap-2 border-b pb-2">
                    <Building2 className="w-5 h-5" /> Detail Perusahaan
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                        control={form.control}
                        name="tenantName"
                        render={({ field }) => (
                        <FormItem>
                            <FormLabel>Nama Tenant / Usaha</FormLabel>
                            <FormControl>
                            <Input placeholder="Contoh: Toko Maju Jaya" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="phone"
                        render={({ field }) => (
                        <FormItem>
                            <FormLabel>Nomor Telepon</FormLabel>
                            <FormControl>
                            <div className="relative">
                                <Phone className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input placeholder="08123456789" className="pl-9" {...field} />
                            </div>
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                        )}
                    />
                </div>
                <FormField
                    control={form.control}
                    name="address"
                    render={({ field }) => (
                    <FormItem>
                        <FormLabel>Alamat Lengkap</FormLabel>
                        <FormControl>
                        <div className="relative">
                            <MapPin className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                            <Textarea placeholder="Jl. Sudirman No. 123, Jakarta Selatan" className="pl-9 min-h-[80px]" {...field} />
                        </div>
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="domain"
                    render={({ field }) => (
                    <FormItem>
                        <FormLabel>Domain / Subdomain (Opsional)</FormLabel>
                        <FormControl>
                        <div className="relative">
                            <Globe className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input placeholder="tokoanda.retailpro.com" className="pl-9" {...field} />
                        </div>
                        </FormControl>
                        <FormDescription>
                            Kosongkan jika ingin menggunakan domain default
                        </FormDescription>
                        <FormMessage />
                    </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="logo"
                    render={({ field: { value, onChange, ...field } }) => (
                    <FormItem>
                        <FormLabel>Logo & Branding (Opsional)</FormLabel>
                        <FormControl>
                        <div className="flex items-center gap-4">
                            <div className="flex-1">
                                <div className="relative cursor-pointer">
                                    <Upload className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                                    <Input 
                                        type="file" 
                                        className="pl-9 cursor-pointer" 
                                        accept="image/*"
                                        onChange={(e) => {
                                            onChange(e.target.files?.[0]);
                                        }}
                                        {...field} 
                                    />
                                </div>
                            </div>
                        </div>
                        </FormControl>
                        <FormDescription>
                            Format: PNG, JPG (Max 2MB)
                        </FormDescription>
                        <FormMessage />
                    </FormItem>
                    )}
                />
              </div>

              {/* Admin Details */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium flex items-center gap-2 border-b pb-2">
                    <User className="w-5 h-5" /> Informasi Admin
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                        control={form.control}
                        name="adminName"
                        render={({ field }) => (
                        <FormItem>
                            <FormLabel>Nama Lengkap Admin</FormLabel>
                            <FormControl>
                            <Input placeholder="Nama lengkap Anda" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                        <FormItem>
                            <FormLabel>Email Resmi</FormLabel>
                            <FormControl>
                            <div className="relative">
                                <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input type="email" placeholder="admin@tokoanda.com" className="pl-9" {...field} />
                            </div>
                            </FormControl>
                            <FormDescription>Email ini akan digunakan untuk login admin</FormDescription>
                            <FormMessage />
                        </FormItem>
                        )}
                    />
                </div>
                <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                    <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                        <div className="relative">
                            <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input type="password" placeholder="••••••••" className="pl-9" {...field} />
                        </div>
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                    )}
                />
              </div>

              <Button type="submit" className="w-full" size="lg" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Daftar Sekarang
              </Button>
            </form>
          </Form>
        </CardContent>
        <CardFooter className="flex justify-center text-center">
          <div className="text-sm text-muted-foreground">
            Sudah punya akun?{" "}
            <Link to="/login" className="text-primary hover:underline font-medium">
              Masuk disini
            </Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
