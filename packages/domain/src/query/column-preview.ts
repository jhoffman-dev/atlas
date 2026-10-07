/**
 * How many cards a board column shows before "+ N more".
 *
 * Enough to read what a column is about at a glance; a column of 166 done
 * cards is a history, not a to-do list, and drawing all of it pushes every
 * other column's story off the screen.
 */
export const COLUMN_PREVIEW = 4;

/**
 * How much of a column is drawn: the first few cards, and how many are held
 * back behind "+ N more" — none once it has been opened, and none when holding
 * back would hide only one card, since "+ 1 more" costs the same room as the
 * card it hides.
 */
export function columnPreview({
  count,
  expanded,
  limit = COLUMN_PREVIEW,
}: {
  count: number;
  expanded: boolean;
  limit?: number;
}): { readonly shown: number; readonly hidden: number } {
  const all = Math.max(0, Math.floor(count));
  if (expanded || all <= limit + 1) return { shown: all, hidden: 0 };
  const shown = Math.max(0, Math.floor(limit));
  return { shown, hidden: all - shown };
}
