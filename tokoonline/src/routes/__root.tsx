import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { AppShell } from "@/components/app-shell";
import { Toaster } from "sonner";
import appCss from "../styles.css?url";

const APP_NAME = "Thalia";

const THEME_BOOT = `try{var t=localStorage.getItem('thalia-storefront');if(t){var p=JSON.parse(t);if(p&&p.state&&p.state.theme==='dark')document.documentElement.classList.add('dark')}}catch(e){}`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1",
      },
      { title: APP_NAME },
      {
        name: "description",
        content:
          "Thalia — Toko Bahan Kue. Bahan kue, cokelat, kemasan, dan perlengkapan dapur, dikirim dari toko pusat Depok.",
      },
      { name: "theme-color", content: "#F4EBE4" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,opsz,wght@0,6..96,400;0,6..96,500;0,6..96,600;1,6..96,500&family=Outfit:wght@300;400;500;600&display=swap",
      },
    ],
  }),
  component: Root,
});

function Root() {
  return (
    <html lang="id" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="antialiased">
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        <PreviewHostBridge />
        <AuthProvider>
          <AppShell>
            <Outlet />
          </AppShell>
          <Toaster
            position="top-center"
            toastOptions={{
              className:
                "!bg-surface !text-fg !border-0 !shadow-[var(--shadow-border)] !font-[Outfit,sans-serif]",
            }}
          />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  );
}
