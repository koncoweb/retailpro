import { useId } from "react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { PERMISSION_HINTS, PERMISSION_LABELS } from "@/config/roles";

interface PermissionRowProps {
  /** A key from `PERMISSION_CATALOG`; an unknown key still renders, unlabeled. */
  permission: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Read-only view of the matrix (a role the actor may not edit). */
  disabled?: boolean;
  /** Hide the explanation, for dense lists where the label is enough. */
  compact?: boolean;
  className?: string;
}

/**
 * One permission, explained, with a switch you can hit with a thumb.
 *
 * The row is the control, not the switch: the whole 44px-high strip is a
 * `<label>`, so tapping the words toggles it. That is the difference between a
 * matrix an owner can read on a phone and one they need a mouse for — and
 * because the label and the hint come out of the catalog, a permission cannot
 * be listed here without being described somewhere.
 */
export function PermissionRow({
  permission,
  checked,
  onCheckedChange,
  disabled = false,
  compact = false,
  className,
}: PermissionRowProps) {
  const id = useId();
  const hint = PERMISSION_HINTS[permission];

  return (
    <label
      htmlFor={id}
      className={cn(
        "flex min-h-11 cursor-pointer items-start justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/60",
        disabled && "cursor-default opacity-70 hover:bg-transparent",
        className
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium leading-5">
          {PERMISSION_LABELS[permission] ?? permission}
        </span>
        {!compact && hint && (
          <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">{hint}</span>
        )}
      </span>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        // The switch sits inside a `<label>`, so its own click would bubble up
        // and be counted twice — the toggle happens here, once.
        onCheckedChange={onCheckedChange}
        onClick={(event) => event.stopPropagation()}
        className="mt-0.5 shrink-0"
      />
    </label>
  );
}
