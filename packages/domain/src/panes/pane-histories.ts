import type { VaultPath } from '../vault/vault-path.ts';
import { forgetNotes, NO_HISTORY, type NavigationHistory } from './navigation-history.ts';
import { MAX_PANES, type PaneLayout } from './pane-layout.ts';

/**
 * Each pane's Back and Forward, one per pane in the order the panes are drawn.
 *
 * These follow the layout's own rules step for step — `closePane`,
 * `closeInPanes`, `splitFocused` — so the history drawn on a pane is always
 * that pane's, never the one that used to sit where it now is.
 */
export type PaneHistories = readonly NavigationHistory[];

/** One empty history per pane of a layout: a vault just opened. */
export function freshHistories(layout: PaneLayout): PaneHistories {
  return layout.paths.map(() => NO_HISTORY);
}

/** A pane's history, or an empty one for a pane that has none yet. */
export function historyOf(histories: PaneHistories, pane: number): NavigationHistory {
  return histories[pane] ?? NO_HISTORY;
}

/** Replaces one pane's history, adding empty ones before it if they are missing. */
export function withHistory(
  histories: PaneHistories,
  { pane, history }: { pane: number; history: NavigationHistory },
): PaneHistories {
  if (historyOf(histories, pane) === history) return histories;
  const next = Array.from({ length: Math.max(histories.length, pane + 1) }, (_, at) =>
    historyOf(histories, at),
  );
  next[pane] = history;
  return next;
}

/** A split's new pane starts with a history of its own, as a new tab does. */
export function splitHistories(histories: PaneHistories, layout: PaneLayout): PaneHistories {
  if (layout.paths.length >= MAX_PANES) return histories;
  return [...layout.paths.map((_, pane) => historyOf(histories, pane)), NO_HISTORY];
}

/** The pane that closes takes its history with it; the last pane is never closed. */
export function closePaneHistory(histories: PaneHistories, pane: number): PaneHistories {
  if (histories.length <= 1 || pane < 0 || pane >= histories.length) return histories;
  return histories.filter((_, at) => at !== pane);
}

/**
 * After a delete: a pane `closeInPanes` closes takes its history with it, and
 * every history left forgets the notes that are gone. When every pane held a
 * deleted note, the one pane left keeps the focused pane's history — Back from
 * the empty pane goes where that pane had been.
 */
export function closeInPaneHistories(
  histories: PaneHistories,
  { layout, gone }: { layout: PaneLayout; gone: (path: VaultPath) => boolean },
): PaneHistories {
  const holdsGone = (held: VaultPath | null) => held !== null && gone(held);
  const survivors = layout.paths.some(holdsGone)
    ? layout.paths.flatMap((held, pane) => (holdsGone(held) ? [] : [historyOf(histories, pane)]))
    : layout.paths.map((_, pane) => historyOf(histories, pane));
  const kept = survivors.length > 0 ? survivors : [historyOf(histories, layout.focused)];
  return kept.map((history) => forgetNotes(history, gone));
}
