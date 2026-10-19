import { Icon } from './icon.tsx';
import type { InboxOfferReading } from './inbox-offer.ts';
import { noticeBarClass } from './notice-bar.ts';

/** One task the cleanup would archive, as the preview lists it. */
export interface MeetingCleanupTask {
  readonly path: string;
  readonly title: string;
  /** Why today's rules would not have made it, in a sentence. */
  readonly why: string;
}

export interface MeetingCleanupProps extends InboxOfferReading {
  /** The tasks that fail today's rules; null when there are none. */
  readonly tasks: readonly MeetingCleanupTask[] | null;
  /** The ones the person chose to keep, by path. */
  readonly kept: ReadonlySet<string>;
  /** Whether the whole preview is shown, rather than the one-line offer. */
  readonly open: boolean;
  readonly busy: boolean;
  /** What the last cleanup did, in a sentence. */
  readonly result: string | null;
  /** Why nothing is offered although meetings made tasks, in a sentence: null when they could be judged. */
  readonly notice: string | null;
  readonly problem: string | null;
  readonly onOpen: () => void;
  readonly onToggle: (path: string) => void;
  readonly onApply: () => void;
  readonly onClose: () => void;
  /** Ends the offer for now, and what the last cleanup said. */
  readonly onDismiss: () => void;
  readonly onOpenTask: (path: string) => void;
}

const tasks = (count: number) => (count === 1 ? '1 task' : `${count} tasks`);

/**
 * The offer to archive the tasks meetings made that today's rules would not
 * have (#226): one line until asked, then every such task with why, each
 * ticked to go. Untick one to keep it. Nothing moves until the person presses
 * Archive, and archiving is never deleting.
 */
export function MeetingCleanup(props: MeetingCleanupProps) {
  const { tasks: listed, open, result, notice, problem } = props;
  if (listed === null && result === null && notice === null && problem === null) return null;
  return (
    <section
      className={noticeBarClass('inbox__offer meeting-cleanup', open)}
      aria-label="Tasks meetings made"
    >
      <Icon name="archive" size={14} className="notice-bar__icon" />
      <div className="notice-bar__text">
        {listed !== null && !open && <Offer {...props} listed={listed} />}
        {listed !== null && open && <Preview {...props} listed={listed} />}
        {result !== null && <p role="status">{result}</p>}
        {notice !== null && <p role="status">{notice}</p>}
        {problem !== null && (
          <p className="table__error" role="alert">
            {problem}
          </p>
        )}
      </div>
      {listed === null && (
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
  listed,
  onOpen,
  onDismiss,
}: MeetingCleanupProps & { listed: readonly MeetingCleanupTask[] }) {
  return (
    <div className="meeting-cleanup__offer">
      <p>
        {tasks(listed.length)} that meetings made aren’t yours by today’s rules. Look them over, and
        archive the ones you don’t want.
      </p>
      <button type="button" className="btn btn--secondary btn--sm" onClick={onOpen}>
        Review them
      </button>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onDismiss}>
        Not now
      </button>
    </div>
  );
}

function Preview(props: MeetingCleanupProps & { listed: readonly MeetingCleanupTask[] }) {
  const { listed, kept, busy, onApply, onClose, onToggle, onOpenTask } = props;
  const going = listed.filter(({ path }) => !kept.has(path)).length;
  return (
    <div className="meeting-cleanup__preview">
      <p>
        Ticked tasks go to the Archive, where they can be found and restored. Untick any you want to
        keep.
      </p>
      <div className="meeting-cleanup__tasks">
        <table aria-label="Tasks to archive">
          <thead>
            <tr>
              <th>Archive</th>
              <th>Task</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            {listed.map((task) => (
              <tr key={task.path}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Archive ${task.title}`}
                    checked={!kept.has(task.path)}
                    disabled={busy}
                    onChange={() => onToggle(task.path)}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="table__link"
                    onClick={() => onOpenTask(task.path)}
                  >
                    {task.title}
                  </button>
                </td>
                <td>{task.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="meeting-cleanup__actions">
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={onApply}
          disabled={busy || going === 0}
        >
          Archive {tasks(going)}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
