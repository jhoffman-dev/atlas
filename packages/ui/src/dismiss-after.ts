import { useEffect, useRef, useState, type FocusEvent } from 'react';

/** How long a toast stays before it goes by itself (the brief: about five seconds). */
export const TOAST_MS = 5000;

/** How long a bar offering Undo stays before it goes by itself, and its undo with it (#165). */
export const UNDO_BAR_MS = 20_000;

/** What the element that goes by itself listens to, so it can be held while in use. */
export interface HoldWhileInUse {
  readonly onPointerEnter: () => void;
  readonly onPointerLeave: () => void;
  readonly onFocus: () => void;
  readonly onBlur: (event: FocusEvent<HTMLElement>) => void;
}

/**
 * Dismisses something shown after `ms`. It waits while the pointer is on it
 * or the focus is in it, so what it offers can be reached by mouse and by
 * keyboard alike, and gives its full time again once let go. Something new
 * shown — another `showing`, compared by identity — starts the time afresh;
 * the same words again are the same `showing`, so a caller that says them
 * again keys its element by a show count (toast.tsx, use-granola-pull's
 * `toastShown`). What `stays` — a failure, which must be read — is never
 * dismissed by time, only by the person.
 */
export function useDismissAfter({
  ms,
  showing,
  onDismiss,
  stays = false,
}: {
  ms: number;
  showing: unknown;
  onDismiss: () => void;
  stays?: boolean;
}): HoldWhileInUse {
  const dismiss = useRef(onDismiss);
  useEffect(() => {
    dismiss.current = onDismiss;
  });
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const held = hovered || focused;
  useEffect(() => {
    if (held || stays) return;
    const timer = window.setTimeout(() => dismiss.current(), ms);
    return () => window.clearTimeout(timer);
  }, [showing, held, ms, stays]);
  return {
    onPointerEnter: () => setHovered(true),
    onPointerLeave: () => setHovered(false),
    onFocus: () => setFocused(true),
    onBlur: (event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
    },
  };
}
