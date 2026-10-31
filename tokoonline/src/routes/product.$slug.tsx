import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { CatalogError, CatalogSkeleton } from "@/components/catalog-state";
import { useMarketplace } from "@/lib/catalog";

/**
 * The product URL used to be `/product/<slug>` when the shop was one tenant's
 * window. A slug is only unique inside a shop, so the seller became part of the
 * path: `/product/<tenant>/<slug>`. Links handed out under the old shape (chat
 * messages, WhatsApp, order notes) still arrive here, so this route looks the
 * slug up across the marketplace and forwards to the real page instead of
 * greeting the shopper with a 404.
 *
 * A slug two shops happen to share resolves to whichever seller comes first —
 * still the right product, never the wrong page.
 */
export const Route = createFileRoute("/product/$slug")({
  component: LegacyProductRedirect,
});

function LegacyProductRedirect() {
  const { slug } = Route.useParams();
  const { state, reload } = useMarketplace();
  const navigate = useNavigate();

  useEffect(() => {
    if (state.status === "loading") return;
    const match =
      state.status === "ready"
        ? state.marketplace.products.find((product) => product.slug === slug)
        : null;
    if (match) {
      navigate({
        to: "/product/$tenant/$slug",
        params: { tenant: match.tenant, slug: match.slug },
        replace: true,
      });
      return;
    }
    // Nothing matches any more: land on the catalogue with the old slug as the
    // search term, which is the closest thing to what the visitor asked for.
    navigate({ to: "/katalog", search: { q: slug }, replace: true });
  }, [state, slug, navigate]);

  if (state.status === "error") {
    return (
      <div className="px-4 pt-4">
        <CatalogError message={state.message} onRetry={reload} />
      </div>
    );
  }

  return (
    <div className="px-4 pt-4">
      <CatalogSkeleton tiles={2} />
    </div>
  );
}
