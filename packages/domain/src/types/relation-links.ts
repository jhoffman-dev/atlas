/**
 * The notes a relation links, as the `[[…]]` links its value holds.
 *
 * A relation that holds several notes is a list in the file; one written by
 * hand as a single link is read as a list of one, so adding to it keeps it.
 */
export function linkedNotes(value: unknown): string[] {
  const items = Array.isArray(value) ? value : [value];
  return items
    .filter((item) => item !== null && item !== undefined)
    .map((item) => String(item))
    .filter((item) => item.trim() !== '');
}

/** The relation's value with `link` in it: added to a list, or in place of the one note. */
export function withLink({
  value,
  link,
  many,
}: {
  value: unknown;
  link: string;
  many: boolean;
}): string | string[] {
  if (!many) return link;
  const links = linkedNotes(value);
  return links.includes(link) ? links : [...links, link];
}

/** The relation's value without `link`; null once nothing is left, so the key is cleared. */
export function withoutLink(value: unknown, link: string): string[] | null {
  const rest = linkedNotes(value).filter((item) => item !== link);
  return rest.length === 0 ? null : rest;
}
