import { Link } from "@tanstack/react-router";
import { categoryIcon } from "@/lib/category-icons";
import type { CategoryInfo } from "@/lib/catalog";
import { cn } from "@/lib/utils";

/**
 * The category row under the banner: one monochrome icon per category.
 *
 * Names come from the tenants themselves, so a category a seller adds in their
 * back office appears here on the next load with no code change; the icon is
 * resolved from the name by keyword (see `lib/category-icons.ts`). Every tile
 * draws its icon in the same colour and stroke — the row is a signpost, not a
 * rainbow.
 */
export function CategoryGrid({
  categories,
  className,
}: {
  categories: CategoryInfo[];
  className?: string;
}) {
  if (categories.length === 0) return null;

  return (
    <nav
      aria-label="Kategori produk"
      className={cn(
        "rounded-xl bg-surface px-1.5 py-3 shadow-[var(--shadow-border)]",
        className,
      )}
    >
      <ul className="grid grid-cols-4 gap-y-3">
        {categories.map((category) => {
          const Icon = categoryIcon(category.name);
          return (
            <li key={category.name}>
              <Link
                to="/katalog"
                search={{ kategori: category.name }}
                className="flex flex-col items-center gap-1.5 px-1 text-center"
              >
                <span className="grid size-11 place-items-center rounded-full bg-bg text-fg">
                  <Icon className="size-[21px]" strokeWidth={1.5} />
                </span>
                <span className="line-clamp-2 text-[11px] leading-tight text-muted">
                  {category.name}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
