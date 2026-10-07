/**
 * Finder's order: case-insensitive, with digit runs compared as numbers so
 * "note10" follows "note9".
 *
 * One collator for the whole app, so the tree, the sidebar's sections and
 * anything else that lists notes agree on what alphabetical means.
 */
const COLLATOR = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

export function compareNames(left: string, right: string): number {
  const collated = COLLATOR.compare(left, right);
  if (collated !== 0) return collated;

  // 'base' sensitivity ties `Notes.md` with `notes.md` and `Resume.md` with
  // `Résumé.md`, and a stable sort then returns whichever arrived first — which
  // is a SQL result in one sidebar section and a directory walk in another, so
  // rows would move between refreshes with nothing changed on disk. Code-unit
  // order is an arbitrary way to break the tie, but it is the same every time.
  return left < right ? -1 : left > right ? 1 : 0;
}
