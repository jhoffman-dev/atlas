import type { Nodes as MdastNode, Root } from 'mdast';
import './mdast-custom-nodes.ts';

/**
 * The words of a note, with the markup removed, for full-text search.
 *
 * Searching the raw source would match `**` and `](` as if they were words, and
 * would miss a phrase split by emphasis. Link targets are kept — `[[Weekly review]]`
 * should be findable by its name — but URLs are not.
 */
export function plainTextOf(root: Root): string {
  const parts: string[] = [];
  collect(root as MdastNode, parts);
  return parts
    .join('')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * Nodes whose words stand apart from what is beside them: blocks, cells and
 * line breaks. Anything else is joined as written, so `[[x]]#tag` stays one
 * run and `**bold**word` one word (A21-04).
 */
const APART: ReadonlySet<string> = new Set([
  'paragraph',
  'heading',
  'code',
  'blockquote',
  'listItem',
  'tableCell',
  'break',
  'thematicBreak',
  'footnoteDefinition',
]);

function collect(node: MdastNode, parts: string[]): void {
  const apart = APART.has(node.type);
  if (apart) parts.push(' ');
  collectWords(node, parts);
  if (apart) parts.push(' ');
}

function collectWords(node: MdastNode, parts: string[]): void {
  switch (node.type) {
    case 'text':
    case 'inlineCode':
    case 'code':
      parts.push(node.value);
      return;
    case 'wikiLink':
      parts.push(node.value);
      return;
    case 'image':
      if (node.alt !== null && node.alt !== undefined) parts.push(node.alt);
      return;
    case 'html':
      return;
    default:
      break;
  }

  if ('children' in node) {
    for (const child of node.children) collect(child as MdastNode, parts);
  }
}
