import {
  blockEmbedNode,
  formatWikiLink,
  linkOfNode,
  shownBlockLink,
  type EditorNode,
} from '@atlas/domain';
import type { Paragraph } from 'mdast';
import './mdast-custom-nodes.ts';

/**
 * A top-level block as read, or the shown block it stands as (P26-03,
 * ADR-0022): a paragraph that is an embed of a note's block or heading,
 * `![[Note#^id]]`, and nothing else — the one rule, `shownBlockLink`.
 */
export function shownBlockOr(node: EditorNode | null): EditorNode | null {
  const link = node === null ? null : shownBlockLink(node, { topLevel: true });
  return link === null ? node : blockEmbedNode(link);
}

/** A shown block as markdown writes it: its embed, alone in a paragraph. */
export function embedToMdast(node: EditorNode): Paragraph {
  return {
    type: 'paragraph',
    children: [{ type: 'wikiLink', value: formatWikiLink({ ...linkOfNode(node), embed: true }) }],
  };
}
