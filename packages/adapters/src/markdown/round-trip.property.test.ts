import { describe, expect, it } from 'vitest';
import type { EditorDocument } from '@atlas/domain';
import { parseMarkdownBody, serializeMarkdownBody } from './markdown-blocks.ts';

/**
 * The promise Phase 2 makes is that editing one block rewrites that block and
 * nothing else. These tests check it across a document with one of every construct,
 * editing each block in turn and asserting every other block survives byte for byte.
 */
const DOCUMENT = [
  '# Heading',
  '',
  'A paragraph with *emphasis*, **strong**, `code` and a [link](https://example.com).',
  '',
  '* star bullet',
  '* second',
  '',
  '1. first',
  '2. second',
  '',
  '- [ ] unchecked',
  '- [x] checked',
  '',
  '> a quote',
  '',
  '```ts',
  'const x = 1;',
  '```',
  '',
  '| a | b |',
  '| - | - |',
  '| 1 | 2 |',
  '',
  '![image](pic.png)',
  '',
  '<div>raw html</div>',
  '',
  '#multi word# opens a line, with #para/resource beside it.',
  '',
  'Trailing paragraph with a [[wikilink]] and #tag.',
  '',
].join('\n');

const parsed = parseMarkdownBody(DOCUMENT);

describe('editing any single block', () => {
  const indices = parsed.doc.content.map((_, index) => index);

  it('parses the document into the expected number of blocks', () => {
    expect(parsed.blocks.length).toBeGreaterThanOrEqual(10);
  });

  it.each(indices)('leaves every other block byte-identical when block %i changes', (target) => {
    const doc: EditorDocument = {
      type: 'doc',
      content: parsed.doc.content.map((node, index) =>
        index === target
          ? { type: 'paragraph', content: [{ type: 'text', text: 'EDITED' }] }
          : node,
      ),
    };

    const result = serializeMarkdownBody({ originalBody: DOCUMENT, parsed, doc });

    expect(result).toContain('EDITED');
    for (const [index, block] of parsed.blocks.entries()) {
      if (index === target) continue;
      expect(
        result.includes(block.source),
        `block ${index} (${JSON.stringify(block.source.slice(0, 30))}) was altered`,
      ).toBe(true);
    }
  });

  it.each(indices)(
    'leaves the document unchanged when block %i is rewritten as itself',
    (target) => {
      const doc: EditorDocument = {
        type: 'doc',
        content: parsed.doc.content.map((node, index) => (index === target ? { ...node } : node)),
      };
      expect(serializeMarkdownBody({ originalBody: DOCUMENT, parsed, doc })).toBe(DOCUMENT);
    },
  );
});

describe('deleting any single block', () => {
  it.each(parsed.doc.content.map((_, index) => index))(
    'removes block %i and keeps the rest byte-identical',
    (target) => {
      const doc: EditorDocument = {
        type: 'doc',
        content: parsed.doc.content.filter((_, index) => index !== target),
      };
      const result = serializeMarkdownBody({ originalBody: DOCUMENT, parsed, doc });

      for (const [index, block] of parsed.blocks.entries()) {
        if (index === target) continue;
        expect(result.includes(block.source), `block ${index} was altered`).toBe(true);
      }
    },
  );
});
