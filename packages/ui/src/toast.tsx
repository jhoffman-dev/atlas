import { useDismissAfter } from './dismiss-after.ts';

/** How long a toast stays before it goes by itself. */
const TOAST_MS = 6000;

/**
 * A small word that something happened — "Task added" — with one thing to do
 * about it, at the foot of the window. It goes by itself; it never takes the
 * focus, since whatever you were doing is what you are still doing. It waits
 * while the pointer is on it or the focus is in it, so its action can be
 * reached, and gives its full time again once let go.
 */
export function Toast({
  message,
  action,
  onDismiss,
}: {
  message: string;
  action?: { readonly label: string; readonly onClick: () => void };
  onDismiss: () => void;
}) {
  const hold = useDismissAfter({ ms: TOAST_MS, showing: message, onDismiss });
  return (
    <div className="toast" role="status" {...hold}>
      <span className="toast__message">{message}</span>
      {action !== undefined && (
        <button
          type="button"
          className="toast__action"
          onClick={() => {
            action.onClick();
            onDismiss();
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
