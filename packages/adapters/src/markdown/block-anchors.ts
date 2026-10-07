import {
  anchorPlaces,
  anchorStyleOf,
  BLOCK_ANCHOR_ATTR,
  blockIdAtEnd,
  standaloneBlockAnchor,
  trailingBlockAnchor,
  type AnchorSlot,
  type EditorNode,
} from '@atlas/domain';
import type { Heading, Nodes, Paragraph, RootContent } from 'mdast';

/*
 * Block ids in the markdown (P26-01, ADR-0022): where the one grammar
 * (`trailingBlockAnchor`) finds one in a paragraph's bytes, and where each id
 * of a block is or would go, so an id added to or taken from a block that was
 * not otherwise changed is the only thing written.
 */

/** A paragraph's id, and the bytes of the body it takes up. */
interface ParagraphAnchor {
  readonly id: string;
  readonly start: number;
  readonly end: number;
}

/** A block that carries its id after its words: a paragraph, or a heading (A26-01). */
type WordsBlock = Paragraph | Heading;

/**
 * The id at the end of a paragraph or a heading, read from its bytes by the
 * one grammar, or null. Its text must end with it too: an id is plain text,
 * never inside a link, code or emphasis, whose bytes end otherwise.
 */
export function paragraphAnchor(paragraph: WordsBlock, body: string): ParagraphAnchor | null {
  const start = paragraph.position?.start.offset;
  const end = paragraph.position?.end.offset;
  if (start === undefined || end === undefined) return null;
  const anchor = trailingBlockAnchor(body.slice(start, end));
  if (anchor === null) return null;
  const last = paragraph.children.at(-1);
  if (last?.type !== 'text' || blockIdAtEnd(last.value)?.id !== anchor.id) return null;
  return { id: anchor.id, start: start + anchor.start, end };
}

/**
 * Editor content with a paragraph's id cut off its end: the last text node,
 * less the `^id` that ends it and the one space or line break the writer puts
 * before it (`editor-to-mdast.ts`), or gone if that was all it held. Any
 * other space before it is the text's own, and stays with it.
 */
export function withoutTrailingAnchor(content: readonly EditorNode[], id: string): EditorNode[] {
  const last = content.at(-1);
  const anchor = last?.type === 'text' ? blockIdAtEnd(last.text ?? '') : null;
  if (last === undefined || anchor === null || anchor.id !== id) return [...content];
  const text = (last.text ?? '').slice(0, anchor.separator);
  const kept = content.slice(0, -1);
  return text === '' ? kept : [...kept, { ...last, text }];
}

/** A paragraph's or a heading's editor node with its id, if it has one, moved off its text. */
export function anchoredParagraph(
  node: EditorNode,
  paragraph: WordsBlock,
  body: string,
): EditorNode {
  const anchor = paragraphAnchor(paragraph, body);
  if (anchor === null) return node;
  return {
    ...node,
    attrs: { ...node.attrs, [BLOCK_ANCHOR_ATTR]: anchor.id },
    content: withoutTrailingAnchor(node.content ?? [], anchor.id),
  };
}

/** Nodes whose insides hold no list item an id could name, as `anchorPlaces` passes them over. */
const OPAQUE: ReadonlySet<string> = new Set(['table', 'code', 'html', 'paragraph', 'heading']);

/**
 * Where each id of a top-level block is or would go, in `anchorPlaces`'s
 * order: each list item's, after its own line, then the block's own — after
 * its text for a paragraph, on a line after it for anything else. `lineAnchor`
 * is an id on a line of its own that the reader gave the block. Null when the
 * markdown and the editor's node do not list the same places.
 */
export function anchorSlots({
  child,
  node,
  body,
  end,
  lineAnchor,
}: {
  child: RootContent;
  node: EditorNode;
  body: string;
  /** Where the block ends, before any id on a line after it. */
  end: number;
  lineAnchor: { readonly id: string; readonly end: number } | null;
}): AnchorSlot[] | null {
  const slots: AnchorSlot[] = [];
  const style = anchorStyleOf(node);
  const modelled = node.type !== 'rawBlock' && node.type !== 'bookmark';
  if (style === 'inline' && (child.type === 'paragraph' || child.type === 'heading')) {
    slots.push(inlineSlot(child, body));
  } else if (modelled) {
    itemSlots(child, body, slots);
  }
  if (style === 'line') {
    slots.push({
      start: end,
      end: lineAnchor?.end ?? end,
      id: lineAnchor?.id ?? null,
      style: 'line',
    });
  }
  return slots.length === anchorPlaces(node).length ? slots : null;
}

function inlineSlot(paragraph: WordsBlock, body: string): AnchorSlot {
  const anchor = paragraphAnchor(paragraph, body);
  if (anchor !== null) return { ...anchor, style: 'inline' };
  const end = paragraph.position?.end.offset ?? 0;
  return { start: end, end, id: null, style: 'inline' };
}

/**
 * The slot of a task whose first line is only its id, after its box
 * (`- [ ] ^id`, A26-01): from the space after the box to the id's end.
 */
function boxSlot(
  item: Extract<Nodes, { type: 'listItem' }>,
  first: Paragraph,
  body: string,
): AnchorSlot | null {
  const start = first.position?.start.offset;
  const end = first.position?.end.offset;
  if (item.checked === null || item.checked === undefined) return null;
  if (start === undefined || end === undefined) return null;
  const id = standaloneBlockAnchor(body.slice(start, end));
  if (id === null) return null;
  let space = start;
  while (space > 0 && (body[space - 1] === ' ' || body[space - 1] === '\t')) space -= 1;
  return { start: space, end, id, style: 'inline' };
}

/** Each list item's slot, outermost first: after the item's own first line of text. */
function itemSlots(node: Nodes, body: string, slots: AnchorSlot[]): void {
  if (node.type === 'listItem') {
    const [first] = node.children;
    if (first?.type === 'paragraph')
      slots.push(boxSlot(node, first, body) ?? inlineSlot(first, body));
  }
  if (OPAQUE.has(node.type) || !('children' in node)) return;
  for (const child of node.children as Nodes[]) itemSlots(child, body, slots);
}
