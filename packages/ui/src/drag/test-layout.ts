/**
 * Test support: enough layout for dnd-kit to run inside jsdom.
 *
 * jsdom lays nothing out, so every box is empty and dnd-kit can find no drop
 * target. A test hands `layOut` the box each element should have, and can then
 * drive a real keyboard drag through the real sensor.
 */
import { act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { Box } from './snapping.ts';

export type { Box } from './snapping.ts';

const EMPTY: Box = { left: 0, top: 0, width: 0, height: 0 };

function rectOf({ left, top, width, height }: Box): DOMRect {
  const rect = {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
  return { ...rect, toJSON: () => rect };
}

/**
 * The drag overlay is placed by dnd-kit itself, from the box of the item it
 * stands in for, in its inline style; it measures the overlay's first child.
 * Reading that style back is what a browser would report for either (dnd-kit
 * adds the transform on top of the measurement itself).
 */
function overlayBox(element: Element): Box | null {
  const overlay = [element, element.parentElement].find(
    (node) => node instanceof HTMLElement && node.style.position === 'fixed',
  );
  if (!(overlay instanceof HTMLElement)) return null;
  const px = (value: string) => Number.parseFloat(value) || 0;
  const { left, top, width, height } = overlay.style;
  return { left: px(left), top: px(top), width: px(width), height: px(height) };
}

export function layOut(boxOf: (element: Element) => Box | null) {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return rectOf(overlayBox(this) ?? boxOf(this) ?? EMPTY);
  });
}

/** The keyboard sensor starts listening a tick after the pick-up key. */
const nextTick = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

/** Space to pick up, each move in turn, then `finish` — Space to drop by default. */
export async function dragByKeyboard(
  handle: HTMLElement,
  moves: readonly string[],
  { finish = ' ' }: { finish?: string } = {},
) {
  const user = userEvent.setup();
  handle.focus();
  await user.keyboard(' ');
  await nextTick();
  for (const move of moves) {
    await user.keyboard(move);
    await nextTick();
  }
  await user.keyboard(finish);
  await nextTick();
}

/** What dnd-kit's live region last said. */
export function announced(): string {
  return document.querySelector('[id^="DndLiveRegion"]')?.textContent ?? '';
}
