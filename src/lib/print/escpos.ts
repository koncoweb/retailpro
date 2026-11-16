/**
 * ESC/POS byte encoder.
 *
 * Turns a `PrintDoc` into the raw command stream a thermal printer understands.
 * This is the path for WebUSB / Web Bluetooth printers (the cheap XPrinter
 * ZJ-58/80, Sinjuxson, TopBox units common across Indonesian warungs), and the
 * bytes double as a downloadable `.prn` a user drags onto a spooled queue.
 *
 * Everything is a pure function of the document + a couple of flags, so the
 * byte layout is unit-testable without any hardware or DOM.
 *
 * Code page: PC858 (CP1252 with a euro at 0x40 mapped to our needs). For
 * rupiah we lean on printing the literal ASCII "Rp" — never a currency glyph —
 * because PC858's euro slot and the various vendor code pages disagree, and a
 * mis-decoded symbol prints as garbage. Indonesian text lives entirely in
 * 7-bit ASCII plus a handful of accented vowels we transliterate away.
 */
import { resolveLineText, type PrintDoc, type PrintDocLine } from '@/lib/print/document';

const ESC = 0x1b;
const GS = 0x1d;

/** Optional side effects driven by tenant receipt settings. */
export interface EscposOptions {
  /** `GS V` — cut the paper after the feed. */
  autoCut?: boolean;
  /** Pulse the kick drawer port (cash sales only). */
  openCashDrawer?: boolean;
}

/**
 * Encode one text line to CP437-ish bytes. We keep to printable ASCII; any
 * byte above 0x7e is degraded to '?' so a stray accent never desynchronises
 * the printer's decoder.
 */
function encodeText(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    out.push(code >= 0x20 && code <= 0x7e ? code : 0x3f);
  }
  return out;
}

function alignByte(align: PrintDocLine['align']): number {
  return align === 'center' ? 1 : align === 'right' ? 2 : 0;
}

function encodeLine(line: PrintDocLine, columns: number, bytes: number[]): void {
  const text = resolveLineText(line, columns);

  // ESC a <n>: alignment.
  bytes.push(ESC, 0x61, alignByte(line.align));
  // ESC E <n>: bold on/off.
  bytes.push(ESC, 0x45, line.bold ? 1 : 0);
  // ESC G <n>: strike font on/off — how a voided line prints crossed out.
  bytes.push(ESC, 0x47, line.strikethrough ? 1 : 0);
  // GS ! <n>: character size (width nibble | height nibble). size 2 → 0x11.
  bytes.push(GS, 0x21, line.size === 2 ? 0x11 : 0x00);

  bytes.push(...encodeText(text));
  bytes.push(0x0a); // LF

  // Reset emphasis so the next line is clean.
  bytes.push(ESC, 0x45, 0);
  bytes.push(ESC, 0x47, 0);
  bytes.push(GS, 0x21, 0);
}

/**
 * Encode a whole document. The header/body/footer are concatenated in order —
 * builders already insert their own dividers and blank lines.
 */
export function encodeEscpos(doc: PrintDoc, options: EscposOptions = {}): Uint8Array {
  const bytes: number[] = [];

  // ESC @: initialise — resets every mode, the safe starting point.
  bytes.push(ESC, 0x40);

  for (const line of [...doc.header, ...doc.body, ...doc.footer]) {
    encodeLine(line, doc.columns, bytes);
  }

  // Three blank lines give the tear-off some slack before the cut.
  bytes.push(0x0a, 0x0a, 0x0a);

  if (options.openCashDrawer) {
    // ESC p 0 25 250: pulse pin 0 (the drawer kick port).
    bytes.push(ESC, 0x70, 0x00, 25, 250);
  }

  if (options.autoCut) {
    // GS V B 0: feed + partial cut.
    bytes.push(GS, 0x56, 0x42, 0x00);
  }

  return new Uint8Array(bytes);
}
