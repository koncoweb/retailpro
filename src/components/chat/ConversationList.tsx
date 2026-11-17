import { Hash, Lock, MessageSquarePlus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatConversation } from "@/lib/chat";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatEmptyState } from "@/components/chat/ChatEmptyState";
import { formatListStamp, initials } from "@/components/chat/chat-utils";

interface ConversationListProps {
  conversations: ChatConversation[];
  loading: boolean;
  activeId: string | null;
  currentUserId: string;
  canManage: boolean;
  onSelect: (id: string) => void;
  onNewChannel: () => void;
  onNewDm: () => void;
}

/** The display name for a DM: the other person, not "you". */
function dmPartner(c: ChatConversation, currentUserId: string): string {
  return c.members.find((m) => m.user_id !== currentUserId)?.name || "Pesan pribadi";
}

function Row({
  active,
  onClick,
  icon,
  title,
  preview,
  stamp,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  preview: string;
  stamp?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
        active ? "bg-primary/10 text-foreground" : "hover:bg-muted/60"
      )}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className={cn("truncate text-sm", active ? "font-semibold" : "font-medium")}>
            {title}
          </span>
          {stamp && <span className="shrink-0 text-[11px] text-muted-foreground">{stamp}</span>}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{preview}</span>
      </span>
    </button>
  );
}

/**
 * The left rail: Channels above Direct messages, newest activity first.
 *
 * Ordering and previews come straight from the denormalized conversation
 * columns, so this list renders with no per-row lookups — which is what makes
 * polling it cheap. The create affordances sit at the top; "New channel" is
 * gated to `manage_channels`, but everyone can start a DM.
 */
export function ConversationList({
  conversations,
  loading,
  activeId,
  currentUserId,
  canManage,
  onSelect,
  onNewChannel,
  onNewDm,
}: ConversationListProps) {
  const channels = conversations.filter((c) => c.kind === "channel");
  const dms = conversations.filter((c) => c.kind === "dm");

  const previewOf = (c: ChatConversation) =>
    c.last_message_preview || (c.kind === "channel" ? c.topic || "Belum ada pesan" : "Belum ada pesan");

  if (loading && conversations.length === 0) {
    return <ChatEmptyState skeleton />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 border-b px-3 py-2.5">
        <Button
          size="sm"
          variant="secondary"
          className="h-8 flex-1 gap-1.5"
          onClick={onNewDm}
        >
          <MessageSquarePlus className="h-4 w-4" /> Pesan
        </Button>
        {canManage && (
          <Button size="sm" variant="outline" className="h-8 flex-1 gap-1.5" onClick={onNewChannel}>
            <Plus className="h-4 w-4" /> Channel
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-4 p-2">
          <section>
            <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Channels
            </p>
            {channels.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">Belum ada channel.</p>
            ) : (
              <div className="space-y-0.5">
                {channels.map((c) => (
                  <Row
                    key={c.id}
                    active={c.id === activeId}
                    onClick={() => onSelect(c.id)}
                    icon={
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        {c.is_private ? <Lock className="h-4 w-4" /> : <Hash className="h-4 w-4" />}
                      </span>
                    }
                    title={c.name ?? "channel"}
                    preview={previewOf(c)}
                    stamp={c.last_message_at ? formatListStamp(c.last_message_at) : undefined}
                  />
                ))}
              </div>
            )}
          </section>

          <section>
            <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Pesan langsung
            </p>
            {dms.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">Belum ada pesan langsung.</p>
            ) : (
              <div className="space-y-0.5">
                {dms.map((c) => {
                  const partner = dmPartner(c, currentUserId);
                  return (
                    <Row
                      key={c.id}
                      active={c.id === activeId}
                      onClick={() => onSelect(c.id)}
                      icon={
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                            {initials(partner)}
                          </AvatarFallback>
                        </Avatar>
                      }
                      title={partner}
                      preview={previewOf(c)}
                      stamp={c.last_message_at ? formatListStamp(c.last_message_at) : undefined}
                    />
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}
