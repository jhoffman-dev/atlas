import type { EditorNode } from './editor-node.ts';
import { wikiLinkLabel } from './wikilink.ts';

/**
 * A node's words as they read: its text, a link's label, an image's
 * description, and a line break as a space. What a card's summary and a
 * block's preview show of it.
 */
export function nodeText(node: EditorNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return ' ';
  if (node.type === 'wikiLink') return wikiLinkLabel(linkAttrs(node));
  if (node.type === 'image') {
    const alt = node.attrs?.['alt'];
    return typeof alt === 'string' ? alt : '';
  }
  return (node.content ?? []).map(nodeText).join('');
}

function linkAttrs(node: EditorNode) {
  const attrs = node.attrs ?? {};
  const text = (key: string) => (typeof attrs[key] === 'string' ? attrs[key] : null);
  return { target: text('target') ?? '', heading: text('heading'), alias: text('alias') };
}
