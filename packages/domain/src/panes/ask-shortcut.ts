import type { PagePlace } from './navigation-history.ts';
import { activePlace, goBackInTab, openInActiveTab, type Workspace } from './workspace.ts';

/** Ask (#37): the page a question starts on. */
export const ASK_PLACE: PagePlace = { kind: 'ask' };

/**
 * ⌘J (#37). Away from Ask, it shows Ask where an open from outside a pane
 * lands — the tab already on it, if the pane has one, as any page's open
 * does. On Ask, it goes back to where you were, as Back would. On an Ask
 * with nowhere to go back to, the workspace is handed back unchanged, and
 * the caller puts the keys in the question box instead.
 */
export function askShortcut(ws: Workspace): Workspace {
  if (activePlace(ws)?.kind !== 'ask') return openInActiveTab(ws, ASK_PLACE);
  return goBackInTab(ws);
}
