import { cn } from "@/lib/utils";

/**
 * Storefront monogram.
 *
 * Drawn inline rather than shipped as a bitmap so it follows the theme tokens
 * (a PNG pair could not), and so the brand lives in one place the code owns.
 * The letter matches the wordmark next to it; the sellers themselves are named
 * on their own products and shop card, not in here.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      role="img"
      aria-label="Toko Bahan Kue"
      className={cn("shrink-0", className)}
    >
      <circle cx="24" cy="24" r="23.2" fill="var(--color-primary)" />
      <circle
        cx="24"
        cy="24"
        r="20.4"
        fill="none"
        stroke="var(--color-primary-fg)"
        strokeOpacity="0.35"
        strokeWidth="0.9"
      />
      <text
        x="24"
        y="32.5"
        textAnchor="middle"
        fontFamily="Bodoni Moda, Georgia, serif"
        fontSize="23"
        fontWeight="500"
        fill="var(--color-primary-fg)"
      >
        T
      </text>
    </svg>
  );
}
