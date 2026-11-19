export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

export interface HtmlPrintOptions { onError?: (error: Error) => void; }

/** Isolated print surface shared by A4 documents; leaves the active dialog open. */
export function printHtml(html: string, title: string, options: HtmlPrintOptions = {}): void {
  if (typeof document === "undefined") throw new Error("Pencetakan hanya tersedia di browser");
  const frame = document.createElement("iframe");
  frame.title = title;
  Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  const cleanup = () => frame.remove();
  frame.onload = () => {
    const target = frame.contentWindow;
    if (!target) { cleanup(); options.onError?.(new Error("Jendela cetak tidak dapat dibuka")); return; }
    target.onafterprint = cleanup;
    try {
      target.focus(); target.print();
      window.setTimeout(cleanup, 60_000);
    } catch (error) {
      cleanup();
      options.onError?.(error instanceof Error ? error : new Error("Jendela cetak tidak dapat dibuka"));
    }
  };
  frame.onerror = () => { cleanup(); options.onError?.(new Error("Dokumen cetak gagal dimuat")); };
  frame.srcdoc = html;
  document.body.appendChild(frame);
}
