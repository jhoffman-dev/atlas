import { trailingBlockAnchor } from '../markdown/block-anchor.ts';

/** How much of the opening line is worth showing on a card. */
const MAX_SUMMARY = 160;

/**
 * The first thing a note says, for showing what it is about without opening it.
 *
 * Headings are skipped: a note whose first line is its own title would otherwise
 * show that title twice on a card. A block id that ends the line (P26-01) is
 * not something the note says, and is left off.
 */
export function summaryOf(text: string): string {
  for (const line of text.split('\n')) {
    const trimmed = withoutId(line.trim());
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    return trimmed.length > MAX_SUMMARY ? `${trimmed.slice(0, MAX_SUMMARY - 1)}…` : trimmed;
  }
  return '';
}

function withoutId(line: string): string {
  const anchor = trailingBlockAnchor(line);
  return anchor === null ? line : line.slice(0, anchor.start).trimEnd();
}
