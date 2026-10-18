import { memo, useEffect, useRef, useState } from 'react';
import { holdsLinks, isYou, linkedNames, propertyRole, type PropertyKind } from '@atlas/domain';
import { ChecklistProgress } from './checklist-progress.tsx';
import { DoneCheckbox, type DoneTicks } from './done-checkbox.tsx';
import { ariaRowIndex, type LinePlace } from './grouped-rows.tsx';
import { ROW_STOP } from './row-focus.ts';
import { Icon } from './icon.tsx';
import { LinkedNote, useNoteNames } from './note-names.tsx';
import { SelectBox } from './row-selection.tsx';
import { sameEntries } from './steady-value.ts';
import { StatusPill } from './status-pill.tsx';

/** The column every row is named by. */
export const TITLE = 'title';

/**
 * What every row of one table shares: its columns, and what can be done to a
 * row. Held steady from one render to the next, so a row draws again only
 * for a change of its own (#238).
 */
export interface RowLook {
  readonly shown: readonly string[];
  readonly kinds: Readonly<Record<string, PropertyKind>>;
  readonly onOpenNote: (path: string) => void;
  readonly onEditCell?:
    ((args: { path: string; column: string; value: string }) => void) | undefined;
  /** Given when the view's type can be ticked done: each row leads with a box. */
  readonly onTick?: DoneTicks['onToggle'] | undefined;
  /**
   * Given while rows can be chosen: each row leads with a box that toggles it,
   * or, with Shift held, extends the choice to it.
   */
  readonly onChoose?: ((path: string, how: { readonly shift: boolean }) => void) | undefined;
}

/** The cells a row leads with before its name: a box to choose it, a box to tick it done. */
export function leadCellCount(look: RowLook): number {
  return (look.onChoose === undefined ? 0 : 1) + (look.onTick === undefined ? 0 : 1);
}

/** One row as the table hands it over: the note, and what it says of the row. */
export interface TableRowProps {
  readonly path: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly look: RowLook;
  /** Whether the note counts as finished, where rows can be ticked. */
  readonly done: boolean;
  /** Whether the row is chosen, while rows can be. */
  readonly chosen: boolean;
  /** Where the row sits among the lines a virtualised table measures. */
  readonly index?: number;
  /** The virtualiser's ref, which measures the row as drawn. */
  readonly measure?: LinePlace['measure'];
}

/**
 * One note as a table row: its boxes, then a cell per shown column. Drawn
 * again only when what it shows changes — a query read again hands every row
 * new values, and only the row whose values differ is drawn (#238).
 */
export const TableRow = memo(function TableRow({
  path,
  values,
  look,
  done,
  chosen,
  index,
  measure,
}: TableRowProps) {
  const { onChoose, onTick, onOpenNote, onEditCell } = look;
  return (
    <tr
      className={done ? 'table__row table__row--done' : 'table__row'}
      ref={measure}
      data-index={index}
      aria-rowindex={index === undefined ? undefined : ariaRowIndex(index)}
    >
      {onChoose !== undefined && (
        <td className="table__choose">
          <SelectBox
            label={`Select ${String(values[TITLE] ?? path)}`}
            checked={chosen}
            onChange={(_checked, how) => onChoose(path, how)}
          />
        </td>
      )}
      {onTick !== undefined && (
        <td className="table__done">
          <DoneCheckbox
            path={path}
            title={String(values[TITLE] ?? '')}
            values={values}
            ticks={{ isDone: () => done, onToggle: onTick }}
          />
        </td>
      )}
      {look.shown.map((column) => (
        <td
          key={column}
          className={column === TITLE ? 'table__name' : undefined}
          data-kind={look.kinds[column]}
        >
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
          {column === TITLE && <ChecklistProgress values={values} kinds={look.kinds} />}
        </td>
      ))}
    </tr>
  );
}, sameRow);

/** Whether a row would draw the same: its values compared by what they hold, the rest by identity. */
function sameRow(before: TableRowProps, after: TableRowProps): boolean {
  return (
    before.path === after.path &&
    before.look === after.look &&
    before.done === after.done &&
    before.chosen === after.chosen &&
    before.index === after.index &&
    before.measure === after.measure &&
    (before.values === after.values || sameEntries(before.values, after.values))
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
      <button {...ROW_STOP} type="button" className="table__link" onClick={onOpen}>
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
    const text = value === null || value === undefined ? '' : String(value);
    return (
      <span className="table__cell" title={fullValue(text, look)}>
        <CellFace text={text} look={look} />
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
 * An empty one stays blank (Table.dc.html); its button still says it is an
 * empty value, so a screen reader finds something to fill in.
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
        aria-label={text === '' ? EMPTY_CELL_NAME : undefined}
        title={fullValue(text, look)}
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

/** What an empty editable cell's button is called, since it shows nothing. */
export const EMPTY_CELL_NAME = 'Empty value';

/** A text cell is cut short at the cell's measure, so its whole value is its title. */
function fullValue(text: string, look: 'pill' | 'you' | 'text'): string | undefined {
  return look === 'text' && text !== '' ? text : undefined;
}

function CellFace({ text, look }: { text: string; look: 'pill' | 'you' | 'text' }) {
  if (text === '') return null;
  if (look === 'pill') return <StatusPill value={text} />;
  if (look === 'you') {
    return (
      <span className="table__you" aria-label={text}>
        <Icon name="person" size={12} />
        You
      </span>
    );
  }
  return <span className="table__text">{text}</span>;
}
