import { useCallback, useEffect, useRef } from 'react';
import { rowToFocusAfter, type VaultPath } from '@atlas/domain';
import { CONTROLS, useRowHandles } from './row-handles.ts';

/**
 * Where focus is on the Today page, by row rather than by element (#111).
 *
 * Acting on a row usually takes it off the page, and the control that had
 * focus with it. So the page says which row was acted on, and once it shows
 * that the row has left, focus lands on the row the domain says comes next —
 * never back at the top of the document. A row that stays keeps its focus.
 * Keyboard triage (#109) moves through the same order with the same handle.
 *
 * The page puts only the rows near what it shows in the DOM (#238), so a row
 * to be focused may not be there: it is `wanted` (`useRowHandles`).
 */
export type RowFocus = ReturnType<typeof useRowFocus>;

export function useRowFocus({
  order,
  shown,
  problem,
}: {
  /** Every row on the page, top to bottom. */
  order: readonly VaultPath[];
  /** Changes when the page shows a fresh read; null while it shows none — the index is being rebuilt, say. */
  shown: object | null;
  /** Why the last action could not be done, if it could not: nothing moved, so focus stays. */
  problem: string | null;
}) {
  const { rowRef, focusRow: focusPlaced, wanted } = useRowHandles(order);
  const pending = useRef<{ acted: VaultPath; next: VaultPath | null } | null>(null);
  const orderNow = useRef(order);
  orderNow.current = order;

  /** Says a row is being acted on, before the action that may take it away. */
  const actedOn = useCallback((path: VaultPath) => {
    pending.current = {
      acted: path,
      next: rowToFocusAfter({ order: orderNow.current, acted: path }),
    };
  }, []);

  const focusRow = useCallback(
    (path: VaultPath | null) => {
      if (path !== null) focusPlaced(path);
    },
    [focusPlaced],
  );

  useEffect(() => {
    if (problem !== null) pending.current = null;
  }, [problem]);

  useEffect(() => {
    const moved = pending.current;
    // The index follows the file, so the page may be read again before the
    // row has left: it is waited for, and a row that stays keeps its focus.
    // Asked of the read, not the DOM: a row scrolled out of it has not left.
    if (moved === null || shown === null || orderNow.current.includes(moved.acted)) return;
    pending.current = null;
    // Focus went with the row — to the document, or to the panel around it,
    // which is where WebKit leaves it after a press on a button. On another
    // control, the person put it there since, and it is left alone.
    if (document.activeElement?.matches(CONTROLS) !== true) focusRow(moved.next);
  }, [shown, focusRow]);

  return { rowRef, actedOn, focusRow, wanted };
}
