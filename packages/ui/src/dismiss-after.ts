import { useEffect, useRef, useState, type FocusEvent } from 'react';

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
 * shown — another `showing` — starts the time afresh.
 */
export function useDismissAfter({
  ms,
  showing,
  onDismiss,
}: {
  ms: number;
  showing: unknown;
  onDismiss: () => void;
}): HoldWhileInUse {
  const dismiss = useRef(onDismiss);
  useEffect(() => {
    dismiss.current = onDismiss;
  });
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const held = hovered || focused;
  useEffect(() => {
    if (held) return;
    const timer = window.setTimeout(() => dismiss.current(), ms);
    return () => window.clearTimeout(timer);
  }, [showing, held, ms]);
  return {
    onPointerEnter: () => setHovered(true),
    onPointerLeave: () => setHovered(false),
    onFocus: () => setFocused(true),
    onBlur: (event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
    },
  };
}
