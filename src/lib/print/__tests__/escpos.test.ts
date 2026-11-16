import { describe, it, expect } from 'vitest';
import { encodeEscpos } from '@/lib/print/escpos';
import { buildSaleReceipt, type ReceiptConfig } from '@/lib/print/receipt-doc';
import type { PrintDoc } from '@/lib/print/document';

const CFG: ReceiptConfig = {
  storeName: 'Toko',
  paperWidthMm: 80,
  showLogo: true,
};

const doc: PrintDoc = buildSaleReceipt(
  {
    invoiceNumber: 'INV/1',
    createdAt: '2026-11-06T14:05:00.000Z',
    total: 12500,
    amountPaid: 20000,
    paymentMethod: 'cash',
    items: [{ name: 'Roti', quantity: 1, unitName: 'Pcs', unitPrice: 12500, subtotal: 12500 }],
  },
  CFG
);

function indexOfSeq(hay: Uint8Array, needle: number[]): number {
  outer: for (let i = 0; i + needle.length <= hay.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

describe('encodeEscpos', () => {
  it('starts with ESC @ (initialise)', () => {
    const bytes = encodeEscpos(doc);
    expect(bytes[0]).toBe(0x1b);
    expect(bytes[1]).toBe(0x40);
  });

  it('emits the rupiah amount as plain ASCII so no code page is needed', () => {
    const bytes = encodeEscpos(doc);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('Rp 12.500');
  });

  it('adds a partial-cut command only when autoCut is requested', () => {
    const withCut = encodeEscpos(doc, { autoCut: true });
    const withoutCut = encodeEscpos(doc, { autoCut: false });
    expect(indexOfSeq(withCut, [0x1d, 0x56, 0x42, 0x00])).toBeGreaterThanOrEqual(0);
    expect(indexOfSeq(withoutCut, [0x1d, 0x56, 0x42, 0x00])).toBe(-1);
  });

  it('kicks the cash drawer only when asked', () => {
    const drawer = encodeEscpos(doc, { openCashDrawer: true });
    const noDrawer = encodeEscpos(doc, { openCashDrawer: false });
    expect(indexOfSeq(drawer, [0x1b, 0x70, 0x00, 25, 250])).toBeGreaterThanOrEqual(0);
    expect(indexOfSeq(noDrawer, [0x1b, 0x70, 0x00, 25, 250])).toBe(-1);
  });

  it('degrades non-printable characters instead of desyncing the decoder', () => {
    const emojiDoc: PrintDoc = {
      ...doc,
      body: [{ text: 'Harga ✓ OK' }],
    };
    const bytes = encodeEscpos(emojiDoc);
    // The checkmark (0x2713) is outside printable ASCII → becomes '?', and no
    // byte above 0x7e leaks into the stream.
    for (const b of bytes) {
      if (b > 0x7e) expect(b).toBeLessThanOrEqual(0x7e);
    }
    expect(new TextDecoder().decode(bytes)).toContain('Harga ? OK');
  });

  it('turns strike font on for a voided line and off again for the next', () => {
    // ESC G <n> is what crosses a voided line out on paper; a printer that
    // ignores it still gets the [VOID] text marker from the doc itself.
    const strikeDoc: PrintDoc = {
      ...doc,
      body: [{ text: 'Gula Pasir', strikethrough: true }, { text: 'Tepung Terigu' }],
    };
    const bytes = encodeEscpos(strikeDoc);
    expect(indexOfSeq(bytes, [0x1b, 0x47, 0x01])).toBeGreaterThanOrEqual(0);
    expect(indexOfSeq(bytes, [0x1b, 0x47, 0x00])).toBeGreaterThanOrEqual(0);
    const on = indexOfSeq(bytes, [0x1b, 0x47, 0x01]);
    // Strike is switched back off after the voided line, so it cannot leak
    // into the lines that follow it.
    expect(indexOfSeq(bytes.subarray(on + 3), [0x1b, 0x47, 0x00])).toBeGreaterThanOrEqual(0);
  });
});
