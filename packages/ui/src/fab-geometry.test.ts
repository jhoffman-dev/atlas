import { describe, expect, it } from 'vitest';
import { FAB_ANCHORS, type FabAnchor } from '@atlas/domain';
import {
  fabAnchorPoint,
  isFabDrag,
  nearestFabAnchor,
  FAB_EDGE,
  FAB_SIZE,
  FAB_TOP,
} from './fab-geometry.ts';

const AREA = { width: 1000, height: 800 };
const HALF = FAB_SIZE / 2;

/** Where a button resting at `anchor` has its centre. */
const centreOf = (anchor: FabAnchor) => {
  const corner = fabAnchorPoint({ anchor, area: AREA });
  return { x: corner.x + HALF, y: corner.y + HALF };
};

describe('fabAnchorPoint', () => {
  it('rests bottom-right clear of the panel edges and its scrollbar', () => {
    expect(fabAnchorPoint({ anchor: 'bottom-right', area: AREA })).toEqual({
      x: 1000 - FAB_EDGE - FAB_SIZE,
      y: 800 - FAB_EDGE - FAB_SIZE,
    });
  });

  it('rests at the top below the page bar, not over it', () => {
    expect(fabAnchorPoint({ anchor: 'top-left', area: AREA })).toEqual({ x: FAB_EDGE, y: FAB_TOP });
    expect(FAB_TOP).toBeGreaterThanOrEqual(52);
  });

  it('centres the middles on their edge', () => {
    expect(fabAnchorPoint({ anchor: 'bottom-middle', area: AREA }).x).toBe(500 - HALF);
    expect(fabAnchorPoint({ anchor: 'left-centre', area: AREA }).y).toBe(400 - HALF);
  });

  it('stays on the panel when the panel is too small for its clearances', () => {
    const point = fabAnchorPoint({ anchor: 'bottom-right', area: { width: 40, height: 40 } });
    expect(point).toEqual({ x: 0, y: 0 });
  });
});

describe('nearestFabAnchor', () => {
  it('snaps a button let go exactly at an anchor to that anchor, for every anchor', () => {
    for (const anchor of FAB_ANCHORS) {
      expect(nearestFabAnchor({ centre: centreOf(anchor), area: AREA })).toBe(anchor);
    }
  });

  it('snaps to the nearest anchor from anywhere near it', () => {
    expect(nearestFabAnchor({ centre: { x: 30, y: 20 }, area: AREA })).toBe('top-left');
    expect(nearestFabAnchor({ centre: { x: 560, y: 790 }, area: AREA })).toBe('bottom-middle');
    expect(nearestFabAnchor({ centre: { x: 990, y: 420 }, area: AREA })).toBe('right-centre');
    expect(nearestFabAnchor({ centre: { x: 120, y: 380 }, area: AREA })).toBe('left-centre');
  });

  it('snaps a button dropped off the panel to the nearest corner', () => {
    expect(nearestFabAnchor({ centre: { x: 2000, y: 2000 }, area: AREA })).toBe('bottom-right');
    expect(nearestFabAnchor({ centre: { x: -500, y: -500 }, area: AREA })).toBe('top-left');
  });

  it('snaps to an edge rather than the centre, which is not an anchor', () => {
    const snapped = nearestFabAnchor({ centre: { x: 500, y: 400 }, area: AREA });
    expect(FAB_ANCHORS).toContain(snapped);
  });
});

describe('isFabDrag', () => {
  it('takes a wobble for a click', () => {
    expect(isFabDrag({ from: { x: 10, y: 10 }, to: { x: 13, y: 12 } })).toBe(false);
  });

  it('takes a real movement for a drag', () => {
    expect(isFabDrag({ from: { x: 10, y: 10 }, to: { x: 10, y: 16 } })).toBe(true);
    expect(isFabDrag({ from: { x: 10, y: 10 }, to: { x: 40, y: 10 } })).toBe(true);
  });
});

describe('a panel shorter than the clearances', () => {
  it.each(FAB_ANCHORS)(
    'keeps the button inside the panel at %s, as the rule promises',
    (anchor) => {
      const area = { width: 400, height: 100 };
      const point = fabAnchorPoint({ anchor, area });
      expect(point.y + FAB_SIZE).toBeLessThanOrEqual(area.height);
    },
  );
});

describe('a panel narrower than the clearances', () => {
  it.each(FAB_ANCHORS)('keeps the button inside the panel at %s', (anchor) => {
    const area = { width: 70, height: 800 };
    const point = fabAnchorPoint({ anchor, area });
    expect(point.x).toBeGreaterThanOrEqual(0);
    expect(point.x + FAB_SIZE).toBeLessThanOrEqual(area.width);
  });
});
