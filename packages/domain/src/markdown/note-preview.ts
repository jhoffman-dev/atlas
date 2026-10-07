import type { EditorDocument, EditorNode } from './editor-node.ts';

/** The frontmatter key a note names its cover image with. */
export const COVER_KEY = 'cover';

/**
 * The image a card is fronted with: the note's `cover:` when it names one,
 * otherwise the first image in its body. Null when it has neither — a card
 * without a picture is a card, not a broken one.
 */
export function noteCover({
  properties,
  doc,
}: {
  properties: Readonly<Record<string, unknown>>;
  doc: EditorDocument;
}): string | null {
  const declared = properties[COVER_KEY];
  if (typeof declared === 'string' && declared.trim() !== '') return declared.trim();
  return firstImage(doc.content);
}

function firstImage(nodes: readonly EditorNode[]): string | null {
  for (const node of nodes) {
    const src = node.attrs?.['src'];
    if (node.type === 'image' && typeof src === 'string' && src !== '') return src;
    const nested = firstImage(node.content ?? []);
    if (nested !== null) return nested;
  }
  return null;
}

/**
 * A note's body without the `# Title` it opens with, when that heading only
 * says again what the card's title already does. A note whose first heading
 * says something else keeps it.
 */
export function bodyWithoutTitle(doc: EditorDocument, title: string): EditorDocument {
  const [first, ...rest] = doc.content;
  const isTitle =
    first?.type === 'heading' &&
    first.attrs?.['level'] === 1 &&
    textOf(first).trim() === title.trim();
  return isTitle ? { type: 'doc', content: rest } : doc;
}

function textOf(node: EditorNode): string {
  return (node.text ?? '') + (node.content ?? []).map(textOf).join('');
}

/** How many blocks a feed shows of a note before "Show more". */
export const FEED_EXCERPT_BLOCKS = 6;

/**
 * The opening of a note, for a feed: its first few blocks, and whether there
 * is more to show. Whole blocks, never a paragraph cut mid-sentence, so what
 * is shown reads as the note does.
 */
export function noteExcerpt(
  doc: EditorDocument,
  blocks: number = FEED_EXCERPT_BLOCKS,
): { doc: EditorDocument; clipped: boolean } {
  if (doc.content.length <= blocks) return { doc, clipped: false };
  return { doc: { type: 'doc', content: doc.content.slice(0, blocks) }, clipped: true };
}
