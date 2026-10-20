import { describe, expect, it } from 'vitest';
import { PREVIEW_CARD_WIDTH, previewPlacement, type AnchorRect } from './preview-placement.ts';

/**
 * Attack on PR #417 (slice 6a): the preview card near every edge, over a
 * seeded spread of links in windows from the app's minimum (720 × 480) up.
 */

/** Mulberry32: the same spread on every run. */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The room `previewPlacement` keeps for the card's height (its head, four lines, its foot). */
const CARD_HEIGHT = 180;
const EDGE = 8;

function cases() {
  const random = seeded(417);
  return Array.from({ length: 2000 }, () => {
    const viewport = {
      width: Math.round(720 + random() * 1200),
      height: Math.round(480 + random() * 700),
    };
    const lineHeight = 16 + Math.round(random() * 8);
    const top = Math.round(random() * (viewport.height - lineHeight));
    const anchor: AnchorRect = {
      left: Math.round(random() * (viewport.width - 20)),
      top,
      bottom: top + lineHeight,
    };
    return { viewport, anchor };
  });
}

function boxOf(anchor: AnchorRect, viewport: { width: number; height: number }) {
  const placed = previewPlacement(anchor, viewport);
  const top = 'top' in placed ? placed.top : viewport.height - placed.bottom - CARD_HEIGHT;
  return {
    left: placed.left,
    top,
    right: placed.left + PREVIEW_CARD_WIDTH,
    bottom: top + CARD_HEIGHT,
  };
}

describe('previewPlacement attack-417: a seeded spread of links', () => {
  it('keeps the card inside the window, an edge clear on every side', () => {
    const off = cases().filter(({ anchor, viewport }) => {
      const box = boxOf(anchor, viewport);
      return (
        box.left < EDGE ||
        box.top < 0 ||
        box.right > viewport.width - EDGE ||
        box.bottom > viewport.height
      );
    });
    expect(off).toEqual([]);
  });

  it('never covers the link it is for', () => {
    const covering = cases().filter(({ anchor, viewport }) => {
      const box = boxOf(anchor, viewport);
      return box.top < anchor.bottom && box.bottom > anchor.top;
    });
    expect(covering).toEqual([]);
  });

  it('lines its left edge up with the link wherever the window has room', () => {
    const moved = cases().filter(
      ({ anchor, viewport }) =>
        anchor.left >= EDGE &&
        anchor.left + PREVIEW_CARD_WIDTH <= viewport.width - EDGE &&
        previewPlacement(anchor, viewport).left !== anchor.left,
    );
    expect(moved).toEqual([]);
  });
});

describe('previewPlacement attack-417: the corners', () => {
  it('puts a link at the very bottom-right corner card above it and inside the window', () => {
    const viewport = { width: 720, height: 480 };
    const placed = previewPlacement({ left: 700, top: 462, bottom: 480 }, viewport);
    expect(placed).toEqual({ left: 720 - PREVIEW_CARD_WIDTH - EDGE, bottom: 480 - 462 + 6 });
  });

  it('puts a link half off the top of the window card below it', () => {
    const placed = previewPlacement({ left: 40, top: -10, bottom: 8 }, { width: 720, height: 480 });
    expect(placed).toEqual({ left: 40, top: 14 });
  });
});
