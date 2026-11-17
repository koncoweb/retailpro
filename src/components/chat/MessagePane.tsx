import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArrowLeft, ChevronUp, Hash, Loader2, MoreVertical, Users } from "lucide-react";
import { toast } from "sonner";
import type { ChatConversation, ChatMessage } from "@/lib/chat";
import {
  fetchOlder,
  useDeleteMessage,
  useEditMessage,
  useMessages,
} from "@/hooks/use-chat";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChatEmptyState } from "@/components/chat/ChatEmptyState";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { Composer } from "@/components/chat/Composer";
import { ChannelMembersDialog } from "@/components/chat/ChannelMembersDialog";
import { GROUP_WINDOW_MS, formatDayDivider, initials } from "@/components/chat/chat-utils";

interface MessagePaneProps {
  conversation: ChatConversation;
  currentUserId: string;
  canManage: boolean;
  onBack?: () => void;
  onArchive?: (conversationId: string) => void;
}

const dayKey = (iso: string) => new Date(iso).toDateString();

/**
 * The thread for one conversation.
 *
 * It renders the polled latest window, with any older pages the operator has
 * pulled kept in local state above it (react-query still owns the fresh tail, so
 * polling never disturbs history). Dividers mark days; consecutive messages from
 * one person collapse their header. Sending/editing/deleting all delegate to the
 * shared mutations so the optimistic cache stays consistent with the list.
 */
export function MessagePane({
  conversation,
  currentUserId,
  canManage,
  onBack,
  onArchive,
}: MessagePaneProps) {
  const messages = useMessages(conversation.id);
  const edit = useEditMessage(conversation.id);
  const del = useDeleteMessage(conversation.id);

  const [older, setOlder] = useState<ChatMessage[]>([]);
  const [olderHasMore, setOlderHasMore] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const latest = useMemo(() => messages.data?.messages ?? [], [messages.data]);
  const fullList = useMemo(() => [...older, ...latest], [older, latest]);
  const newestId = latest.length ? latest[latest.length - 1].id : null;

  const isChannel = conversation.kind === "channel";
  const canModerate = canManage;

  const title = isChannel
    ? conversation.name ?? "channel"
    : conversation.members.find((m) => m.user_id !== currentUserId)?.name ?? "Pesan pribadi";

  // Reset paging whenever a different conversation opens.
  useEffect(() => {
    setOlder([]);
    setOlderHasMore(true);
    stickToBottom.current = true;
  }, [conversation.id]);

  // Paint at the newest message on open; follow new messages only when the
  // operator was already at the bottom, so loading history is never yanked down.
  useEffect(() => {
    if (stickToBottom.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [conversation.id, newestId]);

  const onScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const loadOlder = async () => {
    const first = fullList[0];
    if (!first) return;
    setLoadingOlder(true);
    try {
      const page = await fetchOlder(conversation.id, { created_at: first.created_at, id: first.id });
      setOlder((prev) => [...page.messages, ...prev]);
      setOlderHasMore(page.hasMore);
    } catch {
      toast.error("Gagal memuat pesan sebelumnya.");
    } finally {
      setLoadingOlder(false);
    }
  };

  const hasMoreOlder = older.length === 0 ? (messages.data?.hasMore ?? false) : olderHasMore;

  const handleEdit = (id: string, body: string, mentions: ChatMessage["mentions"]) =>
    edit.mutate({ id, body, mentions });
  const handleDelete = (id: string) =>
    del.mutate(id, { onError: () => toast.error("Gagal menghapus pesan.") });

  const archive = () => {
    if (!onArchive) return;
    onArchive(conversation.id);
  };

  // Group consecutive messages by sender within a short window, and know where
  // a new day starts so we can drop a divider.
  const rendered = fullList.map((m, i) => {
    const prev = fullList[i - 1];
    const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
    const grouped =
      !!prev &&
      !newDay &&
      prev.sender_id === m.sender_id &&
      !prev.system &&
      !m.system &&
      new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < GROUP_WINDOW_MS;
    return { message: m, newDay, grouped };
  });

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b bg-card px-3 py-2.5">
        {onBack && (
          <Button size="iconSm" variant="ghost" className="lg:hidden" onClick={onBack} aria-label="Kembali">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {isChannel ? <Hash className="h-4 w-4" /> : <Users className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {isChannel ? `#${title}` : title}
          </p>
          {conversation.topic && (
            <p className="truncate text-xs text-muted-foreground">{conversation.topic}</p>
          )}
        </div>

        <div className="flex -space-x-2">
          {conversation.members.slice(0, 4).map((m) => (
            <Avatar key={m.user_id} className="h-7 w-7 border-2 border-card">
              <AvatarFallback className="bg-muted text-[10px] font-semibold">
                {initials(m.name)}
              </AvatarFallback>
            </Avatar>
          ))}
          {conversation.members.length > 4 && (
            <span className="flex h-7 items-center rounded-full border-2 border-card bg-muted px-1.5 text-[10px] font-medium">
              +{conversation.members.length - 4}
            </span>
          )}
        </div>

        {isChannel && canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="iconSm" variant="ghost" aria-label="Opsi channel">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setMembersOpen(true)}>
                <Users className="mr-2 h-4 w-4" /> Kelola anggota
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={archive}
                className="text-destructive focus:text-destructive"
              >
                <Archive className="mr-2 h-4 w-4" /> Arsipkan channel
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Transcript */}
      <div ref={containerRef} onScroll={onScroll} className="flex-1 overflow-y-auto py-2">
        {hasMoreOlder && (
          <div className="flex justify-center py-2">
            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={loadOlder} disabled={loadingOlder}>
              {loadingOlder ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronUp className="h-3.5 w-3.5" />}
              Muat pesan sebelumnya
            </Button>
          </div>
        )}

        {messages.isLoading ? (
          <ChatEmptyState skeleton title="Memuat…" description="" />
        ) : fullList.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            Belum ada pesan. Mulai percakapan di bawah.
          </div>
        ) : (
          rendered.map(({ message, newDay, grouped }) => (
            <div key={message.id}>
              {newDay && (
                <div className="my-3 flex items-center gap-3 px-4">
                  <Separator className="flex-1" />
                  <span className="text-xs font-medium text-muted-foreground">
                    {formatDayDivider(message.created_at)}
                  </span>
                  <Separator className="flex-1" />
                </div>
              )}
              <MessageBubble
                message={message}
                currentUserId={currentUserId}
                grouped={grouped}
                canModerate={canModerate}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <Composer conversationId={conversation.id} />

      {isChannel && (
        <ChannelMembersDialog
          conversation={conversation}
          open={membersOpen}
          onOpenChange={setMembersOpen}
        />
      )}
    </div>
  );
}
