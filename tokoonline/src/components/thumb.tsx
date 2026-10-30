import { cn } from "@/lib/utils";

/** Two letters from the product name: "Tepung Terigu Cakra" -> "TT". */
function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Product artwork.
 *
 * The tenant catalogue carries no photos (staff never upload them), so instead
 * of a broken image every tile falls back to a typographic mark built from the
 * product's own name. When a product does gain an image URL in the API, that
 * wins and nothing else changes.
 */
export function Thumb({
  name,
  label,
  image,
  variant = "card",
  className,
}: {
  name: string;
  label?: string | null;
  image?: string | null;
  variant?: "card" | "hero";
  className?: string;
}) {
  if (image) {
    return (
      <img
        src={image}
        alt={name}
        className={cn("size-full object-cover", className)}
      />
    );
  }

  return (
    <div
      className={cn(
        "relative grid place-items-center overflow-hidden bg-surface",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute -right-2 -bottom-5 font-display leading-none text-fg/5 select-none",
          variant === "hero" ? "text-[190px]" : "text-[86px]",
        )}
      >
        {initials(name)}
      </span>
      <span
        className={cn(
          "font-display relative text-muted",
          variant === "hero" ? "text-[64px]" : "text-[26px]",
        )}
      >
        {initials(name)}
      </span>
      {label && (
        <span className="absolute bottom-3 left-3 right-3 truncate text-[10px] tracking-[0.14em] text-subtle uppercase">
          {label}
        </span>
      )}
    </div>
  );
}
