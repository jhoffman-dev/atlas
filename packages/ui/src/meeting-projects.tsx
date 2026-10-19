import { useId } from 'react';
import { Icon } from './icon.tsx';
import type { InboxOfferReading } from './inbox-offer.ts';
import { noticeBarClass } from './notice-bar.ts';

/** A meeting with no project, as the preview lists it. */
export interface MeetingProjectRow {
  readonly path: string;
  /** "2026-10-14 Larkspur Standup". */
  readonly meeting: string;
  /** The project or area it would be filed under; null when nothing says, and it stays empty. */
  readonly project: string | null;
  /** How sure that is: high, medium or low; null with no project. */
  readonly confidence: string | null;
  /** Why, in a sentence. */
  readonly reason: string;
  /** Whether running the backfill files it. */
  readonly chosen: boolean;
}

export interface MeetingProjectsProps extends InboxOfferReading {
  /** Every meeting with no project; null when there is none, or the offer was put away. */
  readonly rows: readonly MeetingProjectRow[] | null;
  /** Whether the whole preview is shown, rather than the one-line offer. */
  readonly open: boolean;
  readonly busy: boolean;
  /** What the last run or undo did, in a sentence. */
  readonly result: string | null;
  readonly problem: string | null;
  /** Whether the last run can be taken back. */
  readonly canUndo: boolean;
  readonly onOpen: () => void;
  /** Files, or stops filing, the meeting at this path. */
  readonly onToggle: (path: string) => void;
  readonly onRun: () => void;
  /** Closes the preview, or puts the offer away until the vault is opened again. */
  readonly onClose: () => void;
  readonly onUndo: () => void;
  /** Puts away what the last run said, and the offer to undo it. */
  readonly onDismiss: () => void;
}

const meetings = (count: number) => (count === 1 ? '1 meeting' : `${count} meetings`);

/**
 * The offer to file the meetings that have no project (#227): one line until
 * asked, then each meeting with the project its series or its other copy
 * says, how sure, and why — the sure ones ticked — and those nothing says,
 * left empty. Nothing is written until the person files them, and only
 * their `project`; the run can be undone from here.
 */
export function MeetingProjects(props: MeetingProjectsProps) {
  const { rows, open, result, problem, canUndo } = props;
  if (rows === null && result === null && problem === null && !canUndo) return null;
  return (
    <section
      className={noticeBarClass('inbox__offer task-migration', open)}
      aria-label="File meetings under projects"
    >
      <Icon name="event" size={14} className="notice-bar__icon" />
      <div className="notice-bar__text">
        {rows !== null && !open && <Offer {...props} rows={rows} />}
        {rows !== null && open && <Preview {...props} rows={rows} />}
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
          Undo filing
        </button>
      )}
      {(canUndo || result !== null) && !open && (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={props.onDismiss}
          disabled={props.busy}
        >
          Dismiss
        </button>
      )}
    </section>
  );
}

function Offer({
  rows,
  onOpen,
  onClose,
}: MeetingProjectsProps & { rows: readonly MeetingProjectRow[] }) {
  const suggested = rows.filter((row) => row.project !== null).length;
  return (
    <div className="task-migration__offer">
      <p>
        {meetings(rows.length)} {rows.length === 1 ? 'has' : 'have'} no project.{' '}
        {suggested === 0
          ? 'Nothing in their series says which.'
          : `${suggested} can be filed as their series, or their other copy, is.`}
      </p>
      <button type="button" className="btn btn--secondary btn--sm" onClick={onOpen}>
        Preview
      </button>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
        Not now
      </button>
    </div>
  );
}

function Preview(props: MeetingProjectsProps & { rows: readonly MeetingProjectRow[] }) {
  const { rows, busy, onRun, onClose, onToggle } = props;
  const suggested = rows.filter((row) => row.project !== null);
  const empty = rows.filter((row) => row.project === null);
  const chosen = suggested.filter((row) => row.chosen).length;
  return (
    <div className="task-migration__preview">
      <p>
        Nothing is changed until you file them, and only each meeting’s project is written. The sure
        ones are ticked; tick any other you agree with.
      </p>
      <Suggested rows={suggested} busy={busy} onToggle={onToggle} />
      <Lines
        heading="Left empty"
        lines={empty.map((row) => ({ key: row.path, line: `${row.meeting}: ${row.reason}` }))}
      />
      <div className="task-migration__actions">
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={onRun}
          disabled={busy || chosen === 0}
        >
          File {meetings(chosen)}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Suggested({
  rows,
  busy,
  onToggle,
}: {
  rows: readonly MeetingProjectRow[];
  busy: boolean;
  onToggle: (path: string) => void;
}) {
  const id = useId();
  if (rows.length === 0) return null;
  return (
    <div className="task-migration__lines">
      <h3 id={id}>Filed from their series</h3>
      <ul aria-labelledby={id}>
        {rows.map((row) => (
          <li key={row.path}>
            <label>
              <input
                type="checkbox"
                checked={row.chosen}
                disabled={busy}
                onChange={() => onToggle(row.path)}
              />{' '}
              {row.meeting} → {row.project} ({row.confidence})
            </label>
            <br />
            <small>{row.reason}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Lines({
  heading,
  lines,
}: {
  heading: string;
  lines: readonly { readonly key: string; readonly line: string }[];
}) {
  const id = useId();
  if (lines.length === 0) return null;
  return (
    <div className="task-migration__lines">
      <h3 id={id}>{heading}</h3>
      <ul aria-labelledby={id}>
        {lines.map(({ key, line }) => (
          <li key={key}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
