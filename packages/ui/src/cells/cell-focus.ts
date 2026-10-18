import { useLayoutEffect, type RefObject } from 'react';
import type { CellEditorHooks } from './cell-editing.ts';
import type { CellAt } from './cell-keys.ts';

/**
 * Gives a cell the focus back once an edit in it has ended: the editor that
 * had the focus is gone from the page, and the cell is drawn in its place.
 * Only the cell the edit ended in takes it, once, so a Tab that moved on to
 * the next cell's editor is not overtaken by the cell it left.
 */
export function useReturningFocus(
  at: CellAt,
  editor: CellEditorHooks,
  element: RefObject<HTMLElement | null>,
): void {
  useLayoutEffect(() => {
    const back = editor.returning.current;
    if (back === null || back.path !== at.path || back.column !== at.column) return;
    editor.returning.current = null;
    element.current?.focus();
  });
}

/** Hands a picker the cell it hangs from, while the cell's picker is open. */
export function useAnchoring(
  expanded: boolean,
  editor: CellEditorHooks,
  element: RefObject<HTMLElement | null>,
): void {
  useLayoutEffect(() => {
    if (expanded) editor.anchor.current = element.current;
  }, [expanded, editor, element]);
}
