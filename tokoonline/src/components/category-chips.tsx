import type { CategoryInfo } from "@/lib/catalog";
import { cn } from "@/lib/utils";

export function CategoryChips({
  categories,
  value,
  onChange,
}: {
  categories: CategoryInfo[];
  /** Category name, or `all`. */
  value: string;
  onChange: (name: string) => void;
}) {
  // Names come from the tenant catalogue, so a category added in the back
  // office appears here without a code change.
  const chips = [
    { name: "all", label: "Semua", count: null as number | null },
    ...categories.map((category) => ({
      name: category.name,
      label: category.name,
      count: category.count,
    })),
  ];

  return (
    <div className="sticky top-14 z-20 -mx-4 bg-bg/88 px-4 py-2 backdrop-blur-md">
      <div className="flex gap-1.5 overflow-x-auto">
        {chips.map((chip) => (
          <button
            key={chip.name}
            type="button"
            onClick={() => onChange(chip.name)}
            className={cn(
              "h-8 shrink-0 rounded-full px-3 text-xs font-medium whitespace-nowrap transition-colors duration-150",
              value === chip.name
                ? "bg-primary text-primary-fg"
                : "bg-surface text-muted shadow-[inset_0_0_0_1px_var(--color-line)]",
            )}
          >
            {chip.label}
            {chip.count != null && (
              <span
                className={cn(
                  "ml-1.5 tabular-nums",
                  value === chip.name ? "opacity-70" : "text-subtle",
                )}
              >
                {chip.count}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
