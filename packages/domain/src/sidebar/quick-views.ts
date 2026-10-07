import type { SidebarEntry } from './sidebar-entry.ts';

/** The saved views the sidebar lifts out of Views and puts at the top. */
export type QuickViewId = 'today' | 'inbox';

/** A quick view that exists in this vault, and the view it opens. */
export interface QuickView {
  readonly id: QuickViewId;
  readonly entry: SidebarEntry;
}

/** Recognised by title, in the order they are shown. */
const QUICK_VIEW_TITLES: readonly (readonly [QuickViewId, string])[] = [
  ['today', 'today'],
  ['inbox', 'inbox'],
];

/**
 * Today and Inbox, if the vault has views by those names.
 *
 * Found by title rather than configured, because they are ordinary views: a
 * vault that has none gets no row, rather than a row that opens nothing. Where
 * two views share a title, the first in sidebar order wins, so the choice is
 * the same every time.
 */
export function findQuickViews(views: readonly SidebarEntry[]): QuickView[] {
  return QUICK_VIEW_TITLES.flatMap(([id, title]) => {
    const entry = views.find((view) => view.title.trim().toLowerCase() === title);
    return entry === undefined ? [] : [{ id, entry }];
  });
}
