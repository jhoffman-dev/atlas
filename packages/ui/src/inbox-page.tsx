import { createVaultPath, humanizeKey, type InboxItem, type VaultPath } from '@atlas/domain';
import { Icon } from './icon.tsx';
import { useNoteNames } from './note-names.tsx';
import { PageBar, type PageHistory } from './page-bar.tsx';
import { PageHead } from './page-head.tsx';
import type { RelationChoice } from './properties-panel.tsx';
import { RelationOptions } from './relation-options.tsx';
import { TaskMigration, type TaskMigrationProps } from './task-migration.tsx';

/** What the Inbox lists, once it has been read. */
export interface InboxContents {
  readonly items: readonly InboxItem[];
  /** More are waiting than are listed. */
  readonly truncated: boolean;
}

/** The offer to let the vault's own types link a project or an area, with what each gains. */
export interface InboxTypesOffer {
  readonly lines: readonly string[];
  readonly onAccept: () => void;
  readonly onDismiss: () => void;
}

export interface InboxPageProps {
  /** Null while the index is being asked. */
  contents: InboxContents | null;
  error: string | null;
  /** The projects and areas a note can be filed under. */
  filing: readonly RelationChoice[];
  onOpen: (path: VaultPath) => void;
  onProcess: (args: { path: VaultPath; project: VaultPath }) => void;
  /** While a note is being filed, so it is not asked for twice. */
  busy: boolean;
  /** Why the last note could not be filed, or null. */
  problem: string | null;
  typesOffer?: InboxTypesOffer | null;
  /** Moving the vault's tasks to GTD's eight statuses, previewed first (P30-02). */
  taskMigration?: TaskMigrationProps | null;
  /** The vault's own Inbox view, which the sidebar's Inbox row opened before this page. */
  view?: { readonly title: string; readonly onOpen: () => void } | null;
  onShowSidebar?: () => void;
  history?: PageHistory;
}

/**
 * The Inbox: every note waiting in the `Inbox` folder — captured, imported or
 * dropped there — each a click from opening, and one choice from being filed
 * under a project or an area, which moves it into that project's folder and
 * links it (P30-01).
 */
export function InboxPage(props: InboxPageProps) {
  const view = props.view ?? null;
  const offer = props.typesOffer ?? null;
  const migration = props.taskMigration ?? null;
  return (
    <>
      <PageBar
        crumb={{ icon: 'inbox', parent: 'Inbox' }}
        name="To process"
        {...(props.onShowSidebar !== undefined && { onShowSidebar: props.onShowSidebar })}
        {...(props.history !== undefined && { history: props.history })}
      />
      <div className="panel__body">
        <article className="page page--wide inbox" aria-label="Inbox">
          <PageHead
            icon="inbox"
            title="Inbox"
            description={describe(props.contents)}
            {...(view !== null && {
              actions: (
                <button type="button" className="btn btn--ghost btn--sm" onClick={view.onOpen}>
                  Open the {view.title} view
                </button>
              ),
            })}
          />
          {offer !== null && <TypesOffer {...offer} />}
          {migration !== null && <TaskMigration {...migration} />}
          {props.problem !== null && (
            <p className="table__error" role="alert">
              {props.problem}
            </p>
          )}
          <InboxList {...props} />
        </article>
      </div>
    </>
  );
}

function describe(contents: InboxContents | null): string | null {
  if (contents === null) return null;
  const count = contents.items.length;
  if (count === 0) return 'Nothing waiting';
  return `${count}${contents.truncated ? '+' : ''} to process · file each under a project or an area`;
}

function TypesOffer({ lines, onAccept, onDismiss }: InboxTypesOffer) {
  return (
    <aside className="inbox__offer" aria-label="Link your types to projects and areas">
      <Icon name="link" size={16} className="inbox__offer-icon" />
      <div className="inbox__offer-text">
        <p>Notes are filed under a project or an area. Your types could link either:</p>
        <ul>
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onAccept}>
        Add to the types
      </button>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onDismiss}>
        Not now
      </button>
    </aside>
  );
}

function InboxList({ contents, error, filing, onOpen, onProcess, busy }: InboxPageProps) {
  if (error !== null) {
    return (
      <p className="table__error" role="alert">
        {error}
      </p>
    );
  }
  if (contents === null) return <p className="table__empty">Reading the Inbox…</p>;
  if (contents.items.length === 0) {
    return (
      <p className="inbox__empty">
        Nothing is waiting. Captured tasks (⇧⌘N) and imported meetings arrive here.
      </p>
    );
  }
  return (
    <div className="table">
      <div className="table__sheet">
        <table className="table__grid inbox__grid">
          <thead>
            <tr>
              <th>Name</th>
              <th>Kind</th>
              <th>
                <span className="visually-hidden">File under</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {contents.items.map((item) => (
              <tr key={item.path} className="table__row">
                <td className="table__name">
                  <button type="button" className="table__link" onClick={() => onOpen(item.path)}>
                    <Icon name="doc" size={16} />
                    <span className="table__title">{item.title}</span>
                  </button>
                </td>
                <td className="inbox__kind">{kindOf(item)}</td>
                <td className="inbox__actions">
                  <FileUnder item={item} filing={filing} busy={busy} onProcess={onProcess} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {contents.truncated && (
          <footer className="table__footer">
            <span className="table__count">More are waiting; process these to see them.</span>
          </footer>
        )}
      </div>
    </div>
  );
}

/** "Meeting · Meetings": its type, and the folder of the Inbox it arrived in. */
function kindOf(item: InboxItem): string {
  const type = item.type === null ? 'Note' : humanizeKey(item.type);
  return item.arrivedIn === '' ? type : `${type} · ${item.arrivedIn}`;
}

function FileUnder({
  item,
  filing,
  busy,
  onProcess,
}: {
  item: InboxItem;
  filing: readonly RelationChoice[];
  busy: boolean;
  onProcess: InboxPageProps['onProcess'];
}) {
  const names = useNoteNames();
  return (
    <select
      className="inbox__file"
      aria-label={`File ${item.title} under`}
      value=""
      disabled={busy || filing.length === 0}
      onChange={(event) => {
        const project = event.target.value;
        if (project !== '') onProcess({ path: item.path, project: createVaultPath(project) });
      }}
    >
      <option value="">{filing.length === 0 ? 'No project or area yet' : 'File under…'}</option>
      <RelationOptions choices={filing} names={names} optionValue={(choice) => choice.path} />
    </select>
  );
}
