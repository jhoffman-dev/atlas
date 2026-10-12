import { useCallback, useEffect, useRef } from 'react';
import { rowToFocusAfter, type VaultPath } from '@atlas/domain';

/**
 * Where focus is on the Today page, by row rather than by element (#111).
 *
 * Acting on a row usually takes it off the page, and the control that had
 * focus with it. So the page says which row was acted on, and once it shows
 * that the row has left, focus lands on the row the domain says comes next —
 * never back at the top of the document. A row that stays keeps its focus.
 * Keyboard triage (#109) moves through the same order with the same handle.
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

  /** A row's handle: the control focus lands on when the row is focused. */
  const rowRef = useCallback(
    (path: VaultPath) => (element: HTMLElement | null) => {
      if (element === null) rows.current.delete(path);
      else rows.current.set(path, element);
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
    if (path !== null) rows.current.get(path)?.focus();
  }, []);

  useEffect(() => {
    if (problem !== null) pending.current = null;
  }, [problem]);

  useEffect(() => {
    const moved = pending.current;
    // The index follows the file, so the page may be read again before the
    // row has left: it is waited for, and a row that stays keeps its focus.
    if (moved === null || shown === null || rows.current.has(moved.acted)) return;
    pending.current = null;
    // Focus went with the row — to the document, or to the panel around it,
    // which is where WebKit leaves it after a press on a button. On another
    // control, the person put it there since, and it is left alone.
    if (document.activeElement?.matches(CONTROLS) !== true) focusRow(moved.next);
  }, [shown, focusRow]);

  return { rowRef, actedOn, focusRow };
}
