import { typeIcon, type SidebarIcon } from '../sidebar/sidebar-icon.ts';
import type { ObjectType } from './property-def.ts';

/**
 * The glyphs a type may choose for itself: the sidebar's own set, less the
 * system folder's, which means "Atlas's files" and would be a lie on a type.
 */
export const TYPE_ICONS: readonly SidebarIcon[] = [
  'doc',
  'task',
  'person',
  'company',
  'event',
  'folder',
  'table',
  'board',
  'list',
  'grid',
  'calendar',
  'timeline',
  'chart',
  'artifact',
];

/** The icon a type is drawn with: the one it chose, else a guess from its name. */
export function objectTypeIcon(type: Pick<ObjectType, 'name' | 'icon'>): SidebarIcon {
  return type.icon ?? typeIcon(type.name);
}
