import { Fragment, memo, useMemo, useRef, useState } from 'react';
import {
  createVaultPath,
  GTD_STATUSES,
  GTD_STATUS_LABELS,
  humanizeKey,
  isGtdStatus,
  noteNames,
  type GtdStatus,
  type InboxItem,
  type InboxTask,
  type VaultPath,
} from '@atlas/domain';
import { Icon } from '../icon.tsx';
import type { RelationChoice } from '../properties-panel.tsx';
import { RelationOptions } from '../relation-options.tsx';
import { useSteadyCallback } from '../steady-callback.ts';
import { TableGap } from '../table-gap.tsx';
import { useVirtualRows } from '../virtual-rows.ts';
import { asksWhoItWaitsOn, clarificationOf, type InboxDraft } from './inbox-triage.ts';
import { useInboxTriage, type ClarifyInboxItem, type InboxTriage } from './use-inbox-triage.ts';

/** Why a row's last clarification was refused or left unfinished. */
export interface InboxRefusal {
  readonly path: VaultPath;
  readonly reason: string;
}

export interface InboxRowsProps {
  items: readonly InboxItem[];
  /** The projects and areas a note can be filed under. */
  filing: readonly RelationChoice[];
  /** The people a task can wait on. */
  people: readonly RelationChoice[];
  /** The statuses a task may be given; GTD's eight unless said. */
  statuses?: readonly GtdStatus[];
  onOpen: (path: VaultPath) => void;
  onClarify: ClarifyInboxItem;
  /** While a note is being written, so it is not asked for twice. */
  busy: boolean;
  /** Why each refused row's last clarification was refused, shown on that row. */
  refusals: readonly InboxRefusal[];
  /** Why each imported meeting's summary still waits, by path: shown on its row (#186). */
  summaryPending?: ReadonlyMap<string, string>;
}

/** A row's height until it is measured, as the stylesheet draws a note's. */
const ROW_HEIGHT = 49;

/** A row's cells: its name, its kind, and how it is clarified. */
const ROW_CELLS = 3;

/** The row the table's header takes, so the rows' `aria-rowindex` counts from below it. */
const HEADER_ROWS = 1;

/**
 * The Inbox's rows (#112). A task is clarified where it is: status, project,
 * who it waits on, defer and due are picked on its row and written together
 * by Done. Any other note is filed under a project or an area at once.
 */
export function InboxRows({
  items,
  filing,
  people,
  statuses = GTD_STATUSES,
  onOpen,
  onClarify,
  busy,
  refusals,
  summaryPending,
}: InboxRowsProps) {
  const triage = useInboxTriage({ items, onClarify });
  const keys = useMemo(() => items.map((item) => item.path), [items]);
  const body = useRef<HTMLTableSectionElement>(null);
  const list = useVirtualRows({
    content: body,
    keys,
    estimate: () => ROW_HEIGHT,
    pinned: triage.wanted,
  });
  const placeRef = usePlacedRowRefs(list.measure, triage.rowRef);
  const open = useSteadyCallback(onOpen);
  const { onRowFocus, pick, commit, fileUnder, makeTask } = triage;
  const actions = useMemo(
    () => ({ pick, commit, fileUnder, makeTask }),
    [pick, commit, fileUnder, makeTask],
  );
  const choices = useMemo(() => ({ filing, people, statuses }), [filing, people, statuses]);
  return (
    <tbody ref={body} onFocus={list.onFocus}>
      {list.placed.map(({ key, index, gapBefore }) => {
        const item = items[index];
        if (item === undefined) return null;
        const focused = triage.focused === item.path;
        return (
          <Fragment key={key}>
            {gapBefore > 0 && <TableGap height={gapBefore} width={ROW_CELLS} />}
            <tr
              ref={placeRef(item.path)}
              data-index={index}
              aria-rowindex={index + HEADER_ROWS + 1}
              tabIndex={-1}
              className={`table__row inbox__row${focused ? ' inbox__row--focused' : ''}`}
              onFocus={() => onRowFocus(item.path)}
            >
              <InboxRow
                item={item}
                draft={triage.draftOf(item.path)}
                choices={choices}
                onOpen={open}
                busy={busy}
                refusal={refusals.find((each) => each.path === item.path)?.reason ?? null}
                summaryPending={summaryPending?.get(item.path) ?? null}
                actions={actions}
              />
            </tr>
          </Fragment>
        );
      })}
      {list.after > 0 && <TableGap height={list.after} width={ROW_CELLS} />}
    </tbody>
  );
}

/**
 * Each placed row's ref, the same one for as long as the row is in the page:
 * it registers the row for focus and has the list measure it, and a new ref
 * on every render would measure every row on every render.
 */
function usePlacedRowRefs(
  measure: (element: Element | null) => void,
  rowRef: InboxTriage['rowRef'],
): (path: VaultPath) => (element: HTMLElement | null) => void {
  const [refs] = useState(() => new Map<VaultPath, (element: HTMLElement | null) => void>());
  return (path) => {
    const held = refs.get(path);
    if (held !== undefined) return held;
    const register = rowRef(path);
    const ref = (element: HTMLElement | null) => {
      register(element);
      measure(element);
      if (element === null) refs.delete(path);
    };
    refs.set(path, ref);
    return ref;
  };
}

/** What a row can do, the same from one render to the next. */
type RowActions = Pick<InboxTriage, 'pick' | 'commit' | 'fileUnder' | 'makeTask'>;

interface RowChoices {
  readonly filing: readonly RelationChoice[];
  readonly people: readonly RelationChoice[];
  readonly statuses: readonly GtdStatus[];
}

/**
 * One row's cells — the `<tr>` around them is placed by the list — drawn again
 * only when what they show has changed: a long Inbox is hundreds of rows,
 * each with a picker of every project, and redrawing them all for one row
 * clarified was what kept the next row waiting (#217).
 */
const InboxRow = memo(function InboxRow({
  item,
  draft,
  choices,
  onOpen,
  busy,
  refusal,
  summaryPending,
  actions,
}: {
  item: InboxItem;
  draft: InboxDraft;
  choices: RowChoices;
  onOpen: (path: VaultPath) => void;
  busy: boolean;
  /** Why this row's last clarification was refused, or null. */
  refusal: string | null;
  /** Why this meeting's summary still waits; null when it waits for none. */
  summaryPending: string | null;
  actions: RowActions;
}) {
  return (
    <>
      <td className="table__name">
        <button type="button" className="table__link" onClick={() => onOpen(item.path)}>
          <Icon name="doc" size={16} />
          <span className="table__title">{item.title}</span>
        </button>
      </td>
      <td className="inbox__kind">
        {kindOf(item)}
        <ImportStanding item={item} />
        {summaryPending !== null && (
          <span className="inbox__import inbox__summary-pending">
            Summary pending: {summaryPending}
          </span>
        )}
      </td>
      <td className="inbox__actions">
        {item.task === null ? (
          <NoteActions item={item} filing={choices.filing} busy={busy} actions={actions} />
        ) : (
          <ClarifyTask
            item={item}
            task={item.task}
            draft={draft}
            choices={choices}
            busy={busy}
            actions={actions}
          />
        )}
        {refusal !== null && (
          <p className="inbox__refusal" role="alert">
            {refusal}
          </p>
        )}
      </td>
    </>
  );
});

/** "Meeting · Meetings": its type, and the folder of the Inbox it arrived in. */
function kindOf(item: InboxItem): string {
  const type = item.type === null ? 'Note' : humanizeKey(item.type);
  return item.arrivedIn === '' ? type : `${type} · ${item.arrivedIn}`;
}

/** What the meeting import made of a file, where it is still the Inbox's business. */
function ImportStanding({ item }: { item: InboxItem }) {
  if (item.importOutcome === 'pending') {
    return <span className="inbox__import">Waiting to be imported</span>;
  }
  if (item.importOutcome !== 'error') return null;
  return (
    <span className="inbox__import inbox__import--error">
      Not imported: {item.importError ?? 'it does not follow the meeting contract'}
    </span>
  );
}

/** A note that is not a task: filed at once, or — with no type of its own — made a task. */
function NoteActions({
  item,
  filing,
  busy,
  actions,
}: {
  item: InboxItem;
  filing: readonly RelationChoice[];
  busy: boolean;
  actions: RowActions;
}) {
  return (
    <div className="inbox__clarify">
      {item.type === null && (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={busy}
          onClick={() => actions.makeTask(item.path)}
        >
          Make task
        </button>
      )}
      <NotePicker
        label={`File ${item.title} under`}
        value=""
        placeholder={filing.length === 0 ? 'No project or area yet' : 'File under…'}
        choices={filing}
        disabled={busy || filing.length === 0}
        onPick={(project) => actions.fileUnder(item.path, project)}
      />
    </div>
  );
}

/** A task's row: everything GTD's clarify step decides, written by Done in one save. */
function ClarifyTask({
  item,
  task,
  draft,
  choices,
  busy,
  actions,
}: {
  item: InboxItem;
  task: InboxTask;
  draft: InboxDraft;
  choices: RowChoices;
  busy: boolean;
  actions: RowActions;
}) {
  const pick = (picked: InboxDraft) => actions.pick(item.path, picked);
  const status = draft.status ?? task.status ?? '';
  // What the vault's Task type declares, and what the task says now so the row can show it.
  const offered = GTD_STATUSES.filter(
    (each) => choices.statuses.includes(each) || each === task.status,
  );
  return (
    <form
      className="inbox__clarify"
      aria-label={`Clarify ${item.title}`}
      onSubmit={(event) => {
        event.preventDefault();
        actions.commit(item, draft);
      }}
    >
      <select
        className="inbox__file"
        aria-label={`Status of ${item.title}`}
        value={status}
        disabled={busy}
        onChange={(event) => {
          if (isGtdStatus(event.target.value)) pick({ status: event.target.value });
        }}
      >
        {status === '' && <option value="">Status…</option>}
        {offered.map((each) => (
          <option key={each} value={each}>
            {GTD_STATUS_LABELS[each]}
          </option>
        ))}
      </select>
      {asksWhoItWaitsOn(task, draft) && (
        <NotePicker
          label={`Who ${item.title} waits on`}
          value={draft.waitingOn ?? task.waitingOn ?? ''}
          placeholder={task.waitingOnNames === '' ? 'Waiting on…' : task.waitingOnNames}
          choices={choices.people}
          disabled={busy}
          onPick={(waitingOn) => pick({ waitingOn })}
        />
      )}
      <NotePicker
        label={`File ${item.title} under`}
        value={draft.project ?? task.project ?? ''}
        placeholder={choices.filing.length === 0 ? 'No project or area yet' : 'Project or area…'}
        choices={choices.filing}
        disabled={busy || choices.filing.length === 0}
        onPick={(project) => pick({ project })}
      />
      <DayField
        label="Defer"
        name={`Defer ${item.title} until`}
        value={draft.defer ?? task.defer ?? ''}
        disabled={busy}
        onPick={(defer) => pick({ defer })}
      />
      <DayField
        label="Due"
        name={`${item.title} is due`}
        value={draft.due ?? task.due ?? ''}
        disabled={busy}
        onPick={(due) => pick({ due })}
      />
      <button
        type="submit"
        className="btn btn--primary btn--sm"
        disabled={busy || clarificationOf(task, draft) === null}
      >
        Done
      </button>
    </form>
  );
}

/**
 * Valued by path, a picker works out no link, so it needs none of the vault's
 * names: reading them would draw every row again each time a note changes.
 */
const BY_PATH = noteNames(null);

/** A picker of notes, valued by path. */
function NotePicker({
  label,
  value,
  placeholder,
  choices,
  disabled,
  onPick,
}: {
  label: string;
  value: string;
  placeholder: string;
  choices: readonly RelationChoice[];
  disabled: boolean;
  onPick: (path: VaultPath) => void;
}) {
  return (
    <select
      className="inbox__file"
      aria-label={label}
      value={choices.some((choice) => choice.path === value) ? value : ''}
      disabled={disabled}
      onChange={(event) => {
        if (event.target.value !== '') onPick(createVaultPath(event.target.value));
      }}
    >
      <option value="">{placeholder}</option>
      <RelationOptions choices={choices} names={BY_PATH} optionValue={(choice) => choice.path} />
    </select>
  );
}

function DayField({
  label,
  name,
  value,
  disabled,
  onPick,
}: {
  label: string;
  /** What a screen reader calls it, naming the task. */
  name: string;
  value: string;
  disabled: boolean;
  onPick: (day: string) => void;
}) {
  return (
    <label className="inbox__day">
      <span aria-hidden="true">{label}</span>
      <input
        type="date"
        className="inbox__file"
        aria-label={name}
        value={value}
        disabled={disabled}
        onChange={(event) => onPick(event.target.value)}
      />
    </label>
  );
}
