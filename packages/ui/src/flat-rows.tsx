import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { BoardRow } from '@atlas/domain';
import { ROW_ESTIMATE, SCROLLER_ESTIMATE, Spacer, type LinePlace } from './grouped-rows.tsx';

/** The button that names a row and opens its note: where the arrows move between rows. */
const ROW_NAME = '.table__link';

/**
 * A table's rows when it does not group them. Virtualised, as the grouped
 * rows are: only the rows near the scroller's window are in the page, so a
 * table of hundreds costs what a screenful does (#238), and spacers keep the
 * scrollbar true, so every row is reached by scrolling.
 *
 * Tab would leave the table at the last row drawn, so Up and Down move from a
 * row's name to the next row's, and Home and End to the first and last,
 * scrolling a row into the page first when it has not been drawn yet.
 */
export function FlatRows({
  rows,
  width,
  renderRow,
  scroller,
}: {
  rows: readonly BoardRow[];
  /** How many cells a row spans, its lead boxes included. */
  width: number;
  renderRow: (row: BoardRow, place: LinePlace) => ReactNode;
  /** The element the table scrolls in; null until it is in the page. */
  scroller: HTMLElement | null;
}) {
  const body = useRef<HTMLTableSectionElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 12,
    initialRect: SCROLLER_ESTIMATE,
  });
  const onKeyDown = useRowFocus({
    body,
    last: rows.length - 1,
    scrollTo: (index) => virtualizer.scrollToIndex(index),
  });

  const items = virtualizer.getVirtualItems();
  const before = items[0]?.start ?? 0;
  const after = virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0);
  const measure = virtualizer.measureElement;

  return (
    <tbody ref={body} onKeyDown={onKeyDown}>
      {before > 0 && <Spacer height={before} width={width} />}
      {items.map((item) => {
        const row = rows[item.index];
        return row === undefined ? null : renderRow(row, { index: item.index, measure });
      })}
      {after > 0 && <Spacer height={after} width={width} />}
    </tbody>
  );
}

/** Where a key from a row's name sends the focus: the row's index, or null for a key that is not the table's. */
function targetIndex(key: string, from: number, last: number): number | null {
  if (key === 'ArrowDown') return Math.min(from + 1, last);
  if (key === 'ArrowUp') return Math.max(from - 1, 0);
  if (key === 'Home') return 0;
  if (key === 'End') return last;
  return null;
}

/**
 * The arrows, Home and End from a row's name, moving the focus to another
 * row's name — scrolled to first when the virtualiser has not drawn it.
 */
function useRowFocus({
  body,
  last,
  scrollTo,
}: {
  body: RefObject<HTMLTableSectionElement | null>;
  last: number;
  scrollTo: (index: number) => void;
}) {
  /** A row asked for the focus before the virtualiser had drawn it. */
  const wanted = useRef<number | null>(null);
  const focusDrawn = (index: number): boolean => {
    const name = body.current?.querySelector<HTMLElement>(`tr[data-index="${index}"] ${ROW_NAME}`);
    name?.focus();
    return name !== null && name !== undefined;
  };

  // Finishes a move to a row that was not drawn when it was asked for: the
  // scroll puts it in the page, that renders, and this focuses it. On every
  // render, as the grouped rows' is — there is only whether it has appeared yet.
  useEffect(() => {
    if (wanted.current !== null && focusDrawn(wanted.current)) wanted.current = null;
  });

  return (event: KeyboardEvent) => {
    if (!(event.target instanceof HTMLElement) || !event.target.matches(ROW_NAME)) return;
    const from = event.target.closest('tr')?.getAttribute('data-index') ?? null;
    const to = from === null ? null : targetIndex(event.key, Number(from), last);
    if (to === null) return;
    // The arrows and Home and End would otherwise scroll the sheet out from under the focus.
    event.preventDefault();
    if (focusDrawn(to)) return;
    scrollTo(to);
    wanted.current = to;
  };
}
