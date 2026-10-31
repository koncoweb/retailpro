import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The marketplace search bar.
 *
 * A plain form so Enter on a phone keyboard submits; the page decides what
 * "submit" means (the home page opens the catalogue with the term, the
 * catalogue page filters in place).
 */
export function SearchField({
  value,
  onChange,
  onSubmit,
  placeholder = "Cari produk atau toko…",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.();
      }}
      className={cn(
        "flex h-10 items-center gap-2 rounded-full bg-surface px-3.5 shadow-[inset_0_0_0_1px_var(--color-line)]",
        className,
      )}
    >
      <Search className="size-4 shrink-0 text-muted" strokeWidth={1.9} />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-subtle"
      />
      <button
        type="submit"
        className="shrink-0 text-[12px] font-medium text-muted"
        aria-label="Cari"
      >
        Cari
      </button>
    </form>
  );
}
