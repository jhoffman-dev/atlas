import type { CellEditorHooks } from './cell-editing.ts';
import { CellInput } from './cell-input.tsx';
import { acceptsNumberDraft, numberOf } from './cell-keys.ts';

/**
 * A number cell's editor: a field that refuses a letter as it is typed and
 * commits a number — or null once it is emptied, which clears the key.
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
  return (
    <CellInput
      text={text}
      draft={draft}
      editor={editor}
      inputMode="decimal"
      accepts={acceptsNumberDraft}
      changeOf={(typed) => ({ value: numberOf(typed) })}
    />
  );
}
