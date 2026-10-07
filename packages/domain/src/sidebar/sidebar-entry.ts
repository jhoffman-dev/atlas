import { isDashboard } from '../dashboard/dashboard.ts';
import { isFavorite } from '../favorites/favorite.ts';
import { isSavedView, parseViewDisplay } from '../query/saved-view.ts';
import { compareNames } from '../vault/name-order.ts';
import { noteTitle } from '../vault/vault-entry.ts';
import type { VaultPath } from '../vault/vault-path.ts';
import { viewIcon, type SidebarIcon } from './sidebar-icon.ts';

/** One note in a sidebar section: what to show, what to open, and its icon. */
export interface SidebarEntry {
  readonly path: VaultPath;
  readonly title: string;
  readonly icon: SidebarIcon;
}

/** An entry named by its page's title when that is known, and by its filename when not. */
export function sidebarEntry(
  path: VaultPath,
  icon: SidebarIcon = 'doc',
  title: string = noteTitle(path),
): SidebarEntry {
  return { path, title, icon };
}

/**
 * Alphabetical, with any note listed once.
 *
 * Ordering is alphabetical and nothing else: a favourite you set by hand has no
 * position to remember, and a manual order is a second thing to keep in step
 * with the files. If that turns out to be annoying in use, it is the moment to
 * add one — not before.
 *
 * The same note can arrive twice because the sections are built from two
 * sources: the index, which knows the vault, and `.atlas`, which the index does
 * not read.
 */
export function orderSidebarEntries(entries: readonly SidebarEntry[]): SidebarEntry[] {
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  return [...byPath.values()].sort(
    (left, right) => compareNames(left.title, right.title) || compareNames(left.path, right.path),
  );
}

/** Which of the derived sections a note belongs in, if any. */
export type SidebarMark = 'view' | 'dashboard';

/**
 * What a note's frontmatter says about where it belongs.
 *
 * Every section is derived from the note itself rather than from where it sits,
 * so a view is a view wherever it is kept and there is never a second list to
 * keep in step.
 */
export function classifySidebarNote(frontmatter: Readonly<Record<string, unknown>>): {
  readonly mark: SidebarMark | null;
  readonly favorite: boolean;
  /** What the note is drawn with, wherever it is listed — a starred view looks like a view. */
  readonly icon: SidebarIcon;
} {
  const mark = isSavedView(frontmatter) ? 'view' : isDashboard(frontmatter) ? 'dashboard' : null;
  return { mark, favorite: isFavorite(frontmatter), icon: markIcon(mark, frontmatter) };
}

function markIcon(
  mark: SidebarMark | null,
  frontmatter: Readonly<Record<string, unknown>>,
): SidebarIcon {
  if (mark === 'view') return viewIcon(parseViewDisplay(frontmatter).layout);
  return mark === 'dashboard' ? 'chart' : 'doc';
}
