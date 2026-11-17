import { useLayoutEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  findActiveToken,
  insertMention,
  type MentionPayload,
} from "@/lib/chat-mentions";
import { useMentionSuggestions, useSendMessage } from "@/hooks/use-chat";
import type { MentionSuggestion } from "@/lib/chat";
import { MentionAutocomplete } from "@/components/chat/MentionAutocomplete";

interface ComposerProps {
  conversationId: string;
}

/** A picked suggestion becomes the structured reference carried to send time. */
function payloadFrom(s: MentionSuggestion): MentionPayload {
  return { kind: s.kind, entity_id: s.entity_id, label: s.label };
}

/**
 * The message input.
 *
 * It inserts the *readable* label into the plain textarea and carries the
 * structured mention separately, so what the operator types is exactly what
 * gets searched and stored while the chip still knows which row it points at.
 * Enter sends, Shift+Enter is a newline, and while an `@`/`#` token is active
 * Enter instead accepts the highlighted suggestion — the two behaviours share
 * one key on purpose, so the keyboard flow stays continuous. While a search for
 * that token is still running the key does nothing at all: the token is neither
 * a suggestion to accept nor a finished message, so it must not be sent.
 */
export function Composer({ conversationId }: ComposerProps) {
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<MentionPayload[]>([]);
  const [caret, setCaret] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  const areaRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);

  const send = useSendMessage(conversationId);

  const token = findActiveToken(text, caret);
  const tokenKey = token ? `${token.start}:${token.trigger}:${token.query}` : null;
  const open = Boolean(token) && tokenKey !== dismissedKey;

  const suggestionsQuery = useMentionSuggestions({
    open,
    trigger: token?.trigger ?? null,
    query: token?.query ?? "",
  });
  const suggestions = suggestionsQuery.data ?? [];
  /**
   * A `@`/`#` token whose search has not produced a result list yet. `pending`
   * (not `isFetching`) so the gap between the token appearing and the query
   * starting is covered too; once a search settles with no match the text is
   * ordinary typing again and Enter sends it.
   */
  const waitingForSuggestions =
    open && suggestions.length === 0 && suggestionsQuery.status === "pending";

  // Apply a caret position that a mention insert asked for, after the new text
  // has been committed to the DOM.
  useLayoutEffect(() => {
    if (pendingCaret.current != null && areaRef.current) {
      const pos = pendingCaret.current;
      pendingCaret.current = null;
      areaRef.current.focus();
      areaRef.current.setSelectionRange(pos, pos);
    }
  }, [text]);

  const updateText = (value: string, selection: number) => {
    setText(value);
    setCaret(selection);
    setActiveIndex(0);
  };

  const selectSuggestion = (label: string, mention: MentionPayload) => {
    if (!token) return;
    const res = insertMention(text, token, label, mentions);
    setMentions((prev) => [...prev, mention]);
    pendingCaret.current = res.caret;
    setText(res.text);
    setCaret(res.caret);
    setDismissedKey(null);
  };

  const doSend = () => {
    const body = text.trim();
    if (!body) return;
    send.mutate(
      { body, mentions },
      {
        onSuccess: () => {
          setText("");
          setMentions([]);
          setCaret(0);
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : "Gagal mengirim pesan."),
      }
    );
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Never fire off a half-typed token. Without this guard Enter sends the raw
    // "#beras" as a message the moment the operator presses it before the
    // search resolves, and the mention they meant is lost from the trail.
    if (waitingForSuggestions && (e.key === "Enter" || e.key === "Tab")) {
      e.preventDefault();
      return;
    }

    if (open && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const s = suggestions[Math.min(activeIndex, suggestions.length - 1)];
        if (s) selectSuggestion(s.label, payloadFrom(s));
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissedKey(tokenKey);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  };

  const canSend = text.trim().length > 0 && !send.isPending;

  return (
    <div className="relative border-t bg-card p-3">
      <MentionAutocomplete
        visible={open && suggestions.length > 0}
        suggestions={suggestions}
        activeIndex={Math.min(activeIndex, Math.max(suggestions.length - 1, 0))}
        onHover={setActiveIndex}
        onSelect={(s) => selectSuggestion(s.label, payloadFrom(s))}
      />
      <div className="flex items-end gap-2">
        <Textarea
          ref={areaRef}
          value={text}
          rows={1}
          placeholder="Tulis pesan…  ketik @ untuk orang, # untuk produk/invoice/PO/vendor"
          className="max-h-40 min-h-[2.5rem] resize-y"
          onChange={(e) => updateText(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
        />
        <Button
          size="icon"
          className="h-10 w-10 shrink-0"
          disabled={!canSend}
          onClick={doSend}
          aria-label="Kirim pesan"
        >
          {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
      <p className="mt-1 pl-1 text-[11px] text-muted-foreground">
        Enter untuk kirim · Shift+Enter baris baru · @ orang · # produk, invoice, PO, vendor
      </p>
    </div>
  );
}
