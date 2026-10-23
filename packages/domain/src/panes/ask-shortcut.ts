import type { PagePlace } from './navigation-history.ts';
import {
  activateTab,
  activePlace,
  goBackInTab,
  openInActiveTab,
  type AskReturn,
  type Workspace,
} from './workspace.ts';

/** Ask (#37): the page a question starts on. */
export const ASK_PLACE: PagePlace = { kind: 'ask' };

/**
 * ⌘J (#37). Away from Ask, it shows Ask where an open from outside a pane
 * lands — the tab already on it, if the pane has one, as any page's open
 * does. On Ask, it goes back to where you were: to the tab it switched from,
 * when it switched tabs, and otherwise as Back would. On an Ask with nowhere
 * to go back to, the workspace is handed back unchanged, and the caller puts
 * the keys in the question box instead.
 */
export function askShortcut(ws: Workspace): Workspace {
  if (activePlace(ws)?.kind !== 'ask') return toAsk(ws);
  const back = returnOf(ws);
  if (back !== null) return activateTab(withoutReturn(ws), { pane: back.pane, id: back.from });
  const cleared = withoutReturn(ws);
  const backed = goBackInTab(cleared);
  // Nowhere to go: unchanged, so the caller knows to put the keys in the box.
  return backed === cleared ? ws : backed;
}

function toAsk(ws: Workspace): Workspace {
  const pane = ws.focused;
  const from = ws.panes[pane]?.active;
  const shown = openInActiveTab(withoutReturn(ws), ASK_PLACE);
  const ask = shown.panes[shown.focused]?.active;
  // The same tab took Ask into its history: Back is the way home.
  if (from === undefined || ask === undefined || ask === from || shown.focused !== pane) {
    return shown;
  }
  return { ...shown, askReturn: { pane, ask, from } };
}

/** Where ⌘J came from, while the Ask tab it switched to is still the one shown and the tab is still there. */
function returnOf(ws: Workspace): AskReturn | null {
  const back = ws.askReturn;
  if (back === undefined || ws.focused !== back.pane) return null;
  const pane = ws.panes[back.pane];
  if (pane?.active !== back.ask || !pane.tabs.some((tab) => tab.id === back.from)) return null;
  return back;
}

function withoutReturn(ws: Workspace): Workspace {
  if (ws.askReturn === undefined) return ws;
  return { panes: ws.panes, focused: ws.focused, nextId: ws.nextId, closed: ws.closed };
}
