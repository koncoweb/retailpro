import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, UserPlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { searchUsers } from "@/lib/chat";
import { useOpenDM } from "@/hooks/use-chat";

interface AddDmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpened: (conversationId: string) => void;
}

/**
 * Start (or resume) a direct message with one person.
 *
 * Opening is idempotent: `getOrCreateDM` collapses onto the unique `dm_key`, so
 * re-picking someone you already chat with just returns the existing thread
 * rather than creating a second DM. Because there is no per-row security, this
 * is a convenience to reach a colleague, not a way into private data.
 */
export function AddDmDialog({ open, onOpenChange, onOpened }: AddDmDialogProps) {
  const [query, setQuery] = useState("");
  const openDM = useOpenDM(onOpened);

  const results = useQuery({
    queryKey: ["chat", "user-search", query],
    enabled: open,
    queryFn: () => searchUsers(query),
    staleTime: 30_000,
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pesan pribadi</DialogTitle>
          <DialogDescription>Pilih rekan untuk memulai percakapan satu-satu.</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Input
            autoFocus
            value={query}
            placeholder="Cari nama atau email…"
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && results.isLoading && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>

        <div className="-mx-1 max-h-72 overflow-y-auto">
          {(results.data ?? []).map((s) => (
            <button
              key={s.entity_id}
              type="button"
              disabled={openDM.isPending}
              onClick={() => {
                openDM.mutate(s.entity_id, { onSettled: () => onOpenChange(false) });
              }}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-accent disabled:opacity-60"
            >
              <UserPlus className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-medium">{s.label}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{s.sublabel}</span>
            </button>
          ))}
          {!results.isLoading && (results.data ?? []).length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Tidak ada karyawan yang cocok.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
