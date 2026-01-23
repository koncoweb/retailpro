import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Link, useNavigate } from "react-router-dom";
import { Store, Loader2, Lock, Mail } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

import { authClient } from "@/lib/auth-client";

const loginSchema = z.object({
  email: z.string().email("Email tidak valid"),
  password: z.string().min(1, "Password wajib diisi"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function Login() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  async function onSubmit(data: LoginFormValues) {
    setIsLoading(true);
    
    try {
      // Attempt Neon Auth Login
      const { data: session, error } = await authClient.signIn.email({
        email: data.email,
        password: data.password,
      });

      if (error) {
        // If we are in dev mode and no Auth URL is set, fall back to mock for demonstration
        if (import.meta.env.DEV && !import.meta.env.VITE_NEON_AUTH_URL) {
           console.warn("Neon Auth not configured, using mock login");
           mockLogin(data.email);
           return;
        }
        toast.error(error.message || "Gagal login. Periksa email dan password Anda.");
        setIsLoading(false);
        return;
      }

      // Success
      toast.success("Login berhasil");
      
      // Redirect logic based on role would ideally come from session data
      // For now we redirect to a central dashboard or check session
      // const userRole = session.user.role; 
      // But standard better-auth might not have role on sign-in response immediately without plugin
      
      // We will fetch session to be sure or just redirect to mode-select/dashboard
      navigate("/mode-select");
      
    } catch (err) {
      console.error("Login error:", err);
      // Fallback to mock if network error in dev
      if (import.meta.env.DEV) {
          mockLogin(data.email);
      } else {
          toast.error("Terjadi kesalahan sistem");
          setIsLoading(false);
      }
    }
  }

  const mockLogin = (email: string) => {
      // Mock Login Logic (Original)
      setTimeout(() => {
        setIsLoading(false);
        if (email.includes("admin")) {
          toast.success("Login berhasil sebagai Tenant Admin (Mock)");
          navigate("/backoffice");
        } else if (email.includes("kasir")) {
          toast.success("Login berhasil sebagai Kasir (Mock)");
          navigate("/pos");
        } else if (email.includes("super")) {
          toast.success("Login berhasil sebagai Super Admin (Mock)");
          navigate("/admin/dashboard");
        } else {
          toast.success("Login berhasil (Mock)");
          navigate("/backoffice");
        }
      }, 1000);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-center mb-4">
            <div className="w-12 h-12 rounded-xl gradient-primary flex items-center justify-center">
              <Store className="w-6 h-6 text-primary-foreground" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold">Selamat Datang</CardTitle>
          <CardDescription>
            Masuk ke RetailPro untuk mengelola bisnis Anda
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="nama@perusahaan.com" className="pl-9" {...field} />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                        <FormLabel>Password</FormLabel>
                        <Link 
                            to="/forgot-password" 
                            className="text-sm font-medium text-primary hover:underline"
                        >
                            Lupa password?
                        </Link>
                    </div>
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
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Masuk
              </Button>
            </form>
          </Form>
        </CardContent>
        <CardFooter className="flex flex-col gap-4 text-center">
          <div className="text-sm text-muted-foreground">
            Belum punya akun?{" "}
            <Link to="/register-tenant" className="text-primary hover:underline font-medium">
              Daftarkan Tenant Baru
            </Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
