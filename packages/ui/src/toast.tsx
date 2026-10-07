import { useEffect, useRef, useState } from 'react';

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
  const dismiss = useRef(onDismiss);
  useEffect(() => {
    dismiss.current = onDismiss;
  });
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const held = hovered || focused;
  // A new message, or being let go, restarts the time it has.
  useEffect(() => {
    if (held) return;
    const timer = window.setTimeout(() => dismiss.current(), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [message, held]);

  return (
    <div
      className="toast"
      role="status"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
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
