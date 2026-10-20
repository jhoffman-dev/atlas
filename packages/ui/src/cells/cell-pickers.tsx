import type { PropertyDef } from '@atlas/domain';
import type { CreateRelated, RelationChoice } from '../properties-panel.tsx';
import type { CellEditing, CellEditorHooks } from './cell-editing.ts';
import { RelationPickerPopover } from './relation-cell.tsx';
import { StatusPicker } from './status-picker.tsx';

/** Whether a column's cells edit in a picker under the cell rather than a field in it. */
export function picksFrom(def: PropertyDef | undefined): boolean {
  if (def === undefined) return false;
  return def.kind === 'relation' || (def.kind === 'select' && def.options.length > 0);
}

/**
 * The picker the editing cell opens, mounted once for the table and only
 * while a cell that picks is edited: a status's options, or a relation's
 * notes. It hangs from the cell the editor's anchor names.
 */
export function CellPickers({
  editing,
  def,
  value,
  choices,
  editor,
  onOpenNote,
  onCreateRelated,
}: {
  editing: CellEditing;
  /** The editing column's property. */
  def: PropertyDef;
  /** What the editing cell holds now. */
  value: unknown;
  /** The notes a relation column may link. */
  choices: readonly RelationChoice[];
  editor: CellEditorHooks;
  onOpenNote: (path: string) => void;
  onCreateRelated?: CreateRelated;
}) {
  if (def.kind === 'relation') {
    return (
      <RelationPickerPopover
        open
        anchor={editor.anchor}
        def={def}
        value={value}
        choices={choices}
        onWrite={(next) =>
          editor.write({ path: editing.path, column: editing.column, value: next })
        }
        onOpenNote={onOpenNote}
        onCancel={() => editor.end()}
        {...(onCreateRelated !== undefined && { onCreateRelated })}
      />
    );
  }
  const held = value === null || value === undefined ? '' : String(value);
  return (
    <StatusPicker
      open
      anchor={editor.anchor}
      label={def.label}
      options={def.options}
      source={def}
      value={held === '' ? null : held}
      onPick={(option) => (option === held ? editor.end() : editor.end({ value: option }))}
      onCancel={() => editor.end()}
      onStep={(to) => editor.step(to)}
    />
  );
}
