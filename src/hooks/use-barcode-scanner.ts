import { useEffect, useRef, type RefObject } from "react";

export interface UseBarcodeScannerOptions {
  /** Called once per completed scan with the decoded string (no terminator). */
  onScan: (code: string) => void;
  /** Set false while a dialog owns the keyboard so its fields still work. */
  enabled?: boolean;
  /** Allow scans in this field, but leave unrelated editable fields alone. */
  scanInput?: RefObject<HTMLInputElement>;
  /** Shortest run that counts as a scan, so a stray Enter is ignored. Default 4. */
  minLength?: number;
  /**
   * Longest gap, in ms, that still keeps two keystrokes in one burst. A USB HID
   * scanner emits characters every few ms; a human cannot. Default 80.
   */
  interKeyTimeoutMs?: number;
}

const TERMINATORS = new Set(["Enter", "Tab"]);

/**
 * Captures a USB HID "keyboard-wedge" scanner (e.g. the Honeywell QuantumT
 * MS3580), which types its decoded string as a burst of keystrokes terminated by
 * Enter or Tab. The scan is recognised by timing — a run of printable characters
 * whose gaps stay under `interKeyTimeoutMs`, closed by a terminator — so it is
 * told apart from a person typing at a normal pace.
 *
 * Listening on `window` in the capture phase is the whole point: the keystrokes
 * register even when no field has focus, which is exactly why scans used to
 * "do nothing" the moment the cashier had clicked a product tile instead of the
 * search box. The consumer decides what a code means (add to cart, fill search).
 */
export function useBarcodeScanner({
  onScan,
  enabled = true,
  scanInput,
  minLength = 4,
  interKeyTimeoutMs = 80,
}: UseBarcodeScannerOptions) {
  const bufferRef = useRef("");
  const lastKeyRef = useRef(0);

  // Keep the newest callback without re-subscribing the window listener on
  // every render — the handler identity changes constantly in a React page.
  const handlerRef = useRef(onScan);
  useEffect(() => {
    handlerRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!enabled) {
      bufferRef.current = "";
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (event.isComposing || event.repeat) return;
      const input = scanInput?.current;
      if (target?.closest('input, textarea, [contenteditable="true"]') && target !== input) {
        bufferRef.current = "";
        return;
      }
      const dialog = target?.closest('[role="dialog"], [role="alertdialog"]');
      if (dialog && dialog !== input?.closest('[role="dialog"], [role="alertdialog"]')) {
        bufferRef.current = "";
        return;
      }
      if (event.key === "Shift") return;
      // A chord (Ctrl/Meta/Alt) is never part of a scan; drop any partial run.
      if (event.ctrlKey || event.metaKey || event.altKey) {
        bufferRef.current = "";
        return;
      }

      const now = performance.now();
      // A long pause means the previous characters were not one scan.
      if (now - lastKeyRef.current > interKeyTimeoutMs) bufferRef.current = "";

      if (TERMINATORS.has(event.key)) {
        const manualEntry = target === input && event.key === "Enter";
        const code = manualEntry ? input.value.trim() : bufferRef.current;
        bufferRef.current = "";
        if (code.length >= (manualEntry ? 1 : minLength)) {
          // Stop the scan's Enter from submitting a surrounding form.
          event.preventDefault();
          event.stopPropagation();
          handlerRef.current(code);
        }
        return;
      }

      // `event.key.length === 1` is a printable character (digits, letters and
      // the punctuation barcodes use); anything longer is a control/function key.
      if (event.key.length === 1) {
        bufferRef.current += event.key;
        lastKeyRef.current = now;
      } else {
        bufferRef.current = "";
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [enabled, scanInput, minLength, interKeyTimeoutMs]);
}
