// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BarcodeGenerator } from './BarcodeGenerator';

// jsdom has no canvas text measurement; retain the real SVG barcode renderer.
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    font: '',
    measureText: (text: string) => ({ width: text.length * 7 }),
  } as unknown as ReturnType<HTMLCanvasElement['getContext']>);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('barcode label contrast', () => {
  it.each([1.5, 2, 3])('renders an opaque white background and quiet zones for width %s', (width) => {
    render(<BarcodeGenerator value="0123456789012" width={width} />);
    const svg = screen.getByRole('img', { name: 'Barcode 0123456789012' });
    const background = svg.querySelector('rect');
    expect(background?.getAttribute('fill')).toBe('#ffffff');
    expect(parseFloat(background!.getAttribute('width')!)).toBe(parseFloat(svg.getAttribute('width')!));
    expect(parseFloat(background!.getAttribute('height')!)).toBe(parseFloat(svg.getAttribute('height')!));
    const group = svg.querySelector('g');
    expect(group?.getAttribute('transform')).toBe(`translate(${Math.ceil(width * 10)}, 8)`);
    expect(group?.getAttribute('fill')).toBe('#000000');
    expect(svg.querySelector('text')?.textContent).toBe('0123456789012');
  });
});
