import { useCallback, useEffect, useRef, useState } from 'react';
import { rowToFocusAfter, type VaultPath } from '@atlas/domain';

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
 * to be focused may not be there: it is `wanted`, the page places it, and it
 * takes the focus as it is drawn.
 */
/** What a person focuses on purpose: something to press or type into. */
const CONTROLS = 'button, input, select, textarea, a[href], [contenteditable="true"]';

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
  const rows = useRef(new Map<VaultPath, HTMLElement>());
  const pending = useRef<{ acted: VaultPath; next: VaultPath | null } | null>(null);
  const orderNow = useRef(order);
  orderNow.current = order;
  /** A row to focus that was not in the DOM when it was asked for. */
  const [wanted, setWanted] = useState<VaultPath | null>(null);
  const wantedNow = useRef<VaultPath | null>(null);

  /** A row's handle: the control focus lands on when the row is focused. */
  const rowRef = useCallback(
    (path: VaultPath) => (element: HTMLElement | null) => {
      if (element === null) {
        rows.current.delete(path);
        return;
      }
      rows.current.set(path, element);
      if (wantedNow.current !== path) return;
      wantedNow.current = null;
      element.focus();
      setWanted(null);
    },
    [],
  );

  /** Says a row is being acted on, before the action that may take it away. */
  const actedOn = useCallback((path: VaultPath) => {
    pending.current = {
      acted: path,
      next: rowToFocusAfter({ order: orderNow.current, acted: path }),
    };
  }, []);

  const focusRow = useCallback((path: VaultPath | null) => {
    if (path === null) return;
    const element = rows.current.get(path);
    if (element !== undefined) {
      element.focus();
      return;
    }
    wantedNow.current = path;
    setWanted(path);
  }, []);

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
