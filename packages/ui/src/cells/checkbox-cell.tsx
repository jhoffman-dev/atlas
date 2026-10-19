import { useRef } from 'react';
import type { CellEditorHooks } from './cell-editing.ts';
import { useOpeningFocus } from './cell-focus.ts';
import { editorKeyAction, type CellAt } from './cell-keys.ts';

/** Stands in where there is no editor, so the hook below is called on every render alike. */
const NO_EDITOR: CellEditorHooks = {
  start: () => {},
  draft: () => {},
  end: () => {},
  step: () => {},
  write: () => {},
  anchor: { current: null },
  returning: { current: null },
  opening: { current: false },
};

/** Whether a checkbox property is ticked: `true` in the file, or the word. */
export const isTicked = (value: unknown): boolean => value === true || value === 'true';

/**
 * A checkbox cell: the box itself, which needs no editor to open — a click
 * or Space ticks it and writes it, one write per tick. Tab reaching it from
 * the cell before is an edit all the same: the box takes the focus, and Tab,
 * ⇧Tab, ↵ and Esc go on from it as from any editor. With no editor, as in a
 * SQL view, it is read only.
 */
export function CheckboxCell({
  at,
  label,
  value,
  editing,
  editor,
}: {
  at: CellAt;
  label: string;
  value: unknown;
  /** Whether Tab or ⇧Tab brought the edit here. */
  editing: boolean;
  editor: CellEditorHooks | undefined;
}) {
  const box = useRef<HTMLInputElement>(null);
  useOpeningFocus(editor ?? NO_EDITOR, box, editing && editor !== undefined);
  const ticked = isTicked(value);
  return (
    <input
      ref={box}
      type="checkbox"
      className="table__check"
      aria-label={label}
      checked={ticked}
      disabled={editor === undefined}
      {...(editor !== undefined && { 'data-cell-stop': at.column })}
      onChange={() => editor?.write({ ...at, value: !ticked })}
      onBlur={() => {
        if (editing) editor?.end();
      }}
      onKeyDown={(event) => {
        if (!editing || editor === undefined) return;
        const action = editorKeyAction(event);
        if (action === null) return;
        event.preventDefault();
        if (action === 'next' || action === 'previous') editor.step(action === 'next' ? 1 : -1);
        else editor.end();
      }}
    />
  );
}
