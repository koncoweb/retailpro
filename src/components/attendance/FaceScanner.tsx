import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Loader2, VideoOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  captureDescriptor,
  detectFaceWithDescriptor,
  loadFaceModels,
  type FaceSource,
} from "@/lib/face";
import { isSecureContext, type GeolocationErrorCode } from "@/lib/geolocation";

/** Box in source-pixel space, reported back for the parent to use if needed. */
export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FaceCapture {
  descriptor: Float32Array;
  box: FaceBox;
}

export interface FaceScannerHandle {
  /** A fresh descriptor from the current frame, or null when no face is up. */
  snapshot: () => Promise<FaceCapture | null>;
  /** True when the loop is currently locking onto a face. */
  hasLiveFace: () => boolean;
}

interface FaceScannerProps {
  /** Fired whenever a full sample is desired to change its prompt/label. */
  onStatus?: (status: { face: boolean; error: string | null }) => void;
  className?: string;
  /** Show the on-screen guidance text under the preview. */
  hint?: string;
}

/**
 * Webcam preview with a live face box and an imperative capture handle.
 *
 * Both the check-in and the enrollment screens need the same three things —
 * `getUserMedia`, a running detection loop that paints a box, and a way to pull
 * a descriptor on demand — so it lives here once instead of being retyped in
 * each page. The loop reuses one `detectFaceWithDescriptor` pass for the box and
 * the descriptor, so a "capture" never costs a second detection.
 *
 * `getUserMedia` needs a secure context, exactly like geolocation; on an insecure
 * origin the browser hides the API, so we surface a clear message rather than a
 * hanging spinner. The model weights load lazily on mount (~7 MB, cached after).
 */
export const FaceScanner = forwardRef<FaceScannerHandle, FaceScannerProps>(
  function FaceScanner({ onStatus, className, hint }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const lastDescriptor = useRef<Float32Array | null>(null);
    const lastBox = useRef<FaceBox | null>(null);

    const [phase, setPhase] = useState<"idle" | "starting" | "loading-models" | "live" | "error">(
      "idle"
    );
    const [error, setError] = useState<string | null>(null);
    const [box, setBox] = useState<FaceBox | null>(null);

    const report = useCallback(
      (face: boolean, message: string | null) => {
        onStatus?.({ face, error: message });
      },
      [onStatus]
    );

    const stop = useCallback(() => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      lastDescriptor.current = null;
      lastBox.current = null;
      setBox(null);
    }, []);

    const start = useCallback(async () => {
      setError(null);
      if (!isSecureContext()) {
        const message =
          "Kamera butuh HTTPS. Buka aplikasi lewat HTTPS (atau localhost), bukan alamat IP lokal.";
        setError(message);
        setPhase("error");
        report(false, message);
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        const message = "Perangkat atau browser ini tidak mendukung kamera.";
        setError(message);
        setPhase("error");
        report(false, message);
        return;
      }
      try {
        setPhase("starting");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setPhase("loading-models");
        try {
          await loadFaceModels();
        } catch (modelError) {
          const message =
            "Model pengenal wajah gagal dimuat. Periksa koneksi lalu coba lagi.";
          setError(message);
          setPhase("error");
          report(false, message);
          // eslint-disable-next-line no-console
          console.error("face model load failed", modelError);
          return;
        }
        setPhase("live");
        report(false, null);
      } catch (err) {
        const name = (err as { name?: string })?.name;
        const message =
          name === "NotAllowedError"
            ? "Izin kamera ditolak. Aktifkan izin kamera untuk aplikasi ini."
            : name === "NotFoundError"
              ? "Tidak ada kamera yang tersedia pada perangkat ini."
              : "Gagal mengakses kamera.";
        setError(message);
        setPhase("error");
        report(false, message);
      }
    }, [report]);

    useEffect(() => stop, [stop]);

    // Detection loop: cheap and self-throttled. Runs only while live.
    useEffect(() => {
      if (phase !== "live") return;
      let cancelled = false;
      let timer: ReturnType<typeof setTimeout>;

      const tick = async () => {
        const video = videoRef.current;
        if (!video || video.readyState < 2 || cancelled) {
          if (!cancelled) timer = setTimeout(tick, 250);
          return;
        }
        let face = false;
        try {
          const found = await detectFaceWithDescriptor(video);
          if (cancelled) return;
          if (found) {
            lastDescriptor.current = found.descriptor;
            lastBox.current = found.box;
            setBox(found.box);
            face = true;
          } else {
            lastDescriptor.current = null;
            lastBox.current = null;
            setBox(null);
          }
          report(face, null);
        } catch {
          // A single bad frame must not kill the loop; keep trying.
        }
        if (!cancelled) timer = setTimeout(tick, face ? 180 : 300);
      };

      void tick();
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }, [phase, report]);

    useImperativeHandle(
      ref,
      () => ({
        snapshot: async () => {
          const video = videoRef.current as FaceSource | null;
          if (!video) return null;
          // Prefer a fresh pass so the returned frame matches the box the user
          // saw; fall back to the last loop result if detection is momentarily
          // between frames.
          const found = await detectFaceWithDescriptor(video);
          if (found) {
            lastDescriptor.current = found.descriptor;
            lastBox.current = found.box;
            return found;
          }
          if (lastDescriptor.current && lastBox.current) {
            return { descriptor: lastDescriptor.current, box: lastBox.current };
          }
          return null;
        },
        hasLiveFace: () => lastDescriptor.current !== null,
      }),
      []
    );

    // Map source-pixel box to the rendered element via percentages, so it scales
    // with responsive video sizing without measuring the DOM.
    const video = videoRef.current;
    const vw = video && "videoWidth" in video ? video.videoWidth : 0;
    const vh = video && "videoHeight" in video ? video.videoHeight : 0;
    const style =
      box && vw && vh
        ? {
            left: `${(box.x / vw) * 100}%`,
            top: `${(box.y / vh) * 100}%`,
            width: `${(box.width / vw) * 100}%`,
            height: `${(box.height / vh) * 100}%`,
          }
        : undefined;

    return (
      <div className={className}>
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-black">
          <video
            ref={videoRef}
            playsInline
            muted
            className="h-full w-full object-cover"
          />
          {box && phase === "live" && style ? (
            <div
              className="pointer-events-none absolute rounded-lg border-2 border-success shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
              style={style}
            />
          ) : null}

          {phase !== "live" ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 p-4 text-center text-sm text-white">
              {phase === "error" ? (
                <>
                  <VideoOff className="h-8 w-8 text-destructive" />
                  <p className="max-w-xs">{error}</p>
                  <Button size="sm" variant="secondary" onClick={() => void start()}>
                    Coba lagi
                  </Button>
                </>
              ) : phase === "starting" || phase === "loading-models" ? (
                <>
                  <Loader2 className="h-8 w-8 animate-spin" />
                  <p>
                    {phase === "starting"
                      ? "Menyalakan kamera…"
                      : "Memuat model pengenalan wajah…"}
                  </p>
                </>
              ) : (
                <>
                  <VideoOff className="h-8 w-8" />
                  <p>Kamera belum aktif.</p>
                  <Button size="sm" onClick={() => void start()}>
                    Nyalakan Kamera
                  </Button>
                </>
              )}
            </div>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="absolute right-2 top-2 bg-black/40 text-white hover:bg-black/60"
              onClick={stop}
            >
              Matikan
            </Button>
          )}
        </div>
        {hint ? <p className="mt-2 text-sm text-muted-foreground">{hint}</p> : null}
      </div>
    );
  }
);

/** Re-export so callers can type a captured sample without importing the lib twice. */
export type { GeolocationErrorCode };
