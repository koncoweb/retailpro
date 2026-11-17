/**
 * Internal team chat — the single data-access module.
 *
 * Everything the chat screens read or write goes through here, exactly as stock
 * movement runs through `stock-movement.ts` and the vendor catalogue through
 * `vendor-catalog.ts`. The screens never hand-write chat SQL: one implementation
 * means the denormalized `chat_conversations.last_message_*` bookkeeping, the
 * DM dedup rule and the mention snapshot cannot drift between pages.
 *
 * The browser talks straight to the tenant database (see `@/lib/db`), so there
 * is no server hop and no row-level security: membership is a product rule, not
 * an access boundary. Placeholders use the `$n` style; `translate.ts` rewrites
 * them to libSQL `?`. Ids are `crypto.randomUUID()` and one ISO timestamp is
 * computed per write so a message and the conversation's `last_message_at`
 * agree exactly.
 */
import { query, runTransaction, batchQuery, parseJsonArray } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { extractMentions, type MentionKind, type MentionPayload } from "@/lib/chat-mentions";

export interface ChatMember {
  user_id: string;
  name: string | null;
  member_role: "owner" | "member";
}

export interface ChatConversation {
  id: string;
  kind: "channel" | "dm";
  name: string | null;
  topic: string | null;
  is_private: number;
  archived: number;
  created_by: string | null;
  dm_key: string | null;
  last_message_at: string | null;
  last_message_sender_id: string | null;
  last_message_preview: string | null;
  created_at: string;
  members: ChatMember[];
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_name: string | null;
  body: string;
  edited_at: string | null;
  deleted: number;
  system: number;
  created_at: string;
  mentions: MentionPayload[];
}

/** One autocomplete row: the `label` is inserted into the body, the rest renders. */
export interface MentionSuggestion {
  kind: MentionKind;
  entity_id: string;
  label: string;
  sublabel: string;
}

export interface MessagePage {
  /** Ascending (oldest first) — the order a transcript paints in. */
  messages: ChatMessage[];
  hasMore: boolean;
}

const nowIso = () => new Date().toISOString();

/** First ~80 chars of a body, for the conversation-list preview line. */
function previewOf(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat;
}

/** Map a raw message row (with its embedded `mentions_json`) to `ChatMessage`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toMessage(row: any, senderName?: string | null): ChatMessage {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    sender_id: row.sender_id,
    sender_name: row.sender_name ?? senderName ?? null,
    body: row.body,
    edited_at: row.edited_at ?? null,
    deleted: Number(row.deleted ?? 0),
    system: Number(row.system ?? 0),
    created_at: row.created_at,
    mentions: parseJsonArray<MentionPayload>(row.mentions_json),
  };
}

const CONVERSATION_COLUMNS = `c.id, c.kind, c.name, c.topic, c.is_private, c.archived,
       c.created_by, c.dm_key, c.last_message_at, c.last_message_sender_id,
       c.last_message_preview, c.created_at`;

/**
 * Conversations the person belongs to, newest activity first.
 *
 * Members are aggregated as JSON in the same pass so a DM can be labelled with
 * the partner's name without a second query per conversation. The share check is
 * a subquery rather than a `p.user_id = $1` predicate: filtering the join would
 * aggregate only the reader, and `dmPartner()` — "the other person" — would then
 * fall back to the generic "Pesan pribadi" label for every DM in the rail.
 */
export async function listConversations(userId: string): Promise<ChatConversation[]> {
  const res = await query<Record<string, unknown>>(listConversationsSql(), [userId]);
  return res.rows.map(mapConversation);
}

/** Public channels the person has not joined yet — the "browse" list. */
export async function listDiscoverableChannels(userId: string): Promise<ChatConversation[]> {
  const res = await query<Record<string, unknown>>(
    `SELECT ${CONVERSATION_COLUMNS},
            COALESCE(json_group_array(
              json_object('user_id', u.id, 'name', u.name, 'member_role', p.member_role)
            ), '[]') AS members_json
       FROM chat_conversations c
       JOIN chat_participants p ON p.conversation_id = c.id
       LEFT JOIN users u ON u.id = p.user_id
      WHERE c.kind = 'channel'
        AND c.is_private = 0
        AND c.archived = 0
        AND c.id NOT IN (SELECT conversation_id FROM chat_participants WHERE user_id = $1)
      GROUP BY c.id
      ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`,
    [userId]
  );
  return res.rows.map(mapConversation);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapConversation(row: any): ChatConversation {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name ?? null,
    topic: row.topic ?? null,
    is_private: Number(row.is_private ?? 0),
    archived: Number(row.archived ?? 0),
    created_by: row.created_by ?? null,
    dm_key: row.dm_key ?? null,
    last_message_at: row.last_message_at ?? null,
    last_message_sender_id: row.last_message_sender_id ?? null,
    last_message_preview: row.last_message_preview ?? null,
    created_at: row.created_at,
    members: parseJsonArray<ChatMember>(row.members_json),
  };
}

/** One conversation by id, membership included — the message-pane header. */
export async function getConversation(conversationId: string): Promise<ChatConversation | null> {
  const res = await query<Record<string, unknown>>(
    `SELECT ${CONVERSATION_COLUMNS},
            COALESCE(json_group_array(
              json_object('user_id', u.id, 'name', u.name, 'member_role', p.member_role)
            ), '[]') AS members_json
       FROM chat_conversations c
       JOIN chat_participants p ON p.conversation_id = c.id
       LEFT JOIN users u ON u.id = p.user_id
      WHERE c.id = $1
      GROUP BY c.id`,
    [conversationId]
  );
  return res.rows[0] ? mapConversation(res.rows[0]) : null;
}

/**
 * The id of the DM shared by two people, creating it on first use.
 *
 * `dm_key` is the sorted pair joined with '|', so the DM is canonical regardless
 * of who opened it first and a concurrent double-open collapses onto the unique
 * index — the loser re-reads the winner's row instead of erroring.
 */
export async function getOrCreateDM(a: string, b: string): Promise<string> {
  const key = [a, b].sort().join("|");
  const existing = await query<{ id: string }>(
    `SELECT id FROM chat_conversations WHERE dm_key = $1`,
    [key]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const now = nowIso();
  const id = crypto.randomUUID();
  try {
    await runTransaction(async (tx) => {
      await tx.execute(
        `INSERT INTO chat_conversations (id, kind, dm_key, created_at, updated_at)
         VALUES ($1, 'dm', $2, $3, $3)`,
        [id, key, now]
      );
      for (const uid of [a, b]) {
        await tx.execute(
          `INSERT OR IGNORE INTO chat_participants (conversation_id, user_id, joined_at)
           VALUES ($1, $2, $3)`,
          [id, uid, now]
        );
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unique/i.test(message)) {
      const again = await query<{ id: string }>(
        `SELECT id FROM chat_conversations WHERE dm_key = $1`,
        [key]
      );
      if (again.rows[0]) return again.rows[0].id;
    }
    throw error;
  }
  return id;
}

/** Channel-name grammar: lowercase, hyphenated, no leading '#', still readable. */
export function normalizeChannelName(raw: string): string {
  const slug = raw
    .trim()
    .replace(/^#/, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, 50);
}

/**
 * Create a channel and its membership in one write.
 *
 * The creator is recorded as `member_role='owner'` so the archive/rename lever
 * can be checked without a settings read; selected members join as `member`.
 * A duplicate name trips the partial unique index and surfaces to the caller.
 */
export async function createChannel(input: {
  name: string;
  topic?: string;
  isPrivate?: boolean;
  memberIds: string[];
  createdBy: string;
}): Promise<string> {
  const name = normalizeChannelName(input.name);
  if (!name) throw new Error("Nama channel tidak valid.");

  const now = nowIso();
  const id = crypto.randomUUID();
  const members = new Set([input.createdBy, ...input.memberIds]);

  await runTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO chat_conversations
         (id, kind, name, topic, is_private, created_by, created_at, updated_at)
       VALUES ($1, 'channel', $2, $3, $4, $5, $6, $6)`,
      [id, name, input.topic?.trim() || null, input.isPrivate ? 1 : 0, input.createdBy, now]
    );
    for (const uid of members) {
      await tx.execute(
        `INSERT OR IGNORE INTO chat_participants (conversation_id, user_id, member_role, joined_at)
         VALUES ($1, $2, $3, $4)`,
        [id, uid, uid === input.createdBy ? "owner" : "member", now]
      );
    }
  });

  await logAudit({
    action: "create_channel",
    entity: "chat_conversations",
    entityId: id,
    details: { name, is_private: input.isPrivate ? 1 : 0, members: members.size },
    userId: input.createdBy,
  });
  return id;
}

export async function setArchived(
  conversationId: string,
  archived: boolean,
  actorId?: string
): Promise<void> {
  await query(
    `UPDATE chat_conversations SET archived = $1, updated_at = $2 WHERE id = $3`,
    [archived ? 1 : 0, nowIso(), conversationId]
  );
  if (actorId) {
    await logAudit({
      action: "archive_channel",
      entity: "chat_conversations",
      entityId: conversationId,
      details: { archived: archived ? 1 : 0 },
      userId: actorId,
    });
  }
}

export async function addMembers(conversationId: string, userIds: string[]): Promise<void> {
  const now = nowIso();
  await runTransaction(async (tx) => {
    for (const uid of userIds) {
      await tx.execute(
        `INSERT OR IGNORE INTO chat_participants (conversation_id, user_id, member_role, joined_at)
         VALUES ($1, $2, 'member', $3)`,
        [conversationId, uid, now]
      );
    }
  });
}

/** Never remove the channel owner — they are the one who can archive it. */
export async function removeMember(conversationId: string, userId: string): Promise<void> {
  await query(
    `DELETE FROM chat_participants
      WHERE conversation_id = $1 AND user_id = $2 AND member_role <> 'owner'`,
    [conversationId, userId]
  );
}

/**
 * A page of messages, newest window or older-than-a-cursor.
 *
 * Reads `limit + 1` to answer `hasMore` without a second count query, then
 * returns at most `limit` rows reversed into transcript order. Mentions are
 * aggregated inline so one round-trip carries both the messages and their
 * chips. The keyset (`created_at`, `id`) rides the composite index instead of
 * a big OFFSET.
 */
export async function listMessages(
  conversationId: string,
  options: { cursor?: { created_at: string; id: string }; limit?: number } = {}
): Promise<MessagePage> {
  const limit = options.limit ?? 50;
  const params: unknown[] = [conversationId, limit + 1];
  let where = "m.conversation_id = $1";
  if (options.cursor) {
    params.push(options.cursor.created_at, options.cursor.id);
    where += ` AND (m.created_at < $3 OR (m.created_at = $3 AND m.id < $4))`;
  }

  const res = await query<Record<string, unknown>>(
    `SELECT m.id, m.conversation_id, m.sender_id, m.body, m.edited_at, m.deleted,
            m.system, m.created_at, u.name AS sender_name,
            COALESCE((
              SELECT json_group_array(
                json_object('kind', cm.kind, 'entity_id', cm.entity_id, 'label', cm.label)
              )
              FROM chat_mentions cm WHERE cm.message_id = m.id
            ), '[]') AS mentions_json
       FROM chat_messages m
       LEFT JOIN users u ON u.id = m.sender_id
      WHERE ${where}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT $2`,
    params
  );

  const hasMore = res.rows.length > limit;
  const page = hasMore ? res.rows.slice(0, limit) : res.rows;
  return { messages: page.map((row) => toMessage(row)).reverse(), hasMore };
}

/**
 * Persist a message with its mentions and refresh the conversation's denormalized
 * last-message columns, all in one write transaction so the preview and the
 * stream never disagree. Returns the built message for an optimistic append.
 */
export async function sendMessage(input: {
  conversationId: string;
  senderId: string;
  senderName?: string | null;
  body: string;
  mentions: MentionPayload[];
}): Promise<ChatMessage> {
  const body = input.body.trim();
  if (!body) throw new Error("Pesan tidak boleh kosong.");

  const now = nowIso();
  const id = crypto.randomUUID();
  const mentions = extractMentions(body, input.mentions);
  const preview = previewOf(body);

  await runTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO chat_messages (id, conversation_id, sender_id, body, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, input.conversationId, input.senderId, body, now]
    );
    for (const m of mentions) {
      await tx.execute(
        `INSERT INTO chat_mentions (id, message_id, kind, entity_id, label, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [crypto.randomUUID(), id, m.kind, m.entity_id, m.label, now]
      );
    }
    await tx.execute(
      `UPDATE chat_conversations
          SET last_message_at = $1, last_message_sender_id = $2,
              last_message_preview = $3, updated_at = $1
        WHERE id = $4`,
      [now, input.senderId, preview, input.conversationId]
    );
  });

  return {
    id,
    conversation_id: input.conversationId,
    sender_id: input.senderId,
    sender_name: input.senderName ?? null,
    body,
    edited_at: null,
    deleted: 0,
    system: 0,
    created_at: now,
    mentions,
  };
}

/** Replace the body and rebuild the mention set (delete + insert). */
export async function editMessage(
  messageId: string,
  body: string,
  mentions: MentionPayload[]
): Promise<void> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Pesan tidak boleh kosong.");
  const now = nowIso();
  const kept = extractMentions(trimmed, mentions);

  await runTransaction(async (tx) => {
    await tx.execute(
      `UPDATE chat_messages SET body = $1, edited_at = $2 WHERE id = $3`,
      [trimmed, now, messageId]
    );
    await tx.execute(`DELETE FROM chat_mentions WHERE message_id = $1`, [messageId]);
    for (const m of kept) {
      await tx.execute(
        `INSERT INTO chat_mentions (id, message_id, kind, entity_id, label, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [crypto.randomUUID(), messageId, m.kind, m.entity_id, m.label, now]
      );
    }
    // Keep the list preview honest if this was the newest message.
    await tx.execute(
      `UPDATE chat_conversations
          SET last_message_preview = $1, updated_at = $2
        WHERE id = (SELECT conversation_id FROM chat_messages WHERE id = $3)
          AND last_message_at = (SELECT created_at FROM chat_messages WHERE id = $3)`,
      [previewOf(trimmed), now, messageId]
    );
  });
}

/** Soft delete only — the row and its neighbours keep the thread coherent. */
export async function softDeleteMessage(
  messageId: string,
  actorId?: string
): Promise<void> {
  await query(`UPDATE chat_messages SET deleted = 1 WHERE id = $1`, [messageId]);
  if (actorId) {
    await logAudit({
      action: "delete_message",
      entity: "chat_messages",
      entityId: messageId,
      details: {},
      userId: actorId,
    });
  }
}

/**
 * People for the `@` autocomplete. An empty query lists the first few active
 * staff, so "New direct message" has something to pick immediately.
 */
export async function searchUsers(q: string, limit = 20): Promise<MentionSuggestion[]> {
  const term = q.trim();
  const rows = term
    ? await query<{ id: string; name: string | null; email: string; role: string }>(
        `SELECT id, name, email, role FROM users
          WHERE is_active = 1 AND (name LIKE $1 OR email LIKE $1)
          ORDER BY name LIMIT $2`,
        [`%${term}%`, limit]
      )
    : await query<{ id: string; name: string | null; email: string; role: string }>(
        `SELECT id, name, email, role FROM users
          WHERE is_active = 1 ORDER BY name LIMIT $1`,
        [limit]
      );
  return rows.rows.map((r) => ({
    kind: "user" as const,
    entity_id: r.id,
    label: `@${(r.name || r.email || "Anggota").trim()}`,
    sublabel: r.email,
  }));
}

/**
 * Entities for the `#` autocomplete. Each kind reads the table that owns it and
 * labels the chip with the number/name operators already recognise (invoice
 * number, PO number, product/vendor name), matching a unique or near-unique key
 * where one exists (SKU, invoice_number, po_number).
 */
export async function searchEntities(kind: MentionKind, q: string, limit = 15): Promise<MentionSuggestion[]> {
  const term = `%${q.trim()}%`;
  switch (kind) {
    case "product": {
      const rows = await query<{ id: string; name: string; sku: string; category: string | null }>(
        `SELECT id, name, sku, category FROM products
          WHERE name LIKE $1 OR sku LIKE $1 ORDER BY name LIMIT $2`,
        [term, limit]
      );
      return rows.rows.map((r) => ({
        kind: "product" as const,
        entity_id: r.id,
        label: `#${r.name}`,
        sublabel: r.sku,
      }));
    }
    case "invoice": {
      const rows = await query<{ id: string; invoice_number: string; total_amount: number }>(
        `SELECT id, invoice_number, total_amount FROM transactions
          WHERE invoice_number LIKE $1 ORDER BY created_at DESC LIMIT $2`,
        [term, limit]
      );
      return rows.rows.map((r) => ({
        kind: "invoice" as const,
        entity_id: r.id,
        label: `#${r.invoice_number}`,
        sublabel: `Rp ${Number(r.total_amount || 0).toLocaleString("id-ID")}`,
      }));
    }
    case "po": {
      const rows = await query<{ id: string; po_number: string; status: string; supplier_name: string | null }>(
        `SELECT id, po_number, status, supplier_name FROM purchase_orders
          WHERE po_number LIKE $1 ORDER BY created_at DESC LIMIT $2`,
        [term, limit]
      );
      return rows.rows.map((r) => ({
        kind: "po" as const,
        entity_id: r.id,
        label: `#${r.po_number}`,
        sublabel: r.supplier_name || r.status,
      }));
    }
    case "vendor": {
      const rows = await query<{ id: string; name: string; code: string | null }>(
        `SELECT id, name, code FROM suppliers
          WHERE name LIKE $1 OR code LIKE $1 ORDER BY name LIMIT $2`,
        [term, limit]
      );
      return rows.rows.map((r) => ({
        kind: "vendor" as const,
        entity_id: r.id,
        label: `#${r.name}`,
        sublabel: r.code || "vendor",
      }));
    }
    case "user":
    default:
      return searchUsers(q, limit);
  }
}

/** Join the pieces the message pane needs in one shot: page + discover list. */
export async function loadConversationBundle(
  userId: string
): Promise<{ conversations: ChatConversation[]; discoverable: ChatConversation[] }> {
  const [conversations, discoverable] = await batchQuery<ChatConversation>([
    {
      sql: listConversationsSql(),
      params: [userId],
    },
    {
      sql: discoverableChannelsSql(),
      params: [userId],
    },
  ]);
  return {
    conversations: conversations.rows.map(mapConversation),
    discoverable: discoverable.rows.map(mapConversation),
  };
}

// The two SELECTs `loadConversationBundle` batches together, kept as string
// builders so both the batch path and the single-query helpers use one source.
function listConversationsSql(): string {
  return `SELECT ${CONVERSATION_COLUMNS},
                 COALESCE(json_group_array(
                   json_object('user_id', u.id, 'name', u.name, 'member_role', p.member_role)
                 ), '[]') AS members_json
            FROM chat_conversations c
            JOIN chat_participants p ON p.conversation_id = c.id
            LEFT JOIN users u ON u.id = p.user_id
           WHERE c.archived = 0
             AND c.id IN (SELECT conversation_id FROM chat_participants WHERE user_id = $1)
           GROUP BY c.id
           ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`;
}

function discoverableChannelsSql(): string {
  return `SELECT ${CONVERSATION_COLUMNS},
                 COALESCE(json_group_array(
                   json_object('user_id', u.id, 'name', u.name, 'member_role', p.member_role)
                 ), '[]') AS members_json
            FROM chat_conversations c
            JOIN chat_participants p ON p.conversation_id = c.id
            LEFT JOIN users u ON u.id = p.user_id
           WHERE c.kind = 'channel' AND c.is_private = 0 AND c.archived = 0
             AND c.id NOT IN (SELECT conversation_id FROM chat_participants WHERE user_id = $1)
           GROUP BY c.id
           ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`;
}
