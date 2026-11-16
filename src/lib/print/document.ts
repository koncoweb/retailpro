/**
 * The print document model.
 *
 * One plain structure feeds every renderer — the 80mm HTML template behind
 * `window.print()` (USB/network printers via the OS driver) and the ESC/POS
 * byte encoder (WebUSB / Web Bluetooth / downloadable `.prn`). Builders in
 * `receipt-doc.ts` and `zreport-doc.ts` fill this in; nothing below touches
 * the DOM, so the whole layout is unit-testable without a browser.
 *
 * Width is measured in *characters*, not millimetres: thermal printers speak
 * fixed-pitch columns, 48 for 80mm paper and 32 for 58mm (Font A 12x24).
 * Every line the builders emit must fit `columns`, or the printer wraps it
 * mid-number and the receipt becomes homework.
 */

/** One line of the receipt. `cols` is a left/right padded pair. */
export interface PrintDocLine {
  /** Plain text when `cols` is absent. */
  text?: string;
  /** 1 = normal, 2 = double height+width (title rows). */
  size?: 1 | 2;
  align?: 'left' | 'center' | 'right';
  /** Bold (`ESC E` in ESC/POS, `font-weight: 700` in HTML). */
  bold?: boolean;
  /** Struck through (`ESC G` in ESC/POS, `line-through` in HTML). Voided lines. */
  strikethrough?: boolean;
  /** Rendered as `left` padded right + `right` padded left inside `columns`. */
  cols?: [string, string];
}

export type PrintDocKind = 'sale' | 'zreport' | 'test';

export interface PrintDoc {
  kind: PrintDocKind;
  /** Store identity block (name, address). */
  header: PrintDocLine[];
  body: PrintDocLine[];
  /** Footer message + timestamps, centred. */
  footer: PrintDocLine[];
  /** Character width of the target paper. */
  columns: number;
}

/**
 * Thermal receipt roll widths stocked for Indonesian POS printers. 58mm and
 * 80mm are by far the most common; 60mm rolls run in the same 58-class
 * mechanisms, while 72mm/76mm cover narrower print areas on desktop 80mm
 * units and impact-style notes. Column counts are the conservative Font A
 * (203 dpi, 12 dots ≈ 1.5 mm/char) fit so a line never wraps mid-number.
 */
export type PaperWidth = 58 | 60 | 72 | 76 | 80;

/** Every selectable width, ascending — the UI iterates this, not a literal. */
export const PAPER_WIDTHS: readonly PaperWidth[] = [58, 60, 72, 76, 80];

/**
 * Snap any persisted/unknown value to a supported width. Tenant settings are
 * free-form JSON, so an old or hand-edited `paperWidthMm` must never reach
 * `columnsForPaper` (whose switch is exhaustive) and yield `undefined`.
 */
export function normalizePaperWidth(value: unknown): PaperWidth {
  const w = Number(value);
  return (PAPER_WIDTHS as readonly number[]).includes(w)
    ? (w as PaperWidth)
    : 80;
}

/** Character columns for a paper width in millimetres. */
export function columnsForPaper(paperWidthMm: PaperWidth): number {
  switch (paperWidthMm) {
    case 58:
    case 60:
      return 32;
    case 72:
      return 42;
    case 76:
      return 44;
    case 80:
      return 48;
  }
}

export function dividerLine(columns: number, char: '-' | '=' = '-'): PrintDocLine {
  return { text: char.repeat(columns), align: 'left' };
}

export function blankLine(): PrintDocLine {
  return { text: '' };
}

/**
 * Format a rupiah amount for a receipt column: `Rp 12.500`, right-anchored
 * digits so pairs stay readable at a fixed width.
 */
export function rupiah(value: number): string {
  const rounded = Math.round(value);
  const abs = Math.abs(rounded).toLocaleString('id-ID');
  return `${rounded < 0 ? '-' : ''}Rp ${abs}`;
}

/**
 * Trim a label to fit next to its value without the pair wrapping: the value
 * keeps its column, dots signal truncation.
 */
export function fitLabel(label: string, room: number): string {
  if (label.length <= room) return label;
  return `${label.slice(0, Math.max(1, room - 1))}.`;
}

/**
 * One "name ......... price" line, padded to exactly `columns`.
 *
 * Kept as a helper because both the ESC/POS encoder and the HTML renderer must
 * produce the *same* layout — a receipt that reflows per renderer is how the
 * two paths drift apart.
 */
export function padPair(left: string, right: string, columns: number): string {
  const gap = columns - left.length - right.length;
  if (gap <= 0) {
    // No room for both: shrink the label, never the amount.
    return `${fitLabel(left, Math.max(1, columns - right.length - 1))} ${right}`.slice(0, columns);
  }
  return `${left}${' '.repeat(gap)}${right}`;
}

/**
 * Flatten a line to its printable string, resolving a `cols` pair into the
 * padded, `columns`-wide form. Both renderers call this so the paper layout is
 * decided once, not once per output path.
 */
export function resolveLineText(line: PrintDocLine, columns: number): string {
  if (line.cols) return padPair(line.cols[0], line.cols[1], columns);
  return line.text ?? '';
}

/** Localised date/time for the small-print rows (`06/11/2026 21:15`). */
export function stampDate(value: string | number | Date): string {
  const d = new Date(value);
  return `${d.toLocaleDateString('id-ID')} ${d.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

/** `12j 13m` between two instants, for the shift duration row. */
export function durationLabel(start: string | number | Date, end: string | number | Date): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!isFinite(ms) || ms < 0) return '-';
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}h ${hours % 24}j`;
  if (hours > 0) return `${hours}j ${minutes % 60}m`;
  return `${minutes}m`;
}
