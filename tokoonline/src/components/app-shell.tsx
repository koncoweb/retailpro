import type { ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Home,
  LayoutGrid,
  MessageCircle,
  Moon,
  ShoppingBag,
  Sun,
  User,
} from "lucide-react";
import { LogoMark } from "./logo";
import { cn } from "@/lib/utils";
import { cartCount, useShop } from "@/lib/store";

const NAV = [
  { to: "/", label: "Beranda", icon: Home, match: (p: string) => p === "/" },
  {
    to: "/katalog",
    label: "Katalog",
    icon: LayoutGrid,
    match: (p: string) => p.startsWith("/katalog") || p.startsWith("/product"),
  },
  {
    to: "/cart",
    label: "Keranjang",
    icon: ShoppingBag,
    match: (p: string) => p.startsWith("/cart") || p.startsWith("/checkout"),
  },
  {
    to: "/chat",
    label: "Chat",
    icon: MessageCircle,
    match: (p: string) => p.startsWith("/chat"),
  },
  {
    to: "/info",
    label: "Info",
    icon: User,
    match: (p: string) =>
      p.startsWith("/info") || p.startsWith("/orders") || p.startsWith("/order"),
  },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const theme = useShop((s) => s.theme);
  const toggleTheme = useShop((s) => s.toggleTheme);
  const cart = useShop((s) => s.cart);
  const count = cartCount(cart);
  const hideNav =
    path.startsWith("/checkout") || path.startsWith("/product/");

  return (
    <div className="min-h-dvh bg-frame">
      <div className="relative mx-auto flex min-h-dvh w-full max-w-[430px] flex-col bg-bg md:shadow-[0_0_0_1px_rgba(42,33,28,0.08),0_24px_80px_-24px_rgba(42,33,28,0.35)]">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 bg-bg/88 px-4 backdrop-blur-md">
          <Link to="/" className="flex min-w-0 items-center gap-2.5">
            <LogoMark className="size-9" />
            <span className="font-display text-[17px] font-medium tracking-[0.18em] text-fg">
              THALIA
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-0.5">
            <button
              type="button"
              aria-label={theme === "dark" ? "Mode terang" : "Mode gelap"}
              onClick={toggleTheme}
              className="grid size-11 place-items-center text-fg"
            >
              {theme === "dark" ? (
                <Sun className="size-5" strokeWidth={1.75} />
              ) : (
                <Moon className="size-5" strokeWidth={1.75} />
              )}
            </button>
            <Link
              to="/cart"
              aria-label="Keranjang"
              className="relative grid size-11 place-items-center text-fg"
            >
              <ShoppingBag className="size-5" strokeWidth={1.75} />
              {count > 0 && (
                <span className="absolute top-2 right-1.5 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] leading-4 font-medium text-primary-fg tabular-nums">
                  {count}
                </span>
              )}
            </Link>
          </div>
        </header>

        <main className={cn("flex min-h-0 flex-1 flex-col", !hideNav && "pb-24")}>
          {children}
        </main>

        {!hideNav && (
          <nav
            className="fixed bottom-0 left-1/2 z-30 w-full max-w-[430px] -translate-x-1/2 border-t border-line bg-bg/92 backdrop-blur-md"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <ul className="grid grid-cols-5 px-1 pt-1 pb-1">
              {NAV.map((item) => {
                const active = item.match(path);
                const Icon = item.icon;
                return (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      className={cn(
                        "flex flex-col items-center gap-0.5 py-2 text-[11px] tracking-wide",
                        active ? "text-fg" : "text-muted",
                      )}
                    >
                      <span className="relative">
                        <Icon
                          className="size-5"
                          strokeWidth={active ? 2.1 : 1.6}
                        />
                        {item.to === "/cart" && count > 0 && (
                          <span className="absolute -top-1 -right-1.5 size-1.5 rounded-full bg-accent" />
                        )}
                      </span>
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}
      </div>
    </div>
  );
}
