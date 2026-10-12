import { useMemo, useRef, type ReactNode } from 'react';
import { Menu } from '@base-ui/react/menu';
import {
  GTD_STATUS_LABELS,
  isGtdStatus,
  TODAY_DEFER_DAYS,
  TODAY_MOVES,
  TODAY_SECTION_LABELS,
  todayRowOrder,
  type TodayGroup,
  type TodaySection,
  type TodaySectionId,
  type TodayTask,
  type VaultPath,
} from '@atlas/domain';
import type { TodayReport } from '@atlas/application';
import { Icon } from './icon.tsx';
import { MenuItems, type MenuCommand } from './menu-items.tsx';
import { PageBar, type PageHistory } from './page-bar.tsx';
import { PageHead } from './page-head.tsx';
import { StatusPill } from './status-pill.tsx';
import { useRowFocus, type RowFocus } from './today-row-focus.ts';

/** What the page did to a task, for the line that offers to take it back. */
export type TodayAction =
  | { readonly kind: 'done' }
  | { readonly kind: 'move'; readonly status: string }
  | { readonly kind: 'defer'; readonly days: number };

/** The last thing done to a task, and the way to undo it. */
export interface TodayNotice {
  readonly title: string;
  readonly action: TodayAction;
  readonly onUndo: () => void;
  readonly onDismiss: () => void;
}

/** The row an action is asked of. */
interface RowTask {
  readonly path: VaultPath;
  readonly title: string;
}

export interface TodayPageProps {
  /** Null while the index is being asked. */
  today: TodayReport | null;
  error: string | null;
  /** While a row is being acted on, so nothing is asked for twice. */
  busy: boolean;
  /** Why the last action could not be done, or null. */
  problem: string | null;
  /** The last action, while it can still be taken back. */
  notice: TodayNotice | null;
  /** A saved view titled Today, which this page's sidebar row stands in for; null when the vault has none. */
  view: { readonly title: string; readonly onOpen: () => void } | null;
  onOpen: (path: VaultPath) => void;
  onOpenInbox: () => void;
  onOpenReview: () => void;
  onOpenDailyNote: () => void;
  /** Ticks a task done, as a type's view does: a repeating one rolls on. */
  onDone: (task: RowTask) => void;
  onSetStatus: (args: RowTask & { status: string }) => void;
  onDefer: (args: RowTask & { days: number }) => void;
  onShowSidebar?: () => void;
  history?: PageHistory;
}

/**
 * The Today page (#111): what needs you today on one screen — what is late,
 * due, back from being put off, under way, next, and waited for — each row a
 * tick, a move or a defer from being dealt with.
 */
export function TodayPage(props: TodayPageProps) {
  // Held here, above the sections: they come and go while the index is read again,
  // and which row was acted on has to outlast that.
  const order = useMemo(
    () => (props.today === null ? [] : todayRowOrder(props.today)),
    [props.today],
  );
  const focus = useRowFocus({ order, shown: props.today, problem: props.problem });
  return (
    <>
      <PageBar
        crumb={{ icon: 'today', parent: 'Today' }}
        name={props.today?.today ?? 'Today'}
        {...(props.onShowSidebar !== undefined && { onShowSidebar: props.onShowSidebar })}
        {...(props.history !== undefined && { history: props.history })}
      />
      <div className="panel__body">
        <article className="page page--wide review today" aria-label="Today">
          <PageHead
            icon="today"
            title="Today"
            description={describe(props.today)}
            actions={
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                title="Open today’s note (⇧⌘D)"
                onClick={props.onOpenDailyNote}
              >
                Open today’s note
                <kbd className="key today__key" aria-hidden="true">
                  ⇧⌘D
                </kbd>
              </button>
            }
          />
          {props.problem !== null && (
            <p className="table__error" role="alert">
              {props.problem}
            </p>
          )}
          <UndoNotice notice={props.notice} busy={props.busy} />
          <TodayBody {...props} focus={focus} />
        </article>
      </div>
    </>
  );
}

/** `2026-10-13` as "Tuesday, October 13" — read as a calendar day, in no timezone. */
function dayName(day: string): string {
  const at = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return day;
  return at.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function describe(today: TodayReport | null): string | null {
  if (today === null) return null;
  const tasks = today.sections.reduce((sum, section) => sum + section.count, 0);
  const counted = tasks === 0 ? 'nothing needs you' : tasks === 1 ? '1 task' : `${tasks} tasks`;
  return `${dayName(today.today)} · ${counted}`;
}

function noticeWords({ title, action }: TodayNotice): string {
  if (action.kind === 'done') return `Finished “${title}”.`;
  if (action.kind === 'defer') {
    return `Deferred “${title}” by ${action.days === 1 ? '1 day' : `${action.days} days`}.`;
  }
  return `Moved “${title}” to ${statusLabel(action.status)}.`;
}

const statusLabel = (status: string) => (isGtdStatus(status) ? GTD_STATUS_LABELS[status] : status);

function UndoNotice({ notice, busy }: { notice: TodayNotice | null; busy: boolean }) {
  if (notice === null) return null;
  return (
    <div className="today__notice" role="status">
      <p className="today__notice-text">{noticeWords(notice)}</p>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        disabled={busy}
        onClick={notice.onUndo}
      >
        Undo
      </button>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        aria-label="Dismiss"
        onClick={notice.onDismiss}
      >
        ×
      </button>
    </div>
  );
}

function TodayBody(props: TodayPageProps & { focus: RowFocus }) {
  const { today, error } = props;
  if (error !== null) {
    return (
      <p className="table__error" role="alert">
        {error}
      </p>
    );
  }
  if (today === null) return <p className="table__empty">Reading the day…</p>;
  return (
    <>
      {today.truncated && (
        <p className="review__note">
          The vault holds more tasks than the page reads at once, so some may be missing.
        </p>
      )}
      <Elsewhere {...props} today={today} />
      <Sections {...props} today={today} />
    </>
  );
}

/** What waits off the page: the Inbox, the projects with nothing next, and a saved Today view. */
function Elsewhere({
  today,
  view,
  onOpenInbox,
  onOpenReview,
}: Pick<TodayPageProps, 'view' | 'onOpenInbox' | 'onOpenReview'> & { today: TodayReport }) {
  const inbox = `${today.inbox.count}${today.inbox.more ? '+' : ''}`;
  const stalled = today.stalledProjects;
  return (
    <nav className="today__elsewhere" aria-label="Elsewhere">
      <button type="button" className="today__link" onClick={onOpenInbox}>
        <Icon name="inbox" size={16} />
        Inbox <span className="review__count">{inbox}</span>
        <span className="today__link-words">
          {today.inbox.count === 0 ? 'nothing to process' : 'to process'}
        </span>
      </button>
      <button type="button" className="today__link" onClick={onOpenReview}>
        <Icon name="calendar" size={16} />
        Stalled projects <span className="review__count">{stalled}</span>
        <span className="today__link-words">
          {stalled === 0 ? 'every active project has a next action' : 'in the weekly review'}
        </span>
      </button>
      {view !== null && (
        <button type="button" className="today__link" onClick={view.onOpen}>
          <Icon name="table" size={16} />
          Open the “{view.title}” view
        </button>
      )}
    </nav>
  );
}

/** What each section says when it holds nothing. */
const EMPTY: Readonly<Record<TodaySectionId, string>> = {
  overdue: 'Nothing is late.',
  dueToday: 'Nothing is due today.',
  backToday: 'Nothing comes back today.',
  inProgress: 'Nothing is under way.',
  nextActions: 'No next actions.',
  waiting: 'Waiting on nobody.',
};

function Sections(props: TodayPageProps & { today: TodayReport; focus: RowFocus }) {
  const { today, busy, focus } = props;
  const act = (task: TodayTask, action: () => void) => {
    focus.actedOn(task.path);
    action();
  };
  const row: RowContext = {
    busy,
    rowRef: focus.rowRef,
    onOpen: props.onOpen,
    onDone: (task) => act(task, () => props.onDone(rowOf(task))),
    onDefer: (task, days) => act(task, () => props.onDefer({ ...rowOf(task), days })),
    onMove: (task, status) => act(task, () => props.onSetStatus({ ...rowOf(task), status })),
  };
  return (
    <>
      {today.sections.map((section) => (
        <Section key={section.id} section={section} row={row} />
      ))}
    </>
  );
}

const rowOf = (task: TodayTask): RowTask => ({ path: task.path, title: task.title });

/**
 * A row's Move to… menu: every status the page offers but the task's own.
 * Open state, focus, typeahead and Escape are Base UI's (ADR-0015).
 */
function MoveMenu({
  task,
  busy,
  onMove,
}: {
  task: TodayTask;
  busy: boolean;
  onMove: (task: TodayTask, status: string) => void;
}) {
  const chosen = useRef<MenuCommand | null>(null);
  const items = TODAY_MOVES.filter((status) => status !== task.status).map((status) => ({
    label: GTD_STATUS_LABELS[status],
    onSelect: () => onMove(task, status),
  }));
  return (
    <Menu.Root>
      <Menu.Trigger
        className="btn btn--ghost btn--sm"
        aria-label={`Move ${task.title} to…`}
        disabled={busy}
      >
        Move to…
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="menu-positioner" side="bottom" align="end" sideOffset={4}>
          <Menu.Popup className="menu" aria-label={`Move ${task.title} to`} render={<ul />}>
            <MenuItems items={items} chosen={chosen} />
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** What every row is handed: how to act, and where it stands. */
interface RowContext {
  readonly busy: boolean;
  readonly rowRef: (path: VaultPath) => (element: HTMLElement | null) => void;
  readonly onOpen: (path: VaultPath) => void;
  readonly onDone: (task: TodayTask) => void;
  readonly onDefer: (task: TodayTask, days: number) => void;
  readonly onMove: (task: TodayTask, status: string) => void;
}

function Section({ section, row }: { section: TodaySection; row: RowContext }) {
  const title = TODAY_SECTION_LABELS[section.id];
  return (
    <section className="review__section" aria-label={title}>
      <h2 className="review__heading">
        {title} <span className="review__count">{section.count}</span>
      </h2>
      {section.id === 'waiting' && section.count > 0 && (
        <p className="review__note today__measure">
          Days are counted from each task’s last change — Atlas keeps no “waiting since”, so any
          edit to a task starts its count again.
        </p>
      )}
      {section.count === 0 ? (
        <p className="review__empty">{EMPTY[section.id]}</p>
      ) : (
        section.groups.map((group) => (
          <Group key={group.key} sectionId={section.id} group={group} row={row} />
        ))
      )}
    </section>
  );
}

/** What a section's unnamed group is called: the tasks under no project, or waiting on nobody. */
const UNNAMED: Partial<Record<TodaySectionId, string>> = {
  nextActions: 'No project',
  waiting: 'Nobody named',
};

function Group({
  sectionId,
  group,
  row,
}: {
  sectionId: TodaySectionId;
  group: TodayGroup;
  row: RowContext;
}) {
  const name = group.label ?? UNNAMED[sectionId] ?? null;
  return (
    <div className="today__group" role="group" aria-label={name ?? undefined}>
      {name !== null && (
        <h3 className="today__group-name">
          <GroupName group={group} name={name} onOpen={row.onOpen} />
          <span className="review__count">{group.tasks.length}</span>
        </h3>
      )}
      <div className="table">
        <div className="table__sheet">
          <table className="table__grid review__grid">
            <tbody>
              {group.tasks.map((task) => (
                <TaskRow key={task.path} task={task} sectionId={sectionId} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function GroupName({
  group,
  name,
  onOpen,
}: {
  group: TodayGroup;
  name: string;
  onOpen: (path: VaultPath) => void;
}) {
  const { project } = group;
  if (project === null) return <span>{name}</span>;
  return (
    <button type="button" className="today__project" onClick={() => onOpen(project)}>
      {name}
    </button>
  );
}

function TaskRow({
  task,
  sectionId,
  row,
}: {
  task: TodayTask;
  sectionId: TodaySectionId;
  row: RowContext;
}) {
  return (
    <tr className="table__row" data-today-row={task.path}>
      <td className="table__done">
        <input
          ref={row.rowRef(task.path)}
          type="checkbox"
          className="done-check"
          aria-label={`Mark ${task.title} done`}
          checked={false}
          disabled={row.busy}
          onChange={() => row.onDone(task)}
        />
      </td>
      <td className="table__name">
        <button type="button" className="table__link" onClick={() => row.onOpen(task.path)}>
          <span className="table__title">{task.title}</span>
        </button>
      </td>
      <td className="review__detail today__detail">
        <Details task={task} sectionId={sectionId} onOpen={row.onOpen} />
      </td>
      <td className="review__actions">
        <MoveMenu task={task} busy={row.busy} onMove={row.onMove} />
        {TODAY_DEFER_DAYS.map((days) => (
          <button
            key={days}
            type="button"
            className="btn btn--ghost btn--sm"
            aria-label={`Defer ${task.title} ${days === 1 ? '1 day' : `${days} days`}`}
            title={days === 1 ? 'Defer until tomorrow' : `Defer for ${days} days`}
            disabled={row.busy}
            onClick={() => row.onDefer(task, days)}
          >
            +{days}d
          </button>
        ))}
      </td>
    </tr>
  );
}

/** The sections whose tasks are of mixed statuses, so each row says its own. */
const SAYS_STATUS: ReadonlySet<TodaySectionId> = new Set(['overdue', 'dueToday', 'backToday']);

/**
 * What a row says of its task beside the name: its status where the section
 * mixes them, its project and who it waits on where the group does not
 * already say, its contexts, its day, and how long it has waited.
 */
function Details({
  task,
  sectionId,
  onOpen,
}: {
  task: TodayTask;
  sectionId: TodaySectionId;
  onOpen: (path: VaultPath) => void;
}) {
  const { project, projectTitle } = task;
  const pieces: ReactNode[] = [];
  if (SAYS_STATUS.has(sectionId) && task.status !== null) {
    pieces.push(<StatusPill key="status" value={task.status} />);
  }
  if (sectionId !== 'nextActions' && project !== null) {
    pieces.push(
      <button
        key="project"
        type="button"
        className="today__project"
        onClick={() => onOpen(project)}
      >
        {projectTitle}
      </button>,
    );
  }
  for (const context of task.contexts) {
    pieces.push(
      <span key={`context ${context}`} className="today__context">
        {context}
      </span>,
    );
  }
  if (sectionId !== 'waiting' && task.status === 'waiting' && task.waitingOn !== '') {
    pieces.push(<span key="on">On {task.waitingOn}</span>);
  }
  if (task.due !== null) pieces.push(<DueDay key="due" task={task} sectionId={sectionId} />);
  if (task.waitingDays !== null) {
    pieces.push(<span key="waited">{waitedWords(task.waitingDays)}</span>);
  }
  return <span className="today__pieces">{pieces}</span>;
}

function DueDay({ task, sectionId }: { task: TodayTask; sectionId: TodaySectionId }) {
  if (sectionId === 'dueToday') return <span>Due today</span>;
  return (
    <span className={sectionId === 'overdue' ? 'today__late' : undefined}>Due {task.due}</span>
  );
}

/** How long a Waiting task has waited, and from what: its file's last change. */
function waitedWords(days: number): string {
  if (days === 0) return 'Less than a day since last change';
  return `${days === 1 ? '1 day' : `${days} days`} since last change`;
}
