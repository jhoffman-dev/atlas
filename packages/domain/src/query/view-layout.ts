import type { ObjectType, PropertyDef } from '../types/property-def.ts';
import { groupableProperties, layoutProblem } from './new-view.ts';
import { VIEW_LAYOUTS, type ViewDisplay, type ViewLayout } from './saved-view.ts';
import type { ViewEdits } from './view-edits.ts';
import type { ViewQuery } from './view-query.ts';

/** One entry in the Layout menu: whether the view can be drawn this way, and if not why. */
export interface LayoutChoice {
  readonly layout: ViewLayout;
  readonly available: boolean;
  /** Why it cannot be chosen, in words for the menu. Null when it can. */
  readonly reason: string | null;
}

/**
 * Every layout, in menu order, and whether this type can draw it — by the
 * same rule the New view dialog uses (`layoutProblem`), so the two never
 * disagree about what a type can be drawn as.
 */
export function layoutChoices(type: ObjectType): LayoutChoice[] {
  return VIEW_LAYOUTS.map((layout) => {
    const reason = layoutProblem(layout, type);
    return { layout, available: reason === null, reason };
  });
}

/** Which setting a layout that needs a property reads it from, and which properties fit. */
const NEEDS: Partial<
  Record<
    ViewLayout,
    { key: 'groupBy' | 'dateKey' | 'startKey'; fits: (type: ObjectType) => PropertyDef[] }
  >
> = {
  board: { key: 'groupBy', fits: groupableProperties },
  calendar: { key: 'dateKey', fits: (type) => type.properties.filter(isDate) },
  timeline: { key: 'startKey', fits: (type) => type.properties.filter(isDate) },
};

function isDate(property: PropertyDef): boolean {
  return property.kind === 'date';
}

/**
 * The view edit that draws it as `layout`, or null when the type cannot be
 * drawn that way.
 *
 * A board with nothing to group by, or a calendar with no date, would fall
 * back to a table the moment it was chosen — so the layout comes with the
 * property it needs: the one the view already names when that still fits,
 * else the status for a board, else the first that fits.
 */
export function layoutChange({
  layout,
  display,
  type,
  statusKey = null,
}: {
  layout: ViewLayout;
  display: ViewDisplay;
  type: ObjectType;
  /** The property a tick writes, which a board groups by when it can. */
  statusKey?: string | null;
}): ViewEdits | null {
  if (layoutProblem(layout, type) !== null) return null;
  const need = NEEDS[layout];
  if (need === undefined) return { layout };

  const fits = need.fits(type).map((property) => property.key);
  const chosen = [display[need.key], layout === 'board' ? statusKey : null, fits[0]].find(
    (key): key is string => key !== null && key !== undefined && fits.includes(key),
  );
  return chosen === undefined ? null : { layout, [need.key]: chosen };
}

/** The layouts that draw a view's groups. */
const GROUPING_LAYOUTS: readonly ViewLayout[] = ['table', 'board', 'gallery'];

/** Whether a layout draws the groups its view's `groupBy` makes: a table, a board, a gallery. */
export function drawsGroups(layout: ViewLayout): boolean {
  return GROUPING_LAYOUTS.includes(layout);
}

/** The column the index adds to every type's view: when the file last changed. */
export const MODIFIED_COLUMN = 'modified';

/**
 * The query as a layout runs it — the saved one, with what the layout needs
 * that the view's columns may not ask for.
 *
 * The status joins the columns whenever notes can be ticked done, because a
 * checkbox has to know whether it is ticked; it is `hidden`, so a table does
 * not grow a column nobody chose. A feed or a gallery also reads, hidden, when
 * each note last changed, so its previews are read again only for notes that
 * did. A calendar that spans notes to an end reads that end, hidden, so a
 * week can draw how long each note runs. A grouped layout reads what it groups
 * by, hidden, so a grouping need not be a shown column. A feed with no sort of its own reads newest first. The saved query is never changed: the Sort control still shows what
 * the view asks for.
 */
export function queryForLayout({
  query,
  layout,
  statusKey,
  endKey = null,
  groupKeys = [],
}: {
  query: ViewQuery;
  layout: ViewLayout;
  statusKey: string | null;
  /** The end a calendar spans notes to (`calendarEndKey`), when it reads one. */
  endKey?: string | null;
  /** What a table, a board or a gallery groups by, which its rows must carry to be grouped. */
  groupKeys?: readonly string[];
}): { query: ViewQuery; hidden: readonly string[] } {
  const wanted = [
    statusKey,
    ...(drawsGroups(layout) ? groupKeys : []),
    layout === 'feed' || layout === 'gallery' ? MODIFIED_COLUMN : null,
    layout === 'calendar' ? endKey : null,
  ];
  const hidden = wanted.filter(
    (key, index): key is string =>
      key !== null && !query.columns.includes(key) && wanted.indexOf(key) === index,
  );
  const sorts =
    layout === 'feed' && query.sorts.length === 0
      ? [{ key: MODIFIED_COLUMN, direction: 'desc' as const }]
      : query.sorts;
  return { query: { ...query, columns: [...query.columns, ...hidden], sorts }, hidden };
}
