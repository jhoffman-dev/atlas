import type { PromoteLine } from './editor/promote-line.ts';

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
 * line. A refusal says why, with nothing to undo.
 */
export function PromotionBanner({ notice }: { notice: PromotionNotice | null }) {
  if (notice === null) return null;
  return (
    <div className="promotion-notice" role="status">
      <p className="promotion-notice__text">{notice.message}</p>
      {notice.onOpen !== null && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={notice.onOpen}>
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
