/**
 * Where the floating add button can rest: the corners and edge middles of the
 * content panel — eight places, the centre being where the work is.
 */
export type FabAnchor =
  | 'top-left'
  | 'top-middle'
  | 'top-right'
  | 'left-centre'
  | 'right-centre'
  | 'bottom-left'
  | 'bottom-middle'
  | 'bottom-right';

export const FAB_ANCHORS: readonly FabAnchor[] = [
  'top-left',
  'top-middle',
  'top-right',
  'left-centre',
  'right-centre',
  'bottom-left',
  'bottom-middle',
  'bottom-right',
];

/** Where it starts: out of the way of reading, where a thumb or a pointer finds it. */
export const DEFAULT_FAB_ANCHOR: FabAnchor = 'bottom-right';

/** Which way the speed dial opens: toward the middle of the panel. */
export type DialDirection = 'up' | 'down' | 'left' | 'right';

/** Which way to move the button one place, from the keyboard. */
export type FabStep = DialDirection;

type Column = 0 | 1 | 2;
type Row = 0 | 1 | 2;

const GRID: Readonly<Record<FabAnchor, readonly [Column, Row]>> = {
  'top-left': [0, 0],
  'top-middle': [1, 0],
  'top-right': [2, 0],
  'left-centre': [0, 1],
  'right-centre': [2, 1],
  'bottom-left': [0, 2],
  'bottom-middle': [1, 2],
  'bottom-right': [2, 2],
};

export function isFabAnchor(value: unknown): value is FabAnchor {
  return typeof value === 'string' && (FAB_ANCHORS as readonly string[]).includes(value);
}

/** An anchor as a person reads it: "bottom right", "left centre". */
export function fabAnchorLabel(anchor: FabAnchor): string {
  return anchor.replace('-', ' ');
}

/** An anchor's place on the panel's three-by-three grid, 0 to 2 across and down. */
export function fabAnchorCell(anchor: FabAnchor): { readonly column: Column; readonly row: Row } {
  const [column, row] = GRID[anchor];
  return { column, row };
}

/**
 * Which way the speed dial opens from an anchor: up from the bottom row, down
 * from the top, and inward from either side's middle.
 */
export function fabDialDirection(anchor: FabAnchor): DialDirection {
  const [column, row] = GRID[anchor];
  if (row === 2) return 'up';
  if (row === 0) return 'down';
  return column === 0 ? 'right' : 'left';
}

/** How the dial lines up with the button across its direction: flush with the nearer edge. */
export function fabDialAlign(anchor: FabAnchor): 'start' | 'center' | 'end' {
  const [column, row] = GRID[anchor];
  if (row === 1 || column === 1) return 'center';
  return column === 0 ? 'start' : 'end';
}

/**
 * The anchor one step away, for moving the button from the keyboard. The
 * centre is not a place, so a step into it carries on to the far side; a
 * step off the panel stays where it is.
 */
export function fabAnchorStep(anchor: FabAnchor, step: FabStep): FabAnchor {
  const [column, row] = GRID[anchor];
  const dx = step === 'left' ? -1 : step === 'right' ? 1 : 0;
  const dy = step === 'up' ? -1 : step === 'down' ? 1 : 0;
  let next = [column + dx, row + dy] as const;
  if (next[0] === 1 && next[1] === 1) next = [next[0] + dx, next[1] + dy];
  return anchorAt(next[0], next[1]) ?? anchor;
}

function anchorAt(column: number, row: number): FabAnchor | null {
  const found = FAB_ANCHORS.find((anchor) => {
    const [c, r] = GRID[anchor];
    return c === column && r === row;
  });
  return found ?? null;
}
