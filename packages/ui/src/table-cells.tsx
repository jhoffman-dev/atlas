import { useEffect, useRef, useState } from 'react';
import { holdsLinks, isYou, linkedNames, propertyRole, type PropertyKind } from '@atlas/domain';
import { DoneCheckbox, doneClass, type DoneTicks } from './done-checkbox.tsx';
import type { LinePlace } from './grouped-rows.tsx';
import { Icon } from './icon.tsx';
import { LinkedNote, useNoteNames } from './note-names.tsx';
import { SelectBox, type RowSelection } from './row-selection.tsx';
import { StatusPill } from './status-pill.tsx';

/** The column every row is named by. */
export const TITLE = 'title';

/** What every row of one table shares: its columns, and what can be done to a row. */
export interface RowLook {
  readonly shown: readonly string[];
  readonly kinds: Readonly<Record<string, PropertyKind>>;
  readonly onOpenNote: (path: string) => void;
  readonly onEditCell?:
    ((args: { path: string; column: string; value: string }) => void) | undefined;
  readonly ticks?: DoneTicks | undefined;
  readonly selection?: RowSelection | undefined;
}

/** The cells a row leads with before its name: a box to choose it, a box to tick it done. */
export function leadCellCount(look: RowLook): number {
  return (look.selection === undefined ? 0 : 1) + (look.ticks === undefined ? 0 : 1);
}

/** One note as a table row: its boxes, then a cell per shown column. */
export function TableRow({
  path,
  values,
  look,
  index,
  measure,
}: {
  path: string;
  values: Readonly<Record<string, unknown>>;
  look: RowLook;
  /** Where the row sits among the lines a virtualised table measures. */
  index?: number;
  /** The virtualiser's ref, which measures the row as drawn. */
  measure?: LinePlace['measure'];
}) {
  const { selection, ticks, onOpenNote, onEditCell } = look;
  return (
    <tr className={doneClass('table__row', ticks, values)} ref={measure} data-index={index}>
      {selection !== undefined && (
        <td className="table__choose">
          <SelectBox
            label={`Select ${String(values[TITLE] ?? path)}`}
            checked={selection.selected.has(path)}
            onChange={() => selection.onToggle(path)}
          />
        </td>
      )}
      {ticks !== undefined && (
        <td className="table__done">
          <DoneCheckbox
            path={path}
            title={String(values[TITLE] ?? '')}
            values={values}
            ticks={ticks}
          />
        </td>
      )}
      {look.shown.map((column) => (
        <td key={column} className={column === TITLE ? 'table__name' : undefined}>
          <CellFor
            column={column}
            kind={look.kinds[column]}
            value={values[column]}
            onOpen={() => onOpenNote(path)}
            onOpenNote={onOpenNote}
            {...(onEditCell !== undefined && {
              onCommit: (next: string) => onEditCell({ path, column, value: next }),
            })}
          />
        </td>
      ))}
    </tr>
  );
}

/** A cell drawn by what it holds: the name opens the note, the rest edit in place. */
function CellFor({
  column,
  kind,
  value,
  onOpen,
  onOpenNote,
  onCommit,
}: {
  column: string;
  kind: PropertyKind | undefined;
  value: unknown;
  onOpen: () => void;
  /** Opens a note a relation in the row links. */
  onOpenNote: (path: string) => void;
  onCommit?: (value: string) => void;
}) {
  if (column === TITLE) {
    return (
      <button type="button" className="table__link" onClick={onOpen}>
        <Icon name="doc" size={16} />
        <span className="table__title">{String(value ?? '')}</span>
      </button>
    );
  }
  // A column no type declares — a SQL view's — is a relation when it holds links.
  if (kind === 'relation' || (kind === undefined && holdsLinks(value))) {
    return <RelationCell value={value} onOpenNote={onOpenNote} />;
  }
  const look =
    kind === 'select' ? 'pill' : propertyRole(column) === 'person' && isYou(value) ? 'you' : 'text';
  if (onCommit === undefined) {
    return (
      <span className="table__cell">
        <CellFace text={value === null || value === undefined ? '' : String(value)} look={look} />
      </span>
    );
  }
  return <Cell value={value} look={look} onCommit={onCommit} />;
}

/**
 * A relation's cell: the notes it links, by name, each opening its note. The
 * cell holds `[[…]]` as the file does; it is never shown that way. A relation
 * is changed on its note, where the notes it may link are offered.
 */
function RelationCell({
  value,
  onOpenNote,
}: {
  value: unknown;
  onOpenNote: (path: string) => void;
}) {
  const names = linkedNames(value, useNoteNames());
  if (names.length === 0) {
    return (
      <span className="table__cell">
        <CellFace text={value === null || value === undefined ? '' : String(value)} look="text" />
      </span>
    );
  }
  return (
    <span className="table__cell table__links">
      {names.map((name, at) => (
        <LinkedNote key={at} name={name} className="table__note" onOpen={onOpenNote} />
      ))}
    </span>
  );
}

/**
 * A cell that becomes an input when clicked and writes back when it is left.
 *
 * An empty one shows nothing until the row is pointed at, when a faint "Empty"
 * says it can be filled in.
 */
function Cell({
  value,
  look,
  onCommit,
}: {
  value: unknown;
  look: 'pill' | 'you' | 'text';
  onCommit: (value: string) => void;
}) {
  const text = value === null || value === undefined ? '' : String(value);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const unsaved = useUnsavedEdit({ pending: editing && draft !== text, draft, onCommit });

  if (!editing) {
    return (
      <button
        type="button"
        className="table__cell"
        onClick={() => {
          setDraft(text);
          setEditing(true);
        }}
      >
        <CellFace text={text} look={look} />
      </button>
    );
  }

  const commit = () => {
    unsaved.settled();
    setEditing(false);
    if (draft !== text) onCommit(draft);
  };

  return (
    <input
      className="table__input"
      // The input exists only because the cell was just clicked, so focusing it
      // is what the click asked for rather than a focus steal.
      autoFocus
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') {
          unsaved.settled();
          setEditing(false);
        }
      }}
    />
  );
}

/**
 * Writes an edit still in progress when its cell leaves the page — a
 * virtualised table drops a row scrolled out of reach, and a removed input
 * gets no blur — so what was typed is kept, as leaving the cell keeps it.
 * `settled` marks the edit written or abandoned, so it is never written twice.
 */
function useUnsavedEdit({
  pending,
  draft,
  onCommit,
}: {
  pending: boolean;
  draft: string;
  onCommit: (value: string) => void;
}) {
  const latest = useRef<(() => void) | null>(null);
  useEffect(() => {
    latest.current = pending ? () => onCommit(draft) : null;
  }, [pending, draft, onCommit]);
  useEffect(
    () => () => {
      latest.current?.();
    },
    [],
  );
  return {
    settled: () => {
      latest.current = null;
    },
  };
}

function CellFace({ text, look }: { text: string; look: 'pill' | 'you' | 'text' }) {
  if (text === '') return <span className="table__blank">Empty</span>;
  if (look === 'pill') return <StatusPill value={text} />;
  if (look === 'you') {
    return (
      <span className="table__you" aria-label={text}>
        <Icon name="person" size={12} />
        You
      </span>
    );
  }
  return <>{text}</>;
}
