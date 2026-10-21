import { Popover } from '@base-ui/react/popover';
import type { RefObject } from 'react';
import type { PropertyDef } from '@dfai/domain';
import type { CreateRelated, RelationChoice } from '../properties-panel.tsx';
import type { CellEditing, CellEditorHooks } from './cell-editing.ts';
import { RelationPickerPopover, useHeldValue } from './relation-cell.tsx';
import { StatusPicker } from './status-picker.tsx';

/** Whether a column's cells edit in a picker under the cell rather than a field in it. */
export function picksFrom(def: PropertyDef | undefined): boolean {
  if (def === undefined) return false;
  if (def.kind === 'relation') return true;
  return (def.kind === 'select' || def.kind === 'multiSelect') && def.options.length > 0;
}

/**
 * Whether a column's cells hold several values — a relation to many notes, a
 * multi-select — which the table's row has joined into one text: what such a
 * cell holds is read from its note, never split out of that text.
 */
export function holdsSeveral(def: PropertyDef | undefined): boolean {
  if (def === undefined) return false;
  return (def.kind === 'relation' && def.many) || def.kind === 'multiSelect';
}

/** What the editing cell holds, for its picker: read, being read, or not readable. */
export type HeldCell =
  | { readonly state: 'read'; readonly value: unknown }
  | { readonly state: 'reading' }
  | { readonly state: 'failed'; readonly problem: string };

/**
 * The picker the editing cell opens, mounted once for the table and only
 * while a cell that picks is edited: a status's or a multi-select's options,
 * or a relation's notes. It hangs from the cell the editor's anchor names.
 */
export function CellPickers({
  editing,
  def,
  held,
  choices,
  choicesProblem = null,
  editor,
  onOpenNote,
  onCreateRelated,
}: {
  editing: CellEditing;
  /** The editing column's property. */
  def: PropertyDef;
  /** What the editing cell holds now. */
  held: HeldCell;
  /** The notes a relation column may link. */
  choices: readonly RelationChoice[];
  /** Why those notes could not be read. */
  choicesProblem?: string | null;
  editor: CellEditorHooks;
  onOpenNote: (path: string) => void;
  onCreateRelated?: CreateRelated;
}) {
  if (held.state !== 'read') {
    return (
      <CellPickerNotice
        anchor={editor.anchor}
        label={def.label}
        message={held.state === 'reading' ? 'Reading…' : held.problem}
        failed={held.state === 'failed'}
        onCancel={() => editor.end()}
      />
    );
  }
  const { value } = held;
  if (def.kind === 'relation') {
    return (
      <RelationPickerPopover
        open
        anchor={editor.anchor}
        def={def}
        value={value}
        choices={choices}
        problem={choicesProblem}
        onWrite={(next) =>
          editor.write({ path: editing.path, column: editing.column, value: next })
        }
        onOpenNote={onOpenNote}
        onCancel={() => editor.end()}
        {...(onCreateRelated !== undefined && { onCreateRelated })}
      />
    );
  }
  if (def.kind === 'multiSelect') {
    return <MultiSelectPicker editing={editing} def={def} value={value} editor={editor} />;
  }
  const current = value === null || value === undefined ? '' : String(value);
  return (
    <StatusPicker
      open
      anchor={editor.anchor}
      label={def.label}
      options={def.options}
      source={def}
      value={current === '' ? null : current}
      onPick={(option) => (option === current ? editor.end() : editor.end({ value: option }))}
      onCancel={() => editor.end()}
      onStep={(to) => editor.step(to)}
    />
  );
}

/** A multi-select's options as a list, however the note spells them: one, several, or none. */
function optionsHeld(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.filter((item) => item !== null).map(String);
  if (value === null || value === undefined || value === '') return [];
  return [String(value)];
}

/**
 * A multi-select's picker: the status picker's rows, each held option
 * ticked; picking one toggles it, written at once as the list it leaves —
 * one write per toggle, the picker open for the next. A write the note
 * refused puts the ticks back as the file holds them.
 */
function MultiSelectPicker({
  editing,
  def,
  value,
  editor,
}: {
  editing: CellEditing;
  def: PropertyDef;
  value: unknown;
  editor: CellEditorHooks;
}) {
  const held = useHeldValue(value);
  const list = optionsHeld(held.value);
  const toggle = (option: string) => {
    const next = list.includes(option) ? list.filter((each) => each !== option) : [...list, option];
    held.set(next);
    const write = editor.write({ path: editing.path, column: editing.column, value: next });
    // Refused or failed: said by whoever refused it; the ticks go back to the file's.
    Promise.resolve(write).catch(held.reset);
  };
  return (
    <StatusPicker
      open
      anchor={editor.anchor}
      label={def.label}
      options={def.options}
      source={def}
      value={null}
      selected={list}
      onPick={toggle}
      onCancel={() => editor.end()}
      onStep={(to) => editor.step(to)}
    />
  );
}

/** The picker's place while what the cell holds is read, or once it cannot be. */
function CellPickerNotice({
  anchor,
  label,
  message,
  failed,
  onCancel,
}: {
  anchor: RefObject<HTMLElement | null>;
  label: string;
  message: string;
  failed: boolean;
  onCancel: () => void;
}) {
  return (
    <Popover.Root
      open
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <Popover.Portal>
        <Popover.Positioner
          className="menu-positioner"
          anchor={anchor}
          side="bottom"
          align="start"
          sideOffset={2}
        >
          <Popover.Popup className="cell-picker" aria-label={`Set ${label}`} finalFocus={false}>
            <p className="cell-picker__none" role={failed ? 'alert' : 'status'}>
              {message}
            </p>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
