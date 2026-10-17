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

/** A move to a row the virtualiser had not drawn: where it goes, and the name it was asked from. */
interface PendingMove {
  readonly index: number;
  readonly from: HTMLElement;
  /** Stops listening for what overtakes the move. */
  readonly release: () => void;
}

/**
 * Whether a pending move may still take the focus: only while the focus is
 * where the move was asked from — or that name has been scrolled out of the
 * page, which drops its focus to the body. A cell being edited, or the focus
 * taken anywhere else, overtakes it.
 */
function stillWanted({ from }: PendingMove): boolean {
  const focused = document.activeElement;
  if (focused === from) return true;
  return !from.isConnected && (focused === null || focused === document.body);
}

/**
 * Listens for what overtakes a pending move that the focus alone does not
 * show: a press anywhere, or the name blurred while it is still in the page.
 * A name scrolled out of the page loses its focus too — some engines say so
 * with a blur, after it has left the page — and that one is not the reader's
 * doing, so a blur counts only while the name is still in the page.
 */
function listenForOvertaking(from: HTMLElement, overtaken: () => void): () => void {
  const onBlur = () => {
    if (from.isConnected) overtaken();
  };
  from.addEventListener('blur', onBlur);
  document.addEventListener('pointerdown', overtaken, true);
  return () => {
    from.removeEventListener('blur', onBlur);
    document.removeEventListener('pointerdown', overtaken, true);
  };
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
  const wanted = useRef<PendingMove | null>(null);
  const nameAt = (index: number) =>
    body.current?.querySelector<HTMLElement>(`tr[data-index="${index}"] ${ROW_NAME}`) ?? null;
  const drop = () => {
    wanted.current?.release();
    wanted.current = null;
  };

  // Finishes a move to a row that was not drawn when it was asked for: the
  // scroll puts it in the page, that renders, and this focuses it — unless the
  // reader has moved on since. On every render, as the grouped rows' is: there
  // is only whether it has appeared yet.
  useEffect(() => {
    const move = wanted.current;
    if (move === null) return;
    if (!stillWanted(move)) {
      drop();
      return;
    }
    const name = nameAt(move.index);
    if (name === null) return;
    drop();
    name.focus();
  });
  // A table that goes away stops listening for a move it can no longer finish.
  useEffect(() => drop, []);

  return (event: KeyboardEvent) => {
    if (!(event.target instanceof HTMLElement) || !event.target.matches(ROW_NAME)) return;
    // A chord belongs to the app or the browser, not to moving between rows.
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const from = event.target.closest('tr')?.getAttribute('data-index') ?? null;
    const to = from === null ? null : targetIndex(event.key, Number(from), last);
    if (to === null) return;
    // The arrows and Home and End would otherwise scroll the sheet out from under the focus.
    event.preventDefault();
    // Any move overtakes one still waiting for its row.
    drop();
    const name = nameAt(to);
    if (name !== null) {
      name.focus();
      return;
    }
    wanted.current = {
      index: to,
      from: event.target,
      release: listenForOvertaking(event.target, drop),
    };
    scrollTo(to);
  };
}
