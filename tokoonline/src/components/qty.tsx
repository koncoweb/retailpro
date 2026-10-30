import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export function Qty({
  value,
  onChange,
  min = 1,
  max = 20,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="inline-flex h-10 items-center rounded-[12px] bg-surface shadow-[inset_0_0_0_1px_var(--color-line)]">
      <button
        type="button"
        aria-label="Kurangi"
        className={cn(
          "grid size-10 place-items-center text-fg",
          value <= min && "opacity-30",
        )}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        <Minus className="size-3.5" strokeWidth={2} />
      </button>
      <span className="min-w-6 text-center text-sm font-medium tabular-nums">
        {value}
      </span>
      <button
        type="button"
        aria-label="Tambah"
        className={cn(
          "grid size-10 place-items-center text-fg",
          value >= max && "opacity-30",
        )}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        <Plus className="size-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}
