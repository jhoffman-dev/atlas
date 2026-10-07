/**
 * The sidebar's five sections.
 *
 * Peers, in this order, rather than views and dashboards nested under types or
 * folded into one another: each answers a different question about the vault,
 * and the point of the sidebar is that all five can be found without knowing
 * where anything lives on disk.
 */
export type SidebarSectionId = 'favorites' | 'types' | 'views' | 'dashboards' | 'userSpace';

export interface SidebarSection {
  readonly id: SidebarSectionId;
  readonly label: string;
}

/** Every section has a name, and the type says so. */
export const SIDEBAR_SECTION_LABELS: Readonly<Record<SidebarSectionId, string>> = {
  favorites: 'Favorites',
  types: 'Types',
  views: 'Views',
  dashboards: 'Dashboards',
  userSpace: 'Pages',
};

const ORDER: readonly SidebarSectionId[] = [
  'favorites',
  'types',
  'views',
  'dashboards',
  'userSpace',
];

export const SIDEBAR_SECTIONS: readonly SidebarSection[] = ORDER.map((id) => ({
  id,
  label: SIDEBAR_SECTION_LABELS[id],
}));

const IDS: ReadonlySet<string> = new Set(ORDER);

export function isSidebarSectionId(value: unknown): value is SidebarSectionId {
  return typeof value === 'string' && IDS.has(value);
}

/**
 * Which sections a viewer has collapsed, out of whatever was remembered.
 *
 * Collapsed rather than expanded is stored, so a section added in a later
 * version shows up open instead of hidden behind a setting nobody set. Anything
 * unrecognised is dropped: this is a convenience, and a stale or hand-edited
 * value should cost nothing more than an open section.
 */
export function parseCollapsedSections(remembered: unknown): SidebarSectionId[] {
  if (!Array.isArray(remembered)) return [];
  return [...new Set(remembered.filter(isSidebarSectionId))];
}
