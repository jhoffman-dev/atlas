import { useEffect, useState } from 'react';
import type { PropertyDef } from '@atlas/domain';
import type { CellEditing } from './cell-editing.ts';
import { holdsSeveral, type HeldCell } from './cell-pickers.tsx';
import type { CellAt } from './cell-keys.ts';

/** Reads what a cell holding several values holds, from its note. */
export type ReadHeldCell = (at: CellAt) => Promise<unknown>;

const NOT_READ = 'This cell’s values could not be read, so it cannot be changed here.';

/**
 * What the editing cell's picker starts from (#425). A cell holding several
 * values — a relation to many notes, a multi-select — has them joined into
 * one text by the index's view, so they are read from the note itself
 * through `read`; anything else is what the row shows. Without `read`, the
 * row's text is all there is.
 */
export function useHeldCell({
  editing,
  def,
  rowValue,
  read,
}: {
  editing: CellEditing | null;
  def: PropertyDef | undefined;
  rowValue: unknown;
  read: ReadHeldCell | undefined;
}): HeldCell {
  const reads = read !== undefined && editing !== null && holdsSeveral(def);
  const path = reads ? editing.path : null;
  const column = reads ? editing.column : null;
  const key = path === null || column === null ? null : `${path}\u0000${column}`;
  const [answer, setAnswer] = useState<{ key: string; held: HeldCell } | null>(null);
  // Read once per cell opened, not on every key typed into its picker.
  useEffect(() => {
    if (key === null || path === null || column === null || read === undefined) return;
    let cancelled = false;
    read({ path, column }).then(
      (value) => {
        if (!cancelled) setAnswer({ key, held: { state: 'read', value } });
      },
      (cause: unknown) => {
        const why = cause instanceof Error ? cause.message : String(cause);
        if (!cancelled)
          setAnswer({ key, held: { state: 'failed', problem: `${NOT_READ} ${why}` } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, path, column, read]);
  if (!reads) return { state: 'read', value: rowValue };
  return answer?.key === key ? answer.held : { state: 'reading' };
}
