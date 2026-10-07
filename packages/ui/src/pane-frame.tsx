import type { ReactNode } from 'react';

/**
 * One half of a split window: a page in a panel of its own.
 *
 * The frame is what carries the focus, not the page inside it — clicking
 * anywhere in a pane, on prose or a table row or its own scrollbar, is what
 * says "this is the pane I am working in", and the next note opened from the
 * sidebar lands here. Splitting and closing are commands in the page's own
 * bar (`PageBar`), so the frame draws nothing of its own.
 */
export function PaneFrame({
  label,
  focused,
  onFocus,
  children,
}: {
  /** Names the region: "Pane 1" is the left one. */
  label: string;
  focused: boolean;
  onFocus: () => void;
  children: ReactNode;
}) {
  return (
    <section
      className={focused ? 'panel pane pane--focused' : 'panel pane'}
      aria-label={label}
      // Focusable from script only, so focus has somewhere in the pane to land
      // while what it holds is still being read.
      tabIndex={-1}
      // Capturing both: a click focuses a pane even when it lands on something
      // that stops the event, and tabbing into a pane focuses it without one.
      onMouseDownCapture={onFocus}
      onFocusCapture={onFocus}
    >
      {children}
    </section>
  );
}
