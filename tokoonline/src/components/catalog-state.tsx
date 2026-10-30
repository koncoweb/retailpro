import { Button } from "@/components/ui/button";

/** Placeholder grid shown while the catalogue request is in flight. */
export function CatalogSkeleton({ tiles = 6 }: { tiles?: number }) {
  return (
    <section className="grid grid-cols-2 gap-x-2.5 gap-y-4" aria-hidden>
      {Array.from({ length: tiles }, (_, index) => (
        <div key={index} className="flex flex-col gap-1.5">
          <div className="aspect-square w-full animate-pulse rounded-md bg-surface" />
          <div className="h-3 w-3/4 animate-pulse rounded-full bg-surface" />
          <div className="h-3 w-1/3 animate-pulse rounded-full bg-surface" />
        </div>
      ))}
    </section>
  );
}

/**
 * Shown when the catalogue API cannot be reached. The message names the API the
 * shop depends on, because the fix is almost always "the backend is not up".
 */
export function CatalogError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-xl bg-surface px-4 py-5 shadow-[var(--shadow-border)]">
      <p className="font-display text-[17px]">Katalog belum tersambung</p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
        {message} Produk diambil langsung dari sistem toko, jadi katalog tidak
        bisa ditampilkan tanpa koneksi ke backend.
      </p>
      <Button variant="outline" className="mt-4" onClick={onRetry}>
        Coba lagi
      </Button>
    </div>
  );
}
