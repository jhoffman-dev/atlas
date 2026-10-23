import type { ReaderReveal } from '@dfai/ui';

/**
 * What the reader says when asked to show a highlight its PDF's note does
 * not have — `[[file.pdf#^id]]` with an id from elsewhere — once the note's
 * highlights are read (`ids`; null until they are). Otherwise it would wait
 * for a highlight that is never placed, and say nothing.
 */
export function missingHighlightNotice(
  reveal: ReaderReveal | null,
  ids: readonly string[] | null,
): string | null {
  if (reveal === null || !('id' in reveal) || ids === null || ids.includes(reveal.id)) return null;
  return `Couldn't find the highlight ^${reveal.id} in this PDF's note.`;
}
