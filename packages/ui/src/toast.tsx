import { useRef, useState } from 'react';
import { TOAST_MS, useDismissAfter } from './dismiss-after.ts';
import { Icon } from './icon.tsx';

/**
 * A small word that something happened — "Task added" — top right, on a dark
 * surface, with what can be done about it: Undo for a change, an action of
 * the caller's ("Open"), either or both, and a × to send it away. Only the
 * words are the live region, so a screen reader hears what happened and not
 * the names of the buttons. It goes by itself after a few seconds; it never
 * takes the focus, since whatever you were doing is what you are still
 * doing. It waits while the pointer is on it or the focus is in it, so its
 * buttons can be reached, and gives its full time again once let go.
 *
 * A button acts once: the first press does its thing and dismisses, and
 * nothing — a second press, the timer — dismisses again. Saying the same
 * words a second time is the caller's to mark, with a `key` that changes per
 * showing (use-granola-pull's `toastShown`): to a component, the same props
 * are the same showing.
 */
export function Toast({
  message,
  action,
  onUndo,
  onDismiss,
}: {
  message: string;
  action?: { readonly label: string; readonly onClick: () => void };
  onUndo?: () => void;
  onDismiss: () => void;
}) {
  // The ref answers a second press in the same tick; the state stops the timer.
  const acted = useRef(false);
  const [done, setDone] = useState(false);
  const hold = useDismissAfter({ ms: TOAST_MS, showing: message, onDismiss, stays: done });
  const once = (does?: () => void) => () => {
    if (acted.current) return;
    acted.current = true;
    setDone(true);
    does?.();
    onDismiss();
  };
  return (
    <div className="toast" {...hold}>
      <span className="toast__message" role="status">
        {message}
      </span>
      {onUndo !== undefined && (
        <button type="button" className="toast__action" onClick={once(onUndo)}>
          <Icon name="undo" size={12} />
          Undo
        </button>
      )}
      {action !== undefined && (
        <button type="button" className="toast__action" onClick={once(action.onClick)}>
          {action.label}
        </button>
      )}
      <button type="button" className="toast__dismiss" aria-label="Dismiss" onClick={once()}>
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}
