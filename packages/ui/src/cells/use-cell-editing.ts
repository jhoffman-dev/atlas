import { useEffect, useMemo, useRef, useState } from 'react';
import { useSteadyCallback } from '../steady-callback.ts';
import type { CellEdit, CellEditing, CellEditorHooks } from './cell-editing.ts';
import { neighbourCell, type CellAt } from './cell-keys.ts';

/**
 * The one cell a table is editing, held by the table (not the row, which the
 * virtualiser may drop meanwhile), and the hooks its editors reach it by —
 * the same functions on every render, so the rows need not draw again for
 * them. Each commit is one write through `onEditCell`; nothing is written
 * for an edit that ends as it began, and an edit whose row leaves the result
 * is dropped rather than written to a row that is gone.
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

  const write = useSteadyCallback((edit: CellEdit) => onEditCell?.(edit));
  const start = useSteadyCallback((at: CellAt) => {
    // A new edit overtakes a cell waiting to take the focus back.
    returning.current = null;
    setEditing({ ...at, draft: null });
  });
  const draft = useSteadyCallback((text: string) =>
    setEditing((was) => (was === null ? null : { ...was, draft: text })),
  );
  const leave = (at: CellAt, change: { readonly value: CellEdit['value'] } | undefined) => {
    if (change !== undefined) write({ path: at.path, column: at.column, value: change.value });
    anchor.current = null;
  };
  const end = useSteadyCallback((change?: { readonly value: CellEdit['value'] }) => {
    if (editing === null) return;
    leave(editing, change);
    returning.current = { path: editing.path, column: editing.column };
    setEditing(null);
  });
  const step = useSteadyCallback((to: 1 | -1, change?: { readonly value: CellEdit['value'] }) => {
    if (editing === null) return;
    leave(editing, change);
    const next = neighbourCell({ paths: order(), columns: columns(), at: editing, step: to });
    if (next === null) {
      returning.current = { path: editing.path, column: editing.column };
      setEditing(null);
    } else {
      setEditing({ ...next, draft: null });
    }
  });

  const editedPath = editing?.path ?? null;
  useEffect(() => {
    if (editedPath !== null && !paths.includes(editedPath)) setEditing(null);
  }, [paths, editedPath]);

  const editable = onEditCell !== undefined;
  const editor = useMemo<CellEditorHooks | undefined>(
    () => (editable ? { start, draft, end, step, write, anchor, returning } : undefined),
    [editable, start, draft, end, step, write],
  );
  return { editing: editable ? editing : null, editor };
}
