import { useRef, type ReactNode, type RefObject } from 'react';
import { Popover } from '@base-ui/react/popover';
import {
  createVaultPath,
  linkedNames,
  linkedNotes,
  relationTypes,
  relationTypesText,
  withLink,
  withoutLink,
  type PropertyDef,
  type VaultPath,
} from '@atlas/domain';
import { Icon } from '../icon.tsx';
import { LinkedNote, useNoteNames } from '../note-names.tsx';
import type { CreateRelated, RelationChoice } from '../properties-panel.tsx';
import { linksTo, RelationPicker } from '../relation-options.tsx';
import type { CellEditorHooks, CellValue } from './cell-editing.ts';
import { useAnchoring, useReturningFocus } from './cell-focus.ts';
import type { CellAt } from './cell-keys.ts';

/**
 * A relation's cell: the notes it links, by name, each opening its note.
 * The cell holds `[[…]]` as the file does; it is never shown that way.
 * Where cells edit, the cell is a stop too: a click beside the names, ↵ or
 * Space opens its picker under it, and it wears the ring while that is open.
 */
export function RelationCell({
  at,
  label,
  value,
  editing,
  editor,
  onOpenNote,
}: {
  at: CellAt;
  /** The column's label, which names an empty cell: "No project". */
  label: string;
  value: unknown;
  /** Whether this cell's picker is open. */
  editing: boolean;
  editor: CellEditorHooks | undefined;
  onOpenNote: (path: string) => void;
}) {
  const names = linkedNames(value, useNoteNames());
  const text = names.map((name) => name.text).join(', ');
  const chips = names.map((name, index) => (
    <LinkedNote key={index} name={name} className="table__note" onOpen={onOpenNote} />
  ));
  if (editor === undefined) {
    return (
      <span className="table__cell table__links" title={text === '' ? undefined : text}>
        {chips}
      </span>
    );
  }
  return (
    <RelationStop at={at} label={label} text={text} editing={editing} editor={editor}>
      {chips}
    </RelationStop>
  );
}

/** The relation cell as a stop: focusable, opening its picker, taking the focus back after. */
function RelationStop({
  at,
  label,
  text,
  editing,
  editor,
  children,
}: {
  at: CellAt;
  label: string;
  text: string;
  editing: boolean;
  editor: CellEditorHooks;
  children: ReactNode;
}) {
  const stop = useRef<HTMLSpanElement>(null);
  useReturningFocus(at, editor, stop);
  useAnchoring(editing, editor, stop);
  return (
    <span
      ref={stop}
      role="button"
      tabIndex={0}
      className="table__cell table__links"
      aria-label={text === '' ? `No ${label.toLowerCase()}` : text}
      aria-haspopup="dialog"
      aria-expanded={editing}
      data-cell-stop={at.column}
      data-editing={editing ? '' : undefined}
      title={text === '' ? undefined : text}
      onClick={() => editor.start(at)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        editor.start(at);
      }}
    >
      {children}
    </span>
  );
}

/**
 * The picker a relation cell opens: a chip per note it links, each with its
 * own remove, then the relation's picker (the properties panel's), offering
 * the notes not linked yet and "New <type>…". Each pick or removal is one
 * write; Esc and a press outside close it.
 */
export function RelationPickerPopover({
  open,
  anchor,
  def,
  value,
  choices,
  onWrite,
  onOpenNote,
  onCancel,
  onCreateRelated,
}: {
  open: boolean;
  anchor: RefObject<HTMLElement | null>;
  def: Pick<PropertyDef, 'label' | 'many' | 'target' | 'targets'>;
  /** What the cell holds now. */
  value: unknown;
  /** The notes the relation may link. */
  choices: readonly RelationChoice[];
  onWrite: (value: CellValue) => void;
  onOpenNote: (path: VaultPath) => void;
  onCancel: () => void;
  onCreateRelated?: CreateRelated;
}) {
  const names = useNoteNames();
  const links = linkedNotes(value);
  const { label, many } = def;
  const unlinked = choices.filter(
    (choice) => !links.some((link) => linksTo(link, createVaultPath(choice.path), names)),
  );
  const what = relationTypesText(def);
  const prompt = many
    ? `Add a ${what}…`
    : links.length === 0
      ? `— no ${what} —`
      : `Change ${what}…`;
  return (
    <Popover.Root
      open={open}
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
          <Popover.Popup
            className="cell-picker cell-picker--relation"
            aria-label={`Set ${label}`}
            finalFocus={false}
          >
            {links.length > 0 && (
              <ul className="props__link-list" aria-label={label}>
                {links.map((link) => {
                  const [name] = linkedNames(link, names);
                  const title = name?.text ?? link;
                  return (
                    <li key={link} className="props__chip props__link">
                      {name === undefined ? (
                        <span className="props__link-title">{link}</span>
                      ) : (
                        <LinkedNote name={name} className="props__link-title" onOpen={onOpenNote} />
                      )}
                      <button
                        type="button"
                        className="props__link-remove"
                        aria-label={`Remove ${title} from ${label}`}
                        onClick={() => onWrite(withoutLink(value, link))}
                      >
                        <Icon name="close" size={12} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <RelationPicker
              choices={unlinked}
              names={names}
              prompt={prompt}
              pointsAt={relationTypes(def)}
              onPick={(link) => onWrite(withLink({ value, link, many }))}
              {...(onCreateRelated !== undefined && { onCreateRelated })}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
