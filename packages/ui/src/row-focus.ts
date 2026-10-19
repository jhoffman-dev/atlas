import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';

/**
 * Marks the button a table's arrows move between: a row's name, or a group's
 * header. Spread onto that button; the line it sits in says its index with
 * `data-index`. A cell that edits is a stop beside it, marked `data-cell-stop`
 * with its column: Up and Down keep the column, Left and Right move along
 * the row, and Tab walks them all in order.
 */
export const ROW_STOP = { 'data-row-stop': '' } as const;

const ROW = '[data-row-stop]';
const STOPS = '[data-row-stop], [data-cell-stop]';

/** The column a stop is under, or null for a row's own stop. */
function columnOf(stop: HTMLElement): string | null {
  return stop.dataset['cellStop'] ?? null;
}

/** The stop in a line under a column, or the line's own stop where it has no such cell. */
function stopIn(line: Element, column: string | null): HTMLElement | null {
  if (column !== null) {
    for (const stop of line.querySelectorAll<HTMLElement>('[data-cell-stop]')) {
      if (columnOf(stop) === column) return stop;
    }
  }
  return line.querySelector<HTMLElement>(ROW);
}

/** Whether a stop's line has cells of its own — a row — rather than a group's header. */
function lineHasCells(stop: HTMLElement): boolean {
  return stop.closest('tr')?.querySelector('[data-cell-stop]') !== null;
}

/** The stop beside one along its row, or null at the row's end. */
function besideStop(origin: HTMLElement, step: 1 | -1): HTMLElement | null {
  const line = origin.closest('tr');
  if (line === null) return null;
  const stops = [...line.querySelectorAll<HTMLElement>(STOPS)];
  return stops[stops.indexOf(origin) + step] ?? null;
}

/**
 * The lines a table draws, and the stop each holds: a key that names the
 * line whatever moves around it — a row's path, a group's id — or null for a
 * line with none, such as "+ New".
 */
interface Stops {
  readonly count: number;
  readonly stopKey: (index: number) => string | null;
  /** How many lines a window of the scroller holds, for Page Up and Page Down; left out, those keys are not the table's. */
  readonly pageSize?: (() => number) | undefined;
}

/** The first stop from `start`, stepping by `step`, or null when there is none that way. */
function stopFrom(start: number, step: 1 | -1, { count, stopKey }: Stops): number | null {
  for (let at = start; at >= 0 && at < count; at += step) {
    if (stopKey(at) !== null) return at;
  }
  return null;
}

/** The stop nearest a line, either way, for a move whose own line has gone. */
function nearestStop(near: number, stops: Stops): number | null {
  const at = Math.min(Math.max(near, 0), stops.count - 1);
  const below = stopFrom(at, 1, stops);
  const above = stopFrom(at, -1, stops);
  if (below === null) return above;
  if (above === null) return below;
  return below - at <= at - above ? below : above;
}

/**
 * What a move is after, so a move still waiting can find it again once the
 * lines change under it — a group folded or unfolded, a re-read: Home and End
 * the first and last stop as they are now, an arrow the line it named.
 */
type Aim = { readonly to: 'first' | 'last' } | { readonly to: 'line'; readonly key: string };

function aimFor(key: string, index: number, stops: Stops): Aim {
  if (key === 'Home') return { to: 'first' };
  if (key === 'End') return { to: 'last' };
  return { to: 'line', key: stops.stopKey(index) ?? '' };
}

/** The line an aim names now; `last` is where it was, for a line that has gone. */
function resolveAim(aim: Aim, last: number, stops: Stops): number | null {
  if (aim.to !== 'line') {
    return aim.to === 'first' ? stopFrom(0, 1, stops) : stopFrom(stops.count - 1, -1, stops);
  }
  if (stops.stopKey(last) === aim.key) return last;
  for (let at = 0; at < stops.count; at += 1) {
    if (stops.stopKey(at) === aim.key) return at;
  }
  return nearestStop(last, stops);
}

/**
 * Where a key from a stop sends the focus: a line's index, or null for a key
 * that is not the table's. Page Down and Page Up move a window of lines, to
 * the nearest stop on from there, or to the last or first when that is nearer.
 */
function targetIndex(key: string, from: number, stops: Stops): number | null {
  if (key === 'ArrowDown') return stopFrom(from + 1, 1, stops) ?? from;
  if (key === 'ArrowUp') return stopFrom(from - 1, -1, stops) ?? from;
  if (key === 'Home') return stopFrom(0, 1, stops);
  if (key === 'End') return stopFrom(stops.count - 1, -1, stops);
  if ((key === 'PageDown' || key === 'PageUp') && stops.pageSize !== undefined) {
    const page = Math.max(1, Math.floor(stops.pageSize()));
    if (key === 'PageDown') {
      const to = Math.min(from + page, stops.count - 1);
      return stopFrom(to, 1, stops) ?? stopFrom(to, -1, stops);
    }
    const to = Math.max(from - page, 0);
    return stopFrom(to, -1, stops) ?? stopFrom(to, 1, stops);
  }
  return null;
}

/**
 * Focuses a stop and scrolls its line wholly into view: focusing alone
 * reveals a line that is out of the window, but leaves one half under the
 * window's edge where it is — a Page Down's landing, or a wrapped row.
 * `scroll-padding-top` keeps it clear of the sticky header. (jsdom has no
 * scrollIntoView.)
 */
function focusWhole(stop: HTMLElement): void {
  stop.focus();
  stop.closest('tr')?.scrollIntoView?.({ block: 'nearest' });
}

/** A move to a line the virtualiser had not drawn: what it is after, and the stop it was asked from. */
interface PendingMove {
  readonly aim: Aim;
  /** The line it last scrolled to: where its aim was, the last time it looked. */
  readonly index: number;
  /** The column it keeps to, or null for the row's own stop. */
  readonly column: string | null;
  readonly from: HTMLElement;
  /** Stops listening for what overtakes the move. */
  readonly release: () => void;
}

/**
 * Whether a pending move may still take the focus: only while the focus is
 * where the move was asked from — or that stop has been scrolled out of the
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
 * show: a press anywhere, or the stop blurred while it is still in the page.
 * A stop scrolled out of the page loses its focus too — some engines say so
 * with a blur, after it has left the page — and that one is not the reader's
 * doing, so a blur counts only while the stop is still in the page.
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
 * Up, Down, Home, End and — given a page size — Page Up and Page Down from a
 * stop — a row's name or a group's header — moving the focus to another
 * stop, scrolled to first when the virtualiser has not drawn it. Tab would
 * leave the table at the last line drawn, so this is how the keyboard
 * reaches the rest. Returns the body's key handler.
 */
export function useRowFocus({
  body,
  count,
  stopKey,
  pageSize,
  scrollTo,
}: Stops & {
  body: RefObject<HTMLTableSectionElement | null>;
  scrollTo: (index: number) => void;
}): (event: KeyboardEvent) => void {
  const stops: Stops = { count, stopKey, pageSize };
  const wanted = useRef<PendingMove | null>(null);
  // The column a move kept to when it landed on a line with no cells — a
  // group's header — so the next move on carries it to the row beyond.
  const carried = useRef<string | null>(null);
  const stopAt = (index: number, column: string | null) => {
    const line = body.current?.querySelector(`tr[data-index="${index}"]`) ?? null;
    return line === null ? null : stopIn(line, column);
  };
  const drop = () => {
    wanted.current?.release();
    wanted.current = null;
  };
  /** Focuses a stop reached for a column, remembering the column past a line without cells. */
  const land = (stop: HTMLElement, column: string | null) => {
    carried.current = columnOf(stop) === null ? column : null;
    focusWhole(stop);
  };

  // Finishes a move to a line that was not drawn when it was asked for: the
  // scroll puts it in the page, that renders, and this focuses it — unless the
  // reader has moved on since. On every render: there is only whether it has
  // appeared yet, and where its aim is now that the lines may have changed.
  useEffect(() => {
    const move = wanted.current;
    if (move === null) return;
    const index = stillWanted(move) ? resolveAim(move.aim, move.index, stops) : null;
    if (index === null) {
      drop();
      return;
    }
    const stop = stopAt(index, move.column);
    if (stop !== null) {
      drop();
      land(stop, move.column);
    } else if (index !== move.index) {
      // The lines changed under it: scroll to where its line is now.
      wanted.current = { ...move, index };
      scrollTo(index);
    }
  });
  // A table that goes away stops listening for a move it can no longer finish.
  useEffect(() => drop, []);

  /**
   * The line a key moves on from: the line a waiting move is after, when the
   * key comes from the stop that move was asked from — a held key repeats
   * faster than the frames that draw each line — or else the key's own line.
   */
  const startOf = (origin: HTMLElement): number | null => {
    const move = wanted.current;
    if (move?.from === origin) return resolveAim(move.aim, move.index, stops);
    const line = origin.closest('tr')?.getAttribute('data-index') ?? null;
    return line === null ? null : Number(line);
  };

  return (event: KeyboardEvent) => {
    const origin = event.target;
    if (!(origin instanceof HTMLElement) || !origin.matches(STOPS)) return;
    // A chord belongs to the app or the browser, not to moving between rows.
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const beside = besideStop(origin, event.key === 'ArrowRight' ? 1 : -1);
      if (beside === null) return;
      event.preventDefault();
      drop();
      beside.focus();
      return;
    }
    const from = startOf(origin);
    const to = from === null ? null : targetIndex(event.key, from, stops);
    if (to === null) return;
    // The arrows and Home and End would otherwise scroll the sheet out from under the focus.
    event.preventDefault();
    // Any move overtakes one still waiting for its line.
    drop();
    // From a header reached for a column, the move keeps to that column.
    const column = columnOf(origin) ?? (lineHasCells(origin) ? null : carried.current);
    const stop = stopAt(to, column);
    if (stop !== null) {
      land(stop, column);
      return;
    }
    wanted.current = {
      aim: aimFor(event.key, to, stops),
      index: to,
      column,
      from: origin,
      release: listenForOvertaking(origin, drop),
    };
    scrollTo(to);
  };
}
