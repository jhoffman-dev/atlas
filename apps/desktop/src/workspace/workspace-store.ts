import { createStore, useStore, type StoreApi } from 'zustand';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import {
  activateNth,
  activateTab as activateTabIn,
  activeTabOf,
  closePaneInWorkspace,
  closeTab as closeTabIn,
  EMPTY_WORKSPACE,
  focusPaneInWorkspace,
  followMoveInWorkspace,
  forgetNotesInWorkspace,
  goBackInTab,
  goForwardInTab,
  isVisibleEntry,
  isWorkspaceSplit,
  MAX_PANES,
  newTab as addEmptyTab,
  nextTab as nextTabIn,
  openInActiveTab,
  openInActiveTabOf,
  openInNewTab,
  openInSplit,
  previousTab as previousTabIn,
  reopenClosedTab as reopenClosedTabIn,
  samePlace,
  splitWithTab,
  tabPlace,
  type EntryMove,
  type NavigationHistory,
  type NavigationPlace,
  type Pane,
  type Tab,
  type TabId,
  type VaultPath,
  type Workspace,
} from '@atlas/domain';
import type { OpenHow } from '@atlas/ui';

/**
 * Where a viewer's tabs are remembered, per vault.
 *
 * Per viewer, so not in the vault: how the window is arranged says nothing
 * about the notes, and two people opening the same vault do not owe each
 * other a layout. It is still I/O, so this is a port and the composition
 * root hands over the browser one.
 */
export interface RememberedWorkspaces {
  /** `null` when the vault has no remembered layout, which is not an error. */
  read: (vaultKey: string) => Workspace | null;
  write: (args: { vaultKey: string; workspace: Workspace }) => void;
}

export interface WorkspaceState {
  /** The vault the tabs belong to; null before one is open. */
  readonly vault: string | null;
  readonly workspace: Workspace;
  /**
   * One key per pane, in the panes' order, that stays with the pane while it
   * is open. A pane's place changes when the one before it closes; React keys
   * the panes by these so the pane that is left keeps its editors and typing.
   */
  readonly paneKeys: readonly number[];
  /** The next new pane's key. Never handed out twice. */
  readonly nextPaneKey: number;
  /** Where the tabs are remembered, held here so every change can write itself. */
  readonly remembered: RememberedWorkspaces;
}

/**
 * The window's tabs and panes, held outside `App` (ADR-0040, tab-model.md §3):
 * what draws a strip or a pane's page subscribes to its slice, so a tab
 * switch draws the strip and one pane's content and nothing else. The rules
 * are the domain's (`workspace.ts`); this holds the current workspace, reads
 * the remembered one when a vault opens, and writes every change back.
 */
export type WorkspaceStore = StoreApi<WorkspaceState>;

export function createWorkspaceStore({
  remembered,
}: {
  remembered: RememberedWorkspaces;
}): WorkspaceStore {
  return createStore<WorkspaceState>()(() => ({
    vault: null,
    workspace: EMPTY_WORKSPACE,
    paneKeys: freshKeys(EMPTY_WORKSPACE),
    nextPaneKey: MAX_PANES,
    remembered,
  }));
}

/** A key for each pane of a layout just read; a pane added later is keyed from `MAX_PANES` up. */
const freshKeys = (workspace: Workspace): number[] => workspace.panes.map((_, pane) => pane);

// ---- Reading --------------------------------------------------------------

/** The workspace as it stands, read at the moment it is needed rather than subscribed to. */
export function workspaceNow(store: WorkspaceStore): Workspace {
  return store.getState().workspace;
}

export function usePaneKeys(store: WorkspaceStore): readonly number[] {
  return useStore(store, (state) => state.paneKeys);
}

export function useFocusedPane(store: WorkspaceStore): number {
  return useStore(store, (state) => state.workspace.focused);
}

/** Reference-stable: the pane's own tabs array, which changes only when its tabs do. */
export function usePaneTabs(store: WorkspaceStore, pane: number): readonly Tab[] {
  return useStore(store, (state) => paneAt(state.workspace, pane).tabs);
}

export function useActiveTabId(store: WorkspaceStore, pane: number): TabId {
  return useStore(store, (state) => paneAt(state.workspace, pane).active);
}

/** Reference-stable: the place object the tab's history holds. */
export function useActivePlace(store: WorkspaceStore, pane: number): NavigationPlace | null {
  return useStore(store, (state) => activePlaceOf(paneAt(state.workspace, pane)));
}

export function useTabHistory(
  store: WorkspaceStore,
  { pane, id }: { pane: number; id: TabId },
): NavigationHistory {
  return useStore(store, (state) => historyOf(state.workspace, { pane, id }));
}

/** What the focused pane shows: what the sidebar marks as where you are. */
export function useFocusedPlace(store: WorkspaceStore): NavigationPlace | null {
  return useStore(store, (state) => activePlace(state.workspace));
}

/**
 * The page the focused pane shows, or null while it shows a note. Compared
 * as places, so the app that assembles the pages' props is drawn again for a
 * change of page and not for a switch between notes.
 */
export function useFocusedPage(store: WorkspaceStore): NavigationPlace | null {
  return useStoreWithEqualityFn(
    store,
    (state) => pageOrNull(activePlace(state.workspace)),
    sameOrNull,
  );
}

/**
 * The pages the panes show in their active tabs, the focused pane's first;
 * notes are left out. Compared as places, as `useFocusedPage` is, so the app
 * is drawn for a page coming or going and not for a note.
 */
export function useShownPages(store: WorkspaceStore): readonly NavigationPlace[] {
  return useStoreWithEqualityFn(store, (state) => shownPages(state.workspace), samePlaces);
}

function shownPages(workspace: Workspace): readonly NavigationPlace[] {
  const ordered = [
    workspace.panes[workspace.focused] as Pane,
    ...workspace.panes.filter((_, pane) => pane !== workspace.focused),
  ];
  return ordered.flatMap((pane) => {
    const page = pageOrNull(activePlaceOf(pane));
    return page === null ? [] : [page];
  });
}

const pageOrNull = (place: NavigationPlace | null): NavigationPlace | null =>
  place === null || place.kind === 'note' ? null : place;

const sameOrNull = (left: NavigationPlace | null, right: NavigationPlace | null): boolean =>
  left === null || right === null ? left === right : samePlace(left, right);

const samePlaces = (left: readonly NavigationPlace[], right: readonly NavigationPlace[]) =>
  left.length === right.length &&
  left.every((place, at) => samePlace(place, right[at] as NavigationPlace));

function paneAt(workspace: Workspace, pane: number): Pane {
  // A pane that has just closed is read once more by the render on its way
  // out; an empty pane is what it reads, not an error.
  return workspace.panes[pane] ?? (EMPTY_WORKSPACE.panes[0] as Pane);
}

function activePlaceOf(pane: Pane): NavigationPlace | null {
  const tab = pane.tabs.find((held) => held.id === pane.active);
  return tab === undefined ? null : tabPlace(tab);
}

function activePlace(workspace: Workspace): NavigationPlace | null {
  return tabPlace(activeTabOf(workspace));
}

/** The note the focused pane's shown tab is on, or null while it is on a page or nothing. */
export function focusedNotePath(workspace: Workspace): VaultPath | null {
  const place = activePlace(workspace);
  return place?.kind === 'note' ? place.path : null;
}

const NO_HISTORY_YET: NavigationHistory = { back: [], current: null, forward: [] };

function historyOf(workspace: Workspace, { pane, id }: { pane: number; id: TabId }) {
  return paneAt(workspace, pane).tabs.find((tab) => tab.id === id)?.history ?? NO_HISTORY_YET;
}

// ---- Changing --------------------------------------------------------------

/**
 * Reads the vault's remembered tabs, in the same event as the location
 * change and not in an effect after it: an effect leaves one render with the
 * old vault's paths under the new vault's key, and R14-01 found a race
 * living in exactly that render. Opening the vault already open changes nothing.
 */
export function loadVault(store: WorkspaceStore, vaultKey: string | null): void {
  const state = store.getState();
  if (state.vault === vaultKey) return;
  const workspace =
    vaultKey === null ? EMPTY_WORKSPACE : (state.remembered.read(vaultKey) ?? EMPTY_WORKSPACE);
  store.setState({
    vault: vaultKey,
    workspace,
    paneKeys: freshKeys(workspace),
    nextPaneKey: MAX_PANES,
  });
}

/** Applies a domain change, keys the panes after it, and writes the result. */
function change(store: WorkspaceStore, step: (workspace: Workspace) => Workspace): void {
  const state = store.getState();
  const next = step(state.workspace);
  if (next === state.workspace) return;
  const { paneKeys, nextPaneKey } = keyedAfter(state, next);
  // Outside the state update on purpose: a write belongs to this one event.
  if (state.vault !== null) state.remembered.write({ vaultKey: state.vault, workspace: next });
  store.setState({ workspace: next, paneKeys, nextPaneKey });
}

/**
 * Each pane of `next` keeps the key of the pane of `was` that held its tabs:
 * ids are never reused, so one shared id is proof of the same pane. A pane
 * with no tab from before — a new split, or the fresh tab left by closing the
 * last — gets the next key, and nothing of the old pane is kept for it.
 */
function keyedAfter(
  { workspace: was, paneKeys, nextPaneKey }: WorkspaceState,
  next: Workspace,
): Pick<WorkspaceState, 'paneKeys' | 'nextPaneKey'> {
  if (next.panes === was.panes) return { paneKeys, nextPaneKey };
  let minted = nextPaneKey;
  const keys = next.panes.map((pane) => {
    const ids = new Set(pane.tabs.map((tab) => tab.id));
    const before = was.panes.findIndex((held) => held.tabs.some((tab) => ids.has(tab.id)));
    if (before !== -1) return paneKeys[before] as number;
    minted += 1;
    return minted - 1;
  });
  const unchanged =
    keys.length === paneKeys.length && keys.every((key, at) => key === paneKeys[at]);
  // The same array when no pane came or went, so a tab switch does not draw the panes.
  return { paneKeys: unchanged ? paneKeys : keys, nextPaneKey: minted };
}

/** Opens a place where a click asked for it: here, in a new tab, or in a split. */
export function openPlace(store: WorkspaceStore, place: NavigationPlace, how: OpenHow): void {
  change(store, (ws) => {
    if (how === 'new-tab') return openInNewTab(ws, place);
    if (how === 'split') return openInSplit(ws, place);
    return openInActiveTab(ws, place);
  });
}

/** Opens in one named pane's active tab, which takes the focus: a link followed inside it. */
export function openInPane(
  store: WorkspaceStore,
  { pane, place }: { pane: number; place: NavigationPlace },
): void {
  change(store, (ws) => openInActiveTabOf(ws, { pane, place }));
}

export function activateTab(store: WorkspaceStore, at: { pane: number; id: TabId }): void {
  change(store, (ws) => activateTabIn(ws, at));
}

export function closeTab(store: WorkspaceStore, at: { pane: number; id: TabId }): void {
  change(store, (ws) => closeTabIn(ws, at));
}

/** Closes the focused pane's shown tab: ⌘W. Never the window. */
export function closeActiveTab(store: WorkspaceStore): void {
  change(store, (ws) => closeTabIn(ws, { pane: ws.focused, id: activeTabOf(ws).id }));
}

/** Adds an empty tab at the end of a pane and shows it, the pane taking the focus: its +. */
export function newTabIn(store: WorkspaceStore, pane: number): void {
  change(store, (ws) => addEmptyTab(focusPaneInWorkspace(ws, pane)));
}

export function nextTab(store: WorkspaceStore): void {
  change(store, nextTabIn);
}

export function previousTab(store: WorkspaceStore): void {
  change(store, previousTabIn);
}

export function activateNthTab(store: WorkspaceStore, n: number): void {
  change(store, (ws) => activateNth(ws, n));
}

export function reopenClosedTab(store: WorkspaceStore): void {
  change(store, reopenClosedTabIn);
}

/**
 * Splits, the new pane starting on a copy of a pane's shown tab: the named
 * pane's, which takes the focus as its bar's button is pressed, else the
 * focused pane's.
 */
export function splitPane(store: WorkspaceStore, pane?: number): void {
  change(store, (ws) => splitWithTab(pane === undefined ? ws : focusPaneInWorkspace(ws, pane)));
}

export function closePane(store: WorkspaceStore, pane: number): void {
  change(store, (ws) => closePaneInWorkspace(ws, pane));
}

/** Splits, or closes the focused pane once the window is split: ⇧⌘\. */
export function toggleSplit(store: WorkspaceStore): void {
  change(store, (ws) =>
    isWorkspaceSplit(ws) ? closePaneInWorkspace(ws, ws.focused) : splitWithTab(ws),
  );
}

export function focusPane(store: WorkspaceStore, pane: number): void {
  change(store, (ws) => focusPaneInWorkspace(ws, pane));
}

/** Back in the focused pane's shown tab: ⌘[ and the mouse's back button. */
export function goBack(store: WorkspaceStore): void {
  change(store, goBackInTab);
}

export function goForward(store: WorkspaceStore): void {
  change(store, goForwardInTab);
}

/** Back in a named pane's shown tab, which takes the focus: its bar's own arrow. */
export function goBackIn(store: WorkspaceStore, pane: number): void {
  change(store, (ws) => goBackInTab(focusPaneInWorkspace(ws, pane)));
}

export function goForwardIn(store: WorkspaceStore, pane: number): void {
  change(store, (ws) => goForwardInTab(focusPaneInWorkspace(ws, pane)));
}

/** Follows a move or a rename: every tab on a moved note holds it where it went. */
export function followMove(store: WorkspaceStore, move: EntryMove): void {
  change(store, (ws) => followMoveInWorkspace(ws, move));
}

/** Forgets notes that are gone from every tab's page and history. */
export function closeNotes(store: WorkspaceStore, paths: readonly VaultPath[]): void {
  const gone = new Set<string>(paths);
  change(store, (ws) => forgetNotesInWorkspace(ws, (path) => gone.has(path)));
}

/**
 * Forgets every note the vault's listing does not have: the notes in user
 * space as listed once the vault opens, against tabs remembered from the
 * last launch. A tab on a note deleted while the app was closed opens on
 * nothing rather than on a read error, under the same rules a delete in the
 * app follows. A note the listing never covers — a view, a dashboard, a
 * template under `.atlas` — is not judged by it.
 */
export function keepNotes(store: WorkspaceStore, listed: readonly VaultPath[]): void {
  const kept = new Set<string>(listed);
  const covered = (path: VaultPath) =>
    isVisibleEntry({ kind: 'file', name: path.split('/').at(-1) ?? path, path });
  change(store, (ws) => forgetNotesInWorkspace(ws, (path) => covered(path) && !kept.has(path)));
}
