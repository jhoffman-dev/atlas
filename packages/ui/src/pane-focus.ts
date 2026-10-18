import { createContext, useContext } from 'react';

/**
 * Whether the pane around a component is the focused one: what `PaneFrame`
 * is told, handed down so a control deep in the page — the close button's
 * tooltip naming the shortcut — can follow it without the page between them
 * drawing again. False outside any frame, where nothing has said so.
 */
export const PaneFocusContext = createContext(false);

export function usePaneFocus(): boolean {
  return useContext(PaneFocusContext);
}
