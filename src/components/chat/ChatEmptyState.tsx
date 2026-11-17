import { MessagesSquare } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The calm placeholder when nothing is open yet — and, via `skeleton`, the list
 * loading shape. Copy stays Indonesian to match the rest of the app and frames
 * chat as internal coordination rather than a private channel (there is no
 * row-level security on tenant data — see docs/spec-chat-internal.md).
 */
export function ChatEmptyState({
  title = "Pilih percakapan",
  description = "Pilih channel atau pesan pribadi di kiri untuk mulai membaca dan membalas.",
  skeleton = false,
}: {
  title?: string;
  description?: string;
  skeleton?: boolean;
}) {
  if (skeleton) {
    return (
      <div className="space-y-3 p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
        <MessagesSquare className="h-7 w-7 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
