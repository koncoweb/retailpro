// @vitest-environment jsdom
import { useRef } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBarcodeScanner } from './use-barcode-scanner';

let now = 1000;
beforeEach(() => {
  now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function burst(code: string, terminator = 'Enter', gap = 5) {
  for (const key of code) { now += gap; fireEvent.keyDown(document.body, { key }); }
  now += gap;
  return fireEvent.keyDown(document.body, { key: terminator });
}

describe('keyboard-wedge barcode capture', () => {
  it('captures repeated fast scans without focus and consumes Enter/Tab once', () => {
    const onScan = vi.fn();
    renderHook(() => useBarcodeScanner({ onScan }));
    expect(burst('012345')).toBe(false);
    expect(burst('012345', 'Tab')).toBe(false);
    expect(onScan.mock.calls).toEqual([['012345'], ['012345']]);
  });

  it('ignores slow typing, short bursts, empty Enter and modified chords', () => {
    const onScan = vi.fn();
    renderHook(() => useBarcodeScanner({ onScan }));
    burst('123456', 'Enter', 120); burst('123'); burst('');
    fireEvent.keyDown(document.body, { key: 'x', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(onScan).not.toHaveBeenCalled();
  });

  it('keeps uppercase and punctuation through Shift keystrokes', () => {
    const onScan = vi.fn();
    renderHook(() => useBarcodeScanner({ onScan }));
    for (const key of ['Shift', 'A', 'Shift', 'B', '-', '1', '2', 'Enter']) {
      now += 5; fireEvent.keyDown(document.body, { key });
    }
    expect(onScan).toHaveBeenCalledWith('AB-12');
  });

  it('uses the latest callback and drops pending scans on disable/unmount', () => {
    const first = vi.fn(), latest = vi.fn();
    const { rerender, unmount } = renderHook(({ enabled, onScan }) => useBarcodeScanner({ enabled, onScan }), {
      initialProps: { enabled: true, onScan: first },
    });
    rerender({ enabled: true, onScan: latest }); burst('98765');
    expect(first).not.toHaveBeenCalled(); expect(latest).toHaveBeenCalledOnce();
    rerender({ enabled: false, onScan: latest }); burst('98765');
    unmount(); burst('98765');
    expect(latest).toHaveBeenCalledOnce();
  });

  it('accepts manual Enter only in the designated field and protects unrelated fields/dialogs', () => {
    const onScan = vi.fn(), submit = vi.fn();
    function Harness() {
      const scanInput = useRef<HTMLInputElement>(null);
      useBarcodeScanner({ onScan, scanInput });
      return <form onSubmit={submit}>
        <input aria-label="Scanner" ref={scanInput} />
        <input aria-label="Quantity" />
        <div role="dialog"><button type="button">Other dialog</button></div>
      </form>;
    }
    render(<Harness />);
    const scanner = screen.getByLabelText('Scanner');
    fireEvent.change(scanner, { target: { value: '  A  ' } });
    now += 500;
    expect(fireEvent.keyDown(scanner, { key: 'Enter' })).toBe(false);
    expect(onScan).toHaveBeenCalledWith('A'); expect(submit).not.toHaveBeenCalled();
    for (const target of [screen.getByLabelText('Quantity'), screen.getByText('Other dialog')]) {
      act(() => { for (const key of '12345') fireEvent.keyDown(target, { key }); fireEvent.keyDown(target, { key: 'Enter' }); });
    }
    expect(onScan).toHaveBeenCalledOnce();
  });
});
