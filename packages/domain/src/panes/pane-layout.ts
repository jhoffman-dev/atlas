import { createVaultPath, type VaultPath } from '../vault/vault-path.ts';
import { movedPath, type EntryMove } from '../vault/vault-moves.ts';

/**
 * How the window is split, and which half a click lands in.
 *
 * Two panes rather than a tree of them: the point of the feature is a board
 * beside the note you are working on, and every further split costs the reading
 * width that made the note worth opening. Growing this to three is a change to
 * `MAX_PANES` and the grid; nothing here counts to two.
 */
export interface PaneLayout {
  /** One entry per pane, in the order they are drawn. Never empty. */
  readonly paths: readonly (VaultPath | null)[];
  /** The pane an open from outside a pane lands in. Always a pane that exists. */
  readonly focused: number;
}

export const MAX_PANES = 2;

/** One pane, holding nothing: a first run, and what closing back down leaves. */
export const SINGLE_PANE: PaneLayout = { paths: [null], focused: 0 };

export function isSplit(layout: PaneLayout): boolean {
  return layout.paths.length > 1;
}

/**
 * Whether there is room for another pane — what decides that a pane offers
 * "Split right" at all, so the button and the menu item come and go together.
 */
export function canSplit(layout: PaneLayout): boolean {
  return layout.paths.length < MAX_PANES;
}

/**
 * Whether a pane can be closed: only while there is another to be left with,
 * since an app with no pane has nowhere to put the next note opened.
 */
export function canClosePane(layout: PaneLayout): boolean {
  return layout.paths.length > 1;
}

/** Whether a pane exists to be focused, closed or drawn. */
function hasPane(layout: PaneLayout, pane: number): boolean {
  return Number.isInteger(pane) && pane >= 0 && pane < layout.paths.length;
}

/**
 * Opens a note in the focused pane.
 *
 * Every open from outside a pane — a link, a search hit, a sidebar row, a board
 * card — comes through here, which is what makes "it opens where I am" one rule
 * rather than a decision taken again at each call site.
 */
export function openInFocused(layout: PaneLayout, path: VaultPath | null): PaneLayout {
  return {
    ...layout,
    paths: layout.paths.map((held, pane) => (pane === layout.focused ? path : held)),
  };
}

/**
 * Opens a note in a named pane, and leaves the focus there: opening inside a
 * pane is also a statement about where you are working.
 *
 * A pane that is not there is refused, rather than opened somewhere else. This
 * is one function in the domain instead of `openInFocused(focusPane(…), …)` at
 * each call site, because that composition quietly opens in the focused pane —
 * focusing a pane that has since closed is a no-op — so a link click queued in
 * a pane that closed replaces the note you are actually reading.
 */
export function openInPane(
  layout: PaneLayout,
  { pane, path }: { pane: number; path: VaultPath | null },
): PaneLayout {
  if (!hasPane(layout, pane)) return layout;
  return {
    paths: layout.paths.map((held, index) => (index === pane ? path : held)),
    focused: pane,
  };
}

/**
 * Splits, giving the new pane the note the focused one holds, and the focus.
 *
 * Starting the new pane on the same note is what makes a split useful straight
 * away: you split, then open something else on one side and compare. Splitting
 * an already-split window is a no-op rather than an error — the control is
 * hidden by then, but a keyboard shortcut is not.
 */
export function splitFocused(layout: PaneLayout): PaneLayout {
  if (!canSplit(layout)) return layout;
  const held = layout.paths[layout.focused] ?? null;
  return { paths: [...layout.paths, held], focused: layout.paths.length };
}

/**
 * Splits a named pane — its own Split button — as `splitFocused` splits the
 * focused one. A pane that is not there splits nothing, rather than another.
 */
export function splitPane(layout: PaneLayout, pane: number): PaneLayout {
  if (!hasPane(layout, pane) || !canSplit(layout)) return layout;
  return splitFocused({ ...layout, focused: pane });
}

/**
 * Opens a note beside the one being read — Cmd-click from the graph: in the
 * other pane if the window is split, otherwise in a new one. The note being
 * read stays where it is, which is the point of asking for "beside".
 */
export function openBeside(layout: PaneLayout, path: VaultPath): PaneLayout {
  if (!isSplit(layout)) return openInFocused(splitFocused(layout), path);
  const other = layout.focused === 0 ? 1 : 0;
  return openInPane(layout, { pane: other, path });
}

/**
 * Closes a pane, leaving the other one holding what it held.
 *
 * The last pane cannot be closed: an app with no pane at all has nowhere to put
 * the next note that is opened.
 */
export function closePane(layout: PaneLayout, pane: number): PaneLayout {
  if (!hasPane(layout, pane) || !canClosePane(layout)) return layout;
  const paths = layout.paths.filter((_, index) => index !== pane);
  // Closing a pane before the focused one shifts it left by one; closing the
  // focused pane itself leaves the index pointing at what slid into its place,
  // which is only out of range when it was the last. `Math.min` alone happens
  // to be right for two panes and wrong for three — it would move the focus to
  // a different note.
  const focused = layout.focused > pane ? layout.focused - 1 : layout.focused;
  return { paths, focused: Math.min(focused, paths.length - 1) };
}

export function focusPane(layout: PaneLayout, pane: number): PaneLayout {
  if (!hasPane(layout, pane) || pane === layout.focused) return layout;
  return { ...layout, focused: pane };
}

/**
 * Follows a move or a rename: a pane holding a moved note now holds it where
 * it went, and a folder's move takes every note under it along.
 *
 * Both panes can be on the note being moved, and a pane left pointing at a
 * path that no longer exists would show a read error rather than the note the
 * person just moved.
 */
export function moveInPanes(layout: PaneLayout, move: EntryMove): PaneLayout {
  return {
    ...layout,
    paths: layout.paths.map((held) => (held === null ? null : (movedPath(held, move) ?? held))),
  };
}

/**
 * Closes whatever holds a note that is gone, after a delete.
 *
 * In a split, a pane on a deleted note closes and the other is left; a pane
 * that is the only one, or both panes on deleted notes, leaves one empty pane.
 * The focus stays on a pane that is still there.
 */
export function closeInPanes(layout: PaneLayout, gone: (path: VaultPath) => boolean): PaneLayout {
  const holdsGone = (held: VaultPath | null) => held !== null && gone(held);
  if (!layout.paths.some(holdsGone)) return layout;
  const kept = layout.paths.filter((held) => !holdsGone(held));
  if (kept.length === 0) return SINGLE_PANE;
  const focusedHeld = layout.paths[layout.focused] ?? null;
  const focused = holdsGone(focusedHeld) ? 0 : kept.indexOf(focusedHeld);
  return { paths: kept, focused: Math.max(0, focused) };
}

/** A path that came back from storage, or null if it is not one. */
function readPath(value: unknown): VaultPath | null {
  if (typeof value !== 'string' || value === '') return null;
  try {
    return createVaultPath(value);
  } catch {
    // A hand-edited or stale path that no longer parses costs an empty pane,
    // which is what a first run shows anyway.
    return null;
  }
}

/**
 * The split remembered for a vault, out of whatever was stored.
 *
 * Only for the vault it was remembered against: the paths are relative to a
 * vault, and restoring one vault's split into another would open two panes on
 * notes that are not there. Anything unrecognised reads as nothing remembered,
 * because a split is a convenience and a stale one should cost a single pane
 * rather than an error.
 */
export function parseRememberedPanes(remembered: unknown, vaultKey: string): PaneLayout | null {
  if (typeof remembered !== 'object' || remembered === null) return null;
  const record = remembered as { vault?: unknown; paths?: unknown; focused?: unknown };
  if (record.vault !== vaultKey) return null;
  if (!Array.isArray(record.paths) || record.paths.length === 0) return null;

  // `Array.from` rather than `map`, which preserves a hole: a hole is neither a
  // path nor null, so `focused` could name a pane that is not there, and every
  // later open would be skipped by the same hole rather than shown.
  const paths = Array.from(record.paths.slice(0, MAX_PANES), readPath);
  const focused = typeof record.focused === 'number' ? record.focused : 0;
  return {
    paths,
    focused: Number.isInteger(focused) && focused >= 0 && focused < paths.length ? focused : 0,
  };
}

/** The split as it goes into storage, against the vault it belongs to. */
export function rememberPanes({ layout, vaultKey }: { layout: PaneLayout; vaultKey: string }): {
  vault: string;
  paths: (string | null)[];
  focused: number;
} {
  return { vault: vaultKey, paths: layout.paths.map((held) => held), focused: layout.focused };
}
