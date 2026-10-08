import type { ReactNode } from 'react';
import type { AutomationAction, AutomationDraft, NoteEvent, Schedule } from '@atlas/domain';
import { SegmentedControl } from '../segmented-control.tsx';
import { Toggle } from '../toggle.tsx';
import type { DryRunView, LogEntryView } from './automation-views.ts';
import { DryRunResult, RunLog } from './run-log-view.tsx';

export interface AutomationEditorProps {
  readonly draft: AutomationDraft;
  readonly onChange: (draft: AutomationDraft) => void;
  /** A rule not yet written: saving creates its file. */
  readonly isNew: boolean;
  /** Why the draft cannot be saved yet, or null. */
  readonly problem: string | null;
  /** Where "which notes" is edited: the query builder, as the query page has it. */
  readonly which: ReactNode;
  /** The vault's types, by name: what a note trigger can watch for. */
  readonly typeNames: readonly string[];
  readonly busy: boolean;
  readonly onSave: () => void;
  readonly onCancel: () => void;
  readonly onDryRun: () => void;
  readonly onRunNow: () => void;
  readonly onUndo: () => void;
  readonly canUndo: boolean;
  readonly dryRun: DryRunView | null;
  readonly log: readonly LogEntryView[];
  readonly onOpenNote: (path: string) => void;
}

type ScheduleKind = Schedule['kind'];

const SCHEDULES = [
  { value: 'daily' as const, label: 'Daily' },
  { value: 'hourly' as const, label: 'Every few hours' },
  { value: 'open' as const, label: 'When Atlas opens' },
  { value: 'manual' as const, label: 'By hand' },
  { value: 'note' as const, label: 'When a note appears' },
];

const NOTE_EVENTS: readonly { value: NoteEvent; label: string }[] = [
  { value: 'created', label: 'is created' },
  { value: 'changed', label: 'is changed' },
];

const ACTIONS = [
  { value: 'archive' as const, label: 'Archive' },
  { value: 'set' as const, label: 'Set a property' },
];

/**
 * What a schedule becomes when its kind is picked: the time or gap it had, or
 * a start — for a note trigger, a note of `type` being created.
 */
function scheduleOf(kind: ScheduleKind, was: Schedule, type: string): Schedule {
  if (kind === was.kind) return was;
  if (kind === 'daily') return { kind, at: '03:00' };
  if (kind === 'hourly') return { kind, every: 6 };
  if (kind === 'note') return { kind, type, on: ['created'] };
  return { kind };
}

/** The events picked once one is turned on or off, in their order; the last one stays on. */
function eventsWith(on: readonly NoteEvent[], event: NoteEvent, picked: boolean): NoteEvent[] {
  const next = NOTE_EVENTS.map((each) => each.value).filter((each) =>
    each === event ? picked : on.includes(each),
  );
  return next.length === 0 ? [...on] : next;
}

/**
 * One automation, being made or changed (P25-03): its name, when it runs,
 * which notes — the query builder — and what it does to them; then a dry run,
 * running it now, undoing its last run, and its log.
 */
export function AutomationEditor(props: AutomationEditorProps) {
  const { draft, onChange } = props;
  return (
    <section className="automation-editor" aria-label="Automation">
      <div className="automation-editor__form">
        <label className="automation-editor__field">
          <span className="automation-editor__label">Name</span>
          <input
            className="field"
            value={draft.name}
            placeholder="Archive done tasks after 30 days"
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
          />
        </label>
        <div className="automation-editor__field">
          <span className="automation-editor__label">On</span>
          <Toggle
            label="Run this automation on its schedule"
            checked={draft.enabled}
            onChange={(enabled) => onChange({ ...draft, enabled })}
          />
        </div>
        <ScheduleField draft={draft} onChange={onChange} typeNames={props.typeNames} />
        <div className="automation-editor__field automation-editor__field--wide">
          <span className="automation-editor__label">Which notes</span>
          {props.which}
          <AgeField draft={draft} onChange={onChange} />
        </div>
        <ActionField draft={draft} onChange={onChange} />
      </div>
      {props.problem !== null && (
        <p className="automation-editor__problem" role="alert">
          {props.problem}
        </p>
      )}
      <EditorButtons {...props} />
      {props.dryRun !== null && (
        <DryRunResult result={props.dryRun} onOpenNote={props.onOpenNote} />
      )}
      {!props.isNew && <RunLog entries={props.log} />}
    </section>
  );
}

function ScheduleField({
  draft,
  onChange,
  typeNames,
}: Pick<AutomationEditorProps, 'draft' | 'onChange' | 'typeNames'>) {
  const { when } = draft;
  return (
    <div className="automation-editor__field automation-editor__field--wide">
      <span className="automation-editor__label">When</span>
      <div className="automation-editor__row">
        <SegmentedControl
          label="When it runs"
          options={SCHEDULES}
          value={when.kind}
          onChange={(kind) =>
            onChange({ ...draft, when: scheduleOf(kind, when, typeNames[0] ?? '') })
          }
        />
        {when.kind === 'daily' && (
          <input
            type="time"
            className="field automation-editor__small"
            aria-label="Time of day"
            value={when.at}
            onChange={(event) =>
              event.target.value !== '' &&
              onChange({ ...draft, when: { kind: 'daily', at: event.target.value.slice(0, 5) } })
            }
          />
        )}
        {when.kind === 'hourly' && (
          <label className="automation-editor__inline">
            every
            <input
              type="number"
              min={1}
              max={168}
              className="field automation-editor__small"
              aria-label="Hours between runs"
              value={when.every}
              onChange={(event) =>
                onChange({ ...draft, when: { kind: 'hourly', every: Number(event.target.value) } })
              }
            />
            hours
          </label>
        )}
        {when.kind === 'note' && (
          <NoteTriggerFields draft={draft} onChange={onChange} typeNames={typeNames} />
        )}
      </div>
    </div>
  );
}

/** A note trigger's type, and whether a note being created, changed or both sets it off. */
function NoteTriggerFields({
  draft,
  onChange,
  typeNames,
}: Pick<AutomationEditorProps, 'draft' | 'onChange' | 'typeNames'>) {
  const { when } = draft;
  if (when.kind !== 'note') return null;
  // A type the file names that the vault lacks is still shown, so the select says what the rule says.
  const names = typeNames.includes(when.type) ? typeNames : [when.type, ...typeNames];
  return (
    <span className="automation-editor__inline">
      a
      <select
        className="field automation-editor__small"
        aria-label="Type of note"
        value={when.type}
        onChange={(event) => onChange({ ...draft, when: { ...when, type: event.target.value } })}
      >
        {names.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      {NOTE_EVENTS.map(({ value, label }) => (
        <label key={value} className="automation-editor__inline">
          <input
            type="checkbox"
            className="select-box"
            checked={when.on.includes(value)}
            onChange={(event) =>
              onChange({
                ...draft,
                when: { ...when, on: eventsWith(when.on, value, event.target.checked) },
              })
            }
          />
          {label}
        </label>
      ))}
    </span>
  );
}

function AgeField({ draft, onChange }: Pick<AutomationEditorProps, 'draft' | 'onChange'>) {
  const on = draft.olderThanDays !== null;
  return (
    <label className="automation-editor__inline automation-editor__age">
      <input
        type="checkbox"
        className="select-box"
        checked={on}
        onChange={() => onChange({ ...draft, olderThanDays: on ? null : 30 })}
      />
      Only notes not changed in the last
      <input
        type="number"
        min={1}
        className="field automation-editor__small"
        aria-label="Days unchanged"
        disabled={!on}
        value={draft.olderThanDays ?? 30}
        onChange={(event) => onChange({ ...draft, olderThanDays: Number(event.target.value) })}
      />
      days
    </label>
  );
}

function ActionField({ draft, onChange }: Pick<AutomationEditorProps, 'draft' | 'onChange'>) {
  const { action } = draft;
  const [key = '', value = ''] =
    action.kind === 'set' ? (Object.entries(action.values)[0] ?? []) : [];
  const setTo = (nextKey: string, nextValue: string): AutomationAction => ({
    kind: 'set',
    values: nextKey === '' && nextValue === '' ? {} : { [nextKey]: nextValue },
  });
  return (
    <div className="automation-editor__field automation-editor__field--wide">
      <span className="automation-editor__label">Do</span>
      <div className="automation-editor__row">
        <SegmentedControl
          label="What it does"
          options={ACTIONS}
          value={action.kind}
          onChange={(kind) =>
            onChange({ ...draft, action: kind === 'archive' ? { kind } : setTo('status', '') })
          }
        />
        {action.kind === 'set' && (
          <>
            <input
              className="field automation-editor__small"
              aria-label="Property"
              placeholder="status"
              value={key}
              onChange={(event) =>
                onChange({ ...draft, action: setTo(event.target.value, String(value)) })
              }
            />
            <span className="automation-editor__to">to</span>
            <input
              className="field automation-editor__small"
              aria-label="Value"
              placeholder="done"
              value={String(value)}
              onChange={(event) => onChange({ ...draft, action: setTo(key, event.target.value) })}
            />
          </>
        )}
      </div>
    </div>
  );
}

function EditorButtons(props: AutomationEditorProps) {
  const saveable = props.problem === null && !props.busy;
  return (
    <div className="automation-editor__buttons">
      <button
        type="button"
        className="btn btn--primary"
        disabled={!saveable}
        onClick={props.onSave}
      >
        {props.isNew ? 'Create automation' : 'Save'}
      </button>
      <button
        type="button"
        className="btn btn--secondary"
        disabled={props.busy}
        onClick={props.onDryRun}
      >
        Dry run
      </button>
      {!props.isNew && (
        <>
          <button
            type="button"
            className="btn btn--secondary"
            disabled={props.busy}
            onClick={props.onRunNow}
          >
            Run now
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={props.busy || !props.canUndo}
            onClick={props.onUndo}
          >
            Undo last run
          </button>
        </>
      )}
      <button type="button" className="btn btn--ghost" onClick={props.onCancel}>
        {props.isNew ? 'Cancel' : 'Close'}
      </button>
    </div>
  );
}
