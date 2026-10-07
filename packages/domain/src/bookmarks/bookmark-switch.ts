import type { EditorNode } from '../markdown/editor-node.ts';
import { paragraphOfEmbed } from '../transclusion/block-embed.ts';
import { BOOKMARK_NODE, linkOfNode, bookmarkNode } from './bookmark.ts';

/*
 * Switching a link between a word in a sentence and a card of its own. A
 * bookmark is a block, so a link in the middle of a paragraph takes the
 * paragraph apart: what came before it stays a paragraph, the card follows,
 * and what came after goes on below it. Only that paragraph changes; the
 * blocks around it keep their bytes (ADR-0003).
 */

/** Whether `node` is a link a paragraph can hand over to a bookmark: a wiki link, not an embed. */
function isLink(node: EditorNode | undefined): boolean {
  return node?.type === 'wikiLink' && node.attrs?.['embed'] !== true;
}

/**
 * The blocks a paragraph becomes when its child at `index` — a wiki link — is
 * shown as a bookmark: the text before it, the bookmark, the text after it.
 * A side with nothing but spaces or line breaks in it is left out, and the
 * spaces the link stood between are dropped with it. The new blocks carry no
 * block id: each is written afresh. Null when there is no link at `index`.
 */
export function paragraphWithBookmark(paragraph: EditorNode, index: number): EditorNode[] | null {
  const content = paragraph.content ?? [];
  const link = content[index];
  if (paragraph.type !== 'paragraph' || link === undefined || !isLink(link)) return null;
  const before = trimmed(content.slice(0, index), 'end');
  const after = trimmed(content.slice(index + 1), 'start');
  return [
    ...(before.length > 0 ? [{ type: 'paragraph', content: before }] : []),
    bookmarkNode(linkOfNode(link)),
    ...(after.length > 0 ? [{ type: 'paragraph', content: after }] : []),
  ];
}

/** Which way a link can be switched: a bookmark to a link, or a link to a bookmark. */
export type LinkSwitch = 'bookmark' | 'link';

/**
 * Which way the link `node` can switch, where it stands: a bookmark back to a
 * link, wherever it is; a wiki link (not an embed) to a card only when its
 * paragraph is one of the note's own blocks (`depth` 1). A card is a
 * top-level block only (ADR-0020), so in a list, a quote, a table or a
 * heading the link stays a link. Null when there is nothing to switch.
 */
export function linkSwitchFor({
  node,
  parent,
  depth,
}: {
  /** The node at the link's position, if any. */
  node: EditorNode | null;
  /** The type of the block the node is in. */
  parent: string;
  /** How deep that block is: 1 for one of the note's own blocks. */
  depth: number;
}): LinkSwitch | null {
  if (node?.type === BOOKMARK_NODE) return 'link';
  if (node === null || !isLink(node)) return null;
  return depth === 1 && parent === 'paragraph' ? 'bookmark' : null;
}

/**
 * A block as it is written inside another block — a quote, a callout, a list
 * item, a table cell. A card is a top-level block only (ADR-0020), and so is a
 * shown block (ADR-0022), so one held anywhere else is written as its link,
 * alone in a paragraph: the link is kept, and reads back as the link it is.
 * Any other block is itself.
 */
export function nestedBlockOf(block: EditorNode): EditorNode {
  return paragraphOfBookmark(block) ?? paragraphOfEmbed(block) ?? block;
}

/** The paragraph a bookmark becomes when it is shown as a link again: the link, alone. */
export function paragraphOfBookmark(bookmark: EditorNode): EditorNode | null {
  if (bookmark.type !== BOOKMARK_NODE) return null;
  const link = linkOfNode(bookmark);
  return {
    type: 'paragraph',
    content: [
      {
        type: 'wikiLink',
        attrs: { target: link.target, heading: link.heading, alias: link.alias },
      },
    ],
  };
}

/** Inline content without the spaces and line breaks at one end. */
function trimmed(nodes: readonly EditorNode[], end: 'start' | 'end'): EditorNode[] {
  const kept = end === 'end' ? [...nodes] : [...nodes].reverse();
  while (kept.length > 0) {
    const last = kept[kept.length - 1]!;
    if (last.type === 'hardBreak') {
      kept.pop();
      continue;
    }
    if (last.type !== 'text') break;
    const text = end === 'end' ? (last.text ?? '').trimEnd() : (last.text ?? '').trimStart();
    if (text !== '') {
      kept[kept.length - 1] = { ...last, text };
      break;
    }
    kept.pop();
  }
  return end === 'end' ? kept : kept.reverse();
}
