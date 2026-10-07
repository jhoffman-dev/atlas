import type { BodyRange } from '@atlas/domain';
import type { Nodes as MdastNode, Root } from 'mdast';
import './mdast-custom-nodes.ts';

/**
 * Nodes whose words are not plain text: a link's text, a reference, a
 * footnote, a definition. Their text children are markup a mention must not
 * be matched in. Code, maths and HTML carry a value, not text children, so
 * they are never collected.
 */
const NOT_PLAIN: ReadonlySet<string> = new Set([
  'link',
  'linkReference',
  'image',
  'imageReference',
  'footnoteReference',
  'definition',
]);

interface Run extends BodyRange {
  readonly wikiLink: boolean;
}

/**
 * Where the body's plain text nodes are, by offset, in document order. A wiki
 * link is a node of its own to the parser (`wiki-link-syntax.ts`) but text in
 * the file, so it stays inside the run around it, as it always has: then
 * `[[Page]]#heading` is still no tag (ADR-0018).
 */
export function textRangesOf(root: Root): BodyRange[] {
  const runs: Run[] = [];
  collect(root as MdastNode, runs);
  const ranges: { start: number; end: number; wikiLink: boolean }[] = [];
  for (const run of runs) {
    const previous = ranges.at(-1);
    const touching = previous !== undefined && previous.end === run.start;
    if (touching && (previous.wikiLink || run.wikiLink)) {
      previous.end = run.end;
      previous.wikiLink = run.wikiLink;
    } else ranges.push({ ...run });
  }
  return ranges.map(({ start, end }) => ({ start, end }));
}

function collect(node: MdastNode, runs: Run[]): void {
  if (NOT_PLAIN.has(node.type)) return;
  if (node.type === 'text' || node.type === 'wikiLink') {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start !== undefined && end !== undefined)
      runs.push({ start, end, wikiLink: node.type === 'wikiLink' });
    return;
  }
  if ('children' in node) {
    for (const child of node.children) collect(child as MdastNode, runs);
  }
}
