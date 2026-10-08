/** The line of a meeting's frontmatter that names its contract, which the mapping always writes. */
const CONTRACT_LINE = /^atlas_import:.*(?:\r?\n|$)/m;

/**
 * A frontmatter block with `lines` put right after its `atlas_import:` line,
 * every other byte as it was; null when the block has no such line.
 *
 * What the import writes goes there rather than at the end, where a property
 * added on another Mac lands: two edits to different lines are separate
 * changes git merges, where two added at one end would conflict.
 */
export function withLinesAfterContract(frontmatter: string, lines: string): string | null {
  const contract = CONTRACT_LINE.exec(frontmatter);
  if (contract === null) return null;
  const end = contract.index + contract[0].length;
  const breakBefore = contract[0].endsWith('\n') ? '' : '\n';
  return `${frontmatter.slice(0, end)}${breakBefore}${lines}${frontmatter.slice(end)}`;
}

const MARKDOWN = /\.(md|markdown)$/i;

/**
 * The link a copy is marked with: its original's path, without the
 * extension. Written from the path alone — never from which other notes
 * share its name, which two Macs can see differently for a moment — so
 * every Mac writes the same link, and it opens the one note it means.
 */
export function duplicateLink(original: string): string {
  return `[[${original.replace(MARKDOWN, '')}]]`;
}
