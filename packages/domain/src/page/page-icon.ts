import type { SidebarIcon } from '../sidebar/sidebar-icon.ts';
import { typeIcon, viewIcon } from '../sidebar/sidebar-icon.ts';
import type { PageKind } from './page-kind.ts';

/**
 * The glyph on a page's icon tile — the same one its row carries in the
 * sidebar, so a page is recognised by the same picture in both places.
 */
export function pageIcon(page: PageKind): SidebarIcon {
  switch (page.kind) {
    case 'note':
      return page.typeName === null ? 'doc' : typeIcon(page.typeName);
    case 'view':
      return viewIcon(page.layout);
    case 'dashboard':
      return 'chart';
    case 'source':
      return 'list';
    case 'type':
      return typeIcon(page.typeName);
    case 'query':
      return 'table';
    case 'template':
      return 'template';
  }
}
