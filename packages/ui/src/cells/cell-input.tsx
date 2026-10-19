import { useRef } from 'react';
import type { CellEditorHooks, CellValue } from './cell-editing.ts';
import { useOpeningFocus } from './cell-focus.ts';
import { editorKeyAction } from './cell-keys.ts';

/** What a draft commits, or null for one that commits nothing. */
export type CellChange = { readonly value: CellValue } | null;

/** Text as a cell holds it, as typed: an emptied cell reports '', which the note reads as cleared. */
export const textChange = (typed: string): CellChange => ({ value: typed });

/**
 * The field a typed-in cell edits in — text, a number, a date — wearing the
 * 1.5px `focus` ring. ↵ commits, Esc cancels, Tab and ⇧Tab commit and move
 * on; leaving it commits too, as leaving a cell always has. A draft that
 * reads as the cell did changes nothing, and nothing is written for it.
 */
export function CellInput({
  text,
  draft,
  editor,
  type = 'text',
  accepts = () => true,
  changeOf = textChange,
  ...field
}: {
  /** What the cell holds, as text. */
  text: string;
  /** What has been typed so far, or null until something is. */
  draft: string | null;
  editor: CellEditorHooks;
  type?: 'text' | 'date';
  /** Whether a draft may be typed; one refused leaves the field as it was. */
  accepts?: (typed: string) => boolean;
  /** What a draft commits, once it differs from the cell. */
  changeOf?: (typed: string) => CellChange;
  inputMode?: 'text' | 'decimal';
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  useOpeningFocus(editor, input);
  const typed = draft ?? text;
  const change = typed === text ? null : changeOf(typed);
  const end = () => (change === null ? editor.end() : editor.end(change));
  const step = (to: 1 | -1) => (change === null ? editor.step(to) : editor.step(to, change));
  return (
    <input
      {...field}
      ref={input}
      className={field.className ?? 'table__input'}
      type={type}
      value={typed}
      onChange={(event) => {
        const next = event.target.value;
        if (accepts(next)) editor.draft(next, next === text ? null : changeOf(next));
      }}
      onBlur={(event) => {
        // A field that has left the page lost its focus to the scroll, not to
        // the reader: the edit goes on, and is back once its row is drawn.
        if (event.currentTarget.isConnected) end();
      }}
      onKeyDown={(event) => {
        const action = editorKeyAction(event);
        if (action === null) return;
        event.preventDefault();
        if (action === 'commit') end();
        else if (action === 'cancel') editor.end();
        else step(action === 'next' ? 1 : -1);
      }}
    />
  );
}
