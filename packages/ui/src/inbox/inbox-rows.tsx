import {
  createVaultPath,
  GTD_STATUSES,
  GTD_STATUS_LABELS,
  humanizeKey,
  isGtdStatus,
  type GtdStatus,
  type InboxItem,
  type InboxTask,
  type VaultPath,
} from '@atlas/domain';
import { Icon } from '../icon.tsx';
import { useNoteNames } from '../note-names.tsx';
import type { RelationChoice } from '../properties-panel.tsx';
import { RelationOptions } from '../relation-options.tsx';
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
  refusal: InboxRefusal | null;
}

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
  refusal,
}: InboxRowsProps) {
  const triage = useInboxTriage({ items, onClarify });
  return (
    <tbody>
      {items.map((item) => (
        <tr
          key={item.path}
          ref={triage.rowRef(item.path)}
          tabIndex={-1}
          className={`table__row inbox__row${triage.focused === item.path ? ' inbox__row--focused' : ''}`}
          onFocus={() => triage.onRowFocus(item.path)}
        >
          <td className="table__name">
            <button type="button" className="table__link" onClick={() => onOpen(item.path)}>
              <Icon name="doc" size={16} />
              <span className="table__title">{item.title}</span>
            </button>
          </td>
          <td className="inbox__kind">
            {kindOf(item)}
            <ImportStanding item={item} />
          </td>
          <td className="inbox__actions">
            {item.task === null ? (
              <NoteActions item={item} filing={filing} busy={busy} triage={triage} />
            ) : (
              <ClarifyTask
                item={item}
                task={item.task}
                choices={{ filing, people, statuses }}
                busy={busy}
                triage={triage}
              />
            )}
            {refusal?.path === item.path && (
              <p className="inbox__refusal" role="alert">
                {refusal.reason}
              </p>
            )}
          </td>
        </tr>
      ))}
    </tbody>
  );
}

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
  triage,
}: {
  item: InboxItem;
  filing: readonly RelationChoice[];
  busy: boolean;
  triage: InboxTriage;
}) {
  return (
    <div className="inbox__clarify">
      {item.type === null && (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={busy}
          onClick={() => triage.makeTask(item.path)}
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
        onPick={(project) => triage.fileUnder(item.path, project)}
      />
    </div>
  );
}

/** A task's row: everything GTD's clarify step decides, written by Done in one save. */
function ClarifyTask({
  item,
  task,
  choices,
  busy,
  triage,
}: {
  item: InboxItem;
  task: InboxTask;
  choices: {
    filing: readonly RelationChoice[];
    people: readonly RelationChoice[];
    statuses: readonly GtdStatus[];
  };
  busy: boolean;
  triage: InboxTriage;
}) {
  const draft = triage.draftOf(item.path);
  const pick = (picked: InboxDraft) => triage.pick(item.path, picked);
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
        triage.commit(item);
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
  const names = useNoteNames();
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
      <RelationOptions choices={choices} names={names} optionValue={(choice) => choice.path} />
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
