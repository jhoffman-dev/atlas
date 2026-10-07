import { pageTitle, type PageTitleSource } from '../page/page-title.ts';
import {
  parseQueryView,
  parseSavedView,
  parseViewDisplay,
  queryViewLayout,
  type ViewLayout,
} from '../query/saved-view.ts';
import type { ViewQuery } from '../query/view-query.ts';
import type { ObjectType } from '../types/property-def.ts';
import { noteTitle } from '../vault/vault-entry.ts';
import type { VaultPath } from '../vault/vault-path.ts';
import { viewIcon, type SidebarIcon } from './sidebar-icon.ts';
import { compareViewPlaces, defaultViewTab, typeViews, viewOrderOf } from './type-views.ts';

/** What the tabs need to know about a saved view: what it lists, and how. */
export interface SavedViewSummary {
  readonly path: VaultPath;
  readonly title: string;
  /** The type whose notes it lists. */
  readonly type: string;
  readonly layout: ViewLayout;
  /** What it asks, so a dashboard widget can start from the same question. */
  readonly query: ViewQuery;
  /** Its place among its type's tabs (`order:`), or null when it was never placed. */
  readonly order: number | null;
  /** Where its title came from: its `title` property, or its file name. */
  readonly titleSource: PageTitleSource;
}

/** A view's note read as a summary, or null when the note is not a view. */
export function savedViewSummary(
  path: VaultPath,
  frontmatter: Readonly<Record<string, unknown>>,
): SavedViewSummary | null {
  const query = parseSavedView(frontmatter);
  if (query === null) return null;
  const title = pageTitle({ fileTitle: noteTitle(path), properties: frontmatter });
  return {
    path,
    title: title.text,
    type: query.type,
    layout: parseViewDisplay(frontmatter).layout,
    query,
    order: viewOrderOf(frontmatter),
    titleSource: title.source,
  };
}

/** What the tabs need to know about a query view (ADR-0019): where it is, and how it draws. */
export interface QueryViewSummary {
  readonly path: VaultPath;
  readonly title: string;
  readonly layout: ViewLayout;
}

/** A query view's note read as a summary, or null when the note is not one. */
export function queryViewSummary(
  path: VaultPath,
  frontmatter: Readonly<Record<string, unknown>>,
): QueryViewSummary | null {
  if (parseQueryView(frontmatter) === null) return null;
  return {
    path,
    title: pageTitle({ fileTitle: noteTitle(path), properties: frontmatter }).text,
    layout: queryViewLayout(frontmatter),
  };
}

/** One tab over a page's view: another way of looking at the same notes. */
export interface ViewTab {
  readonly path: VaultPath;
  readonly title: string;
  readonly icon: SidebarIcon;
  /** The view this page is. */
  readonly selected: boolean;
  /** A type's default table, shown while the type has no views: not a file yet. */
  readonly virtual: boolean;
  /** It can be dragged, or moved with Alt+arrows, to another place: a type's view among others. */
  readonly movable: boolean;
  /** It is a file of a type's that its tabs can delete. */
  readonly deletable: boolean;
}

/**
 * The tabs across a view's head: every saved view over the same type as this
 * one, this one among them (Notion's model — a type has views, and the tabs
 * switch between them), in the type's order (`typeViews`).
 *
 * A view the catalogue has not read yet — the index is still opening — still
 * gets its own tab, so the row never disappears under the page that asked.
 */
export function viewTabs({
  views,
  current,
}: {
  views: readonly SavedViewSummary[];
  current: SavedViewSummary;
}): ViewTab[] {
  // The page's own reading goes last, so it wins over the catalogue's older one.
  const owned = typeViews([...views, current], current.type);
  return owned.map((view) => typeTabOf(view, current.path, owned.length));
}

/**
 * The tabs across a type's own page — the generated table of its notes. A
 * type with no views shows its default table as its one tab, selected and not
 * yet a file (ADR-0023). A type with views is reached here only by Back, since
 * a click on it lands on a view: every view it owns, none of them selected.
 */
export function typePageTabs({
  views,
  type,
  takenPaths,
}: {
  views: readonly SavedViewSummary[];
  type: Pick<ObjectType, 'name' | 'label'>;
  takenPaths: readonly string[];
}): ViewTab[] {
  const owned = typeViews(views, type.name);
  if (owned.length === 0) return [defaultViewTab({ type, takenPaths })];
  return owned.map((view) => typeTabOf(view, null, owned.length));
}

/** One of a type's own tabs: each can be deleted, and moved once there is another. */
function typeTabOf(view: TabSource, current: VaultPath | null, count: number): ViewTab {
  return { ...tabOf(view, current), movable: count > 1, deletable: true };
}

type TabSource = { path: VaultPath; title: string; layout: ViewLayout };

function tabOf(view: TabSource, current: VaultPath | null): ViewTab {
  return {
    path: view.path,
    title: view.title,
    icon: viewIcon(view.layout),
    selected: view.path === current,
    virtual: false,
    movable: false,
    deletable: false,
  };
}

/**
 * The tabs across a query view's head: every saved query, this one among them.
 * A query is not over one type, so its tabs are the other queries — the shelf
 * of questions kept, as the sidebar lists them. They are not a type's, so they
 * are not moved or placed.
 */
export function queryViewTabs({
  views,
  current,
}: {
  views: readonly QueryViewSummary[];
  current: QueryViewSummary;
}): ViewTab[] {
  return tabsOf([...views, current], current.path);
}

function tabsOf(
  views: readonly { path: VaultPath; title: string; layout: ViewLayout }[],
  current: VaultPath,
): ViewTab[] {
  const byPath = new Map(views.map((view) => [view.path, view]));
  // Never placed, so they read the way a type's unplaced tabs do.
  return [...byPath.values()]
    .map((view) => ({ ...view, type: '', order: null }))
    .sort(compareViewPlaces)
    .map((view) => tabOf(view, current));
}
