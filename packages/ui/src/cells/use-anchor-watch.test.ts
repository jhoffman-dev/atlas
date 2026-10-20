// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { anchorInView } from './use-anchor-watch.ts';

function boxed(top: number, bottom: number): HTMLElement {
  const element = document.body.appendChild(document.createElement('div'));
  element.getBoundingClientRect = () => ({ top, bottom }) as DOMRect;
  return element;
}

describe('anchorInView (#425)', () => {
  const sheet = boxed(100, 500);

  it('holds for a cell drawn inside the sheet, or partly inside it', () => {
    expect(anchorInView(boxed(200, 234), sheet)).toBe(true);
    expect(anchorInView(boxed(480, 514), sheet)).toBe(true);
  });

  it('fails for a cell scrolled above or below the sheet', () => {
    expect(anchorInView(boxed(40, 74), sheet)).toBe(false);
    expect(anchorInView(boxed(520, 554), sheet)).toBe(false);
  });

  it('fails for a cell taken out of the page, or none', () => {
    const gone = boxed(200, 234);
    gone.remove();
    expect(anchorInView(gone, sheet)).toBe(false);
    expect(anchorInView(null, sheet)).toBe(false);
  });
});
