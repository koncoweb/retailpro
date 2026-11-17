import { test, describe } from '@e2e-dev/web';
import { expect } from 'e2e';
import assert from 'node:assert/strict';
import { tenantClient } from './support/db';
import { APP_CONTEXT } from './support/context';

/**
 * The internal team chat: channels and DMs between the owner and a cashier.
 *
 * Everything here is deterministic on purpose — the chat's value is the data
 * trail (`chat_conversations` / `chat_participants` / `chat_messages` /
 * `chat_mentions`), and both the visible surface and the rows behind it can be
 * asserted exactly, so this file uses no `agent.assert`. The rail proves what
 * each role is offered; the tenant DB proves what was actually written. The
 * polling model is asserted the cheap way: the cashier test runs after the
 * owner's writes, and a 60-second assertion outlasts the 3s/10s poll intervals
 * (`src/hooks/use-chat.ts`), so "it shows up eventually" is a real test.
 *
 * Everything this file creates is named `e2e-chat` (or is the owner↔kasir DM)
 * and is swept at the start of the case that needs it, so a half-failed attempt
 * leaves no channel behind that would collide with the UNIQUE index.
 */

/**
 * Identifiers are constants on purpose — no `Date.now()` stamp.
 *
 * The runner re-evaluates this module more than once during a single run (a
 * retried or later test gets a fresh import), so a timestamp-based name made
 * each case look for a channel that a different module instance had created:
 * the run measured 3 of 8 cases failing purely because of that. Fixed names +
 * the per-case sweeps below are what make a retry start from known state.
 */
const CHANNEL = 'e2e-chat';
const OWNER_EMAIL = 'owner@tokobahankue.com';
const KASIR_EMAIL = 'e2e.kasir@tokobahankue.com';

const MSG_PLAIN = 'halo dari e2e';
const MSG_USER_MENTION = 'tolong cek stok';
const MSG_PRODUCT_MENTION = 'minta review';
const MSG_DM = 'dm halo';
/** Label `searchEntities` builds for the one demo product matching "beras". */
const PRODUCT_LABEL = '#Tepung Beras';

type SqlArg = string | number | null;
type Row = Record<string, SqlArg>;

async function select(sql: string, args: SqlArg[] = []): Promise<Row[]> {
  const client = await tenantClient();
  try {
    const result = await client.execute({ sql, args });
    return result.rows as unknown as Row[];
  } finally {
    client.close();
  }
}

async function mutate(sql: string, args: SqlArg[] = []): Promise<void> {
  const client = await tenantClient();
  try {
    await client.execute({ sql, args });
  } finally {
    client.close();
  }
}

async function userId(email: string): Promise<string> {
  const rows = await select('SELECT id FROM users WHERE email = ?', [email]);
  assert.equal(rows.length, 1, `users has no single row for ${email}`);
  return String(rows[0].id);
}

/** Conversation row by channel name (names are stored normalized, slug-like). */
async function channelRow(name: string): Promise<Row | null> {
  const rows = await select(
    "SELECT id, kind, name, archived, last_message_preview FROM chat_conversations WHERE kind = 'channel' AND name = ?",
    [name]
  );
  return rows[0] ?? null;
}

/** Drop every conversation this file can create, so a case starts from nothing. */
async function sweepChatRows(): Promise<void> {
  const ids = (
    await select("SELECT id FROM chat_conversations WHERE name LIKE 'e2e-chat%'")
  ).map((row) => String(row.id));
  // The owner↔kasir DM belongs to this file too (idempotent by dm_key, so a
  // stale one simply gets replaced — remove it to make "exactly one" check true).
  ids.push(...(await dmIds()));
  for (const id of new Set(ids)) {
    await deleteConversation(id);
  }
}

/** Conversations between the demo owner and the e2e cashier, whichever kind. */
async function dmIds(): Promise<string[]> {
  const [ownerId, kasirId] = [await userId(OWNER_EMAIL), await userId(KASIR_EMAIL)];
  const rows = await select(
    `SELECT c.id FROM chat_conversations c
       JOIN chat_participants po ON po.conversation_id = c.id AND po.user_id = ?
       JOIN chat_participants pk ON pk.conversation_id = c.id AND pk.user_id = ?
      WHERE c.kind = 'dm'`,
    [ownerId, kasirId]
  );
  return rows.map((row) => String(row.id));
}

/** Children first: a conversation and everything that points at it. */
async function deleteConversation(id: string): Promise<void> {
  await mutate(
    `DELETE FROM chat_mentions WHERE message_id IN (SELECT id FROM chat_messages WHERE conversation_id = ?)`,
    [id]
  );
  await mutate('DELETE FROM chat_messages WHERE conversation_id = ?', [id]);
  await mutate('DELETE FROM chat_participants WHERE conversation_id = ?', [id]);
  await mutate('DELETE FROM chat_conversations WHERE id = ?', [id]);
}

/**
 * Drop this file's two mention messages so a retry of the mention case starts
 * from the same state — the plain message from the previous case stays, because
 * the cashier case asserts on it.
 */
async function sweepMentionMessages(conversationId: string): Promise<void> {
  for (const suffix of [MSG_USER_MENTION, MSG_PRODUCT_MENTION]) {
    await mutate(
      `DELETE FROM chat_mentions WHERE message_id IN
         (SELECT id FROM chat_messages WHERE conversation_id = ? AND body LIKE ?)`,
      [conversationId, `%${suffix}`]
    );
    await mutate(
      'DELETE FROM chat_messages WHERE conversation_id = ? AND body LIKE ?',
      [conversationId, `%${suffix}`]
    );
  }
}

/** The composer textarea on the chat screen. */
type ComposerLocator = {
  fill: (value: string) => Promise<void>;
  press: (key: string) => Promise<void>;
  inputValue: () => Promise<string>;
};
function composer(screen: {
  getByPlaceholder: (pattern: RegExp | string) => ComposerLocator;
}) {
  return screen.getByPlaceholder(/^Tulis pesan/);
}

describe('internal team chat', { tags: ['owner', 'kasir', 'chat'], agentContext: APP_CONTEXT }, () => {
  test('the rail offers channels to the owner and only DMs to a cashier', { session: 'owner' }, async ({ app, screen }) => {
    await app.open('/backoffice/chat');
    await expect(screen.getByText('Pesan langsung')).toBeVisible();
    await expect(screen.getByRole('button', { name: 'Pesan', exact: true })).toBeVisible();
    // "Channel" is the manage_channels affordance; the owner has it.
    await expect(screen.getByRole('button', { name: 'Channel', exact: true })).toBeVisible();
  });

  test('a cashier reaches chat without manage_channels', { session: 'kasir' }, async ({ app, screen }) => {
    // use_chat is default-on for every role precisely so owners can reach staff.
    await app.open('/backoffice/chat');
    await expect(screen.getByText('Pesan langsung')).toBeVisible();
    await expect(screen.getByRole('button', { name: 'Pesan', exact: true })).toBeVisible();
    await expect(screen.getByRole('button', { name: 'Channel', exact: true })).toBeHidden();
  });

  test(
    'the owner creates a channel with a member and the message lands in the DB',
    { session: 'owner' },
    async ({ app, screen }) => {
      await sweepChatRows();

      await app.open('/backoffice/chat');
      await screen.getByRole('button', { name: 'Channel', exact: true }).tap();

      const dialog = screen.getByRole('dialog', { name: 'Channel baru' });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel('Nama').fill(CHANNEL);
      // Member picker: searchUsers is a name/email LIKE match, ASCII-case-free.
      await dialog.getByPlaceholder(/Cari nama atau email/).fill('kasir');
      await dialog.getByRole('button', { name: /Kasir E2E/ }).tap();
      await dialog.getByRole('button', { name: 'Buat channel' }).tap();
      await expect(dialog).toBeHidden();

      // Rail row + header, then the first message. The header assertion is not
      // decoration: the pane used to keep the previously open conversation on
      // screen while the new one loaded (`placeholderData: keepPreviousData` on
      // an id-keyed query), and a message typed in that window was written to
      // the *other* channel. Typing only becomes safe once the header names the
      // channel under test, and the DB checks below prove it stayed that way.
      await expect(screen.getByText(CHANNEL).first()).toBeVisible();
      await expect(screen.getByText(`#${CHANNEL}`)).toBeVisible();
      const area = composer(screen);
      await area.fill(MSG_PLAIN);
      await area.press('Enter');
      await expect(screen.getByText(MSG_PLAIN).first()).toBeVisible();
      await expect(area).toHaveValue('');

      const channel = await channelRow(CHANNEL);
      assert.ok(channel, `chat_conversations has no channel "${CHANNEL}"`);
      assert.equal(Number(channel.archived), 0);
      assert.equal(String(channel.last_message_preview), MSG_PLAIN);

      const members = await select(
        'SELECT user_id FROM chat_participants WHERE conversation_id = ?',
        [String(channel.id)]
      );
      assert.equal(members.length, 2, 'creator + picked cashier should be the members');

      const stored = await select(
        'SELECT body, sender_id FROM chat_messages WHERE conversation_id = ? ORDER BY created_at',
        [String(channel.id)]
      );
      assert.equal(stored.length, 1);
      assert.equal(String(stored[0].body), MSG_PLAIN);
    }
  );

  test(
    '@ and # mentions become chips whose snapshots the DB keeps, and the product chip navigates',
    { session: 'owner' },
    async ({ app, screen, browser }) => {
      // Retry-safe: drop this case's own messages first, so the strict counts
      // below describe one send, not however many attempts ran before.
      const existing = await channelRow(CHANNEL);
      assert.ok(existing, `the channel "${CHANNEL}" from the previous case is gone`);
      await sweepMentionMessages(String(existing.id));

      await app.open('/backoffice/chat');
      await screen.getByRole('button', { name: new RegExp(CHANNEL) }).tap();
      const area = composer(screen);

      // A person mention: "@kasir" (no space — the active token stops at one),
      // accepted with Enter, finished as plain text. The picker is a listbox, so
      // its rows are `option`s and cannot be confused with the rail row that
      // also carries the same label.
      await area.fill('@kasir');
      await expect(area).toHaveValue('@kasir');
      await expect(screen.getByRole('option', { name: /@Kasir E2E/ }).first()).toBeVisible();
      await area.press('Enter');
      const userText = `${await area.inputValue()}${MSG_USER_MENTION}`;
      await area.fill(userText);
      await area.press('Enter');
      await expect(screen.getByText('@Kasir E2E').first()).toBeVisible();

      // An entity mention, same dance, then click the chip. The demo tenant has
      // exactly one product matching "beras": Tepung Beras (TPG-005), and a
      // suggestion's accessible name is "#<name> <sku>". Waiting for the option
      // before pressing Enter is not decoration: the composer refuses to send a
      // token whose search is still in flight, so the accept must be proven on
      // the settled list — and the value assertion proves the token was
      // replaced by its label instead of being fired off as a message.
      await area.fill('#beras');
      await expect(area).toHaveValue('#beras');
      await expect(screen.getByRole('option', { name: /#Tepung Beras/ }).first()).toBeVisible();
      await area.press('Enter');
      await expect(area).toHaveValue(`${PRODUCT_LABEL} `);
      await area.fill(`${PRODUCT_LABEL} ${MSG_PRODUCT_MENTION}`);
      await area.press('Enter');

      const chip = screen.getByRole('button', { name: PRODUCT_LABEL, exact: true }).first();
      await expect(chip).toBeVisible();
      await chip.tap();
      await expect(screen.getByRole('heading', 'Inventory Produk', { level: 1 })).toBeVisible();
      const search = await browser.evaluate(() => window.location.search);
      assert.match(String(search), /product=/, 'the chip did not deep-link with ?product=<id>');

      const channel = await channelRow(CHANNEL);
      assert.ok(channel, 'the channel from the previous case is gone');
      const mentions = await select(
        `SELECT m.kind, m.label FROM chat_mentions m
           JOIN chat_messages msg ON msg.id = m.message_id
          WHERE msg.conversation_id = ? ORDER BY msg.created_at`,
        [String(channel.id)]
      );
      assert.deepEqual(
        mentions.map((row) => String(row.kind)).sort(),
        ['product', 'user'],
        'the two mention messages should have written one user and one product snapshot'
      );
      assert.equal(String(mentions.find((row) => row.kind === 'user')!.label), '@Kasir E2E');
      assert.equal(String(mentions.find((row) => row.kind === 'product')!.label), PRODUCT_LABEL);
    }
  );

  test(
    'the cashier sees the channel and its messages after a poll tick',
    { session: 'kasir' },
    async ({ app, screen }) => {
      await app.open('/backoffice/chat');
      // The list polls every 10s and the assertion retries for 60s, so this
      // is the polling model being proven, not a lucky timing.
      await expect(screen.getByText(CHANNEL).first()).toBeVisible();
      await screen.getByRole('button', { name: new RegExp(CHANNEL) }).tap();
      await expect(screen.getByText(MSG_PLAIN).first()).toBeVisible();
      await expect(screen.getByText(MSG_PRODUCT_MENTION).first()).toBeVisible();
      // The cashier was mentioned by name — the chip renders for them too.
      await expect(screen.getByText('@Kasir E2E').first()).toBeVisible();
    }
  );

  test(
    'opening a DM twice lands on one conversation, idempotent through dm_key',
    { session: 'owner' },
    async ({ app, screen }) => {
      // One DM per pair is the invariant under test, so start from no DM at all
      // (also what makes a retry of this case meaningful).
      for (const id of await dmIds()) await deleteConversation(id);

      await app.open('/backoffice/chat');
      const openDm = async () => {
        await screen.getByRole('button', { name: 'Pesan', exact: true }).tap();
        const dialog = screen.getByRole('dialog', { name: 'Pesan pribadi' });
        await dialog.getByPlaceholder(/Cari nama atau email/).fill('kasir');
        await dialog.getByRole('button', { name: /Kasir E2E/ }).tap();
        await expect(dialog).toBeHidden();
      };

      await openDm();
      await expect(screen.getByText('Kasir E2E').first()).toBeVisible();
      const area = composer(screen);
      await area.fill(MSG_DM);
      await area.press('Enter');
      await expect(screen.getByText(MSG_DM).first()).toBeVisible();

      // Second time, same person: the unique dm_key must collapse onto the
      // existing thread instead of starting a parallel one.
      await openDm();
      const [ownerId, kasirId] = [await userId(OWNER_EMAIL), await userId(KASIR_EMAIL)];
      const dms = await select(
        `SELECT c.id FROM chat_conversations c
           JOIN chat_participants po ON po.conversation_id = c.id AND po.user_id = ?
           JOIN chat_participants pk ON pk.conversation_id = c.id AND pk.user_id = ?
          WHERE c.kind = 'dm'`,
        [ownerId, kasirId]
      );
      assert.equal(dms.length, 1, 'two DMs with the same person must not exist');

      const dmMsg = await select(
        'SELECT body FROM chat_messages WHERE conversation_id = ?',
        [String(dms[0].id)]
      );
      assert.deepEqual(dmMsg.map((row) => String(row.body)), [MSG_DM]);
    }
  );

  test('the cashier sees the DM from the owner', { session: 'kasir' }, async ({ app, screen }) => {
    await app.open('/backoffice/chat');
    // dmPartner(): a DM row carries the OTHER person's name, which is only
    // possible because `listConversations` aggregates every participant — a
    // join filtered to the reader would leave the generic fallback here. The
    // row's accessible name leads with the avatar initials ("SU Surya 01.17
    // dm halo"), so the partner is matched in the middle, not anchored.
    await expect(screen.getByRole('button', { name: /Surya/ })).toBeVisible();
    await expect(screen.getByRole('button', { name: /Pesan pribadi/ })).toBeHidden();
    await screen.getByRole('button', { name: /Surya/ }).first().tap();
    await expect(screen.getByText(MSG_DM).first()).toBeVisible();
  });

  test(
    'archiving a channel takes it out of the rail and stamps the row',
    { session: 'owner' },
    async ({ app, screen }) => {
      // A previous attempt may have archived it; the case is about the UI taking
      // it out of the rail, so put it back on the rail first.
      await mutate('UPDATE chat_conversations SET archived = 0 WHERE kind = ? AND name = ?', [
        'channel',
        CHANNEL,
      ]);

      await app.open('/backoffice/chat');
      await screen.getByRole('button', { name: new RegExp(CHANNEL) }).tap();
      await screen.getByRole('button', { name: 'Opsi channel' }).tap();
      await screen.getByText('Arsipkan channel').tap();

      await expect(screen.getByText(CHANNEL)).toHaveCount(0);
      const channel = await channelRow(CHANNEL);
      assert.ok(channel, 'archiving must not delete the conversation row');
      assert.equal(Number(channel.archived), 1);
    }
  );
});
