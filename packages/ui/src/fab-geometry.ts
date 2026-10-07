import { FAB_ANCHORS, DEFAULT_FAB_ANCHOR, fabAnchorCell, type FabAnchor } from '@atlas/domain';

/** The button's diameter. */
export const FAB_SIZE = 56;

/** Its clearance from the panel's edges — past a page's scrollbar on the right. */
export const FAB_EDGE = 24;

/** Its clearance from the panel's top: under the page bar (52) and a little more. */
export const FAB_TOP = 64;

/** How far a press moves before it is a drag rather than a click. */
export const FAB_DRAG_THRESHOLD = 6;

/** A point, or a size, in the panel's own pixels. */
export interface FabPoint {
  readonly x: number;
  readonly y: number;
}

export interface FabArea {
  readonly width: number;
  readonly height: number;
}

/**
 * The button's top-left corner at an anchor, in the panel's pixels. A panel
 * too small for the clearances gives them up and keeps the button inside;
 * one smaller than the button pins it to the top-left.
 */
export function fabAnchorPoint({ anchor, area }: { anchor: FabAnchor; area: FabArea }): FabPoint {
  const { column, row } = fabAnchorCell(anchor);
  const xs = [FAB_EDGE, (area.width - FAB_SIZE) / 2, area.width - FAB_EDGE - FAB_SIZE];
  const ys = [FAB_TOP, (area.height - FAB_SIZE) / 2, area.height - FAB_EDGE - FAB_SIZE];
  return {
    x: withinPanel(xs[column] ?? 0, area.width),
    y: withinPanel(ys[row] ?? 0, area.height),
  };
}

function withinPanel(offset: number, extent: number): number {
  return Math.max(0, Math.min(offset, extent - FAB_SIZE));
}

/**
 * The anchor a button let go of with its centre at `centre` snaps to: the one
 * whose resting place is nearest, measured centre to centre. A tie goes to
 * the one listed first.
 */
export function nearestFabAnchor({ centre, area }: { centre: FabPoint; area: FabArea }): FabAnchor {
  let best: FabAnchor = DEFAULT_FAB_ANCHOR;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const anchor of FAB_ANCHORS) {
    const corner = fabAnchorPoint({ anchor, area });
    const distance = Math.hypot(
      corner.x + FAB_SIZE / 2 - centre.x,
      corner.y + FAB_SIZE / 2 - centre.y,
    );
    if (distance < bestDistance) {
      best = anchor;
      bestDistance = distance;
    }
  }
  return best;
}

/** Whether a press that went from `from` to `to` is a drag, not a click that wobbled. */
export function isFabDrag({ from, to }: { from: FabPoint; to: FabPoint }): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) >= FAB_DRAG_THRESHOLD;
}
