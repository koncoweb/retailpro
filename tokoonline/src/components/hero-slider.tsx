import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface HeroSlide {
  id: string;
  /** Small line above the title, e.g. "Toko Bahan Kue". */
  kicker: string;
  title: string;
  body: string;
  icon: LucideIcon;
}

const AUTOPLAY_MS = 5200;

/**
 * The banner row at the top of the marketplace.
 *
 * Built on native scroll-snap rather than a carousel library: on a phone the
 * swipe is then the browser's own momentum scroll (no gesture re-implementation,
 * no extra bytes), the slides stay reachable with a keyboard or screen reader,
 * and the dots below remain the only custom chrome.
 *
 * Autoplay stops for good on the first touch/drag and never starts when the
 * visitor asked for reduced motion, so the banner cannot fight the reader.
 */
export function HeroSlider({ slides, className }: { slides: HeroSlide[]; className?: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [autoplay, setAutoplay] = useState(true);

  useEffect(() => {
    if (!autoplay || slides.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const timer = window.setInterval(() => {
      const element = scroller.current;
      if (!element || document.hidden) return;
      const next = (active + 1) % slides.length;
      scrollTo(element, next);
    }, AUTOPLAY_MS);
    return () => window.clearInterval(timer);
  }, [active, autoplay, slides.length]);

  // The active dot follows the scroll position, so a manual swipe and the
  // autoplay timer cannot disagree about which slide is showing.
  function onScroll() {
    const element = scroller.current;
    if (!element) return;
    const box = element.getBoundingClientRect();
    const centre = box.left + element.clientWidth / 2;
    const children = Array.from(element.children) as HTMLElement[];
    let nearest = 0;
    let distance = Number.POSITIVE_INFINITY;
    children.forEach((child, index) => {
      const slot = child.getBoundingClientRect();
      const gap = Math.abs(slot.left + slot.width / 2 - centre);
      if (gap < distance) {
        distance = gap;
        nearest = index;
      }
    });
    setActive(nearest);
  }

  function scrollTo(element: HTMLDivElement, index: number) {
    const child = element.children[index] as HTMLElement | undefined;
    if (!child) return;
    // Rect-relative offset: correct whatever the scroll container's offsetParent
    // is, and it includes the gap between slides.
    const delta =
      child.getBoundingClientRect().left - element.getBoundingClientRect().left;
    element.scrollTo({ left: element.scrollLeft + delta, behavior: "smooth" });
  }

  return (
    <section className={cn("flex flex-col gap-2", className)} aria-label="Promo">
      <div
        ref={scroller}
        onScroll={onScroll}
        onPointerDown={() => setAutoplay(false)}
        onTouchStart={() => setAutoplay(false)}
        className="relative flex snap-x snap-mandatory gap-2.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((slide) => {
          const Icon = slide.icon;
          return (
            <article
              key={slide.id}
              className="relative flex h-[132px] w-full shrink-0 snap-center flex-col justify-end overflow-hidden rounded-xl bg-surface px-4 py-3.5 shadow-[var(--shadow-border)]"
            >
              <Icon
                aria-hidden
                className="absolute -top-3 -right-3 size-28 text-fg/5"
                strokeWidth={0.9}
              />
              <div
                aria-hidden
                className="absolute inset-y-0 left-0 w-1 bg-primary/70"
              />
              <p className="text-[10px] font-medium tracking-[0.18em] text-muted uppercase">
                {slide.kicker}
              </p>
              <h2 className="font-display mt-1 text-[22px] leading-[1.1] font-medium text-fg">
                {slide.title}
              </h2>
              <p className="mt-1 line-clamp-2 max-w-[26ch] text-[12px] leading-relaxed text-muted">
                {slide.body}
              </p>
            </article>
          );
        })}
      </div>

      {slides.length > 1 && (
        <div className="flex items-center justify-center gap-1.5">
          {slides.map((slide, index) => (
            <button
              key={slide.id}
              type="button"
              aria-label={`Slide ${index + 1}`}
              aria-current={index === active}
              onClick={() => {
                setAutoplay(false);
                if (scroller.current) scrollTo(scroller.current, index);
              }}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300",
                index === active ? "w-5 bg-primary" : "w-1.5 bg-subtle/60",
              )}
            />
          ))}
        </div>
      )}
    </section>
  );
}
