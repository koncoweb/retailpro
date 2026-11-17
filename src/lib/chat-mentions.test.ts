import { describe, expect, it } from 'vitest';
import {
  MENTION_KINDS,
  entityRoute,
  extractMentions,
  findActiveToken,
  insertMention,
  renderSegments,
  type MentionPayload,
} from './chat-mentions';

const user = (id: string, label: string): MentionPayload => ({
  kind: 'user',
  entity_id: id,
  label,
});

describe('entityRoute', () => {
  it('maps each entity kind to its list/detail route with an encoded id', () => {
    expect(entityRoute('product', 'p/1')).toBe(
      '/backoffice/inventory/products?product=p%2F1'
    );
    expect(entityRoute('invoice', 'i1')).toBe('/backoffice/pos/transactions?invoice=i1');
    expect(entityRoute('po', 'po1')).toBe('/backoffice/inventory/po?po=po1');
    expect(entityRoute('vendor', 'v1')).toBe('/backoffice/vendors/v1');
  });

  it('has no chat-owned route for a person mention', () => {
    expect(entityRoute('user', 'u1')).toBeNull();
  });
});

describe('MENTION_KINDS', () => {
  it('offers a person plus the four referenceable entities', () => {
    expect(MENTION_KINDS).toEqual(['user', 'product', 'invoice', 'po', 'vendor']);
  });
});

describe('extractMentions', () => {
  it('keeps only the labels the body still contains', () => {
    const picked = [user('1', '@Budi'), user('2', '@Siti')];
    expect(extractMentions('halo @Budi', picked)).toEqual([user('1', '@Budi')]);
  });

  it('drops exact duplicates so one chip persists once', () => {
    const picked = [user('1', '@Budi'), user('1', '@Budi')];
    expect(extractMentions('@Budi @Budi', picked)).toHaveLength(1);
  });

  it('returns nothing when every selection was edited away before send', () => {
    expect(extractMentions('halo dunia', [user('1', '@Budi')])).toEqual([]);
  });
});

describe('renderSegments', () => {
  it('splits body into text and chip segments around a mention', () => {
    const segs = renderSegments('lihat #Kopi ABC sekarang', [
      { kind: 'product', entity_id: 'p1', label: '#Kopi ABC' },
    ]);
    expect(segs).toEqual([
      { type: 'text', text: 'lihat ' },
      { type: 'chip', mention: { kind: 'product', entity_id: 'p1', label: '#Kopi ABC' } },
      { type: 'text', text: ' sekarang' },
    ]);
  });

  it('leaves a literal @ or # as plain text when it matches no stored mention', () => {
    expect(renderSegments('diskon 20% @ 50 pcs', [])).toEqual([
      { type: 'text', text: 'diskon 20% @ 50 pcs' },
    ]);
  });

  it('prefers the longest label at the same offset so overlaps resolve', () => {
    const segs = renderSegments('halo @Budi', [
      user('1', '@Bud'),
      user('2', '@Budi'),
    ]);
    expect(segs[1]).toEqual({ type: 'chip', mention: user('2', '@Budi') });
  });

  it('still renders a chip whose entity was deleted, using the snapshot label', () => {
    const segs = renderSegments('rek #Lama', [
      { kind: 'vendor', entity_id: null, label: '#Lama' },
    ]);
    expect(segs[1]).toMatchObject({ type: 'chip', mention: { entity_id: null, label: '#Lama' } });
  });
});

describe('findActiveToken', () => {
  it('detects an @ token preceded by whitespace, with the caret at its end', () => {
    expect(findActiveToken('halo @bud', 9)).toMatchObject({
      trigger: '@',
      query: 'bud',
      start: 5,
      caret: 9,
    });
  });

  it('detects a # token at the very start of the text', () => {
    expect(findActiveToken('#ko', 3)).toMatchObject({ trigger: '#', query: 'ko', start: 0 });
  });

  it('ignores an @ that is glued to a word (an email or user@host)', () => {
    expect(findActiveToken('mail a@b.com', 12)).toBeNull();
  });

  it('stops at whitespace, so a typed space closes the token', () => {
    expect(findActiveToken('halo @budi ', 11)).toBeNull();
  });
});

describe('insertMention', () => {
  it('replaces the active token with the readable label and a trailing space', () => {
    const res = insertMention('halo @bud', { start: 5, caret: 9 }, '@Budi', []);
    expect(res.text).toBe('halo @Budi ');
    expect(res.caret).toBe('halo @Budi '.length);
    // insertMention returns the mentions it was handed; the composer appends the
    // payload separately, so the codec stays a pure string transformation.
    expect(res.mentions).toEqual([]);
  });
});
