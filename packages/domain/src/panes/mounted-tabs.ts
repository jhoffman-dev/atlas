import type { TabId } from './workspace.ts';

/**
 * How many hidden tabs of a pane keep their editor mounted (James's decision
 * on #303): each keeps its own undo while hidden, and the least recently
 * shown is let go once a fifth would be kept.
 */
export const HIDDEN_EDITOR_LIMIT = 4;

/**
 * Which of a pane's tabs stay mounted: the shown one first, then the ones
 * shown most recently before it, up to `limit` of them. A tab that has
 * closed is dropped, since there is nothing left to keep. The same list comes
 * back when nothing changed, so a renderer can skip a draw.
 */
export function keepMounted({
  kept,
  shown,
  present,
  limit = HIDDEN_EDITOR_LIMIT,
}: {
  /** The list as it stood, the shown tab first. */
  kept: readonly TabId[];
  /** The tab now shown. */
  shown: TabId;
  /** The tabs the pane holds now. */
  present: readonly TabId[];
  limit?: number;
}): readonly TabId[] {
  const open = new Set(present);
  const hidden = kept.filter((id) => id !== shown && open.has(id)).slice(0, limit);
  const next = [shown, ...hidden];
  return next.length === kept.length && next.every((id, at) => id === kept[at]) ? kept : next;
}
