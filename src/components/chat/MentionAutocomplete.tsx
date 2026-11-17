import { AtSign, FileText, Package, ShoppingCart, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MentionKind } from "@/lib/chat-mentions";
import type { MentionSuggestion } from "@/lib/chat";

const TRIGGER_ICON = {
  user: AtSign,
  product: Package,
  invoice: FileText,
  po: ShoppingCart,
  vendor: Truck,
} as const;

interface MentionAutocompleteProps {
  visible: boolean;
  suggestions: MentionSuggestion[];
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (suggestion: MentionSuggestion) => void;
}

/**
 * The floating picker under the composer.
 *
 * It is deliberately presentational: the textarea keeps focus (so the caret and
 * arrow keys stay where the user is typing) while this panel only paints the
 * current match list and highlights `activeIndex`. Selection is driven by the
 * composer's key handler, not by a competing Command input that would steal the
 * caret from the mention token being typed.
 */
export function MentionAutocomplete({
  visible,
  suggestions,
  activeIndex,
  onHover,
  onSelect,
}: MentionAutocompleteProps) {
  if (!visible || suggestions.length === 0) return null;

  return (
    <div
      role="listbox"
      aria-label="Saran mention"
      className="absolute bottom-full left-3 z-20 mb-2 max-h-64 w-80 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {suggestions.map((s, i) => {
        const Icon = TRIGGER_ICON[s.kind as MentionKind] ?? AtSign;
        return (
          <button
            key={`${s.kind}-${s.entity_id}`}
            type="button"
            role="option"
            aria-selected={i === activeIndex}
            onMouseDown={(e) => {
              // mousedown (not click) so it lands before the textarea blurs.
              e.preventDefault();
              onSelect(s);
            }}
            onMouseEnter={() => onHover(i)}
            className={cn(
              "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none",
              i === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
            )}
          >
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-medium">{s.label}</span>
            {s.sublabel && (
              <span className="max-w-[7rem] shrink-0 truncate text-xs text-muted-foreground">
                {s.sublabel}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
