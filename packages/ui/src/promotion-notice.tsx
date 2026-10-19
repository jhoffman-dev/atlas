import { UNDO_BAR_MS, useDismissAfter } from './dismiss-after.ts';
import type { PromoteLine } from './editor/promote-line.ts';
import { Icon } from './icon.tsx';

/** What the page says after a checklist line was made a task, or a try at it failed. */
export interface PromotionNotice {
  readonly message: string;
  /** Opens the task made; null when none was. */
  readonly onOpen: (() => void) | null;
  /** Takes back the task and the line in one step; null when there is nothing to take back. */
  readonly onUndo: (() => void) | null;
  readonly onDismiss: () => void;
}

/** Making a checklist line a task, from the note it is in (P30-03). */
export interface LinePromotion {
  readonly promote: PromoteLine;
  /** What the last promotion did or why it could not; null when there is nothing to say. */
  readonly notice: PromotionNotice | null;
}

/**
 * The line under the page bar after a checklist line became a task: what was
 * made, a way to open it, and one Undo that takes back both the task and the
 * line. It goes by itself, and its Undo with it, after 20 seconds unless held
 * (#165). A refusal says why, with nothing to undo, and stays until dismissed.
 * A new notice is a new object: one kept across renders keeps its time.
 */
export function PromotionBanner({ notice }: { notice: PromotionNotice | null }) {
  if (notice === null) return null;
  return <Banner notice={notice} />;
}

function Banner({ notice }: { notice: PromotionNotice }) {
  const hold = useDismissAfter({
    ms: UNDO_BAR_MS,
    showing: notice,
    onDismiss: notice.onDismiss,
    // A refusal, or an Undo that failed, offers nothing to take back: it stays until read and dismissed.
    stays: notice.onUndo === null,
  });
  return (
    <div className="notice-bar promotion-notice" role="status" {...hold}>
      <Icon name="task" size={14} className="notice-bar__icon" />
      <div className="notice-bar__text">
        <p>{notice.message}</p>
      </div>
      {notice.onOpen !== null && (
        <button type="button" className="btn btn--secondary btn--sm" onClick={notice.onOpen}>
          Open
        </button>
      )}
      {notice.onUndo !== null && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={notice.onUndo}>
          Undo
        </button>
      )}
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
