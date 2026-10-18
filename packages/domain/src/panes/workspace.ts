import type { EntryMove } from '../vault/vault-moves.ts';
import type { VaultPath } from '../vault/vault-path.ts';
import {
  followMoveInHistory,
  forgetNotes,
  goBack,
  goForward,
  NO_HISTORY,
  samePlace,
  visit,
  type NavigationHistory,
  type NavigationPlace,
} from './navigation-history.ts';

/** How many panes the window can show side by side. */
export const MAX_PANES = 2;

/**
 * The window as tabs in panes (docs/design/tab-model.md).
 *
 * A tab is a place with its own Back and Forward; a pane is a row of tabs with
 * one showing; the workspace is one or two panes and which of them the next
 * open lands in. Every operation here is pure, `(workspace, …) => workspace`,
 * and hands back the same workspace when it changes nothing, so a store can
 * skip a write and a renderer a draw.
 *
 * The rules that hold throughout, each tested:
 * - 1 ≤ panes ≤ `MAX_PANES`; every pane has at least one tab, and `active`
 *   names one of them; `focused` names a pane.
 * - Ids are unique, minted from `nextId` — no randomness in the domain — and
 *   never reused, so a tab that comes back from the closed stack keeps its id.
 * - Closing the last tab of a split pane closes the pane; closing the last tab
 *   of the only pane leaves one empty tab. Moving the last tab out of a pane
 *   collapses the split.
 * - Pinned tabs sit first and cannot be closed. (Reserved: nothing pins yet.)
 * - The same place may be open in two tabs, and there is no cap on tabs.
 */

/** "t<n>": the n is `nextId` at the time the tab was minted. */
export type TabId = string;

export interface Tab {
  readonly id: TabId;
  readonly pinned: boolean;
  readonly history: NavigationHistory;
}

export interface Pane {
  /** Left to right, pinned ones first. Never empty. */
  readonly tabs: readonly Tab[];
  /** The tab shown: always one of `tabs`. */
  readonly active: TabId;
}

export interface Workspace {
  /** In the order they are drawn. Never empty, never more than `MAX_PANES`. */
  readonly panes: readonly Pane[];
  /** The pane an open from outside a pane lands in. Always a pane that exists. */
  readonly focused: number;
  /** The number the next tab's id is minted from. */
  readonly nextId: number;
  /** Tabs closed by hand, newest first, for ⌘⇧T. Not remembered across launches. */
  readonly closed: readonly Tab[];
}

/** How many closed tabs ⌘⇧T can bring back; older ones are forgotten first. */
export const CLOSED_LIMIT = 10;

/** One pane holding one empty tab: a first run, and what closing back down leaves. */
export const EMPTY_WORKSPACE: Workspace = {
  panes: [{ tabs: [{ id: 't1', pinned: false, history: NO_HISTORY }], active: 't1' }],
  focused: 0,
  nextId: 2,
  closed: [],
};

/** The place a tab shows, or null for an empty tab. */
export function tabPlace(tab: Tab): NavigationPlace | null {
  return tab.history.current;
}

export function isWorkspaceSplit(ws: Workspace): boolean {
  return ws.panes.length > 1;
}

/** The focused pane's active tab: where an open from outside a pane lands. */
export function activeTabOf(ws: Workspace): Tab {
  return activeTabIn(ws.panes[ws.focused] as Pane);
}

/** What the focused pane shows: what the sidebar marks as where you are. */
export function activePlace(ws: Workspace): NavigationPlace | null {
  return tabPlace(activeTabOf(ws));
}

// ---- Opening ---------------------------------------------------------------

/**
 * A plain click: shows the place in the focused pane.
 *
 * A tab of that pane already on the place is shown rather than a second copy
 * opened (James's decision on #303); otherwise the active tab goes there, as
 * a step in its history. Every open from outside a pane — a link, a search
 * hit, a sidebar row, a board card — comes through here, which is what makes
 * "it opens where I am" one rule rather than a decision taken again at each
 * call site. ⌘-click (`openInNewTab`) is how a second copy is asked for.
 */
export function openInActiveTab(ws: Workspace, place: NavigationPlace): Workspace {
  return openInActiveTabOf(ws, { pane: ws.focused, place });
}

/**
 * As `openInActiveTab`, in a named pane, which takes the focus: opening
 * inside a pane is also a statement about where you are working. A pane that
 * is not there is refused, rather than opened somewhere else.
 */
export function openInActiveTabOf(
  ws: Workspace,
  { pane, place }: { pane: number; place: NavigationPlace },
): Workspace {
  if (!hasPane(ws, pane)) return ws;
  const held = ws.panes[pane] as Pane;
  const tab = activeTabIn(held);
  const already = showing(tab, place) ? tab : held.tabs.find((each) => showing(each, place));
  if (already !== undefined) return activateTab(ws, { pane, id: already.id });
  const history = visit(tab.history, place);
  return {
    ...ws,
    focused: pane,
    panes: replacePane(ws.panes, pane, withTab(held, { ...tab, history })),
  };
}

/**
 * Opens in a new tab placed right after the active one, and shows it: ⌘-click.
 * Right after, not at the end, so a run of ⌘-clicks from one page reads in the
 * order they were made.
 */
export function openInNewTab(ws: Workspace, place: NavigationPlace): Workspace {
  return addTab(ws, { history: visit(NO_HISTORY, place), at: 'after-active' });
}

/** Adds an empty tab at the end of the focused pane and shows it: the + button. */
export function newTab(ws: Workspace): Workspace {
  return addTab(ws, { history: NO_HISTORY, at: 'end' });
}

/**
 * Opens beside what is being read: ⌘⇧-click. In a new pane while there is
 * room for one, otherwise in the other pane's active tab; either way the
 * focus goes with it.
 */
export function openInSplit(ws: Workspace, place: NavigationPlace): Workspace {
  if (!isWorkspaceSplit(ws)) return openInActiveTab(splitWithTab(ws), place);
  const other = ws.focused === 0 ? 1 : 0;
  return openInActiveTabOf(ws, { pane: other, place });
}

function showing(tab: Tab, place: NavigationPlace): boolean {
  const shown = tabPlace(tab);
  return shown !== null && samePlace(shown, place);
}

function addTab(
  ws: Workspace,
  { history, at }: { history: NavigationHistory; at: 'after-active' | 'end' },
): Workspace {
  const pane = ws.panes[ws.focused] as Pane;
  const tab: Tab = { id: mintId(ws), pinned: false, history };
  const place = at === 'end' ? pane.tabs.length : activeIndex(pane) + 1;
  const tabs = insertAt(pane.tabs, tab, clampToRun(pane.tabs, place, false));
  return {
    ...ws,
    nextId: ws.nextId + 1,
    panes: replacePane(ws.panes, ws.focused, { tabs, active: tab.id }),
  };
}

// ---- Closing ---------------------------------------------------------------

/**
 * Closes a tab. The right neighbour takes over when the shown tab closes,
 * else the left one — as browsers do, so closing a run of tabs walks right.
 * The last tab of a split pane takes the pane with it; the last tab of the
 * only pane leaves a fresh empty one. The tab goes onto the closed stack for
 * ⌘⇧T. A pinned tab, or one that is not there, closes nothing.
 */
export function closeTab(ws: Workspace, { pane, id }: { pane: number; id: TabId }): Workspace {
  const tab = findTab(ws, { pane, id });
  if (tab === null || tab.pinned) return ws;
  const closed = [tab, ...ws.closed].slice(0, CLOSED_LIMIT);
  return { ...removeTab(ws, { pane, id }), closed };
}

/**
 * Brings back the most recently closed tab, with its history, beside the
 * active tab of the focused pane, and shows it. A pane holding nothing but
 * one blank tab hands that tab's place over instead: it was only ever a
 * placeholder, and ⌘⇧T after ⌘W should leave what ⌘W found.
 */
export function reopenClosedTab(ws: Workspace): Workspace {
  const [tab, ...rest] = ws.closed;
  if (tab === undefined) return ws;
  const pane = ws.panes[ws.focused] as Pane;
  const only = pane.tabs.length === 1 ? (pane.tabs[0] as Tab) : null;
  const kept = only !== null && isBlank(only) && !only.pinned ? [] : pane.tabs;
  const tabs = insertAt(kept, tab, clampToRun(kept, activeIndex(pane) + 1, false));
  return {
    ...ws,
    closed: rest,
    panes: replacePane(ws.panes, ws.focused, { tabs, active: tab.id }),
  };
}

/**
 * Takes a tab out of its pane without keeping it, applying the last-tab
 * rules. The caller has checked the tab is there.
 */
function removeTab(ws: Workspace, { pane, id }: { pane: number; id: TabId }): Workspace {
  const held = ws.panes[pane] as Pane;
  if (held.tabs.length > 1) {
    return { ...ws, panes: replacePane(ws.panes, pane, withoutTab(held, id)) };
  }
  if (isWorkspaceSplit(ws)) return dropPane(ws, pane);
  const fresh: Tab = { id: mintId(ws), pinned: false, history: NO_HISTORY };
  return {
    ...ws,
    nextId: ws.nextId + 1,
    panes: [{ tabs: [fresh], active: fresh.id }],
  };
}

/** The pane with one of its several tabs gone, a neighbour shown if it was the one. */
function withoutTab(pane: Pane, id: TabId): Pane {
  const at = pane.tabs.findIndex((tab) => tab.id === id);
  const tabs = pane.tabs.filter((tab) => tab.id !== id);
  if (pane.active !== id) return { tabs, active: pane.active };
  const neighbour = tabs[at] ?? (tabs[at - 1] as Tab);
  return { tabs, active: neighbour.id };
}

// ---- Switching and ordering -----------------------------------------------

/** Shows a tab, and the pane it is in takes the focus. */
export function activateTab(ws: Workspace, { pane, id }: { pane: number; id: TabId }): Workspace {
  if (findTab(ws, { pane, id }) === null) return ws;
  const held = ws.panes[pane] as Pane;
  if (held.active === id && ws.focused === pane) return ws;
  return { ...ws, focused: pane, panes: replacePane(ws.panes, pane, { ...held, active: id }) };
}

/** Shows the tab to the right of the shown one, round to the first: ⌃Tab. */
export function nextTab(ws: Workspace): Workspace {
  return stepTab(ws, 1);
}

/** Shows the tab to the left of the shown one, round to the last: ⌃⇧Tab. */
export function previousTab(ws: Workspace): Workspace {
  return stepTab(ws, -1);
}

function stepTab(ws: Workspace, by: 1 | -1): Workspace {
  const pane = ws.panes[ws.focused] as Pane;
  const count = pane.tabs.length;
  const at = (activeIndex(pane) + by + count) % count;
  return activateTab(ws, { pane: ws.focused, id: (pane.tabs[at] as Tab).id });
}

/**
 * Shows the nth tab of the focused pane, counting from 1: ⌘1–9. Nine is the
 * last tab however many there are, as browsers have it; a number past the
 * tabs, or outside 1–9, shows nothing different.
 */
export function activateNth(ws: Workspace, n: number): Workspace {
  if (!Number.isInteger(n) || n < 1 || n > 9) return ws;
  const pane = ws.panes[ws.focused] as Pane;
  const tab = n === 9 ? pane.tabs.at(-1) : pane.tabs[n - 1];
  return tab === undefined ? ws : activateTab(ws, { pane: ws.focused, id: tab.id });
}

/**
 * Moves a tab to another place in its pane. The place is clamped to the ends,
 * and a pinned tab stays among the pinned ones, an unpinned one among the rest.
 */
export function reorderTab(
  ws: Workspace,
  { pane, id, to }: { pane: number; id: TabId; to: number },
): Workspace {
  const tab = findTab(ws, { pane, id });
  if (tab === null || !Number.isInteger(to)) return ws;
  const held = ws.panes[pane] as Pane;
  const rest = held.tabs.filter((each) => each.id !== id);
  const tabs = insertAt(rest, tab, clampToRun(rest, to, tab.pinned));
  if (tabs.every((each, at) => each === held.tabs[at])) return ws;
  return { ...ws, panes: replacePane(ws.panes, pane, { ...held, tabs }) };
}

/**
 * Moves a tab into another pane, where it is shown and the focus goes. The
 * pane it leaves shows a neighbour, or closes with its last tab, which
 * collapses the split. Within one pane this is a reorder.
 */
export function moveTabToPane(
  ws: Workspace,
  { id, from, to, at }: { id: TabId; from: number; to: number; at: number },
): Workspace {
  if (from === to) return reorderTab(ws, { pane: from, id, to: at });
  const tab = findTab(ws, { pane: from, id });
  if (tab === null || !hasPane(ws, to) || !Number.isInteger(at)) return ws;
  const left = removeTab(ws, { pane: from, id });
  // Dropping the source pane shifts the destination left by one.
  const landing = left.panes.length < ws.panes.length && to > from ? to - 1 : to;
  const pane = left.panes[landing] as Pane;
  const tabs = insertAt(pane.tabs, tab, clampToRun(pane.tabs, at, tab.pinned));
  return {
    ...left,
    focused: landing,
    panes: replacePane(left.panes, landing, { tabs, active: tab.id }),
  };
}

// ---- Panes -----------------------------------------------------------------

/**
 * Splits, giving the new pane a copy of the focused pane's active tab — same
 * history, a new id — and the focus. Starting the new pane on the same page is
 * what makes a split useful straight away: you split, then open something
 * else on one side and compare. Splitting a full window is a no-op rather than
 * an error: the control is hidden by then, but a keyboard shortcut is not.
 */
export function splitWithTab(ws: Workspace): Workspace {
  if (ws.panes.length >= MAX_PANES) return ws;
  const copy: Tab = { id: mintId(ws), pinned: false, history: activeTabOf(ws).history };
  return {
    ...ws,
    nextId: ws.nextId + 1,
    panes: [...ws.panes, { tabs: [copy], active: copy.id }],
    focused: ws.panes.length,
  };
}

/**
 * Closes a pane with every tab in it. Its tabs go onto the closed stack, the
 * shown one on top, so ⌘⇧T brings the pane's page back first; a pinned tab
 * closes with the pane and is not kept (pinning is reserved, so none is).
 * The only pane cannot be closed: an app with no pane has nowhere to put the
 * next page opened.
 */
export function closePaneInWorkspace(ws: Workspace, pane: number): Workspace {
  if (!hasPane(ws, pane) || !isWorkspaceSplit(ws)) return ws;
  const held = ws.panes[pane] as Pane;
  const shown = activeTabIn(held);
  const others = held.tabs.filter((tab) => tab !== shown && !tab.pinned);
  const gone = shown.pinned ? others : [shown, ...others];
  return { ...dropPane(ws, pane), closed: [...gone, ...ws.closed].slice(0, CLOSED_LIMIT) };
}

export function focusPaneInWorkspace(ws: Workspace, pane: number): Workspace {
  if (!hasPane(ws, pane) || pane === ws.focused) return ws;
  return { ...ws, focused: pane };
}

/** The workspace without one of its several panes, the focus on one still there. */
function dropPane(ws: Workspace, pane: number): Workspace {
  const panes = ws.panes.filter((_, index) => index !== pane);
  // Closing a pane before the focused one shifts it left by one; closing the
  // focused pane itself leaves the index pointing at what slid into its place,
  // which is only out of range when it was the last.
  const focused = ws.focused > pane ? ws.focused - 1 : ws.focused;
  return { ...ws, panes, focused: Math.min(focused, panes.length - 1) };
}

// ---- History ---------------------------------------------------------------

/** One step back in the focused pane's active tab: ⌘[. */
export function goBackInTab(ws: Workspace): Workspace {
  return withActiveHistory(ws, goBack);
}

/** One step forward in the focused pane's active tab: ⌘]. */
export function goForwardInTab(ws: Workspace): Workspace {
  return withActiveHistory(ws, goForward);
}

function withActiveHistory(
  ws: Workspace,
  step: (history: NavigationHistory) => NavigationHistory,
): Workspace {
  const pane = ws.panes[ws.focused] as Pane;
  const tab = activeTabIn(pane);
  const history = step(tab.history);
  if (history === tab.history) return ws;
  return { ...ws, panes: replacePane(ws.panes, ws.focused, withTab(pane, { ...tab, history })) };
}

// ---- Keeping tabs right after outside changes ------------------------------

/**
 * Follows a move or a rename: every tab on a moved note, open or closed, is
 * where it went. The same workspace when no tab was on it, so a store can
 * skip the write.
 */
export function followMoveInWorkspace(ws: Workspace, move: EntryMove): Workspace {
  const follow = (tab: Tab): Tab => {
    const history = followMoveInHistory(tab.history, move);
    return history === tab.history ? tab : { ...tab, history };
  };
  const panes = ws.panes.map((pane) => {
    const tabs = pane.tabs.map(follow);
    return sameItems(tabs, pane.tabs) ? pane : { ...pane, tabs };
  });
  const closed = ws.closed.map(follow);
  if (sameItems(panes, ws.panes) && sameItems(closed, ws.closed)) return ws;
  return { ...ws, panes, closed };
}

/**
 * Forgets deleted notes, after a delete. A tab on a gone note shows nothing
 * and keeps its Back, so it can leave the way it came; a tab the delete
 * leaves with nothing at all — no page, nowhere to go — closes, under the
 * last-tab rules, and not onto the closed stack: nobody closed it. A tab
 * that was already empty is not the delete's to close, and pinned tabs stay.
 */
export function forgetNotesInWorkspace(
  ws: Workspace,
  gone: (path: VaultPath) => boolean,
): Workspace {
  let touched = false;
  const emptied = new Set<TabId>();
  const forget = (tab: Tab): Tab => {
    const history = forgetNotes(tab.history, gone);
    if (history === tab.history) return tab;
    touched = true;
    const next = { ...tab, history };
    if (!tab.pinned && isBlank(next)) emptied.add(tab.id);
    return next;
  };
  const panes = ws.panes.map((pane) => ({ ...pane, tabs: pane.tabs.map(forget) }));
  const closed = ws.closed.map(forget);
  if (!touched) return ws;

  let next: Workspace = { ...ws, panes, closed: closed.filter((tab) => !emptied.has(tab.id)) };
  // One at a time, finding the pane afresh: closing a split pane's last tab
  // drops the pane, and the next id's pane may have moved left.
  for (const id of emptied) {
    const pane = next.panes.findIndex((held) => held.tabs.some((tab) => tab.id === id));
    if (pane !== -1) next = removeTab(next, { pane, id });
  }
  return next;
}

/** A tab with no page and no history at all. */
function isBlank(tab: Tab): boolean {
  const { back, current, forward } = tab.history;
  return current === null && back.length === 0 && forward.length === 0;
}

// ---- Pinning (reserved) ----------------------------------------------------

/** Pins a tab: it moves to the end of the pinned ones and cannot be closed. */
export function pinTab(ws: Workspace, { pane, id }: { pane: number; id: TabId }): Workspace {
  return setPinned(ws, { pane, id, pinned: true });
}

/** Unpins a tab: it moves to the front of the unpinned ones. */
export function unpinTab(ws: Workspace, { pane, id }: { pane: number; id: TabId }): Workspace {
  return setPinned(ws, { pane, id, pinned: false });
}

function setPinned(
  ws: Workspace,
  { pane, id, pinned }: { pane: number; id: TabId; pinned: boolean },
): Workspace {
  const tab = findTab(ws, { pane, id });
  if (tab === null || tab.pinned === pinned) return ws;
  const held = ws.panes[pane] as Pane;
  const rest = held.tabs.filter((each) => each.id !== id);
  const at = pinnedCount(rest);
  const tabs = insertAt(rest, { ...tab, pinned }, at);
  return { ...ws, panes: replacePane(ws.panes, pane, { ...held, tabs }) };
}

// ---- Helpers ---------------------------------------------------------------

function hasPane(ws: Workspace, pane: number): boolean {
  return Number.isInteger(pane) && pane >= 0 && pane < ws.panes.length;
}

function findTab(ws: Workspace, { pane, id }: { pane: number; id: TabId }): Tab | null {
  if (!hasPane(ws, pane)) return null;
  return (ws.panes[pane] as Pane).tabs.find((tab) => tab.id === id) ?? null;
}

function activeIndex(pane: Pane): number {
  return pane.tabs.findIndex((tab) => tab.id === pane.active);
}

function activeTabIn(pane: Pane): Tab {
  return pane.tabs[activeIndex(pane)] as Tab;
}

function mintId(ws: Workspace): TabId {
  return `t${ws.nextId}`;
}

function pinnedCount(tabs: readonly Tab[]): number {
  return tabs.filter((tab) => tab.pinned).length;
}

/**
 * Where a tab may land among `tabs` (which do not hold it): a pinned tab among
 * the pinned ones at the front, an unpinned one after them, and never off the ends.
 */
function clampToRun(tabs: readonly Tab[], at: number, pinned: boolean): number {
  const boundary = pinnedCount(tabs);
  const low = pinned ? 0 : boundary;
  const high = pinned ? boundary : tabs.length;
  return Math.min(Math.max(at, low), high);
}

function sameItems<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((item, at) => item === right[at]);
}

function insertAt(tabs: readonly Tab[], tab: Tab, at: number): Tab[] {
  return [...tabs.slice(0, at), tab, ...tabs.slice(at)];
}

function replacePane(panes: readonly Pane[], at: number, pane: Pane): Pane[] {
  return panes.map((held, index) => (index === at ? pane : held));
}

function withTab(pane: Pane, tab: Tab): Pane {
  return { ...pane, tabs: pane.tabs.map((held) => (held.id === tab.id ? tab : held)) };
}
