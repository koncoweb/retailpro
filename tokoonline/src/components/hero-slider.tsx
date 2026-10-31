import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export interface HeroSlide {
  id: string;
  /** Path under `public/`. The art carries the words, so there is no text layer. */
  src: string;
  /**
   * The words baked into the banner, transcribed. It is what a screen reader
   * announces and what a visitor sees if the image fails to load.
   */
  alt: string;
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
 *
 * Every banner is a doorway into the catalogue: the picture is the message, the
 * tap has to lead somewhere.
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
        {slides.map((slide, index) => (
          <Link
            key={slide.id}
            to="/katalog"
            className="relative aspect-[16/9] w-full shrink-0 snap-center overflow-hidden rounded-xl bg-surface shadow-[var(--shadow-border)]"
          >
            <img
              src={slide.src}
              alt={slide.alt}
              // The first banner is the largest paint on the page; the rest can
              // arrive while the reader is still on slide one.
              loading={index === 0 ? "eager" : "lazy"}
              fetchPriority={index === 0 ? "high" : "auto"}
              decoding="async"
              className="size-full object-cover"
            />
          </Link>
        ))}
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
