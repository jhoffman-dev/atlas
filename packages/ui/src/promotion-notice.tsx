import type { PromoteLine } from './editor/promote-line.ts';
import { Icon } from './icon.tsx';

/**
 * Why a checklist line could not become a task, or its Undo could not take
 * it back. A task made is said in the window's toast, with Open and Undo
 * (UI v2, slice 15); only a failure is said on the page.
 */
export interface PromotionNotice {
  readonly message: string;
  readonly onDismiss: () => void;
}

/** Making a checklist line a task, from the note it is in (P30-03). */
export interface LinePromotion {
  readonly promote: PromoteLine;
  /** Why the last promotion, or its Undo, failed; null when there is nothing to say. */
  readonly notice: PromotionNotice | null;
}

/**
 * The line under the page bar when Make task, or its Undo, failed: why, with
 * nothing to take back. It stays until it is read and dismissed.
 */
export function PromotionBanner({ notice }: { notice: PromotionNotice | null }) {
  if (notice === null) return null;
  return (
    <div className="notice-bar promotion-notice" role="status">
      <Icon name="task" size={14} className="notice-bar__icon" />
      <div className="notice-bar__text">
        <p>{notice.message}</p>
      </div>
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
