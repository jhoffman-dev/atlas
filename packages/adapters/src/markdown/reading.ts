import { BLOCK_ID_ATTR, type EditorMark, type EditorNode } from '@atlas/domain';

/**
 * What blocks read as in the editor: one token for each node's start and end
 * and one for each character, with the marks on it. Two pieces of markdown
 * that differ only in how they are written — an escape, a verbatim link —
 * read alike; a mark that appears or disappears anywhere does not.
 */
export type Reading = readonly ReadToken[];

interface ReadToken {
  readonly key: string;
  /**
   * The key without the link GFM makes of an address typed as plain text, on
   * a character inside one (else null). Such a link is what Obsidian shows for
   * that text too, so a document that has the text unlinked reads the same.
   */
  readonly unlinked: string | null;
}

export function readingOf(nodes: readonly EditorNode[]): Reading {
  const tokens: ReadToken[] = [];
  const visit = (node: EditorNode) => {
    if (node.type === 'text') {
      tokens.push(...characterTokens(node));
      return;
    }
    const opening = `<${node.type} ${canonical(node.type, node.attrs)} ${marksKey(node.marks ?? [])}`;
    tokens.push({ key: opening, unlinked: null });
    if (node.content === undefined) return;
    const content = TEXT_BLOCKS.has(node.type) ? endTrimmed(node.content) : node.content;
    mergedText(content).forEach(visit);
    tokens.push({ key: `</${node.type}>`, unlinked: null });
  };
  nodes.forEach(visit);
  return tokens;
}

/**
 * Whether `candidate` reads as `document` does. The only difference allowed
 * is one way round: an address the document holds as plain text may read back
 * as the link GFM makes of it. A link the document has must read back as
 * that link, and one it lacks may not appear on anything else.
 */
export function readsAs(candidate: Reading, document: Reading): boolean {
  if (candidate.length !== document.length) return false;
  return candidate.every((token, index) => {
    const expected = document[index]!.key;
    return token.key === expected || token.unlinked === expected;
  });
}

/** Blocks whose trailing whitespace the writer drops (see `endTrimmed` there). */
const TEXT_BLOCKS: ReadonlySet<string> = new Set(['paragraph', 'heading']);

function characterTokens(node: EditorNode): ReadToken[] {
  const value = node.text ?? '';
  const marks = node.marks ?? [];
  const key = marksKey(marks);
  const autolink = marks.find((mark) => isAutolinkOf(mark, value));
  const unlinked = autolink === undefined ? null : marksKey(marks.filter((m) => m !== autolink));
  return [...value].map((character) => ({
    key: `${character} ${key}`,
    unlinked: unlinked === null ? null : `${character} ${unlinked}`,
  }));
}

/** Whether `mark` is the link GFM reads `value`, typed bare, as. */
function isAutolinkOf(mark: EditorMark, value: string): boolean {
  if (mark.type !== 'link' || (mark.attrs?.['title'] ?? null) !== null) return false;
  const href = mark.attrs?.['href'];
  return href === value || href === `mailto:${value}` || href === `http://${value}`;
}

function marksKey(marks: readonly EditorMark[]): string {
  return marks
    .map((mark) => `${mark.type}${canonical(mark.type, mark.attrs)}`)
    .sort()
    .join(',');
}

/**
 * The attributes markdown can say, by node or mark type: those the writer
 * (`editor-to-mdast.ts`) writes and the reader gives back. The editor adds
 * others markdown has no way to hold — a link's `target` and `rel`, a cell's
 * `colspan` — which neither writing reads. A type not listed keeps them all.
 */
const EXPRESSED: Readonly<Record<string, readonly string[]>> = {
  // A block id is read off a paragraph's or an item's text (P26-01).
  paragraph: ['anchor'],
  heading: ['level'],
  blockquote: [],
  callout: ['kind', 'title', 'fold'],
  codeBlock: ['language'],
  bulletList: [],
  orderedList: ['start'],
  taskList: [],
  listItem: ['anchor'],
  taskItem: ['checked', 'anchor'],
  table: ['align'],
  tableRow: [],
  tableHeader: [],
  tableCell: [],
  horizontalRule: [],
  hardBreak: [],
  image: ['src', 'alt', 'title'],
  wikiLink: ['target', 'heading', 'alias', 'embed'],
  bookmark: ['target', 'heading', 'alias'],
  blockEmbed: ['target', 'heading', 'alias'],
  link: ['href', 'title'],
  bold: [],
  italic: [],
  strike: [],
  code: [],
};

/**
 * The attributes markdown can say, keys in order, leaving out empty ones
 * (null, false) and the block id.
 */
function canonical(type: string, attrs: Readonly<Record<string, unknown>> | undefined): string {
  const expressed = EXPRESSED[type];
  const kept = Object.entries(attrs ?? {})
    .filter(
      ([key]) => key !== BLOCK_ID_ATTR && (expressed === undefined || expressed.includes(key)),
    )
    .filter(([, value]) => value !== null && value !== undefined && value !== false)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return kept.length === 0 ? '' : JSON.stringify(kept);
}

/** Adjacent text with the same marks as one run, so a link over it is seen whole. */
function mergedText(nodes: readonly EditorNode[]): EditorNode[] {
  const merged: EditorNode[] = [];
  for (const node of nodes) {
    const previous = merged.at(-1);
    const same =
      previous?.type === 'text' &&
      node.type === 'text' &&
      marksKey(previous.marks ?? []) === marksKey(node.marks ?? []);
    if (same) merged[merged.length - 1] = { ...previous, text: `${previous.text}${node.text}` };
    else merged.push(node);
  }
  return merged;
}

/** The content without the whitespace that ends it, as the writer leaves it. */
function endTrimmed(nodes: readonly EditorNode[]): EditorNode[] {
  const trimmed = [...nodes];
  for (let last = trimmed.at(-1); last?.type === 'text'; last = trimmed.at(-1)) {
    if ((last.marks ?? []).some((mark) => mark.type === 'code')) break;
    const text = (last.text ?? '').replace(/\s+$/, '');
    if (text !== '') {
      trimmed[trimmed.length - 1] = { ...last, text };
      break;
    }
    trimmed.pop();
  }
  return trimmed;
}
