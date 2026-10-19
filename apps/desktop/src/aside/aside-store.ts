import { createStore, useStore, type StoreApi } from 'zustand';
import type { NavigationPlace, TabId, VaultPath } from '@atlas/domain';
import type { AsideTab } from '@atlas/ui';

/** What a viewer last left the right sidebar as, for one vault. */
export interface RememberedAside {
  readonly open: boolean;
  readonly tab: AsideTab;
}

/**
 * Where the aside's state is remembered, per vault. Per viewer and so not in
 * the vault, as the tabs are (`RememberedWorkspaces`); it is still I/O, so
 * this is a port and the composition root hands over the browser one.
 */
export interface RememberedAsides {
  /** `null` when the vault has nothing remembered, which is not an error. */
  read: (vaultKey: string) => RememberedAside | null;
  write: (args: { vaultKey: string; aside: RememberedAside }) => void;
}

/**
 * The row last focused in a tab's table, and the page it was focused on: a
 * tab that has since moved on to another page is not showing that row.
 */
export interface FocusedRow {
  readonly path: VaultPath;
  /** What `withinOf` names the page the table is on. */
  readonly within: string;
}

export interface AsideState {
  /** The vault the state belongs to; null before one is open. */
  readonly vault: string | null;
  readonly open: boolean;
  readonly tab: AsideTab;
  /** Folded by a narrow window (collapse.ts), whatever `open` remembers. */
  readonly folded: boolean;
  readonly rows: ReadonlyMap<TabId, FocusedRow>;
  readonly remembered: RememberedAsides;
}

/**
 * What names the page a table is on, for a focused row to be held against:
 * a note's path (a view in a note), a type's name (its table), else the page
 * kind. Null for an empty tab, which no table is on.
 */
export function withinOf(place: NavigationPlace): string;
export function withinOf(place: NavigationPlace | null): string | null;
export function withinOf(place: NavigationPlace | null): string | null {
  if (place === null) return null;
  if (place.kind === 'note') return place.path;
  if (place.kind === 'type') return `type:${place.name}`;
  return place.kind;
}

/** A first run: shut, on Properties, so a vault opens as it did before there was an aside. */
const FRESH: RememberedAside = { open: false, tab: 'properties' };

/**
 * The right sidebar's state, held outside `App` (ADR-0040) so what draws it
 * subscribes to its slice: the toggle button reads `open`, the aside reads
 * its tab and the focused row of the tab it follows, and a tick on Today,
 * which changes none of them, draws neither. Open and tab are remembered per
 * vault; the focused rows are the window's.
 */
export type AsideStore = StoreApi<AsideState>;

export function createAsideStore({ remembered }: { remembered: RememberedAsides }): AsideStore {
  return createStore<AsideState>()(() => ({
    vault: null,
    ...FRESH,
    folded: false,
    rows: new Map(),
    remembered,
  }));
}

// ---- Reading --------------------------------------------------------------

export function useAsideOpen(store: AsideStore): boolean {
  return useStore(store, (state) => state.open);
}

export function useAsideTab(store: AsideStore): AsideTab {
  return useStore(store, (state) => state.tab);
}

/** Whether the aside is on screen: open by the viewer's choice and not folded by the window. */
export function useAsideShown(store: AsideStore): boolean {
  return useStore(store, asideShown);
}

export const asideShown = (state: AsideState): boolean => state.open && !state.folded;

/** The row `tab` holds while the tab is still on the page it was focused on, read outside a render. */
export function focusedRowOf(
  state: AsideState,
  { tab, within }: { tab: TabId; within: string | null },
): VaultPath | null {
  const row = state.rows.get(tab);
  return row !== undefined && row.within === within ? row.path : null;
}

/** Whether the chat is on screen: the aside open on its Claude tab. */
export function useClaudeShown(store: AsideStore): boolean {
  return useStore(store, claudeShown);
}

const claudeShown = (state: AsideState): boolean => state.open && state.tab === 'claude';

/** The row focused in `tab`'s table while the tab is still on the page it was focused on. */
export function useFocusedRow(
  store: AsideStore,
  { tab, within }: { tab: TabId; within: string | null },
): VaultPath | null {
  return useStore(store, (state) => focusedRowOf(state, { tab, within }));
}

// ---- Changing --------------------------------------------------------------

/**
 * Reads the vault's remembered state, in the same event as the location
 * change (as the tabs are read): the next render is already that vault's.
 * The focused rows go with the old vault's tabs. Opening the vault already
 * open changes nothing.
 */
export function loadVaultAside(store: AsideStore, vaultKey: string | null): void {
  const state = store.getState();
  if (state.vault === vaultKey) return;
  const read = vaultKey === null ? null : state.remembered.read(vaultKey);
  store.setState({ vault: vaultKey, ...(read ?? FRESH), rows: new Map() });
}

export function toggleAside(store: AsideStore): void {
  remember(store, { open: !store.getState().open });
}

/** Told by the app as the window folds the aside or makes room for it again. */
export function setAsideFolded(store: AsideStore, folded: boolean): void {
  if (store.getState().folded !== folded) store.setState({ folded });
}

export function hideAside(store: AsideStore): void {
  remember(store, { open: false });
}

/** Opens the aside on `tab`, or only shows the tab when it is open already. */
export function showAsideTab(store: AsideStore, tab: AsideTab): void {
  remember(store, { open: true, tab });
}

/** A tab clicked in the open aside, or the one it fell back to as a panel went. */
export function selectAsideTab(store: AsideStore, tab: AsideTab): void {
  remember(store, { tab });
}

/** ⌘J: Claude comes up in the aside, or the aside goes when it is on Claude. */
export function toggleClaude(store: AsideStore): void {
  if (claudeShown(store.getState())) hideAside(store);
  else showAsideTab(store, 'claude');
}

/** Said by a table as the focus lands on one of its rows. */
export function focusRow(
  store: AsideStore,
  { tab, path, within }: { tab: TabId; path: VaultPath; within: string },
): void {
  const { rows } = store.getState();
  const held = rows.get(tab);
  if (held !== undefined && held.path === path && held.within === within) return;
  store.setState({ rows: new Map(rows).set(tab, { path, within }) });
}

/** The row `tab` held, let go: its table lost the focus to the page around it, or the tab closed. */
export function clearRow(store: AsideStore, tab: TabId): void {
  const { rows } = store.getState();
  if (!rows.has(tab)) return;
  const next = new Map(rows);
  next.delete(tab);
  store.setState({ rows: next });
}

function remember(store: AsideStore, change: Partial<RememberedAside>): void {
  const state = store.getState();
  const next = { open: change.open ?? state.open, tab: change.tab ?? state.tab };
  if (next.open === state.open && next.tab === state.tab) return;
  store.setState(next);
  if (state.vault !== null) state.remembered.write({ vaultKey: state.vault, aside: next });
}
