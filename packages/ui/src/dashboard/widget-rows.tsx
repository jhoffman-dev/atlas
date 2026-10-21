import { withNoteNames, type NoteNames } from '@dfai/domain';
import type { WidgetRow } from '@dfai/application';
import { useNoteNames } from '../note-names.tsx';

/** path identifies a row and the title opens it; neither is a column to show. */
const IDENTIFYING = new Set(['path', 'title']);

/**
 * A list widget's rows: the title, which opens the note, and whatever else
 * the row carries on one metadata line — `P14 · 1h` — with nothing printed
 * for an empty value.
 */
export function WidgetList({
  rows,
  columns,
  onOpenNote,
}: {
  rows: readonly WidgetRow[];
  columns: readonly string[];
  onOpenNote: (path: string) => void;
}) {
  const names = useNoteNames();
  if (rows.length === 0) return <p className="widget__empty">Nothing matches yet.</p>;

  const shown = columns.filter((column) => !IDENTIFYING.has(column));

  return (
    <ul className="widget__list">
      {rows.map((row) => {
        const meta = metadataOf(row, shown, names);
        return (
          <li key={row.path} className="widget__row">
            <button type="button" className="widget__link" onClick={() => onOpenNote(row.path)}>
              {row.title}
            </button>
            {meta !== '' && <span className="widget__meta">{meta}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** The row's other values on one line, separated by " · ", leaving out the empty ones. */
function metadataOf(row: WidgetRow, columns: readonly string[], names: NoteNames): string {
  return columns
    .map((column) => withNoteNames(row.values[column], names))
    .filter((value) => value !== '')
    .join(' · ');
}

export function WidgetTable({
  columns,
  rows,
  onOpenNote,
}: {
  columns: readonly string[];
  rows: readonly WidgetRow[];
  onOpenNote: (path: string) => void;
}) {
  const names = useNoteNames();
  if (rows.length === 0) return <p className="widget__empty">Nothing matches yet.</p>;

  // A SQL widget's rows may have neither path nor title, and are then read as they came.
  const named = columns.includes('path') && columns.includes('title');
  const shown = named ? columns.filter((column) => !IDENTIFYING.has(column)) : columns;

  return (
    <div className="widget__scroll">
      <table className="widget__table">
        <thead>
          <tr>
            {named && <th scope="col">Name</th>}
            {shown.map((column) => (
              <th scope="col" key={column}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, at) => (
            <tr key={named ? row.path : at}>
              {named && (
                <td>
                  <button
                    type="button"
                    className="widget__link"
                    onClick={() => onOpenNote(row.path)}
                  >
                    {row.title}
                  </button>
                </td>
              )}
              {shown.map((column) => (
                <td key={column}>{withNoteNames(row.values[column], names)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
