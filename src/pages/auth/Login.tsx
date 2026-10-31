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
import { useTenant } from "@/contexts/TenantContext";
import { useQueryClient } from "@tanstack/react-query";

const loginSchema = z.object({
  email: z.string().email("Email tidak valid"),
  password: z.string().min(1, "Password wajib diisi"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function Login() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { bootstrap, clear } = useTenant();
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
      // A new identity must never inherit the previous tenant's in-memory token.
      clear();
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth-session" });

      const { error } = await authClient.signIn.email({
        email: data.email,
        password: data.password,
      });

      if (error) {
        toast.error(error.message || "Gagal login. Periksa email dan password Anda.");
        setIsLoading(false);
        return;
      }

      // Session is live; now resolve the company database and its token.
      const tenantSession = await bootstrap();
      queryClient.invalidateQueries({ queryKey: ["auth-session"] });

      if (!tenantSession) {
        toast.info("Akun ini belum memiliki perusahaan. Silakan daftarkan perusahaan Anda.");
        navigate("/register-tenant");
        return;
      }

      toast.success("Login berhasil");
      navigate("/mode-select");
    } catch (err) {
      console.error("Login error:", err);
      toast.error("Terjadi kesalahan sistem saat mencoba login");
      setIsLoading(false);
    }
  }

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
                    {/* The icon wrapper sits outside FormControl: FormControl is a
                        Slot, so it must receive the input itself to hand down the
                        id the label points at. */}
                    <div className="relative">
                      <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <FormControl>
                        <Input placeholder="nama@perusahaan.com" className="pl-9" {...field} />
                      </FormControl>
                    </div>
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
                    <div className="relative">
                      <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <FormControl>
                        <Input type="password" placeholder="••••••••" className="pl-9" {...field} />
                      </FormControl>
                    </div>
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
