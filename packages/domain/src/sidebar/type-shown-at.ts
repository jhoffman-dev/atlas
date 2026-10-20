import type { NavigationPlace } from '../panes/navigation-history.ts';
import type { SavedViewSummary } from './view-tabs.ts';

/**
 * The type a place shows, whose editor the right sidebar offers beside it
 * (slice 12): a type's own page, or one of its saved views. Null for any
 * other place — a note, a page of another kind, an empty tab.
 */
export function typeShownAt(
  place: NavigationPlace | null,
  views: readonly Pick<SavedViewSummary, 'path' | 'type'>[],
): string | null {
  if (place === null) return null;
  if (place.kind === 'type') return place.name;
  if (place.kind !== 'note') return null;
  return views.find((view) => view.path === place.path)?.type ?? null;
}
