/**
 * Arranging a dashboard: the order of `widgets:` is the order on the grid, and
 * a widget's `span` is its width in grid columns.
 *
 * Every change works on the entries as written in the note — not on the parsed
 * widgets — so what an edit does not touch reaches the file as it was, unknown
 * keys and all. An index out of range changes nothing rather than throwing: it
 * means the file moved on under a gesture, and the next read shows what is
 * really there.
 */

import { isRecord } from '../query/frontmatter-query.ts';
import { GRID_COLUMNS } from './dashboard.ts';

/** The entries of a dashboard's `widgets:`, or none. */
export function widgetEntries(frontmatter: Readonly<Record<string, unknown>>): unknown[] {
  const declared = frontmatter['widgets'];
  return Array.isArray(declared) ? [...declared] : [];
}

/** A span the grid can draw: a whole number of columns, 1 to 12. */
export function clampSpan(span: number): number {
  if (!Number.isFinite(span)) return 1;
  return Math.min(GRID_COLUMNS, Math.max(1, Math.round(span)));
}

const inRange = (items: readonly unknown[], at: number) =>
  Number.isInteger(at) && at >= 0 && at < items.length;

/** The item at `from` taken out and put back at `to`, the others closing up around it. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (!inRange(items, from) || !inRange(items, to)) return [...items];
  const moved = [...items];
  const [item] = moved.splice(from, 1);
  moved.splice(to, 0, item as T);
  return moved;
}

/**
 * An entry at a new width. `width` — the older thirds of the page — goes, since
 * `span` wins over it and leaving it would say two different things.
 */
export function withSpan(entry: unknown, span: number): unknown {
  if (!isRecord(entry)) return entry;
  const sized: Record<string, unknown> = { ...entry, span: clampSpan(span) };
  delete sized['width'];
  return sized;
}

/**
 * One gesture's worth of arranging: the entry moved to where another stood,
 * and at the width it was left at. A span that did not change is not written,
 * so a move leaves the widget's size as it was declared — or not declared.
 */
export function placeEntry(
  entries: readonly unknown[],
  { from, to, span }: { from: number; to: number; span: number | null },
): unknown[] {
  if (!inRange(entries, from)) return [...entries];
  const sized =
    span === null
      ? entries
      : entries.map((entry, at) => (at === from ? withSpan(entry, span) : entry));
  return moveItem(sized, from, inRange(entries, to) ? to : from);
}

export function removeEntry(entries: readonly unknown[], at: number): unknown[] {
  return entries.filter((_, index) => index !== at);
}

export function replaceEntry(entries: readonly unknown[], at: number, entry: unknown): unknown[] {
  if (!inRange(entries, at)) return [...entries];
  return entries.map((existing, index) => (index === at ? entry : existing));
}

/** Where a held widget is while it is being arranged: its place in the grid, and its width. */
export interface Placement {
  readonly index: number;
  readonly span: number;
}

export type LayoutStep = 'earlier' | 'later' | 'narrower' | 'wider';

/** One arrow press while a widget is held. It stops at the ends rather than wrapping round. */
export function stepPlacement(
  placement: Placement,
  { step, count }: { step: LayoutStep; count: number },
): Placement {
  const last = Math.max(0, count - 1);
  switch (step) {
    case 'earlier':
      return { ...placement, index: Math.max(0, placement.index - 1) };
    case 'later':
      return { ...placement, index: Math.min(last, placement.index + 1) };
    case 'narrower':
      return { ...placement, span: clampSpan(placement.span - 1) };
    case 'wider':
      return { ...placement, span: clampSpan(placement.span + 1) };
  }
}

/**
 * The width a resize handle dragged `deltaX` pixels leaves a widget at, snapped
 * to whole columns. `column` is one column and its gap, the distance a column
 * boundary is from the next.
 */
export function spanAfterDrag({
  span,
  deltaX,
  column,
}: {
  span: number;
  deltaX: number;
  column: number;
}): number {
  if (!(column > 0)) return clampSpan(span);
  return clampSpan(span + Math.round(deltaX / column));
}
