import { useState } from "react";
import { Check, Pencil, Send, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { renderSegments, type MentionPayload } from "@/lib/chat-mentions";
import type { ChatMessage } from "@/lib/chat";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MentionChip } from "@/components/chat/MentionChip";
import { formatClock, initials } from "@/components/chat/chat-utils";

interface MessageBubbleProps {
  message: ChatMessage;
  currentUserId: string;
  /** Consecutive same-sender follow-up: hide the name/avatar header. */
  grouped: boolean;
  /** manage_channels / channel owner may remove anyone's message. */
  canModerate: boolean;
  onEdit: (id: string, body: string, mentions: MentionPayload[]) => void;
  onDelete: (id: string) => void;
}

/** Turns a stored body + its mentions into readable, chip-bearing text. */
function MessageBody({ message, currentUserId }: { message: ChatMessage; currentUserId: string }) {
  const segments = renderSegments(message.body, message.mentions);
  return (
    <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
      {segments.map((seg, i) =>
        seg.type === "text" ? (
          <span key={i}>{seg.text}</span>
        ) : (
          <MentionChip
            key={i}
            mention={seg.mention}
            isCurrentUser={seg.mention.kind === "user" && seg.mention.entity_id === currentUserId}
          />
        )
      )}
    </div>
  );
}

/**
 * A single transcript row.
 *
 * It owns only its transient edit buffer — the actual write is the parent's
 * mutation, so optimistic caching stays in one place. Deleted and system rows
 * render as quiet placeholders rather than vanishing, which keeps the thread
 * length and ordering honest for everyone reading it.
 */
export function MessageBubble({
  message,
  currentUserId,
  grouped,
  canModerate,
  onEdit,
  onDelete,
}: MessageBubbleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);

  const own = message.sender_id === currentUserId;
  const pending = message.id.startsWith("temp-");

  if (message.system) {
    return (
      <div className="py-1 text-center text-xs text-muted-foreground">{message.body}</div>
    );
  }

  if (message.deleted) {
    return (
      <div className={cn("flex gap-3 px-4 py-0.5", grouped && "min-h-[1.25rem]")}>
        {!grouped && <div className="w-9 shrink-0" />}
        <p className="text-sm italic text-muted-foreground">Pesan ini telah dihapus.</p>
      </div>
    );
  }

  const startEdit = () => {
    setDraft(message.body);
    setEditing(true);
  };
  const commitEdit = () => {
    const trimmed = draft.trim();
    setEditing(false);
    if (trimmed && trimmed !== message.body) {
      // Keep the mention set the bubble already carries; extractMentions (inside
      // editMessage) drops any chip whose label this edit removed.
      onEdit(message.id, trimmed, message.mentions);
    }
  };

  return (
    <div
      className={cn(
        "group flex gap-3 px-4 py-0.5 hover:bg-muted/40",
        grouped ? "py-0.5" : "mt-2 py-1"
      )}
    >
      <div className="w-9 shrink-0">
        {!grouped ? (
          <Avatar className="h-9 w-9">
            <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
              {initials(message.sender_name)}
            </AvatarFallback>
          </Avatar>
        ) : (
          <span className="mt-1 hidden text-[10px] leading-4 text-muted-foreground group-hover:block">
            {formatClock(message.created_at)}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-foreground">
              {message.sender_name ?? "Anggota"}
            </span>
            <span className="text-xs text-muted-foreground">{formatClock(message.created_at)}</span>
            {pending && <Send className="h-3 w-3 text-muted-foreground" />}
          </div>
        )}

        {editing ? (
          <div className="mt-1 flex flex-col gap-1">
            <Textarea
              value={draft}
              autoFocus
              rows={2}
              className="min-h-[2.5rem] resize-y text-sm"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commitEdit();
                if (e.key === "Escape") setEditing(false);
              }}
            />
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Button size="sm" variant="outline" className="h-7 gap-1 px-2" onClick={commitEdit}>
                <Check className="h-3.5 w-3.5" /> Simpan
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditing(false)}>
                Batal
              </Button>
              <span>Enter + Ctrl untuk menyimpan</span>
            </div>
          </div>
        ) : (
          <MessageBody message={message} currentUserId={currentUserId} />
        )}

        {message.edited_at && !editing && (
          <span className="text-[10px] text-muted-foreground">(diedit)</span>
        )}
      </div>

      {!editing && !pending && (
        <div className="flex shrink-0 items-start gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {own && (
            <Button
              size="iconSm"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground"
              onClick={startEdit}
              aria-label="Edit pesan"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          {(own || canModerate) && (
            <Button
              size="iconSm"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={() => onDelete(message.id)}
              aria-label="Hapus pesan"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
