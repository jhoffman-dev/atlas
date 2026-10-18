import type { CellEditorHooks } from './cell-editing.ts';
import type { CellAt } from './cell-keys.ts';

/** Whether a checkbox property is ticked: `true` in the file, or the word. */
export const isTicked = (value: unknown): boolean => value === true || value === 'true';

/**
 * A checkbox cell: the box itself, which needs no editor to open — a click
 * or Space ticks it and writes it, one write per tick. With no editor, as
 * in a SQL view, it is read only.
 */
export function CheckboxCell({
  at,
  label,
  value,
  editor,
}: {
  at: CellAt;
  label: string;
  value: unknown;
  editor: CellEditorHooks | undefined;
}) {
  const ticked = isTicked(value);
  return (
    <input
      type="checkbox"
      className="table__check"
      aria-label={label}
      checked={ticked}
      disabled={editor === undefined}
      {...(editor !== undefined && { 'data-cell-stop': at.column })}
      onChange={() => editor?.write({ ...at, value: !ticked })}
    />
  );
}
