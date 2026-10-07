import { withNoteNames } from '@atlas/domain';
import type { WidgetRow } from '@atlas/application';
import { useNoteNames } from '../note-names.tsx';

export function WidgetList({
  rows,
  onOpenNote,
}: {
  rows: readonly WidgetRow[];
  onOpenNote: (path: string) => void;
}) {
  if (rows.length === 0) return <p className="widget__empty">Nothing matches yet.</p>;

  return (
    <ul className="widget__list">
      {rows.map((row) => (
        <li key={row.path}>
          <button type="button" className="widget__link" onClick={() => onOpenNote(row.path)}>
            {row.title}
          </button>
        </li>
      ))}
    </ul>
  );
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

  // path identifies a row; the title already opens it, so it is not a column.
  // A SQL widget's rows may be neither, and are then read as they came.
  const named = columns.includes('path') && columns.includes('title');
  const shown = named
    ? columns.filter((column) => column !== 'path' && column !== 'title')
    : columns;

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
