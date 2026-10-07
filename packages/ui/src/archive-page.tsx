import { formatPropertyDate, type ArchivedNote, type VaultPath } from '@atlas/domain';
import { Icon } from './icon.tsx';
import { PageBar, type PageHistory } from './page-bar.tsx';
import { PageHead } from './page-head.tsx';
import { SelectAllBox, SelectBox, SelectionBar, type RowSelection } from './row-selection.tsx';

/** What the Archive lists, once it has been read. */
export interface ArchiveContents {
  readonly notes: readonly ArchivedNote[];
  /** More matched than are listed; a search narrows them. */
  readonly truncated: boolean;
}

export interface ArchivePageProps {
  /** Null while the index is being asked. */
  contents: ArchiveContents | null;
  error: string | null;
  search: string;
  onSearch: (search: string) => void;
  selection: RowSelection;
  onClearSelection: () => void;
  onOpen: (path: VaultPath) => void;
  onUnarchive: (paths: readonly VaultPath[]) => void;
  /** While notes are being put back, so they are not asked for twice. */
  busy: boolean;
  onShowSidebar?: () => void;
  history?: PageHistory;
}

/**
 * The Archive: every archived note — its title, where it came from and the
 * day it was archived — searchable, each one a click from opening or going
 * back where it was. Rows can be chosen and put back together.
 */
export function ArchivePage(props: ArchivePageProps) {
  const { contents, selection } = props;
  const chosen = contents?.notes.filter((note) => selection.selected.has(note.path)) ?? [];
  return (
    <>
      <PageBar
        crumb={{ icon: 'archive', parent: 'Archive' }}
        name="Archived notes"
        {...(props.onShowSidebar !== undefined && { onShowSidebar: props.onShowSidebar })}
        {...(props.history !== undefined && { history: props.history })}
      />
      <div className="panel__body">
        <article className="page page--wide archive" aria-label="Archive">
          <PageHead
            icon="archive"
            title="Archive"
            description={describe(contents)}
            actions={<ArchiveSearch search={props.search} onSearch={props.onSearch} />}
          />
          <SelectionBar
            count={chosen.length}
            actions={[
              {
                label: `Unarchive ${chosen.length === 1 ? 'note' : `${chosen.length} notes`}`,
                onRun: () => props.onUnarchive(chosen.map((note) => note.path)),
                disabled: props.busy,
              },
            ]}
            onClear={props.onClearSelection}
          />
          <ArchiveList {...props} />
        </article>
      </div>
    </>
  );
}

function describe(contents: ArchiveContents | null): string | null {
  if (contents === null) return null;
  const count = contents.notes.length;
  const listed = `${count}${contents.truncated ? '+' : ''} archived ${count === 1 ? 'note' : 'notes'}`;
  return `${listed} · out of the way, never lost`;
}

function ArchiveSearch({
  search,
  onSearch,
}: {
  search: string;
  onSearch: (search: string) => void;
}) {
  return (
    <label className="archive__search">
      <Icon name="search" size={15} />
      <input
        type="search"
        className="archive__search-input"
        placeholder="Search the Archive…"
        aria-label="Search the Archive"
        value={search}
        onChange={(event) => onSearch(event.target.value)}
      />
    </label>
  );
}

function ArchiveList({
  contents,
  error,
  search,
  selection,
  onOpen,
  onUnarchive,
  busy,
}: ArchivePageProps) {
  if (error !== null) {
    return (
      <p className="table__error" role="alert">
        {error}
      </p>
    );
  }
  if (contents === null) return <p className="table__empty">Reading the Archive…</p>;
  if (contents.notes.length === 0) {
    return (
      <p className="archive__empty">
        {search.trim() === ''
          ? 'Nothing is archived. Archive a note from its “…” menu to put it away here.'
          : 'No archived note matches.'}
      </p>
    );
  }
  const paths = contents.notes.map((note) => note.path);
  return (
    <div className="table">
      <div className="table__sheet">
        <table className="table__grid archive__grid">
          <thead>
            <tr>
              <th className="table__choose">
                <SelectAllBox paths={paths} selection={selection} />
              </th>
              <th>Name</th>
              <th>Came from</th>
              <th>Archived</th>
              <th>
                <span className="visually-hidden">Unarchive</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {contents.notes.map((note) => (
              <tr key={note.path} className="table__row">
                <td className="table__choose">
                  <SelectBox
                    label={`Select ${note.title}`}
                    checked={selection.selected.has(note.path)}
                    onChange={() => selection.onToggle(note.path)}
                  />
                </td>
                <td className="table__name">
                  <button type="button" className="table__link" onClick={() => onOpen(note.path)}>
                    <Icon name="doc" size={16} />
                    <span className="table__title">{note.title}</span>
                  </button>
                </td>
                <td className="archive__from">
                  <span className="archive__from-path" title={note.from}>
                    {note.from}
                  </span>
                </td>
                <td className="archive__date">
                  {note.archivedOn === null
                    ? '—'
                    : (formatPropertyDate(note.archivedOn) ?? note.archivedOn)}
                </td>
                <td className="archive__actions">
                  <button
                    type="button"
                    className="btn btn--ghost archive__unarchive"
                    aria-label={`Unarchive ${note.title}`}
                    disabled={busy}
                    onClick={() => onUnarchive([note.path])}
                  >
                    Unarchive
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {contents.truncated && (
          <footer className="table__footer">
            <span className="table__count">More are archived; search to narrow them.</span>
          </footer>
        )}
      </div>
    </div>
  );
}
