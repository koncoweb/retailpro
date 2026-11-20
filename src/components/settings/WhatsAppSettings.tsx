import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  LogOut,
  RefreshCw,
  Smartphone,
  Unlink,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

/** One GOWA device slot, as projected by `GET /api/tenant/whatsapp-device`. */
interface WaDevice {
  id: string;
  name: string;
  state: string;
  jid: string;
  isConnected: boolean;
  isLoggedIn: boolean;
  phone: string | null;
}

interface WaOverview {
  configured: boolean;
  sendEnabled: boolean;
  serverHost: string;
  devices: WaDevice[];
  activeDeviceId: string | null;
  error: string | null;
}

interface QrState {
  dataUrl: string;
  deviceId: string;
}

/** While a QR is on screen the owner is scanning, so keep the status fresh. */
const STATUS_POLL_MS = 3000;

/** `6281999824806` → `+62 819-9982-4806`; anything odd is shown as-is. */
function formatSender(phone: string | null): string {
  if (!phone) return "belum tertaut";
  const match = /^62(\d{3})(\d{3,4})(\d{2,6})$/.exec(phone);
  if (!match) return `+${phone}`;
  return `+62 ${match[1]}-${match[2]}-${match[3]}`;
}

async function readError(response: Response, fallback: string): Promise<string> {
  const detail = (await response.json().catch(() => null)) as { message?: string } | null;
  return detail?.message || fallback;
}

export function WhatsAppSettings() {
  const [overview, setOverview] = useState<WaOverview | null>(null);
  const [deviceChoice, setDeviceChoice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"" | "qr" | "logout" | "reconnect">("");

  const [qr, setQr] = useState<QrState | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const expiresAt = useRef(0);
  /** Guards the auto-refresh so one in-flight QR request can never stack. */
  const requestingQr = useRef(false);
  /** Null until the first read, so a page load is never reported as a scan. */
  const loggedInRef = useRef<boolean | null>(null);

  const activeDevice =
    overview?.devices.find((device) => device.id === (deviceChoice ?? overview?.activeDeviceId)) ??
    overview?.devices[0] ??
    null;

  const loadOverview = useCallback(async (quiet = false) => {
    try {
      const response = await fetch(`${apiBase}/api/tenant/whatsapp-device`, { credentials: "include" });
      if (!response.ok) throw new Error(await readError(response, "Gagal memuat status WhatsApp"));
      const data = (await response.json()) as WaOverview;
      const wasLoggedIn = loggedInRef.current;
      const isLoggedIn = data.devices.some((device) => device.isLoggedIn);
      loggedInRef.current = isLoggedIn;
      setOverview(data);
      // The scan just landed: stop refreshing QR codes and tell the owner. The
      // first read only records the state — nothing was scanned by the owner.
      if (isLoggedIn && wasLoggedIn === false) {
        const phone = data.devices.find((device) => device.isLoggedIn)?.phone ?? null;
        setQr(null);
        toast.success(`Nomor ${formatSender(phone)} berhasil ditautkan`);
      }
    } catch (error) {
      if (!quiet) toast.error(error instanceof Error ? error.message : "Gagal memuat status WhatsApp");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  // Poll only while a QR is on screen; otherwise the owner presses Perbarui.
  useEffect(() => {
    if (!qr) return;
    const timer = window.setInterval(() => void loadOverview(true), STATUS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [qr, loadOverview]);

  const showQr = useCallback(async (deviceId: string | null, quiet = false) => {
    if (requestingQr.current) return;
    requestingQr.current = true;
    if (!quiet) setBusy("qr");
    try {
      const response = await fetch(`${apiBase}/api/tenant/whatsapp-device`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "qr", deviceId }),
      });
      if (!response.ok) throw new Error(await readError(response, "Gagal meminta QR ke server WhatsApp"));
      const data = (await response.json()) as { qrDataUrl: string; deviceId: string; expiresIn: number };
      setQr({ dataUrl: data.qrDataUrl, deviceId: data.deviceId });
      const seconds = Number(data.expiresIn) > 0 ? Number(data.expiresIn) : 30;
      expiresAt.current = Date.now() + seconds * 1000;
      setSecondsLeft(seconds);
    } catch (error) {
      setQr(null);
      toast.error(error instanceof Error ? error.message : "Gagal meminta QR ke server WhatsApp");
    } finally {
      requestingQr.current = false;
      if (!quiet) setBusy("");
    }
  }, []);

  // WhatsApp rotates the code roughly every 30 seconds; a stale one is scanned
  // and silently rejected, so replace it the moment the countdown runs out.
  useEffect(() => {
    if (!qr) return;
    const timer = window.setInterval(() => {
      const left = Math.max(0, Math.round((expiresAt.current - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) void showQr(qr.deviceId, true);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [qr, showQr]);

  const runAction = useCallback(
    async (action: "logout" | "reconnect") => {
      if (!activeDevice) return;
      setBusy(action);
      try {
        const response = await fetch(`${apiBase}/api/tenant/whatsapp-device`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, deviceId: activeDevice.id }),
        });
        if (!response.ok) throw new Error(await readError(response, "Aksi gagal"));
        toast.success(action === "logout" ? "Sambungan WhatsApp diputus" : "Menyambungkan ulang, tunggu sebentar");
        await loadOverview(true);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Aksi gagal");
      } finally {
        setBusy("");
      }
    },
    [activeDevice, loadOverview]
  );

  if (loading) {
    return (
      <div className="bg-card rounded-xl border p-6 flex items-center gap-3 text-sm text-muted-foreground animate-fade-in">
        <Loader2 className="w-4 h-4 animate-spin" />
        Memuat status WhatsApp…
      </div>
    );
  }

  const configured = overview?.configured ?? false;
  const unreachable = Boolean(overview?.error);
  const linked = Boolean(activeDevice?.isLoggedIn);
  const devices = overview?.devices ?? [];

  return (
    <div className="bg-card rounded-xl border p-4 md:p-6 space-y-4 md:space-y-6 animate-fade-in">
      <div className="flex items-center gap-3 pb-4 border-b">
        <div className={cn("p-2.5 rounded-lg", linked ? "bg-success/10" : "bg-primary/10")}>
          <Smartphone className={cn("w-5 h-5", linked ? "text-success" : "text-primary")} />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold">Nomor Pengirim WhatsApp</h3>
          <p className="text-sm text-muted-foreground">
            Nomor yang dipakai toko untuk mengirim invoice ke pelanggan
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void loadOverview()} className="gap-2">
          <RefreshCw className="w-3.5 h-3.5" />
          Perbarui
        </Button>
      </div>

      {!configured && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Server WhatsApp belum dikonfigurasi</AlertTitle>
          <AlertDescription>
            Isi <code>GOWA_URL</code>, <code>GOWA_USERNAME</code>, dan <code>GOWA_PASSWORD</code>{" "}
            pada lingkungan server (Vercel / <code>.env</code>) dulu, lalu buka lagi halaman ini.
          </AlertDescription>
        </Alert>
      )}

      {configured && unreachable && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Server WhatsApp tidak terjangkau</AlertTitle>
          <AlertDescription className="break-all">{overview?.error}</AlertDescription>
        </Alert>
      )}

      {configured && !unreachable && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Status perangkat</p>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                    linked ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
                  )}
                >
                  {linked ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Unlink className="w-3.5 h-3.5" />}
                  {linked ? "Tertaut" : "Belum tertaut"}
                </span>
                <span className="font-medium">{formatSender(activeDevice?.phone ?? null)}</span>
                {!linked && activeDevice?.isConnected ? (
                  <span className="text-xs text-muted-foreground">(sambungan sedang dipulihkan)</span>
                ) : null}
              </div>
              {devices.length > 1 ? (
                <div className="flex items-center gap-2 pt-1">
                  <Select
                    value={activeDevice?.id ?? ""}
                    onValueChange={(value) => {
                      setDeviceChoice(value);
                      setQr(null);
                    }}
                  >
                    <SelectTrigger className="h-8 w-[16rem] text-xs">
                      <SelectValue placeholder="Pilih perangkat" />
                    </SelectTrigger>
                    <SelectContent>
                      {devices.map((device) => (
                        <SelectItem key={device.id} value={device.id} className="text-xs">
                          {formatSender(device.phone)} · {device.isLoggedIn ? "tertaut" : "kosong"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {linked ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    disabled={busy !== ""}
                    onClick={() => void showQr(activeDevice?.id ?? null)}
                  >
                    {busy === "qr" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    Pindai ulang
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 text-destructive"
                    disabled={busy !== ""}
                    onClick={() => void runAction("logout")}
                  >
                    {busy === "logout" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
                    Putuskan
                  </Button>
                </>
              ) : (
                <Button size="sm" className="gap-2" disabled={busy !== ""} onClick={() => void showQr(activeDevice?.id ?? null)}>
                  {busy === "qr" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Smartphone className="w-3.5 h-3.5" />}
                  Tampilkan QR
                </Button>
              )}
              {!linked && devices.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-2"
                  disabled={busy !== ""}
                  onClick={() => void runAction("reconnect")}
                >
                  {busy === "reconnect" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  Sambungkan ulang
                </Button>
              )}
            </div>
          </div>

          {qr ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-4 md:p-6">
              <div className="rounded-lg bg-white p-3 shadow-sm">
                <img
                  src={qr.dataUrl}
                  alt="QR kode untuk menautkan perangkat WhatsApp"
                  className="h-52 w-52 [image-rendering:pixelated]"
                />
              </div>
              <p className="text-sm text-muted-foreground tabular-nums">
                QR berlaku {secondsLeft} detik — otomatis diperbarui
              </p>
              <ol className="w-full max-w-md space-y-1.5 text-sm">
                <li className="flex gap-2">
                  <span className="text-muted-foreground">1.</span> Di ponsel, buka WhatsApp
                </li>
                <li className="flex gap-2">
                  <span className="text-muted-foreground">2.</span> Setelan → <b>Perangkat tertaut</b> →{" "}
                  <b>Tautkan perangkat</b>
                </li>
                <li className="flex gap-2">
                  <span className="text-muted-foreground">3.</span> Arahkan kamera ke QR di atas, lalu tunggu
                  statusnya berubah menjadi <b>Tertaut</b>
                </li>
              </ol>
              <Button variant="ghost" size="sm" onClick={() => setQr(null)}>
                Tutup QR
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {linked
                ? "Nomor ini sudah tertaut. Pindai ulang hanya bila ingin menggantinya dengan nomor lain."
                : "Tekan Tampilkan QR, lalu pindai dengan ponsel yang memegang nomor pengirim."}
            </p>
          )}

          {!overview?.sendEnabled && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>Pengiriman invoice masih mati</AlertTitle>
              <AlertDescription>
                Perangkat bisa ditautkan sekarang, tapi invoice baru terkirim setelah{" "}
                <code>WHATSAPP_INVOICE_ENABLED=true</code> di lingkungan server.
              </AlertDescription>
            </Alert>
          )}
        </>
      )}
    </div>
  );
}
