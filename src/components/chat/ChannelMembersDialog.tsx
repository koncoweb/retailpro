import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Crown, Loader2, UserPlus, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { searchUsers, type ChatConversation } from "@/lib/chat";
import { useChannelMembers } from "@/hooks/use-chat";
import { initials } from "@/components/chat/chat-utils";

interface ChannelMembersDialogProps {
  conversation: ChatConversation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Add people to a channel or take them back out.
 *
 * Removal is offered to everyone but the channel owner — the person recorded as
 * `member_role='owner'` is the one who can archive the channel, so the write
 * layer also refuses to delete that row. Membership here is a visibility rule,
 * not a security boundary (there is no row-level security on tenant data).
 */
export function ChannelMembersDialog({ conversation, open, onOpenChange }: ChannelMembersDialogProps) {
  const [query, setQuery] = useState("");
  const members = useChannelMembers(conversation.id);

  const results = useQuery({
    queryKey: ["chat", "user-search", query],
    enabled: open && query.trim().length > 0,
    queryFn: () => searchUsers(query),
    staleTime: 30_000,
  });

  const existing = new Set(conversation.members.map((m) => m.user_id));
  const addable = (results.data ?? []).filter((s) => !existing.has(s.entity_id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Kelola anggota</DialogTitle>
          <DialogDescription>#{conversation.name}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <div className="relative">
            <Input
              value={query}
              placeholder="Cari nama atau email untuk menambah…"
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && results.isLoading && (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>
          {addable.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-md border">
              {addable.map((s) => (
                <button
                  key={s.entity_id}
                  type="button"
                  disabled={members.isPending}
                  onClick={() => members.mutate({ add: [s.entity_id] })}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-60"
                >
                  <UserPlus className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{s.sublabel}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="-mx-1 max-h-64 space-y-0.5 overflow-y-auto">
          {conversation.members.map((m) => (
            <div
              key={m.user_id}
              className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/50"
            >
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                  {initials(m.name)}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 truncate text-sm">{m.name ?? "Anggota"}</span>
              {m.member_role === "owner" ? (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Crown className="h-3.5 w-3.5" /> pemilik
                </span>
              ) : (
                <button
                  type="button"
                  disabled={members.isPending}
                  onClick={() => members.mutate({ remove: [m.user_id] })}
                  className="rounded p-1 text-muted-foreground hover:text-destructive disabled:opacity-60"
                  aria-label={`Keluarkan ${m.name ?? "anggota"}`}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
