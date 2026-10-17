import { Fragment, useRef, useState, type ReactNode } from 'react';
import type { GtdStatus, InboxItem, VaultPath } from '@atlas/domain';
import { UNDO_BAR_MS, useDismissAfter } from './dismiss-after.ts';
import { Icon } from './icon.tsx';
import { InboxRows, type InboxRefusal } from './inbox/inbox-rows.tsx';
import type { ClarifyInboxItem } from './inbox/use-inbox-triage.ts';
import { PageBar, type PageHistory } from './page-bar.tsx';
import { PageHead } from './page-head.tsx';
import { ROW_SCROLLER_MARK, RowScrollerContext } from './row-scroller.ts';
import {
  proposalsToShow,
  ProposalsSection,
  type ProposalsSectionProps,
} from './proposals/proposals-section.tsx';
import type { RelationChoice } from './properties-panel.tsx';
import { MeetingProjects, type MeetingProjectsProps } from './meeting-projects.tsx';
import { ParaMigration, type ParaMigrationProps } from './para-migration.tsx';
import { TaskMigration, type TaskMigrationProps } from './task-migration.tsx';
import { VaultTidy, type VaultTidyProps } from './vault-tidy.tsx';
import { MeetingCleanup, type MeetingCleanupProps } from './meeting-cleanup.tsx';

const NO_REFUSALS: readonly InboxRefusal[] = [];

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
  /** Why each row's clarification was refused, shown on that row, until it is clarified again. */
  refusals?: readonly InboxRefusal[];
  /** Why each imported meeting's summary still waits, by path; a meeting not in it waits for none (#186). */
  summaryPending?: ReadonlyMap<string, string>;
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
  /** Moving loose notes and old meetings to their home folders, once, previewed first (#214). */
  vaultTidy?: VaultTidyProps | null;
  /**
   * Set while a rule would make the owner's tasks from meetings but the vault
   * does not say who the owner is (#181): no task can be made until it does.
   */
  ownerUnknown?: { readonly onOpenSettings: () => void } | null;
  /**
   * Set while the vault's settings note cannot be read (#226): who the owner
   * is is not known, so the meeting import and the automations are held
   * until it reads. `problem` is why it cannot be read.
   */
  settingsUnreadable?: { readonly problem: string; readonly onOpenSettings: () => void } | null;
  /** The tasks meetings made that today's rules would not have, offered to archive (#226). */
  meetingCleanup?: MeetingCleanupProps | null;
  /** Filing the meetings that have no project as their series is, previewed first (#227). */
  meetingProjects?: MeetingProjectsProps | null;
  /** The vault's own Inbox view, which the sidebar's Inbox row opened before this page. */
  view?: { readonly title: string; readonly onOpen: () => void } | null;
  /** What Claude or an automation proposed, answered here rather than filed (P29-02). */
  proposals?: ProposalsSectionProps | null;
  onShowSidebar?: () => void;
  history?: PageHistory;
}

/**
 * The Inbox: every note waiting in the `Inbox` folder — captured or dropped
 * there — every task still at the Inbox status and every imported meeting not
 * filed yet, wherever each lives, each a click from opening. A task is
 * clarified on its row (#112); any other note is one choice from being filed
 * under a project or an area, which links it (P30-01, #214). Proposals wait there too, and are answered in their own
 * section rather than filed (P29-02). A meeting the import is waiting on, or
 * could not import, says so on its row (P28-04).
 */
export function InboxPage(props: InboxPageProps) {
  const view = props.view ?? null;
  const offer = props.typesOffer ?? null;
  const migration = props.taskMigration ?? null;
  const paraMigration = props.paraMigration ?? null;
  const tidy = props.vaultTidy ?? null;
  const ownerUnknown = props.ownerUnknown ?? null;
  const settingsUnreadable = props.settingsUnreadable ?? null;
  const cleanup = props.meetingCleanup ?? null;
  const meetingProjects = props.meetingProjects ?? null;
  const proposals = props.proposals ?? null;
  const problem = props.problem ?? leftRefusal(props);
  const scroller = useRef<HTMLDivElement>(null);
  return (
    <>
      <PageBar
        crumb={{ icon: 'inbox', parent: 'Inbox' }}
        name="To process"
        {...(props.onShowSidebar !== undefined && { onShowSidebar: props.onShowSidebar })}
        {...(props.history !== undefined && { history: props.history })}
      />
      <div className="panel__body panel__body--rows" ref={scroller} {...ROW_SCROLLER_MARK}>
        <RowScrollerContext.Provider value={scroller}>
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
            {settingsUnreadable !== null && <SettingsUnreadable {...settingsUnreadable} />}
            {ownerUnknown !== null && <OwnerUnknown {...ownerUnknown} />}
            <Offers
              offers={[
                ['types', offer && <TypesOffer {...offer} />],
                ['tasks', migration && <TaskMigration {...migration} />],
                ['para', paraMigration && <ParaMigration {...paraMigration} />],
                ['tidy', tidy && <VaultTidy {...tidy} />],
                ['cleanup', cleanup && <MeetingCleanup {...cleanup} />],
                ['meetings', meetingProjects && <MeetingProjects {...meetingProjects} />],
              ]}
            />
            {problem !== null && (
              <p className="table__error" role="alert">
                {problem}
              </p>
            )}
            <LastAction {...props} />
            {proposals !== null && proposalsToShow(proposals) && (
              <ProposalsSection {...proposals} />
            )}
            <InboxList {...props} />
          </article>
        </RowScrollerContext.Provider>
      </div>
    </>
  );
}

/**
 * The Inbox's offers, each read on its own and shown once it is (#227). One
 * read after the others goes below those already shown: arriving above them
 * would move what is under the person's pointer as they reach for it. Offers
 * read together keep the order given.
 */
function Offers({ offers }: { offers: readonly (readonly [string, ReactNode])[] }) {
  const shown = offers.filter(([, offer]) => offer !== null);
  const [order, setOrder] = useState<readonly string[]>(() => shown.map(([key]) => key));
  const next = inArrivalOrder(
    order,
    shown.map(([key]) => key),
  );
  if (next.join('\n') !== order.join('\n')) setOrder(next);
  const byKey = new Map(shown);
  return next.map((key) => <Fragment key={key}>{byKey.get(key)}</Fragment>);
}

/** The offers shown before, in their order, then each newly shown one, in the order given. */
function inArrivalOrder(before: readonly string[], shown: readonly string[]): readonly string[] {
  const kept = before.filter((key) => shown.includes(key));
  return [...kept, ...shown.filter((key) => !kept.includes(key))];
}

function describe(contents: InboxContents | null, proposals: number): string | null {
  if (contents === null) return null;
  const toAnswer = proposals === 0 ? '' : ` · ${proposals} to answer`;
  if (contents.total === 0)
    return proposals === 0 ? 'Nothing waiting' : `Nothing to file${toAnswer}`;
  return `${contents.total} to process · clarify each task, file each note${toAnswer}`;
}

/**
 * Said for as long as it is so (#181): with no name or address to know the
 * owner by, no meeting's item can be known to be theirs, so none is made a task.
 */
function OwnerUnknown({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <aside
      className="inbox__offer inbox__offer--warning"
      role="alert"
      aria-label="Atlas can’t tell which action items are yours"
    >
      <Icon name="person" size={16} className="inbox__offer-icon" />
      <div className="inbox__offer-text">
        <p>
          Atlas can’t tell which action items are yours, so meetings make no tasks for you. Add your
          name or your emails in Settings → Profile.
        </p>
      </div>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onOpenSettings}>
        Open Settings
      </button>
    </aside>
  );
}

/**
 * Said for as long as the vault's settings note cannot be read (#226): the
 * meeting import and the automations wait, losing nothing, until it reads.
 */
function SettingsUnreadable({
  problem,
  onOpenSettings,
}: {
  problem: string;
  onOpenSettings: () => void;
}) {
  return (
    <aside
      className="inbox__offer inbox__offer--warning"
      role="alert"
      aria-label="Meetings and automations are paused"
    >
      <Icon name="person" size={16} className="inbox__offer-icon" />
      <div className="inbox__offer-text">
        <p>
          Meetings and automations are paused: .atlas/settings.md can’t be read ({problem}). Nothing
          is lost — meetings wait in their folder — and both resume once it reads.
        </p>
      </div>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onOpenSettings}>
        Open Settings
      </button>
    </aside>
  );
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

/** The refusals whose rows have left the list — clarified, but not filed — which the page says instead. */
function leftRefusal({ contents, refusals = NO_REFUSALS }: InboxPageProps): string | null {
  const listed = new Set(contents?.items.map((item: InboxItem) => item.path));
  const left = refusals.filter((refusal) => !listed.has(refusal.path));
  return left.length === 0 ? null : left.map((refusal) => refusal.reason).join(' ');
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
  refusals = NO_REFUSALS,
  summaryPending,
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
        <table className="table__grid inbox__grid" aria-rowcount={contents.items.length + 1}>
          <thead>
            <tr aria-rowindex={1}>
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
            refusals={refusals}
            {...(summaryPending !== undefined && { summaryPending })}
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
