import { TOAST_MS, useDismissAfter } from './dismiss-after.ts';
import { Icon } from './icon.tsx';

/**
 * A small word that something happened — "Task added" — top right, on a dark
 * surface, with at most one thing to do about it: Undo for a change, or an
 * action of the caller's ("Open"), and a × to send it away. It goes by itself
 * after a few seconds; it never takes the focus, since whatever you were
 * doing is what you are still doing. It waits while the pointer is on it or
 * the focus is in it, so its buttons can be reached, and gives its full time
 * again once let go.
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
  const hold = useDismissAfter({ ms: TOAST_MS, showing: message, onDismiss });
  const act = (does: () => void) => () => {
    does();
    onDismiss();
  };
  return (
    <div className="toast" role="status" {...hold}>
      <span className="toast__message">{message}</span>
      {onUndo !== undefined && (
        <button type="button" className="toast__action" onClick={act(onUndo)}>
          <Icon name="undo" size={12} />
          Undo
        </button>
      )}
      {action !== undefined && (
        <button type="button" className="toast__action" onClick={act(action.onClick)}>
          {action.label}
        </button>
      )}
      <button type="button" className="toast__dismiss" aria-label="Dismiss" onClick={onDismiss}>
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}
