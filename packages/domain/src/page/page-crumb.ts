import type { VaultPath } from '../vault/vault-path.ts';
import { SIDEBAR_SECTION_LABELS } from '../sidebar/sidebar-section.ts';
import type { SidebarIcon } from '../sidebar/sidebar-icon.ts';
import { typeIcon, viewIcon } from '../sidebar/sidebar-icon.ts';
import { SYSTEM_FOLDER_LABEL } from '../sidebar/sidebar-names.ts';
import { ATLAS_DIRECTORY } from '../vault/vault-visibility.ts';
import { ARCHIVE_DIRECTORY, isArchivedPath } from '../archive/archive.ts';
import type { PageKind } from './page-kind.ts';

/** The breadcrumb's leading part: where the page lives, and its glyph. */
export interface PageCrumb {
  readonly icon: SidebarIcon;
  readonly parent: string;
}

/** What the breadcrumb calls where a source lives. Sources have no sidebar section. */
const SOURCES_LABEL = 'Sources';

/** Where templates are found: the page of that name, which lists them. */
export const TEMPLATES_LABEL = 'Templates';

/**
 * Where a page is, said the way the sidebar says it.
 *
 * A view, a dashboard and a type are found under their sidebar section, not
 * under `.atlas/…` — the system folder is an implementation detail and never
 * shown. A note is found under the folder it sits in, and one at the top of
 * the vault under Pages, which is what the sidebar calls the vault's own files.
 */
export function pageCrumb(page: PageKind, path: VaultPath | null): PageCrumb {
  switch (page.kind) {
    case 'view':
      return { icon: viewIcon(page.layout), parent: SIDEBAR_SECTION_LABELS.views };
    case 'dashboard':
      return { icon: 'chart', parent: SIDEBAR_SECTION_LABELS.dashboards };
    case 'type':
      return { icon: typeIcon(page.typeName), parent: SIDEBAR_SECTION_LABELS.types };
    case 'source':
      return { icon: 'list', parent: SOURCES_LABEL };
    case 'query':
      return { icon: 'table', parent: SIDEBAR_SECTION_LABELS.views };
    case 'template':
      return { icon: 'template', parent: TEMPLATES_LABEL };
    case 'note':
      if (path !== null && isArchivedPath(path)) return ARCHIVE_PLACE;
      return { icon: 'folder', parent: folderOf(path) ?? SIDEBAR_SECTION_LABELS.userSpace };
  }
}

/** Where an archived note is: in the Archive, whatever folder it sits in there. */
const ARCHIVE_PLACE: PageCrumb = { icon: 'archive', parent: ARCHIVE_DIRECTORY };

/** The parts of `.atlas` a person knows by name, and how each is drawn. */
const ATLAS_PLACES: Readonly<Record<string, PageCrumb>> = {
  views: { icon: 'table', parent: SIDEBAR_SECTION_LABELS.views },
  dashboards: { icon: 'chart', parent: SIDEBAR_SECTION_LABELS.dashboards },
  types: { icon: 'system', parent: SIDEBAR_SECTION_LABELS.types },
  templates: { icon: 'template', parent: TEMPLATES_LABEL },
  sources: { icon: 'list', parent: SOURCES_LABEL },
};

/**
 * Where a note is, from its path alone — for a list such as search results,
 * which has each note's path but not its frontmatter. Said the way
 * {@link pageCrumb} says it: never `.atlas/…`, and Pages for the vault's top.
 */
export function placeCrumb(path: VaultPath): PageCrumb {
  const [top, section] = path.split('/');
  if (top === ATLAS_DIRECTORY) {
    return (
      (section === undefined ? undefined : ATLAS_PLACES[section]) ?? {
        icon: 'system',
        parent: SYSTEM_FOLDER_LABEL,
      }
    );
  }
  if (isArchivedPath(path)) return ARCHIVE_PLACE;
  return { icon: 'doc', parent: folderOf(path) ?? SIDEBAR_SECTION_LABELS.userSpace };
}

function folderOf(path: VaultPath | null): string | null {
  if (path === null) return null;
  const parts = path.split('/');
  return parts.length < 2 ? null : (parts.at(-2) ?? null);
}
