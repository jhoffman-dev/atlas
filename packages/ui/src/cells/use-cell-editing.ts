import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSteadyCallback } from '../steady-callback.ts';
import type { CellEdit, CellEditing, CellEditorHooks, CellValue } from './cell-editing.ts';
import { neighbourCell, type CellAt } from './cell-keys.ts';

type Change = { readonly value: CellValue };

/**
 * The one cell a table is editing, held by the table (not the row, which the
 * virtualiser may drop meanwhile), and the hooks its editors reach it by —
 * the same functions on every render, so the rows need not draw again for
 * them. Each commit is one write through `onEditCell`; nothing is written
 * for an edit that ends as it began. A draft overtaken rather than ended —
 * another cell opened over it, its row gone from the result, the table gone
 * from the page — is written too, as leaving a cell writes it: the note is
 * still there, and what was typed is not lost in silence.
 */
export function useCellEditing({
  onEditCell,
  paths,
  order,
  columns,
}: {
  /** Left out, cells are read only. */
  onEditCell: ((edit: CellEdit) => void) | undefined;
  /** The rows' paths, to notice the edited row leaving. */
  paths: readonly string[];
  /** The rows' paths in the order the table shows them, read when Tab moves on. */
  order: () => readonly string[];
  /** The columns that edit, in the order the table shows them. */
  columns: () => readonly string[];
}): { editing: CellEditing | null; editor: CellEditorHooks | undefined } {
  const [editing, setEditing] = useState<CellEditing | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const returning = useRef<CellAt | null>(null);
  const opening = useRef(false);
  // Read when the table leaves the page, after its last render.
  const latest = useRef<CellEditing | null>(null);
  useLayoutEffect(() => {
    latest.current = editing;
  });

  const write = useSteadyCallback((edit: CellEdit) => onEditCell?.(edit));
  /** Writes an edit's change, given one, as the edit is left. */
  const leave = (at: CellAt, change: Change | null) => {
    if (change !== null) write({ path: at.path, column: at.column, value: change.value });
    anchor.current = null;
  };
  const start = useSteadyCallback((at: CellAt) => {
    // What was typed in a cell left open — scrolled away, say — is written
    // before another is opened over it.
    if (editing !== null) leave(editing, editing.pending);
    // A new edit overtakes a cell waiting to take the focus back.
    returning.current = null;
    opening.current = true;
    setEditing({ ...at, draft: null, pending: null });
  });
  const draft = useSteadyCallback((text: string, pending: Change | null) =>
    setEditing((was) => (was === null ? null : { ...was, draft: text, pending })),
  );
  const end = useSteadyCallback((change?: Change) => {
    if (editing === null) return;
    leave(editing, change ?? null);
    returning.current = { path: editing.path, column: editing.column };
    setEditing(null);
  });
  const step = useSteadyCallback((to: 1 | -1, change?: Change) => {
    if (editing === null) return;
    leave(editing, change ?? null);
    const next = neighbourCell({ paths: order(), columns: columns(), at: editing, step: to });
    if (next === null) {
      returning.current = { path: editing.path, column: editing.column };
      setEditing(null);
    } else {
      opening.current = true;
      setEditing({ ...next, draft: null, pending: null });
    }
  });

  // The edited row gone from the result: what was typed is written to its
  // note, which is still there, and the edit is over.
  const overtaken = useSteadyCallback(() => {
    if (editing !== null) leave(editing, editing.pending);
    setEditing(null);
  });
  const editedPath = editing?.path ?? null;
  useEffect(() => {
    if (editedPath !== null && !paths.includes(editedPath)) overtaken();
  }, [paths, editedPath, overtaken]);

  // The table gone from the page — the view switched — with an edit open.
  useEffect(
    () => () => {
      const left = latest.current;
      if (left !== null && left.pending !== null) {
        write({ path: left.path, column: left.column, value: left.pending.value });
      }
    },
    [write],
  );

  const editable = onEditCell !== undefined;
  const editor = useMemo<CellEditorHooks | undefined>(
    () => (editable ? { start, draft, end, step, write, anchor, returning, opening } : undefined),
    [editable, start, draft, end, step, write],
  );
  return { editing: editable ? editing : null, editor };
}
