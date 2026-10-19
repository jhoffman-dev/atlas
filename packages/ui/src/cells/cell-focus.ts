import { useLayoutEffect, useRef, type RefObject } from 'react';
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

/**
 * A press on a cell whose picker is open closes it (Base UI's outside
 * press), and the click that ends the press must not open it again. A press
 * dragged off the cell, or cancelled, ends in no click on it, so it is
 * forgotten; a click from the keyboard — ↵ or Space, `detail` 0 — was no
 * press at all, and always opens.
 */
export function usePressOnOpenCell(expanded: boolean): {
  readonly onPointerDown: () => void;
  readonly onPointerLeave: () => void;
  readonly onPointerCancel: () => void;
  /** Whether a click opens the picker, rather than ending the press that closed it. */
  readonly opens: (event: { readonly detail: number }) => boolean;
} {
  const closing = useRef(false);
  const forget = () => {
    closing.current = false;
  };
  return {
    onPointerDown: () => {
      closing.current = expanded;
    },
    onPointerLeave: forget,
    onPointerCancel: forget,
    opens: (event) => {
      if (event.detail === 0 || !closing.current) return true;
      closing.current = false;
      return false;
    },
  };
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
