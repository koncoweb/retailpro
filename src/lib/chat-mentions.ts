/**
 * The pure grammar of chat mentions — no database, no React.
 *
 * A mention is a *readable* label the composer inserts into the message body
 * ("@Budi", "#Kopi ABC") paired with a structured reference (kind + entity id)
 * that lives in `chat_mentions`. We deliberately do NOT re-parse '@'/'#' out of
 * the text at render time: that is fragile (a casual "copy @ 50%" would become
 * a chip, a renamed product would break its links). Instead the body keeps the
 * natural text so it stays searchable, and the structured rows decide what each
 * span means. This module is the single place that turns the two back into an
 * ordered list of segments to render, so the rendering rule has exactly one
 * implementation — the same discipline `stock-issue.ts` and `void.ts` follow.
 */

/** What a `#` may reference, plus `@` for a person. */
export type MentionKind = 'user' | 'product' | 'invoice' | 'po' | 'vendor';

/** Every kind the autocomplete offers; `user` is reached with `@`, the rest with `#`. */
export const MENTION_KINDS: MentionKind[] = ['user', 'product', 'invoice', 'po', 'vendor'];

/**
 * A mention as it is captured at send time. `entity_id` is the row the chip
 * deep-links to; `label` is the exact substring that was inserted into the body,
 * including the leading `@`/`#` (e.g. `"@Budi"`, `"#PO-0007"`). `entity_id` may
 * be null in the rendered view when the referenced row is later deleted — the
 * snapshot `label` is what still reads correctly.
 */
export interface MentionPayload {
  kind: MentionKind;
  entity_id: string | null;
  label: string;
}

/** A slice of a rendered message body: plain text, or one mention chip. */
export type Segment =
  | { type: 'text'; text: string }
  | { type: 'chip'; mention: MentionPayload };

/**
 * Where a `#` chip navigates. Product/invoice/PO land on their list route with a
 * query param naming the row (the `?product=`/`?po=` pattern already used by
 * `BranchOrders.tsx` and `VendorDetail.tsx`); a vendor has a real detail route.
 * A `user` mention has no chat-owned route, so it is only highlighted.
 */
export function entityRoute(kind: MentionKind, id: string): string | null {
  const enc = encodeURIComponent(id);
  switch (kind) {
    case 'product':
      return `/backoffice/inventory/products?product=${enc}`;
    case 'invoice':
      return `/backoffice/pos/transactions?invoice=${enc}`;
    case 'po':
      return `/backoffice/inventory/po?po=${enc}`;
    case 'vendor':
      return `/backoffice/vendors/${enc}`;
    case 'user':
    default:
      return null;
  }
}

/**
 * Keep only the mentions the user actually left in the body when they sent.
 *
 * A selection is dropped if its label was edited away afterwards, so an undo
 * that removed "@Budi" before sending does not persist a dangling chip. Exact
 * duplicates (same kind + entity + label) collapse to one row; mentioning the
 * same person twice still renders on both occurrences because rendering matches
 * every instance of the stored label.
 */
export function extractMentions(
  body: string,
  picked: MentionPayload[]
): MentionPayload[] {
  const out: MentionPayload[] = [];
  for (const p of picked) {
    if (!p || !p.label || !body.includes(p.label)) continue;
    if (
      out.some(
        (v) => v.kind === p.kind && v.entity_id === p.entity_id && v.label === p.label
      )
    ) {
      continue;
    }
    out.push(p);
  }
  return out;
}

/**
 * Split a body into renderable text/chip segments.
 *
 * A single left-to-right scan matches, at each position, the longest known
 * label. Longest-first means "@Budi" wins over a shorter "@Bud" registered at
 * the same offset, so overlapping labels are deterministic. Labels are
 * deduplicated first (two rows sharing one label render as the first), and a
 * label that no longer appears in the body simply never matches — no crash.
 */
export function renderSegments(body: string, mentions: MentionPayload[]): Segment[] {
  if (!body) return [];
  if (!mentions.length) return [{ type: 'text', text: body }];

  const byLabel = new Map<string, MentionPayload>();
  for (const m of mentions) {
    if (m.label && !byLabel.has(m.label)) byLabel.set(m.label, m);
  }
  // Longest label first so a longer span is preferred at the same start index.
  const labels = [...byLabel.keys()].sort((a, b) => b.length - a.length);

  const segments: Segment[] = [];
  let buffer = '';
  let i = 0;
  while (i < body.length) {
    let matched: string | null = null;
    for (const label of labels) {
      if (body.startsWith(label, i)) {
        matched = label;
        break;
      }
    }
    if (matched) {
      if (buffer) {
        segments.push({ type: 'text', text: buffer });
        buffer = '';
      }
      segments.push({ type: 'chip', mention: byLabel.get(matched) as MentionPayload });
      i += matched.length;
    } else {
      buffer += body[i];
      i += 1;
    }
  }
  if (buffer) segments.push({ type: 'text', text: buffer });
  return segments;
}

/**
 * The `@`/`#` token the caret is currently inside, or null.
 *
 * Only a trigger preceded by whitespace or the string start counts (so an email
 * or a "user@host" is not treated as a mention), and the query runs up to the
 * caret with no further whitespace. `start` points at the trigger character so
 * the composer can replace exactly the typed token with a label on selection.
 */
export function findActiveToken(
  text: string,
  caret: number
): { trigger: '@' | '#'; query: string; start: number; caret: number } | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)([@#])([^\s@#]*)$/.exec(before);
  if (!match) return null;
  const trigger = match[2] as '@' | '#';
  const query = match[3];
  const start = caret - query.length - 1;
  return { trigger, query, start, caret };
}

/**
 * Replace the active token with a picked label and record the mention.
 *
 * Returns the new text plus where to place the caret (just past the inserted
 * label and a trailing space, so typing continues naturally) and the updated
 * mention list the composer carries to send time.
 */
export function insertMention(
  text: string,
  token: { start: number; caret: number },
  label: string,
  mentions: MentionPayload[]
): { text: string; caret: number; mentions: MentionPayload[] } {
  const next = `${text.slice(0, token.start)}${label} ${text.slice(token.caret)}`;
  const caret = token.start + label.length + 1;
  return { text: next, caret, mentions };
}
