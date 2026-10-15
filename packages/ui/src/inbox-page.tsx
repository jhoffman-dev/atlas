import type { GtdStatus, InboxItem, VaultPath } from '@atlas/domain';
import { UNDO_BAR_MS, useDismissAfter } from './dismiss-after.ts';
import { Icon } from './icon.tsx';
import { InboxRows, type InboxRefusal } from './inbox/inbox-rows.tsx';
import type { ClarifyInboxItem } from './inbox/use-inbox-triage.ts';
import { PageBar, type PageHistory } from './page-bar.tsx';
import { PageHead } from './page-head.tsx';
import {
  proposalsToShow,
  ProposalsSection,
  type ProposalsSectionProps,
} from './proposals/proposals-section.tsx';
import type { RelationChoice } from './properties-panel.tsx';
import { ParaMigration, type ParaMigrationProps } from './para-migration.tsx';
import { TaskMigration, type TaskMigrationProps } from './task-migration.tsx';

/** What the Inbox lists, once it has been read. */
export interface InboxContents {
  readonly items: readonly InboxItem[];
  /** More are waiting than are listed. */
  readonly truncated: boolean;
  /** How many wait in all, listed or not (#167). */
  readonly total: number;
}

/** The offer to set the vault's types up for PARA and the Inbox, with what each gains. */
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
  /** The people a task can wait on. */
  people?: readonly RelationChoice[];
  /** The statuses a row may give a task: the ones the vault's Task type declares. GTD's eight unless said. */
  statuses?: readonly GtdStatus[];
  onOpen: (path: VaultPath) => void;
  /** Lists the next page of what waits, once more wait than are listed (#167). */
  onShowMore: () => void;
  /** Clarifies a note — a task's status, project, wait and dates, or a note's filing (#112). */
  onClarify: ClarifyInboxItem;
  /** While a note is being written, so it is not asked for twice. */
  busy: boolean;
  /** Why the last undo could not be done, or null. */
  problem: string | null;
  /** Why a row's clarification was refused, shown on that row. */
  refusal?: InboxRefusal | null;
  /** The last clarification, while it can be taken back: a new object for each, kept across renders. */
  lastAction?: { readonly title: string } | null;
  onUndo?: () => void;
  /** Ends the offer to take the last clarification back, once its bar has had its time (#165); with `onUndo`. */
  onDismissLastAction?: () => void;
  typesOffer?: InboxTypesOffer | null;
  /** Moving the vault's tasks to GTD's eight statuses, previewed first (P30-02). */
  taskMigration?: TaskMigrationProps | null;
  /** Moving the vault's Area and Resource notes onto the Project type, previewed first (#213). */
  paraMigration?: ParaMigrationProps | null;
  /** The vault's own Inbox view, which the sidebar's Inbox row opened before this page. */
  view?: { readonly title: string; readonly onOpen: () => void } | null;
  /** What Claude or an automation proposed, answered here rather than filed (P29-02). */
  proposals?: ProposalsSectionProps | null;
  onShowSidebar?: () => void;
  history?: PageHistory;
}

/**
 * The Inbox: every note waiting in the `Inbox` folder — captured, imported or
 * dropped there — and every task still at the Inbox status wherever it lives,
 * each a click from opening. A task is clarified on its row (#112); any other
 * note is one choice from being filed under a project or an area, which moves
 * it into that project's folder and links it (P30-01). Proposals wait there too, and are answered in their own
 * section rather than filed (P29-02). A meeting the import is waiting on, or
 * could not import, says so on its row (P28-04).
 */
export function InboxPage(props: InboxPageProps) {
  const view = props.view ?? null;
  const offer = props.typesOffer ?? null;
  const migration = props.taskMigration ?? null;
  const paraMigration = props.paraMigration ?? null;
  const proposals = props.proposals ?? null;
  const problem = props.problem ?? leftRefusal(props);
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
            description={describe(props.contents, proposals?.contents?.open.length ?? 0)}
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
          {paraMigration !== null && <ParaMigration {...paraMigration} />}
          {problem !== null && (
            <p className="table__error" role="alert">
              {problem}
            </p>
          )}
          <LastAction {...props} />
          {proposals !== null && proposalsToShow(proposals) && <ProposalsSection {...proposals} />}
          <InboxList {...props} />
        </article>
      </div>
    </>
  );
}

function describe(contents: InboxContents | null, proposals: number): string | null {
  if (contents === null) return null;
  const toAnswer = proposals === 0 ? '' : ` · ${proposals} to answer`;
  if (contents.total === 0)
    return proposals === 0 ? 'Nothing waiting' : `Nothing to file${toAnswer}`;
  return `${contents.total} to process · clarify each task, file each note${toAnswer}`;
}

function TypesOffer({ lines, onAccept, onDismiss }: InboxTypesOffer) {
  return (
    <aside className="inbox__offer" aria-label="Set your types up for the Inbox">
      <Icon name="link" size={16} className="inbox__offer-icon" />
      <div className="inbox__offer-text">
        <p>
          Notes are filed under a project or an area, and proposals and meetings arrive here. Your
          types could hold what that needs:
        </p>
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

/** A refusal whose row has left the list — clarified, but not filed — which the page says instead. */
function leftRefusal({ contents, refusal }: InboxPageProps): string | null {
  if (refusal === null || refusal === undefined) return null;
  const listed = contents?.items.some((item: InboxItem) => item.path === refusal.path) ?? false;
  return listed ? null : refusal.reason;
}

function LastAction({ lastAction, onUndo, onDismissLastAction, busy }: InboxPageProps) {
  if (lastAction === null || lastAction === undefined) return null;
  if (onUndo === undefined || onDismissLastAction === undefined) return null;
  return (
    <LastActionBar
      lastAction={lastAction}
      busy={busy}
      onUndo={onUndo}
      onDismiss={onDismissLastAction}
    />
  );
}

/** The last clarification, for 20 seconds unless held: its Undo lasts as long as it does. */
function LastActionBar({
  lastAction,
  busy,
  onUndo,
  onDismiss,
}: {
  lastAction: { readonly title: string };
  busy: boolean;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  // Each clarification is its own object, so a second note of the same title gets its own time.
  const hold = useDismissAfter({ ms: UNDO_BAR_MS, showing: lastAction, onDismiss });
  const { title } = lastAction;
  return (
    <p className="inbox__done" role="status" {...hold}>
      Clarified “{title}”.
      <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={onUndo}>
        Undo
      </button>
    </p>
  );
}

function InboxList({
  contents,
  error,
  filing,
  people = [],
  statuses,
  onOpen,
  onShowMore,
  onClarify,
  busy,
  refusal = null,
}: InboxPageProps) {
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
                <span className="visually-hidden">Clarify</span>
              </th>
            </tr>
          </thead>
          <InboxRows
            items={contents.items}
            filing={filing}
            people={people}
            {...(statuses !== undefined && { statuses })}
            onOpen={onOpen}
            onClarify={onClarify}
            busy={busy}
            refusal={refusal}
          />
        </table>
        {contents.truncated && (
          <footer className="table__footer">
            <span className="table__count">
              Showing the newest {contents.items.length} of {contents.total}.
            </span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={onShowMore}>
              Show more
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
