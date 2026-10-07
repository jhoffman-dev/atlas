/**
 * Turns what someone typed into a full-text query.
 *
 * People type words, not query syntax, and a stray quote or `*` should narrow the
 * search rather than produce an error. Every term is quoted, and the last one gets
 * a prefix match so results appear while typing rather than only on word endings.
 */
export function toSearchQuery(text: string): string | null {
  const terms = text
    .split(/\s+/)
    .map((term) => term.replace(/"/g, '').trim())
    .filter((term) => term !== '');

  if (terms.length === 0) return null;

  return terms
    .map((term, position) => (position === terms.length - 1 ? `"${term}"*` : `"${term}"`))
    .join(' ');
}
