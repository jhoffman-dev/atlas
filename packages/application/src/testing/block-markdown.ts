import { BLOCK_ID_ATTR, blockIdOf, type ParsedBody, type SourceBlock } from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import { fakeMarkdown } from './fake-ports.ts';

/**
 * A markdown port that knows blocks: each run of non-blank lines is one, and
 * its node carries its id, so a save can be checked for writing untouched
 * blocks back from their own bytes. A changed block is written as its node's
 * text with `(written)` after it, so a test can tell the writer's output from
 * the original bytes. Test support only; the real one is remark's.
 */
export function blockMarkdown(): MarkdownPort {
  let next = 0;
  const parseBody = (body: string): ParsedBody => {
    const blocks: SourceBlock[] = [];
    const pattern = /[^\n]+(?:\n[^\n]+)*/g;
    for (const match of body.matchAll(pattern)) {
      if (match[0].trim() === '') continue;
      next += 1;
      const start = match.index;
      blocks.push({
        id: `b${next}`,
        index: blocks.length,
        source: match[0],
        start,
        end: start + match[0].length,
        normalized: match[0],
      });
    }
    const content = blocks.map((block) => ({
      type: 'paragraph',
      attrs: { [BLOCK_ID_ATTR]: block.id },
      content: [{ type: 'text', text: block.source }],
    }));
    return { blocks, doc: { type: 'doc', content } };
  };
  return {
    ...fakeMarkdown(),
    parseBody,
    serializeBody: ({ parsed, doc }) => {
      const byId = new Map(parsed.blocks.map((block) => [block.id, block]));
      const pieces = doc.content.map((node) => {
        const block = byId.get(blockIdOf(node) ?? '');
        return block?.source ?? `${node.content?.[0]?.text ?? ''} (written)`;
      });
      return pieces.length === 0 ? '' : `${pieces.join('\n\n')}\n`;
    },
  };
}
