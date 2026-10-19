import type { CellEditorHooks } from './cell-editing.ts';
import { CellInput, type CellChange } from './cell-input.tsx';
import { acceptsNumberDraft, isWritableNumber, numberOf, numberText } from './cell-keys.ts';

/**
 * A number cell's editor: a field that refuses a letter as it is typed and
 * commits a number — or null once it is emptied, which clears the key. A
 * draft that reads as the number the cell holds ("3." on 3, "-" on an empty
 * cell) commits nothing, and nor does one no note can hold: not finite, or
 * past the integers kept exactly.
 */
export function NumberCellEditor({
  text,
  draft,
  editor,
}: {
  text: string;
  draft: string | null;
  editor: CellEditorHooks;
}) {
  const held = numberText(text);
  const changeOf = (typed: string): CellChange => {
    const next = numberOf(typed);
    if (next === numberOf(held)) return null;
    if (next !== null && !isWritableNumber(next)) return null;
    return { value: next };
  };
  return (
    <CellInput
      text={held}
      draft={draft}
      editor={editor}
      inputMode="decimal"
      accepts={acceptsNumberDraft}
      changeOf={changeOf}
    />
  );
}
