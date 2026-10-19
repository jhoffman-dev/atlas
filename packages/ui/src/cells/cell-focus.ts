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

/**
 * Gives an editor the focus as it appears. Opened by the reader — a click,
 * ↵, Tab — it takes the focus outright: that is what the opening asked for,
 * and WebKit leaves a clicked button unfocused, so where the focus was says
 * nothing. Drawn again later, when its row scrolls back into the page, it
 * is not what the reader is doing now if they went on to the search box
 * meanwhile: it takes the focus only while that is still on the table, or
 * on nothing at all.
 */
export function useOpeningFocus(
  editor: CellEditorHooks,
  element: RefObject<HTMLElement | null>,
  editing = true,
): void {
  useLayoutEffect(() => {
    const field = element.current;
    if (!editing || field === null) return;
    if (editor.opening.current) {
      editor.opening.current = false;
      field.focus();
      return;
    }
    const focused = document.activeElement;
    const table = field.closest('table');
    if (focused === null || focused === document.body || table?.contains(focused)) field.focus();
  }, [editing, editor, element]);
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
