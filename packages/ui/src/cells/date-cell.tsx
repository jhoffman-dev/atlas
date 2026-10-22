import { withDatePart } from '@dfai/domain';
import type { CellEditorHooks } from './cell-editing.ts';
import { CellInput } from './cell-input.tsx';
import { isIsoDay } from './cell-keys.ts';

/**
 * A date cell's editor: the platform's date field, which commits a day as
 * `YYYY-MM-DD` and keeps whatever followed the day — a time, a zone — as
 * the properties panel does. The field reads '' the moment a part of the
 * day is erased, so an empty draft commits nothing: a date is not lost to
 * one Backspace, and is cleared on the note instead.
 */
export function DateCellEditor({
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
      text={text.slice(0, 10)}
      draft={draft}
      editor={editor}
      type="date"
      className="table__input table__input--date"
      changeOf={(typed) => (isIsoDay(typed) ? { value: withDatePart(text, typed) } : null)}
    />
  );
}
