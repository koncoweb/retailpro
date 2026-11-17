import { useNavigate } from "react-router-dom";
import { FileText, Package, ShoppingCart, Truck, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { entityRoute, type MentionPayload } from "@/lib/chat-mentions";
import { Badge } from "@/components/ui/badge";

/** The icon each `#` entity kind reads as, matching the sidebar's own cues. */
const KIND_ICON = {
  product: Package,
  invoice: FileText,
  po: ShoppingCart,
  vendor: Truck,
  user: User,
} as const;

interface MentionChipProps {
  mention: MentionPayload;
  /** A person mention of the viewer is tinted so "@me" stands out. */
  isCurrentUser?: boolean;
}

/**
 * One rendered mention.
 *
 * The visible text is always the stored snapshot `label`, so a chip still reads
 * correctly even if the row behind it was renamed or deleted. An entity chip is
 * a button that deep-links to that record; a person chip is inert highlight —
 * the chat has no profile route to send a person to.
 */
export function MentionChip({ mention, isCurrentUser = false }: MentionChipProps) {
  const navigate = useNavigate();
  const route = mention.entity_id ? entityRoute(mention.kind, mention.entity_id) : null;
  const Icon = KIND_ICON[mention.kind] ?? User;

  if (mention.kind === "user") {
    return (
      <span
        className={cn(
          "mx-0.5 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-sm font-medium align-baseline",
          isCurrentUser ? "bg-primary/15 text-primary" : "bg-muted text-foreground"
        )}
      >
        <User className="h-3.5 w-3.5" />
        {mention.label}
      </span>
    );
  }

  const clickable = Boolean(route);
  return (
    <Badge
      variant="secondary"
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? () => navigate(route as string) : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                navigate(route as string);
              }
            }
          : undefined
      }
      className={cn(
        "mx-0.5 gap-1 border font-normal",
        clickable
          ? "cursor-pointer border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
          : "border-transparent bg-muted text-muted-foreground"
      )}
      title={clickable ? "Buka detail" : "Referensi (data sudah tidak ada)"}
    >
      <Icon className="h-3 w-3" />
      {mention.label}
    </Badge>
  );
}
