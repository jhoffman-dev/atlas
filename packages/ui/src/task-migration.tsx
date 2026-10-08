import { useId } from 'react';
import { optionLabel } from '@atlas/domain';
import { Icon } from './icon.tsx';

/** One task as the preview lists it: its status now, and what it becomes. */
export interface TaskMigrationRow {
  readonly path: string;
  readonly title: string;
  readonly from: string;
  readonly to: string;
  /** The day it is given as finished, when it is. */
  readonly completed: string | null;
}

/** An old status, what it becomes, and how many tasks hold it. */
export interface TaskMigrationMapping {
  readonly from: string;
  readonly to: string;
  readonly tasks: number;
}

/** What moving the tasks to GTD would do, as the preview shows it. */
export interface TaskMigrationPreviewData {
  readonly mapping: readonly TaskMigrationMapping[];
  /** The statuses an old one can be sent to, in order. */
  readonly statuses: readonly string[];
  readonly typeLines: readonly string[];
  readonly tasks: readonly TaskMigrationRow[];
  readonly references: readonly { readonly title: string; readonly moved: readonly string[] }[];
  readonly listed: readonly { readonly title: string; readonly reason: string }[];
  /** The names of the GTD views to be added. */
  readonly views: readonly string[];
}

export interface TaskMigrationProps {
  /** What the migration would do; null when the tasks already follow GTD. */
  readonly preview: TaskMigrationPreviewData | null;
  /** Whether the whole preview is shown, rather than the one-line offer. */
  readonly open: boolean;
  readonly busy: boolean;
  /** What the last run or undo did, in a sentence. */
  readonly result: string | null;
  readonly problem: string | null;
  /** Whether a run is recorded that can be undone. */
  readonly canUndo: boolean;
  readonly onOpen: () => void;
  readonly onChoose: (choice: { from: string; to: string }) => void;
  readonly onRun: () => void;
  readonly onClose: () => void;
  readonly onUndo: () => void;
}

const tasks = (count: number) => (count === 1 ? '1 task' : `${count} tasks`);

/** "Done" for a status, "(none)" for no status at all. */
const statusText = (value: string) => (value === '' ? '(none)' : optionLabel(value));

/**
 * The offer to move the vault's tasks to GTD's eight statuses (P30-02): one
 * line until asked, then the whole preview — every task old → new, the
 * mapping, editable, and what else changes — and nothing is written until
 * the person says so. Once run, it can be undone from here.
 */
export function TaskMigration(props: TaskMigrationProps) {
  const { preview, open, result, problem, canUndo } = props;
  if (preview === null && !canUndo && result === null && problem === null) return null;
  return (
    <section className="inbox__offer task-migration" aria-label="Move tasks to GTD statuses">
      <Icon name="task" size={16} className="inbox__offer-icon" />
      <div className="inbox__offer-text">
        {preview !== null && !open && <Offer {...props} preview={preview} />}
        {preview !== null && open && <Preview {...props} preview={preview} />}
        {result !== null && <p role="status">{result}</p>}
        {problem !== null && (
          <p className="table__error" role="alert">
            {problem}
          </p>
        )}
      </div>
      {canUndo && !open && (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={props.onUndo}
          disabled={props.busy}
        >
          Undo the move to GTD
        </button>
      )}
    </section>
  );
}

function Offer({
  preview,
  onOpen,
  onClose,
}: TaskMigrationProps & { preview: TaskMigrationPreviewData }) {
  return (
    <div className="task-migration__offer">
      <p>
        Tasks follow GTD’s eight statuses, from Inbox to Archive.{' '}
        {preview.tasks.length === 0
          ? 'Your Task type and views can be set up for them.'
          : `${tasks(preview.tasks.length)} would move to them.`}
      </p>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onOpen}>
        Preview the move
      </button>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
        Not now
      </button>
    </div>
  );
}

function Preview(props: TaskMigrationProps & { preview: TaskMigrationPreviewData }) {
  const { preview, busy, onRun, onClose } = props;
  return (
    <div className="task-migration__preview">
      <p>
        Nothing is changed until you move them. Each task’s other properties and its text stay as
        they are.
      </p>
      {preview.mapping.length > 0 && <MappingTable {...props} />}
      <Lines heading="The Task type" lines={preview.typeLines} />
      <Lines
        heading="Views and automations rewritten"
        lines={preview.references.map(({ title, moved }) => `${title}: ${moved.join(', ')}`)}
      />
      <Lines
        heading="Listed for you to change by hand"
        lines={preview.listed.map(({ title, reason }) => `${title}: ${reason}`)}
      />
      <Lines heading="Views added" lines={preview.views} />
      {preview.tasks.length > 0 && <TaskTable rows={preview.tasks} />}
      <div className="task-migration__actions">
        <button type="button" className="btn btn--sm" onClick={onRun} disabled={busy}>
          {preview.tasks.length === 0 ? 'Set up GTD' : `Move ${tasks(preview.tasks.length)}`}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function MappingTable({
  preview,
  busy,
  onChoose,
}: TaskMigrationProps & { preview: TaskMigrationPreviewData }) {
  return (
    <table className="task-migration__mapping" aria-label="Status mapping">
      <thead>
        <tr>
          <th>Status now</th>
          <th>Tasks</th>
          <th>Becomes</th>
        </tr>
      </thead>
      <tbody>
        {preview.mapping.map((row) => (
          <tr key={row.from}>
            <td>{statusText(row.from)}</td>
            <td>{row.tasks}</td>
            <td>
              <select
                aria-label={`${statusText(row.from)} becomes`}
                value={row.to}
                disabled={busy}
                onChange={(event) => onChoose({ from: row.from, to: event.target.value })}
              >
                {preview.statuses.map((status) => (
                  <option key={status} value={status}>
                    {optionLabel(status)}
                  </option>
                ))}
              </select>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Lines({ heading, lines }: { heading: string; lines: readonly string[] }) {
  const id = useId();
  if (lines.length === 0) return null;
  return (
    <div className="task-migration__lines">
      <h3 id={id}>{heading}</h3>
      <ul aria-labelledby={id}>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

function TaskTable({ rows }: { rows: readonly TaskMigrationRow[] }) {
  return (
    <div className="task-migration__tasks">
      <table aria-label="Tasks that move">
        <thead>
          <tr>
            <th>Task</th>
            <th>Now</th>
            <th>Becomes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.path}>
              <td>{row.title}</td>
              <td>{statusText(row.from)}</td>
              <td>
                {optionLabel(row.to)}
                {row.completed !== null && `, completed ${row.completed}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
