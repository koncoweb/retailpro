/**
 * react-query access for the chat screens.
 *
 * "Real time" here is polling: the browser reads the tenant database directly
 * (`@/lib/db`), and there is no push channel in this architecture, so the active
 * conversation is refetched on a timer and the conversation list a bit slower.
 * Two choices make that tolerable at small-org scale:
 *   * only the *visible* conversation polls, and `refetchIntervalInBackground`
 *     is off so a background tab costs nothing;
 *   * `placeholderData: keepPreviousData` is applied to the *list* queries only,
 *     so the rail never flashes empty. Queries keyed by a conversation id never
 *     use it — a placeholder there is the previous conversation standing in for
 *     the one being opened (see `useConversation`).
 *
 * Sending is optimistic: the composer paints the message immediately and the
 * real row replaces the temp one on success, so a click feels instant even
 * though the round-trip and the peer's poll each take a beat.
 */
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import type { MentionPayload } from "@/lib/chat-mentions";
import {
  addMembers,
  createChannel,
  editMessage,
  getConversation,
  getOrCreateDM,
  listConversations,
  listDiscoverableChannels,
  listMessages,
  removeMember,
  searchEntities,
  searchUsers,
  sendMessage,
  setArchived,
  softDeleteMessage,
  type ChatConversation,
  type ChatMessage,
  type MentionSuggestion,
  type MessagePage,
} from "@/lib/chat";

/** Active-conversation poll: short enough to feel live, long enough to be cheap. */
export const MSG_POLL_MS = 3000;
/** Conversation-list poll: previews change less often than the open thread. */
export const LIST_POLL_MS = 10000;
/** Messages fetched per page. */
export const PAGE_SIZE = 50;

const conversationsKey = (userId: string) => ["chat", "conversations", userId] as const;
const discoverKey = (userId: string) => ["chat", "discover", userId] as const;
const conversationKey = (id: string) => ["chat", "conversation", id] as const;
const messagesKey = (id: string) => ["chat", "messages", id] as const;

export function useConversations() {
  const { user } = useAuth();
  return useQuery<ChatConversation[]>({
    queryKey: conversationsKey(user?.id ?? "-"),
    enabled: !!user?.id,
    queryFn: () => listConversations(user!.id),
    refetchInterval: LIST_POLL_MS,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
  });
}

export function useDiscoverableChannels() {
  const { user } = useAuth();
  return useQuery<ChatConversation[]>({
    queryKey: discoverKey(user?.id ?? "-"),
    enabled: !!user?.id,
    queryFn: () => listDiscoverableChannels(user!.id),
    refetchInterval: LIST_POLL_MS * 3,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
  });
}

/**
 * The selected conversation — its identity, never a placeholder.
 *
 * `keepPreviousData` is wrong for a key that contains the conversation id: it
 * keeps the *previous* conversation on screen while the new one loads, and the
 * pane writes to whatever it is showing. Measured in `tests/chat.e2e.ts`: a
 * message typed right after creating a channel landed in `operasional-toko`, the
 * channel that was open before the switch (`chat_messages.conversation_id` proves
 * it, at 18:24:16.780Z), because the send fired inside that placeholder window.
 */
export function useConversation(conversationId: string | null) {
  return useQuery<ChatConversation | null>({
    queryKey: conversationKey(conversationId ?? "-"),
    enabled: !!conversationId,
    queryFn: () => getConversation(conversationId as string),
  });
}

/**
 * The latest window of a conversation, polled while it is open.
 *
 * Same reason as above: another conversation's transcript is not a loading state,
 * it is a lie about where the operator is typing.
 */
export function useMessages(conversationId: string | null) {
  return useQuery<MessagePage>({
    queryKey: messagesKey(conversationId ?? "-"),
    enabled: !!conversationId,
    queryFn: () => listMessages(conversationId as string, { limit: PAGE_SIZE }),
    refetchInterval: MSG_POLL_MS,
    refetchIntervalInBackground: false,
  });
}

/** Fetch messages older than a cursor. Ad-hoc (button-driven), not polled. */
export async function fetchOlder(conversationId: string, cursor: { created_at: string; id: string }) {
  return listMessages(conversationId, { cursor, limit: PAGE_SIZE });
}

/**
 * Send with an optimistic append into the message cache.
 *
 * The temp row is swapped for the real one (real id + `created_at`) on success
 * and rolled back on error; the conversation list is invalidated on settle so
 * the preview line and the recency sort catch up.
 */
export function useSendMessage(conversationId: string | null) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = messagesKey(conversationId ?? "-");

  return useMutation({
    mutationFn: (input: { body: string; mentions: MentionPayload[] }) => {
      if (!conversationId || !user) throw new Error("Sesi belum siap.");
      return sendMessage({
        conversationId,
        senderId: user.id,
        senderName: user.name ?? null,
        body: input.body,
        mentions: input.mentions,
      });
    },
    onMutate: async (input) => {
      if (!conversationId || !user) return {};
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<MessagePage>(key);
      const tempId = `temp-${crypto.randomUUID()}`;
      const optimistic: ChatMessage = {
        id: tempId,
        conversation_id: conversationId,
        sender_id: user.id,
        sender_name: user.name ?? null,
        body: input.body.trim(),
        edited_at: null,
        deleted: 0,
        system: 0,
        created_at: new Date().toISOString(),
        mentions: input.mentions,
      };
      qc.setQueryData<MessagePage>(key, (old) =>
        old ? { ...old, messages: [...old.messages, optimistic] } : { messages: [optimistic], hasMore: false }
      );
      return { tempId, prev };
    },
    onSuccess: (created, _input, ctx) => {
      qc.setQueryData<MessagePage>(key, (old) => {
        if (!old) return { messages: [created], hasMore: false };
        const withoutTemp = old.messages.filter((m) => m.id !== ctx?.tempId);
        return { ...old, messages: [...withoutTemp, created] };
      });
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      else if (ctx?.tempId) {
        qc.setQueryData<MessagePage>(key, (old) =>
          old ? { ...old, messages: old.messages.filter((m) => m.id !== ctx.tempId) } : old
        );
      }
    },
    onSettled: () => {
      if (user) qc.invalidateQueries({ queryKey: conversationsKey(user.id) });
    },
  });
}

/** Replace a body and rebuild its mentions, then patch the cache in place. */
export function useEditMessage(conversationId: string | null) {
  const qc = useQueryClient();
  const key = messagesKey(conversationId ?? "-");
  return useMutation({
    mutationFn: (input: { id: string; body: string; mentions: MentionPayload[] }) =>
      editMessage(input.id, input.body, input.mentions),
    onSuccess: (_data, input) => {
      qc.setQueryData<MessagePage>(key, (old) =>
        old
          ? {
              ...old,
              messages: old.messages.map((m) =>
                m.id === input.id
                  ? { ...m, body: input.body.trim(), edited_at: new Date().toISOString(), mentions: input.mentions }
                  : m
              ),
            }
          : old
      );
    },
  });
}

export function useDeleteMessage(conversationId: string | null) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = messagesKey(conversationId ?? "-");
  return useMutation({
    mutationFn: (id: string) => softDeleteMessage(id, user?.id),
    onSuccess: (_data, id) => {
      qc.setQueryData<MessagePage>(key, (old) =>
        old ? { ...old, messages: old.messages.map((m) => (m.id === id ? { ...m, deleted: 1 } : m)) } : old
      );
    },
  });
}

/** Create a channel; refresh the list + browse so it (and any new joinable) appear. */
export function useCreateChannel() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name: string;
      topic?: string;
      isPrivate?: boolean;
      memberIds: string[];
    }) => createChannel({ ...input, createdBy: user!.id }),
    onSuccess: () => {
      if (!user) return;
      qc.invalidateQueries({ queryKey: conversationsKey(user.id) });
      qc.invalidateQueries({ queryKey: discoverKey(user.id) });
    },
  });
}

/** Open (or resume) a DM and switch into it. */
export function useOpenDM(onOpened: (conversationId: string) => void) {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (partnerId: string) => getOrCreateDM(user!.id, partnerId),
    onSuccess: (id) => {
      if (user) qc.invalidateQueries({ queryKey: conversationsKey(user.id) });
      onOpened(id);
    },
  });
}

export function useArchiveChannel() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { conversationId: string; archived: boolean }) =>
      setArchived(input.conversationId, input.archived, user?.id),
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: conversationKey(input.conversationId) });
      if (user) {
        qc.invalidateQueries({ queryKey: conversationsKey(user.id) });
        qc.invalidateQueries({ queryKey: discoverKey(user.id) });
      }
    },
  });
}

export function useChannelMembers(conversationId: string | null) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = conversationKey(conversationId ?? "-");
  return useMutation({
    mutationFn: (input: { add?: string[]; remove?: string[] }) =>
      (async () => {
        if (input.add?.length) await addMembers(conversationId as string, input.add);
        for (const uid of input.remove ?? []) await removeMember(conversationId as string, uid);
      })(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      if (user) qc.invalidateQueries({ queryKey: conversationsKey(user.id) });
    },
  });
}

/**
 * One query feeding both `@` and `#` autocomplete.
 *
 * `@` reads people; `#` fans out across products, invoices, POs and vendors and
 * merges the hits, so a single `#` trigger reaches every referenceable record
 * without the composer needing to know which entity class the user meant.
 */
export function useMentionSuggestions(args: {
  open: boolean;
  trigger: "@" | "#" | null;
  query: string;
}) {
  const { open, trigger, query } = args;
  return useQuery<MentionSuggestion[]>({
    queryKey: ["chat", "mention", trigger, query],
    enabled: open && !!trigger,
    queryFn: async () => {
      if (trigger === "@") return searchUsers(query);
      if (trigger === "#") {
        const [products, invoices, pos, vendors] = await Promise.all([
          searchEntities("product", query),
          searchEntities("invoice", query),
          searchEntities("po", query),
          searchEntities("vendor", query),
        ]);
        return [...products, ...invoices, ...pos, ...vendors];
      }
      return [];
    },
    staleTime: 10_000,
  });
}
