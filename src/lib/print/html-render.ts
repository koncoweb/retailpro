/**
 * HTML receipt renderer.
 *
 * The universal print path: a thermal printer installed as an OS printer
 * (USB/kabel or network — Epson TM-T82/TM-U220, XPrinter XP-N160I, and every
 * Bluetooth unit bonded as a Windows printer) is reached through the browser's
 * own `window.print()`. This builds the document string that goes into the
 * hidden iframe.
 *
 * Layout is fixed-pitch, exactly like the ESC/POS encoder: same `columns`,
 * same resolved line text. Only the emphasis differs (font-weight vs `ESC E`),
 * so a receipt looks the same whichever printer a tenant wired up.
 */
import { resolveLineText, type PaperWidth, type PrintDoc, type PrintDocLine } from '@/lib/print/document';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function lineStyle(line: PrintDocLine): string {
  const parts: string[] = [];
  // A `cols` pair is already padded to exactly `columns`, so it must stay on
  // one fixed-pitch line (pre) to keep the amount right-aligned. Plain text
  // (a long footer, a wrapped address) is allowed to soft-wrap instead of
  // overflowing the roll — pre-wrap lets it fold at the paper edge, matching
  // how a thermal printer itself breaks an over-width line.
  parts.push(line.cols ? 'white-space:pre' : 'white-space:pre-wrap;overflow-wrap:anywhere');
  if (line.align) parts.push(`text-align:${line.align}`);
  else parts.push('text-align:left');
  if (line.bold) parts.push('font-weight:700');
  // size 2 doubles the glyph box; in `em` it scales with the fitted base size,
  // mirroring the ESC/POS double-width header on every paper width.
  if (line.size === 2) parts.push('font-size:2em');
  return parts.join(';');
}

function renderLine(line: PrintDocLine, columns: number): string {
  const text = resolveLineText(line, columns);
  // A blank line still needs height, so keep an empty block element.
  return `<div style="${lineStyle(line)}">${escapeHtml(text) || '&nbsp;'}</div>`;
}

/**
 * Build the full HTML document. `widthMm` drives the `@page` size and the
 * container width so the print dialog offers the 80mm (or 58mm) roll instead
 * of A4, which is what makes the margins come out right on a thermal roll.
 */
export function renderReceiptHtml(doc: PrintDoc, widthMm: PaperWidth): string {
  const lines = [...doc.header, ...doc.body, ...doc.footer]
    .map((line) => renderLine(line, doc.columns))
    .join('\n');

  // Fit `columns` monospace characters into the printable width instead of
  // pinning one font size: Courier advances ~0.6em, 1mm = 72/25.4pt. Sizing to
  // the roll is what keeps 80mm/48-col from clipping and makes the narrower
  // high-column sizes (72mm/42, 76mm/44) print like the ESC/POS path does. The
  // 0.98 factor is margin for sub-pixel advance so a full line never wraps.
  const ptPerMm = 72 / 25.4;
  const fittedPt = ((widthMm - 6) * ptPerMm * 0.98) / (doc.columns * 0.6);
  const basePt = Math.min(11, Math.max(4, Math.round(fittedPt * 100) / 100));

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<title>${doc.kind === 'zreport' ? 'Laporan Tutup Shift' : 'Struk'}</title>
<style>
  @page { size: ${widthMm}mm auto; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    font-family: 'Courier New', ui-monospace, monospace;
    /* Auto-fitted so exactly the column count spans the roll (see basePt). */
    font-size: ${basePt}pt;
    line-height: 1.25;
    color: #000;
  }
  .receipt {
    width: ${widthMm - 6}mm;
    margin: 3mm;
    box-sizing: border-box;
  }
  /* The doubled header line is taller; give its block a fixed height so it
     does not overlap the row beneath on some print engines. */
  .receipt div { min-height: 1em; }
</style>
</head>
<body>
  <div class="receipt">
${lines}
  </div>
</body>
</html>`;
}
