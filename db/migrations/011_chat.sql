-- ---------------------------------------------------------------------------
-- 011 — internal team chat (channels, DMs, messages, mentions)
--
-- Runs once against a tenant database that is still on schema version 10.
-- `scripts/apply-schema-all.mjs` applies this file, then re-applies
-- `db/schema/tenant.sql` and stamps the version, so this file holds only the
-- four new tables and their indexes — the superset lives in tenant.sql for
-- virgin databases.
--
-- Additive only: no existing table or column is touched, so there is no risk to
-- live rows. The table bodies are kept byte-identical to tenant.sql (including
-- the UUID DEFAULT expression) because a row inserted without `id` still relies
-- on that schema-level default.
--
-- Invariant after this migration:
--   * a conversation is a `channel` (human `name`, UNIQUE while kind='channel')
--     or a `dm` deduplicated by the canonical `dm_key` (UNIQUE when present);
--   * `chat_conversations.last_message_*` is denormalized and kept in sync on
--     every send, so the conversation list polls without a per-row subquery;
--   * `chat_messages` are never hard-deleted (`deleted` flips to 1);
--   * `chat_mentions` snapshot `kind`/`entity_id`/`label` so a chip survives the
--     entity being renamed or deleted later.
--
-- Visibility (membership, DM privacy) is an APPLICATION rule, not a security
-- boundary: there is no row-level security, and every signed-in employee holds
-- a full-access token for this database. See `docs/spec-chat-internal.md`.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS chat_conversations (
  id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  -- 'channel' | 'dm'
  kind                TEXT NOT NULL,
  -- Channel label ("ops", "gudang"). NULL for a DM.
  name                TEXT,
  topic               TEXT,
  -- Private channel: only members may see it in the browse list. Still a UI
  -- rule, not an access boundary (see the note above).
  is_private          INTEGER NOT NULL DEFAULT 0,
  archived            INTEGER NOT NULL DEFAULT 0,
  created_by          TEXT,
  -- Canonical sorted '<a>|<b>' user-id key; present (and UNIQUE) only for DMs.
  dm_key              TEXT,
  -- Kept in sync with every send so the list needs no join/subquery on poll.
  last_message_at     TEXT,
  last_message_sender_id TEXT,
  last_message_preview   TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT
);

-- Membership for both channels and DMs. `member_role` marks the channel owner
-- who may rename/archive it; it grants no data access.
CREATE TABLE IF NOT EXISTS chat_participants (
  conversation_id TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  -- 'owner' | 'member'
  member_role     TEXT NOT NULL DEFAULT 'member',
  joined_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (conversation_id, user_id)
);

-- One row per message. `body` is the raw visible text (kept natural so it is
-- searchable); structured mentions live in `chat_mentions`, so a chip still
-- reads correctly even if the person/entity is later renamed or deleted.
CREATE TABLE IF NOT EXISTS chat_messages (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  conversation_id TEXT NOT NULL,
  sender_id       TEXT NOT NULL,
  body            TEXT NOT NULL,
  edited_at       TEXT,
  -- Soft delete only: never removed, so the surrounding thread keeps reading
  -- correctly and the (conversation, created_at, id) ordering stays stable.
  deleted         INTEGER NOT NULL DEFAULT 0,
  -- 'channel created', 'Budi joined', etc. Rendered inline, not as a bubble.
  system          INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Structured, snapshotted mention reference for a message. `label` is the exact
-- '@…'/'#…' substring that was inserted; `entity_id` drives the deep link.
CREATE TABLE IF NOT EXISTS chat_mentions (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+(abs(random())%4),1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  message_id TEXT NOT NULL,
  -- 'user' | 'product' | 'invoice' | 'po' | 'vendor'
  kind       TEXT NOT NULL,
  entity_id  TEXT,
  label      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Two DMs between the same pair collapse to one conversation; two channels
-- cannot share a name. Both are partial so DMs (no name) and channels (no
-- dm_key) are unaffected by the other's rule.
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_dm_key       ON chat_conversations(dm_key) WHERE dm_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_channel_name ON chat_conversations(name)   WHERE kind = 'channel';
-- "my conversations" and "who is in this conversation".
CREATE INDEX        IF NOT EXISTS idx_chat_part_user     ON chat_participants(user_id, conversation_id);
CREATE INDEX        IF NOT EXISTS idx_chat_part_conv     ON chat_participants(conversation_id);
-- The message stream poll and the keyset "load older" both read this.
CREATE INDEX        IF NOT EXISTS idx_chat_msg_conv      ON chat_messages(conversation_id, created_at, id);
CREATE INDEX        IF NOT EXISTS idx_chat_mentions_msg  ON chat_mentions(message_id);
CREATE INDEX        IF NOT EXISTS idx_chat_conv_recent   ON chat_conversations(last_message_at);

UPDATE schema_version SET version = 11 WHERE id = 1;
